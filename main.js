const { app, BrowserWindow, globalShortcut, nativeTheme, Tray, Menu, nativeImage, screen, ipcMain, shell, safeStorage, Notification } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const Database = require('better-sqlite3');
const { registry: toolRegistry } = require('./tools');
const { autoUpdater } = require('electron-updater');

// ===== 자동 업데이트 설정 =====
autoUpdater.autoDownload = false;  // 수동으로 다운로드 시작
autoUpdater.autoInstallOnAppQuit = true;

// Config file path
function getConfigPath() {
  const appName = 'handsub';
  let configDir;
  if (process.platform === 'darwin') {
    configDir = path.join(os.homedir(), 'Library', 'Application Support', appName);
  } else if (process.platform === 'win32') {
    configDir = path.join(process.env.APPDATA || os.homedir(), appName);
  } else {
    configDir = path.join(os.homedir(), '.config', appName);
  }
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  return path.join(configDir, 'config.json');
}

function loadConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return { shortcut: 'CommandOrControl+Shift+Space' };
}

function saveConfig(config) {
  try {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (e) {
    console.error('Failed to save config:', e);
    return false;
  }
}

let config = loadConfig();
let currentShortcut = config.shortcut || 'CommandOrControl+Shift+Space';
let newMemoShortcut = config.newMemoShortcut || 'CommandOrControl+Shift+N';

// 창 위치/크기 기본값
const DEFAULT_WINDOW_BOUNDS = { width: 650, height: 500 };

function getWindowBounds() {
  return config.windowBounds || DEFAULT_WINDOW_BOUNDS;
}

function saveWindowBounds(bounds) {
  // 크기만 저장 (위치는 저장하지 않음)
  config.windowBounds = {
    width: bounds.width,
    height: bounds.height
  };
  saveConfig(config);
}

// ===== First Run Detection =====
function isFirstRun() {
  if (config.firstRun === undefined) {
    config.firstRun = true;
    saveConfig(config);
    return true;
  }
  return false;
}

function markFirstRunComplete() {
  config.firstRun = false;
  saveConfig(config);
}

// ===== Auto Launch Setup =====
function getAutoLaunchEnabled() {
  // 기본값은 false (비활성화)
  if (config.autoLaunch === undefined) {
    config.autoLaunch = false;
    saveConfig(config);
  }
  return config.autoLaunch;
}

function setAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true, // 백그라운드로 시작
  });
  config.autoLaunch = enabled;
  saveConfig(config);
}

// 앱 시작 시 자동 실행 설정 적용
function initAutoLaunch() {
  const enabled = getAutoLaunchEnabled();
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
  });
}

// ===== Notification Settings =====
function getNotificationEnabled() {
  // 기본값은 true (활성화)
  if (config.notificationEnabled === undefined) {
    config.notificationEnabled = true;
    saveConfig(config);
  }
  return config.notificationEnabled;
}

function setNotificationEnabled(enabled) {
  config.notificationEnabled = enabled;
  saveConfig(config);

  // 알림 활성화 시 테스트 알림 보내기 (권한 요청 트리거)
  if (enabled) {
    const notification = new Notification({
      title: 'handsub',
      body: '알림이 활성화되었습니다',
      silent: true
    });
    notification.show();
  }
}

// ===== Database Setup (single instance in main process) =====
function getAppDataPath() {
  const appName = 'handsub';
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName);
  } else if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), appName);
  } else {
    return path.join(os.homedir(), '.config', appName);
  }
}

const dataDir = getAppDataPath();
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 이미지 저장 폴더
const imagesDir = path.join(dataDir, 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'handsub.db');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS memos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT DEFAULT '',
    pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// pinned 컬럼 없으면 추가 (기존 DB 호환)
try {
  db.exec(`ALTER TABLE memos ADD COLUMN pinned INTEGER DEFAULT 0`);
} catch (e) {
  // 이미 존재하면 무시
}

// uuid 컬럼 추가 (협업용 고유 ID)
try {
  db.exec(`ALTER TABLE memos ADD COLUMN uuid TEXT`);
} catch (e) {
  // 이미 존재하면 무시
}

// received_from 컬럼 추가 (보낸 사람 이메일)
try {
  db.exec(`ALTER TABLE memos ADD COLUMN received_from TEXT`);
} catch (e) {
  // 이미 존재하면 무시
}

// transfer_id 컬럼 추가 (받은 메모 전달 ID)
try {
  db.exec(`ALTER TABLE memos ADD COLUMN transfer_id INTEGER`);
} catch (e) {
  // 이미 존재하면 무시
}

// is_read 컬럼 추가 (받은 메모 읽음 여부)
try {
  db.exec(`ALTER TABLE memos ADD COLUMN is_read INTEGER DEFAULT 1`);
} catch (e) {
  // 이미 존재하면 무시
}

// last_notified_at 컬럼 추가 (알림 시간 - 채팅 정렬용)
try {
  db.exec(`ALTER TABLE memos ADD COLUMN last_notified_at INTEGER`);
} catch (e) {
  // 이미 존재하면 무시
}

// 기존 메모에 UUID 부여
const memosWithoutUuid = db.prepare('SELECT id FROM memos WHERE uuid IS NULL').all();
memosWithoutUuid.forEach(memo => {
  db.prepare('UPDATE memos SET uuid = ? WHERE id = ?').run(crypto.randomUUID(), memo.id);
});

// Operations 테이블 (변경사항 저장 - 협업 동기화용)
db.exec(`
  CREATE TABLE IF NOT EXISTS operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memo_uuid TEXT NOT NULL,
    op_type TEXT NOT NULL,
    op_data TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    synced INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Operations 인덱스
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ops_memo ON operations(memo_uuid)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ops_synced ON operations(synced)`);
} catch (e) {
  // 이미 존재하면 무시
}

// 링크 미리보기 캐시 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS link_cache (
    url TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    image TEXT,
    favicon TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 단축어(스니펫) 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS snippets (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    shortcut TEXT NOT NULL,
    name TEXT,
    icon TEXT,
    config TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 기존 테이블에 icon 컬럼이 없으면 추가 (마이그레이션)
try {
  const columns = db.prepare("PRAGMA table_info(snippets)").all();
  const hasIcon = columns.some(col => col.name === 'icon');
  if (!hasIcon) {
    db.exec('ALTER TABLE snippets ADD COLUMN icon TEXT');
  }
} catch (e) {
  console.error('Migration error:', e);
}

// 연락처 캐시 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    avatar_url TEXT,
    is_favorite INTEGER DEFAULT 0,
    last_sent_at DATETIME,
    server_id TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 설정 동기화 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS settings_sync (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    synced_at INTEGER DEFAULT 0
  );
`);

// 연락처 그룹 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS contact_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#007AFF',
    sort_order INTEGER DEFAULT 0,
    server_id TEXT,
    synced_at INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 그룹 멤버 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS contact_group_members (
    contact_email TEXT NOT NULL,
    group_id TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contact_email, group_id),
    FOREIGN KEY (group_id) REFERENCES contact_groups(id) ON DELETE CASCADE
  );
`);

// 리마인더 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memo_id INTEGER,
    text TEXT NOT NULL,
    remind_at INTEGER NOT NULL,
    notified INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (memo_id) REFERENCES memos(id) ON DELETE CASCADE
  );
`);

// 리마인더 컬럼 마이그레이션
try {
  const reminderColumns = db.prepare("PRAGMA table_info(reminders)").all().map(c => c.name);
  if (!reminderColumns.includes('notified')) {
    db.exec('ALTER TABLE reminders ADD COLUMN notified INTEGER DEFAULT 0');
  }
  if (!reminderColumns.includes('text')) {
    db.exec('ALTER TABLE reminders ADD COLUMN text TEXT');
  }
  if (!reminderColumns.includes('memo_id')) {
    db.exec('ALTER TABLE reminders ADD COLUMN memo_id INTEGER');
  }
  if (!reminderColumns.includes('remind_at')) {
    db.exec('ALTER TABLE reminders ADD COLUMN remind_at INTEGER');
  }
} catch (e) {
  // 테이블이 없으면 무시 (위에서 생성됨)
}

// 리마인더 인덱스
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(remind_at, notified)`);
} catch (e) {
  // 이미 존재하면 무시
}

// 알림 이력 테이블 (채팅 스타일 표시용)
db.exec(`
  CREATE TABLE IF NOT EXISTS notification_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'reminder',
    text TEXT NOT NULL,
    memo_id INTEGER,
    from_email TEXT,
    read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

// 알림 이력 인덱스
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notification_read ON notification_history(read, created_at)`);
} catch (e) {
  // 이미 존재하면 무시
}

// snippets 테이블 동기화 컬럼 추가 (마이그레이션)
const snippetColumns = db.prepare("PRAGMA table_info(snippets)").all().map(c => c.name);
if (!snippetColumns.includes('synced_at')) {
  db.exec(`ALTER TABLE snippets ADD COLUMN synced_at INTEGER DEFAULT 0`);
}
if (!snippetColumns.includes('updated_at')) {
  db.exec(`ALTER TABLE snippets ADD COLUMN updated_at INTEGER`);
  // 기존 데이터에 현재 시간 설정
  db.exec(`UPDATE snippets SET updated_at = ${Date.now()} WHERE updated_at IS NULL`);
}

// ===== Input Validation Helpers =====
function isValidId(id) {
  return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

function isValidContent(content) {
  return typeof content === 'string' && content.length <= 1000000; // 1MB limit
}

function isValidShortcut(shortcut) {
  if (typeof shortcut !== 'string' || shortcut.length > 100) return false;
  // 허용된 키 조합만 허용
  const validPattern = /^(CommandOrControl|Ctrl|Command|Alt|Shift)(\+(CommandOrControl|Ctrl|Command|Alt|Shift))*\+[A-Z0-9]$/;
  return validPattern.test(shortcut);
}

// ===== Memo IPC Handlers =====
ipcMain.handle('memo-getAll', () => {
  // 채팅 스타일 정렬: 알림/공유 온 메모 → 고정 → 최신순
  return db.prepare(`
    SELECT * FROM memos
    ORDER BY
      pinned DESC,
      (CASE WHEN last_notified_at IS NOT NULL AND is_read = 0 THEN last_notified_at ELSE 0 END) DESC,
      updated_at DESC
  `).all();
});

ipcMain.handle('memo-togglePin', (_event, id) => {
  if (!isValidId(id)) return false;
  const memo = db.prepare('SELECT pinned FROM memos WHERE id = ?').get(id);
  if (!memo) return false;
  const newPinned = memo.pinned ? 0 : 1;
  db.prepare('UPDATE memos SET pinned = ? WHERE id = ?').run(newPinned, id);
  // 모든 창에 메모 변경 알림
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('memos-updated');
    }
  });
  return newPinned === 1;
});

ipcMain.handle('memo-get', (_, id) => {
  if (!isValidId(id)) return null;
  return db.prepare('SELECT * FROM memos WHERE id = ?').get(id);
});

ipcMain.handle('memo-create', () => {
  const uuid = crypto.randomUUID();
  const result = db.prepare("INSERT INTO memos (content, uuid) VALUES ('', ?)").run(uuid);
  return {
    id: result.lastInsertRowid,
    uuid: uuid,
    content: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
});

ipcMain.handle('memo-update', (event, id, content) => {
  if (!isValidId(id) || !isValidContent(content)) return false;
  db.prepare('UPDATE memos SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(content, id);
  // 모든 창에 메모 변경 알림
  BrowserWindow.getAllWindows().forEach(w => {
    if (w.webContents !== event.sender && !w.isDestroyed()) {
      w.webContents.send('memos-updated');
    }
  });
  return true;
});

ipcMain.handle('memo-delete', (_, id) => {
  if (!isValidId(id)) return false;
  db.prepare('DELETE FROM memos WHERE id = ?').run(id);
  return true;
});

// ===== Snippet IPC Handlers =====
function isValidSnippetType(type) {
  return toolRegistry.isValidType(type);
}

function isValidSnippetShortcut(shortcut) {
  return typeof shortcut === 'string' && shortcut.length > 0 && shortcut.length <= 50;
}

function isValidSnippetConfig(config, type) {
  if (typeof config !== 'object' || !config) return false;

  // URL이 있으면 형식 검증
  if (config.url) {
    if (typeof config.url !== 'string') return false;
    try {
      new URL(config.url);
    } catch {
      return false;
    }
  }

  if (type === 'http' && config.method) {
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    if (!validMethods.includes(config.method)) return false;
  }
  return true;
}

ipcMain.handle('snippet-getAll', () => {
  const snippets = db.prepare('SELECT * FROM snippets ORDER BY created_at DESC').all();

  // 도구 폴더의 icon.png 또는 meta.icon 가져오기
  return snippets.map(s => ({
    ...s,
    icon: s.icon || toolRegistry.getIcon(s.type)
  }));
});

ipcMain.handle('snippet-create', (_, { type, shortcut, name, icon, config }) => {
  if (!isValidSnippetType(type)) return { success: false, error: 'Invalid type' };
  if (!isValidSnippetShortcut(shortcut)) return { success: false, error: 'Invalid shortcut' };
  if (!isValidSnippetConfig(config, type)) return { success: false, error: 'Invalid config' };

  const id = crypto.randomUUID();
  const configJson = JSON.stringify(config);

  try {
    db.prepare('INSERT INTO snippets (id, type, shortcut, name, icon, config) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, type, shortcut.toLowerCase(), name || shortcut, icon || null, configJson);
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('snippet-update', (_, { id, type, shortcut, name, icon, config }) => {
  if (typeof id !== 'string') return { success: false, error: 'Invalid id' };
  if (!isValidSnippetType(type)) return { success: false, error: 'Invalid type' };
  if (!isValidSnippetShortcut(shortcut)) return { success: false, error: 'Invalid shortcut' };
  if (!isValidSnippetConfig(config, type)) return { success: false, error: 'Invalid config' };

  const configJson = JSON.stringify(config);

  try {
    db.prepare('UPDATE snippets SET type = ?, shortcut = ?, name = ?, icon = ?, config = ? WHERE id = ?')
      .run(type, shortcut.toLowerCase(), name || shortcut, icon || null, configJson, id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('snippet-delete', (_, id) => {
  if (typeof id !== 'string') return false;
  db.prepare('DELETE FROM snippets WHERE id = ?').run(id);
  return true;
});

// 도구 목록 조회
ipcMain.handle('tools-list', () => {
  return toolRegistry.list();
});

// 도구 스키마 조회
ipcMain.handle('tools-schema', (_, type) => {
  return toolRegistry.getSchema(type);
});

// 도구 연결 상태 조회
ipcMain.handle('tools-get-connections', () => {
  return config.toolConnections || {};
});

// 도구 연결 설정
ipcMain.handle('tools-connect', (_, toolId, credentials) => {
  if (!config.toolConnections) {
    config.toolConnections = {};
  }
  config.toolConnections[toolId] = {
    connected: true,
    credentials,
    connectedAt: Date.now()
  };
  saveConfig(config);
  return true;
});

// 도구 연결 해제
ipcMain.handle('tools-disconnect', (_, toolId) => {
  if (config.toolConnections) {
    delete config.toolConnections[toolId];
    saveConfig(config);
  }
  return true;
});

// ===== 매니페스트 도구 IPC Handlers =====

// 매니페스트 도구 목록
ipcMain.handle('manifest-tools-list', () => {
  return toolRegistry.listManifestTools();
});

// 모든 명령어 목록 (단축어용)
ipcMain.handle('manifest-commands-list', () => {
  return toolRegistry.getAllCommands();
});

// 매니페스트 도구 설정 조회
ipcMain.handle('manifest-tool-settings-get', (_, toolId) => {
  if (!config.manifestToolSettings) config.manifestToolSettings = {};
  return config.manifestToolSettings[toolId] || {};
});

// 매니페스트 도구 설정 저장
ipcMain.handle('manifest-tool-settings-save', (_, toolId, settings) => {
  if (!config.manifestToolSettings) config.manifestToolSettings = {};
  config.manifestToolSettings[toolId] = settings;
  saveConfig(config);
  return true;
});

// 매니페스트 도구 실행
ipcMain.handle('manifest-tool-execute', async (_, toolId, shortcut, fieldValues) => {
  const settings = config.manifestToolSettings?.[toolId] || {};
  return toolRegistry.executeManifest(toolId, shortcut, fieldValues, settings);
});

// ===== Operations IPC Handlers (협업 동기화용) =====
ipcMain.handle('op-save', (_, memoUuid, opType, opData) => {
  if (typeof memoUuid !== 'string' || typeof opType !== 'string') return false;
  const timestamp = Date.now();
  const dataJson = typeof opData === 'string' ? opData : JSON.stringify(opData);

  db.prepare('INSERT INTO operations (memo_uuid, op_type, op_data, timestamp) VALUES (?, ?, ?, ?)')
    .run(memoUuid, opType, dataJson, timestamp);
  return true;
});

ipcMain.handle('op-get-unsynced', (_, memoUuid) => {
  if (typeof memoUuid !== 'string') return [];
  return db.prepare('SELECT * FROM operations WHERE memo_uuid = ? AND synced = 0 ORDER BY timestamp ASC')
    .all(memoUuid);
});

ipcMain.handle('op-mark-synced', (_, opIds) => {
  if (!Array.isArray(opIds) || opIds.length === 0) return false;
  // 배열 길이 제한 (DoS 방지)
  if (opIds.length > 1000) return false;
  // 모든 요소가 숫자인지 검증
  if (!opIds.every(id => typeof id === 'number' && Number.isInteger(id))) return false;
  const placeholders = opIds.map(() => '?').join(',');
  db.prepare(`UPDATE operations SET synced = 1 WHERE id IN (${placeholders})`).run(...opIds);
  return true;
});

ipcMain.handle('op-get-since', (_, memoUuid, sinceTimestamp) => {
  if (typeof memoUuid !== 'string') return [];
  return db.prepare('SELECT * FROM operations WHERE memo_uuid = ? AND timestamp > ? ORDER BY timestamp ASC')
    .all(memoUuid, sinceTimestamp || 0);
});

// 메모 UUID로 조회
ipcMain.handle('memo-get-by-uuid', (_, uuid) => {
  if (typeof uuid !== 'string') return null;
  return db.prepare('SELECT * FROM memos WHERE uuid = ?').get(uuid);
});

ipcMain.handle('snippet-execute', async (_, id, content, editorContent) => {
  if (id === undefined || id === null) return { success: false, error: 'Invalid id' };

  const snippet = db.prepare('SELECT * FROM snippets WHERE id = ?').get(id);
  if (!snippet) return { success: false, error: 'Snippet not found' };

  const config = JSON.parse(snippet.config);

  // 도구 레지스트리를 통해 실행 (editorContent = 메모장 전체 내용)
  return toolRegistry.execute(snippet.type, config, { content, editorContent });
});

// ===== Image IPC Handlers =====
ipcMain.handle('image-save', async (_, base64Data, mimeType) => {
  try {
    // 입력 검증
    if (typeof base64Data !== 'string' || base64Data.length > 10 * 1024 * 1024) {
      return { success: false, error: 'Invalid image data' };
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) {
      return { success: false, error: 'Invalid image type' };
    }

    const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
    const hash = crypto.createHash('md5').update(base64Data).digest('hex');
    const filename = `${hash}.${ext}`;
    const filepath = path.join(imagesDir, filename);

    // 이미 존재하면 경로만 반환
    if (!fs.existsSync(filepath)) {
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filepath, buffer);
    }

    return { success: true, path: filepath, filename };
  } catch (e) {
    console.error('Failed to save image:', e);
    return { success: false, error: e.message };
  }
});

// ===== Video IPC Handlers =====
ipcMain.handle('video-save', async (_, base64Data, mimeType) => {
  try {
    // 입력 검증 (동영상은 50MB까지 허용)
    // Base64는 원본보다 약 1.37배 크므로, 50MB 원본 = ~68.5MB base64
    if (typeof base64Data !== 'string' || base64Data.length > 70 * 1024 * 1024) {
      return { success: false, error: 'Invalid video data or too large (max 50MB)' };
    }

    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/ogg'];
    if (!allowedTypes.includes(mimeType)) {
      return { success: false, error: 'Invalid video type' };
    }

    // 확장자 매핑
    const extMap = {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'video/x-m4v': 'm4v',
      'video/ogg': 'ogv'
    };
    const ext = extMap[mimeType] || 'mp4';
    const hash = crypto.createHash('md5').update(base64Data.substring(0, 10000)).digest('hex');
    const filename = `${hash}.${ext}`;
    const filepath = path.join(imagesDir, filename);

    // 이미 존재하면 경로만 반환
    if (!fs.existsSync(filepath)) {
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filepath, buffer);
    }

    return { success: true, path: filepath, filename };
  } catch (e) {
    console.error('Failed to save video:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('image-get-path', () => {
  return imagesDir;
});

// ===== SSRF Prevention - 내부 IP 차단 =====
function isPrivateHost(hostname) {
  // localhost 차단
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }

  // IPv4 사설 IP 대역 차단
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Pattern);
  if (match) {
    const [, a, b] = match.map(Number);
    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 127.0.0.0/8
    if (a === 127) return true;
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true;
    // 0.0.0.0
    if (a === 0) return true;
  }

  // IPv6 사설 주소 차단
  if (hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd')) {
    return true;
  }

  return false;
}

// ===== Link Preview IPC Handlers =====
ipcMain.handle('link-fetch-meta', async (_, url) => {
  try {
    // URL 검증
    if (typeof url !== 'string' || url.length > 2000) {
      return { success: false, error: 'Invalid URL' };
    }

    // URL 형식 검증
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { success: false, error: 'Invalid protocol' };
      }
    } catch {
      return { success: false, error: 'Invalid URL format' };
    }

    // SSRF 방지: 내부 IP/localhost 차단
    if (isPrivateHost(parsedUrl.hostname)) {
      return { success: false, error: 'Internal hosts not allowed' };
    }

    // 캐시 확인 (24시간 이내)
    const cached = db.prepare(
      "SELECT * FROM link_cache WHERE url = ? AND fetched_at > datetime('now', '-24 hours')"
    ).get(url);

    if (cached) {
      return {
        success: true,
        data: {
          title: cached.title,
          description: cached.description,
          image: cached.image,
          favicon: cached.favicon,
          url: url
        }
      };
    }

    // YouTube 특별 처리 - 썸네일 직접 생성
    const ytMeta = getYouTubeMeta(url);

    // Fetch with timeout
    const response = await fetchWithTimeout(url, 10000);

    if (!response.ok) {
      // YouTube면 썸네일이라도 반환
      if (ytMeta) {
        return { success: true, data: ytMeta };
      }
      return { success: false, error: 'Failed to fetch' };
    }

    const html = await response.text();
    const meta = parseMetaTags(html, url);

    // YouTube면 썸네일 보강
    if (ytMeta && !meta.image) {
      meta.image = ytMeta.image;
    }

    // 캐시에 저장
    db.prepare(`
      INSERT OR REPLACE INTO link_cache (url, title, description, image, favicon, fetched_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(url, meta.title, meta.description, meta.image, meta.favicon);

    return { success: true, data: meta };
  } catch (e) {
    console.error('[Main] Failed to fetch link meta:', e);
    return { success: false, error: e.message };
  }
});

// Fetch with timeout helper using Node.js https/http
function fetchWithTimeout(url, timeout) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        timeout: timeout
      };

      const timeoutId = setTimeout(() => {
        request.destroy();
        reject(new Error('Timeout'));
      }, timeout);

      const request = client.request(options, (response) => {
        // 리디렉션 처리
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          clearTimeout(timeoutId);
          const redirectUrl = new URL(response.headers.location, url).href;
          fetchWithTimeout(redirectUrl, timeout).then(resolve).catch(reject);
          return;
        }

        let data = '';
        let resolved = false;

        response.on('data', (chunk) => {
          if (resolved) return;
          data += chunk.toString();
          // 처음 50KB만 읽기 (메타 태그는 보통 상단에 있음)
          if (data.length > 50000) {
            resolved = true;
            clearTimeout(timeoutId);
            resolve({
              ok: response.statusCode >= 200 && response.statusCode < 300,
              text: () => Promise.resolve(data)
            });
            response.destroy(); // response를 destroy (request 아님)
          }
        });

        response.on('end', () => {
          if (resolved) return;
          clearTimeout(timeoutId);
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            text: () => Promise.resolve(data)
          });
        });

        response.on('error', (e) => {
          if (resolved) return;
          clearTimeout(timeoutId);
          reject(e);
        });
      });

      request.on('timeout', () => {
        clearTimeout(timeoutId);
        request.destroy();
        reject(new Error('Request timeout'));
      });

      request.on('error', (e) => {
        clearTimeout(timeoutId);
        reject(e);
      });

      request.end();
    } catch (e) {
      reject(e);
    }
  });
}

// YouTube 영상 ID 추출
function extractYouTubeVideoId(url) {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?]+)/,
    /youtube\.com\/embed\/([^?]+)/,
    /youtube\.com\/v\/([^?]+)/,
    /youtube\.com\/shorts\/([^?]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

// YouTube 전용 메타데이터 생성
function getYouTubeMeta(url) {
  const videoId = extractYouTubeVideoId(url);
  if (videoId) {
    return {
      title: '',  // 나중에 HTML에서 파싱
      description: '',
      image: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      favicon: 'https://www.youtube.com/favicon.ico',
      url: url,
      videoId: videoId
    };
  }
  return null;
}

// Parse meta tags from HTML
function parseMetaTags(html, baseUrl) {
  // 메타 태그에서 속성값 추출 (순서에 관계없이)
  const getMetaContent = (_, value) => {
    // property="og:..." 또는 name="..." 형태 모두 지원
    // content가 앞에 오든 뒤에 오든 처리
    const patterns = [
      new RegExp(`<meta[^>]*(?:property|name)=["']${value}["'][^>]*content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${value}["']`, 'i')
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        return decodeHTMLEntities(match[1].trim());
      }
    }
    return '';
  };

  // title 우선순위: og:title > twitter:title > <title>
  let title = getMetaContent('property', 'og:title') ||
              getMetaContent('name', 'twitter:title');
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) title = decodeHTMLEntities(titleMatch[1].trim());
  }

  // description
  const description = getMetaContent('property', 'og:description') ||
                      getMetaContent('name', 'description') ||
                      getMetaContent('name', 'twitter:description');

  // image
  let image = getMetaContent('property', 'og:image') ||
              getMetaContent('name', 'twitter:image') ||
              getMetaContent('name', 'twitter:image:src');

  // 상대 URL을 절대 URL로 변환
  if (image && !image.startsWith('http')) {
    try {
      image = new URL(image, baseUrl).href;
    } catch {}
  }

  // favicon - 다양한 형태 지원
  let favicon = '';
  const faviconPatterns = [
    /<link[^>]*rel=["'](?:shortcut\s+)?icon["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut\s+)?icon["']/i,
    /<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["']/i
  ];
  for (const pattern of faviconPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      favicon = match[1];
      break;
    }
  }

  if (!favicon) {
    try {
      favicon = new URL('/favicon.ico', baseUrl).href;
    } catch {}
  } else if (!favicon.startsWith('http')) {
    try {
      favicon = new URL(favicon, baseUrl).href;
    } catch {}
  }

  return { title, description, image, favicon, url: baseUrl };
}

// HTML 엔티티 디코딩
function decodeHTMLEntities(text) {
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    '&nbsp;': ' ', '&#x27;': "'", '&#x2F;': '/'
  };
  return text.replace(/&[^;]+;/g, (entity) => entities[entity] || entity);
}

// 빠른 전달 단축키
const quickShareShortcut = process.platform === 'darwin' ? 'Command+Shift+S' : 'Ctrl+Shift+S';

function registerShortcuts() {
  globalShortcut.unregisterAll();

  // 열기 단축키 (기존 메모 보기)
  try {
    globalShortcut.register(currentShortcut, () => {
      showWindowAtCursor();
    });
  } catch (e) {
    console.error('Failed to register open shortcut:', e);
  }

  // 새 메모 단축키
  try {
    globalShortcut.register(newMemoShortcut, () => {
      showNewMemo();
    });
  } catch (e) {
    console.error('Failed to register new memo shortcut:', e);
  }

  // 빠른 전달 단축키
  try {
    globalShortcut.register(quickShareShortcut, () => {
      if (win && !win.isDestroyed()) {
        // 창이 보이지 않으면 먼저 표시
        if (!win.isVisible()) {
          showWindowAtCursor();
        }
        // 빠른 전달 이벤트 전송
        win.webContents.send('quick-share-trigger');
      }
    });
  } catch (e) {
    console.error('Failed to register quick share shortcut:', e);
  }
}

// 새 메모 - 현재 창에서 빈 메모로 전환
function showNewMemo() {
  const savedBounds = getWindowBounds();
  const winWidth = savedBounds.width || DEFAULT_WINDOW_BOUNDS.width;
  const winHeight = savedBounds.height || DEFAULT_WINDOW_BOUNDS.height;

  // 창이 보이지 않을 때만 위치 변경 (이미 열린 상태면 현재 위치 유지)
  if (!win.isVisible()) {
    // 커서가 있는 모니터 중앙에 표시
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const { x, y, width, height } = display.workArea;
    const newX = Math.round(x + (width - winWidth) / 2);
    const newY = Math.round(y + (height - winHeight) / 2);

    win.setBounds({ x: newX, y: newY, width: winWidth, height: winHeight });
  }

  // 창 표시 전에 먼저 새 메모 이벤트 전송 (깜빡임 방지)
  win.webContents.send('create-new-memo');

  // 창이 보이지 않으면 표시
  if (!win.isVisible()) {
    // macOS: 현재 데스크탑(Space)에서 열리도록 설정
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.show();
      win.focus();
      setTimeout(() => {
        win.setVisibleOnAllWorkspaces(false);
      }, 50);
    } else {
      win.show();
      win.focus();
    }
  } else {
    win.focus();
  }
}

function registerShortcut(shortcut) {
  try {
    globalShortcut.unregister(currentShortcut);
    const success = globalShortcut.register(shortcut, () => {
      showWindowAtCursor();
    });
    if (success) {
      currentShortcut = shortcut;
      return true;
    }
  } catch (e) {
    console.error('Failed to register shortcut:', e);
  }
  return false;
}

function registerNewMemoShortcut(shortcut) {
  try {
    globalShortcut.unregister(newMemoShortcut);
    const success = globalShortcut.register(shortcut, () => {
      showNewMemo();
    });
    if (success) {
      newMemoShortcut = shortcut;
      return true;
    }
  } catch (e) {
    console.error('Failed to register new memo shortcut:', e);
  }
  return false;
}

function showWindowAtCursor() {
  // 이미 열려있으면 포커스만
  if (win.isVisible()) {
    win.focus();
    return;
  }

  const savedBounds = getWindowBounds();
  const winWidth = savedBounds.width || DEFAULT_WINDOW_BOUNDS.width;
  const winHeight = savedBounds.height || DEFAULT_WINDOW_BOUNDS.height;

  // 커서가 있는 모니터 중앙에 표시
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width, height } = display.workArea;
  const newX = Math.round(x + (width - winWidth) / 2);
  const newY = Math.round(y + (height - winHeight) / 2);

  win.setBounds({ x: newX, y: newY, width: winWidth, height: winHeight });

  // macOS: 현재 데스크탑(Space)에서 열리도록 설정
  if (process.platform === 'darwin') {
    app.focus({ steal: true });
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.show();
    win.focus();
    setTimeout(() => {
      win.setVisibleOnAllWorkspaces(false);
    }, 50);
  } else {
    win.show();
    win.focus();
  }

  // 검색창에 포커스
  win.webContents.send('focus-search');
}

let win;
let settingsWin;
let tray;

function createWindow() {
  const savedBounds = getWindowBounds();

  const isDev = !app.isPackaged;

  win = new BrowserWindow({
    width: savedBounds.width || DEFAULT_WINDOW_BOUNDS.width,
    height: savedBounds.height || DEFAULT_WINDOW_BOUNDS.height,
    minWidth: 300,
    minHeight: 200,
    show: false, // 생성 시 숨김 상태
    frame: false,
    transparent: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    skipTaskbar: true,
    icon: path.join(__dirname, 'logoo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev, // 개발 모드에서만 DevTools 허용
    },
  });

  win.loadFile('index.html');

  // 보안: 외부 URL 네비게이션 차단
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  // 보안: 새 창 열기 차단
  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // ESC는 renderer에서 처리 (스니펫 모드 등 상황에 따라 다르게 동작)

  nativeTheme.on('updated', () => {
    const bg = nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff';
    win.setBackgroundColor(bg);
    if (settingsWin) {
      settingsWin.setBackgroundColor(bg);
    }
  });

  // 창 크기 변경 시 저장 (debounce)
  let resizeTimeout;
  win.on('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (!win.isDestroyed() && !win.isMinimized()) {
        const bounds = win.getBounds();
        saveWindowBounds(bounds);
      }
    }, 500);
  });

  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createSettingsWindow() {
  if (settingsWin) {
    settingsWin.setAlwaysOnTop(true, 'floating');
    settingsWin.show();
    settingsWin.focus();
    return;
  }

  const isDev = !app.isPackaged;

  settingsWin = new BrowserWindow({
    width: 550,
    height: 400,
    frame: false,
    transparent: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev,
    },
  });

  settingsWin.loadFile('settings.html');

  // 보안: 외부 URL 네비게이션 차단
  settingsWin.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  // 보안: 새 창 열기 차단
  settingsWin.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // 클릭/포커스 시 최상단으로
  settingsWin.on('focus', () => {
    settingsWin.setAlwaysOnTop(true, 'floating');
  });

  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  icon = icon.resize({ width: 18, height: 18 });
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('handsub');

  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;

  const openShortcut = config.shortcut || 'Option+Space';
  const newShortcut = config.newMemoShortcut || 'CommandOrControl+Shift+N';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '새 메모',
      accelerator: newShortcut,
      click: () => {
        showNewMemo();
      }
    },
    {
      label: '열기',
      accelerator: openShortcut,
      click: () => {
        showWindowAtCursor();
      }
    },
    {
      label: '설정',
      click: () => {
        createSettingsWindow();
      }
    },
    { type: 'separator' },
    {
      label: '종료',
      click: async () => {
        // 모든 창에 저장 요청 후 종료
        BrowserWindow.getAllWindows().forEach(w => {
          if (!w.isDestroyed()) {
            w.webContents.send('request-save-before-quit');
          }
        });
        // 저장 완료 대기 후 종료
        setTimeout(() => {
          app.isQuitting = true;
          app.quit();
        }, 200);
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

ipcMain.on('close-settings', () => {
  if (settingsWin) {
    settingsWin.close();
  }
});

ipcMain.handle('get-version', () => {
  return app.getVersion();
});

// ===== 자동 업데이트 IPC =====
let updateCheckResult = null;

// 업데이트 확인
ipcMain.handle('check-update', async () => {
  // 개발 모드에서는 업데이트 확인 안함
  if (!app.isPackaged) {
    return { hasUpdate: false };
  }

  try {
    // GitHub 릴리즈 직접 확인 (autoUpdater 대신)
    const pkg = require('./package.json');
    const owner = pkg.build?.publish?.owner;
    const repo = pkg.build?.publish?.repo;

    // GitHub 설정이 안 되어 있으면 업데이트 확인 안함
    if (!owner || !repo || owner === 'YOUR_GITHUB_USERNAME') {
      return { hasUpdate: false };
    }

    const result = await autoUpdater.checkForUpdates();
    if (result?.updateInfo?.version) {
      const currentVersion = app.getVersion();
      const latestVersion = result.updateInfo.version;
      // 버전 비교: 최신 버전이 현재 버전보다 높을 때만 업데이트
      const hasUpdate = isNewerVersion(latestVersion, currentVersion);
      updateCheckResult = {
        hasUpdate,
        currentVersion,
        latestVersion,
        releaseNotes: result.updateInfo.releaseNotes || ''
      };
    } else {
      updateCheckResult = { hasUpdate: false };
    }
    return updateCheckResult;
  } catch (e) {
    console.error('Update check error:', e);
    return { hasUpdate: false };
  }
});

// 버전 비교 함수 (semver 비교)
function isNewerVersion(latest, current) {
  const latestParts = latest.split('.').map(Number);
  const currentParts = current.split('.').map(Number);
  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

// 업데이트 다운로드 시작
ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (e) {
    console.error('Download error:', e);
    return { success: false, error: e.message };
  }
});

// 업데이트 설치 및 재시작
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

// autoUpdater 이벤트 - 설정 창으로 진행률 전송
autoUpdater.on('download-progress', (progress) => {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('update-progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total
    });
  }
});

autoUpdater.on('update-downloaded', () => {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('update-downloaded');
  }
});

autoUpdater.on('error', (error) => {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('update-error', error.message);
  }
});

// 외부 링크 열기 (기본 브라우저에서)
ipcMain.handle('open-external', async (_, url) => {
  try {
    // URL 검증
    if (typeof url !== 'string' || url.length > 2000) {
      return false;
    }
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return false;
    }
    await shell.openExternal(url);
    return true;
  } catch (e) {
    console.error('Failed to open external URL:', e);
    return false;
  }
});

ipcMain.handle('get-auto-launch', () => {
  return getAutoLaunchEnabled();
});

ipcMain.handle('set-auto-launch', (_, enabled) => {
  if (typeof enabled !== 'boolean') return false;
  setAutoLaunch(enabled);
  return true;
});

ipcMain.handle('get-notification-enabled', () => {
  return getNotificationEnabled();
});

ipcMain.handle('set-notification-enabled', (_, enabled) => {
  if (typeof enabled !== 'boolean') return false;
  setNotificationEnabled(enabled);
  return true;
});

ipcMain.handle('get-shortcut', () => {
  return currentShortcut;
});

ipcMain.handle('set-shortcut', (_, shortcut) => {
  if (!isValidShortcut(shortcut)) return false;
  if (registerShortcut(shortcut)) {
    config.shortcut = shortcut;
    saveConfig(config);
    updateTrayMenu();
    return true;
  }
  return false;
});

// 새 메모 단축키
ipcMain.handle('get-new-memo-shortcut', () => {
  return newMemoShortcut;
});

ipcMain.handle('set-new-memo-shortcut', (_, shortcut) => {
  if (!isValidShortcut(shortcut)) return false;
  if (registerNewMemoShortcut(shortcut)) {
    config.newMemoShortcut = shortcut;
    saveConfig(config);
    updateTrayMenu();
    return true;
  }
  return false;
});

// 단축키 일시 중지 (설정 창에서 단축키 입력 시)
ipcMain.handle('suspend-shortcuts', () => {
  globalShortcut.unregisterAll();
  return true;
});

// 단축키 다시 등록
ipcMain.handle('resume-shortcuts', () => {
  registerShortcuts();
  return true;
});

// Snippet trigger key
ipcMain.handle('get-trigger-key', () => {
  return config.snippetTrigger || '/';
});

ipcMain.handle('set-trigger-key', (_, key) => {
  if (typeof key !== 'string' || key.length !== 1) return false;
  config.snippetTrigger = key;
  saveConfig(config);
  // 모든 윈도우에 알림
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('trigger-key-changed', key);
    }
  });
  return true;
});

// Snippet execute key
ipcMain.handle('get-execute-key', () => {
  // Tab에서 Enter로 마이그레이션
  if (config.snippetExecuteKey === 'Tab') {
    config.snippetExecuteKey = 'Enter';
    saveConfig(config);
  }
  return config.snippetExecuteKey || 'Enter';
});

ipcMain.handle('set-execute-key', (_, key) => {
  if (typeof key !== 'string' || key.length === 0) return false;
  config.snippetExecuteKey = key;
  saveConfig(config);
  // 모든 윈도우에 알림
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('execute-key-changed', key);
    }
  });
  return true;
});

// ===== Sync Settings =====
ipcMain.handle('get-sync-server', () => {
  return config.syncServerUrl || '';
});

ipcMain.handle('set-sync-server', (_, url) => {
  if (typeof url !== 'string') return false;
  config.syncServerUrl = url;
  saveConfig(config);
  // 모든 윈도우에 알림
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('sync-server-changed', url);
    }
  });
  return true;
});

// ===== License (암호화 저장) =====
function getLicensePath() {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  return path.join(configDir, 'license.enc');
}

// 기기 고유 ID 생성
function getMachineId() {
  const data = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || '',
    os.totalmem().toString()
  ].join('|');

  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

ipcMain.handle('get-license', () => {
  try {
    const licensePath = getLicensePath();
    if (!fs.existsSync(licensePath)) return null;

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[License] Encryption not available');
      return null;
    }

    const encrypted = fs.readFileSync(licensePath);
    const decrypted = safeStorage.decryptString(encrypted);
    return JSON.parse(decrypted);
  } catch (e) {
    console.error('Failed to get license:', e);
    return null;
  }
});

ipcMain.handle('set-license', (_, licenseData) => {
  try {
    const licensePath = getLicensePath();
    if (!licenseData) {
      if (fs.existsSync(licensePath)) {
        fs.unlinkSync(licensePath);
      }
      return true;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[License] Encryption not available');
      return false;
    }

    const dataStr = JSON.stringify(licenseData);
    const encrypted = safeStorage.encryptString(dataStr);
    fs.writeFileSync(licensePath, encrypted);
    return true;
  } catch (e) {
    console.error('Failed to set license:', e);
    return false;
  }
});

ipcMain.handle('get-machine-id', () => {
  return getMachineId();
});

ipcMain.handle('verify-license', async (_, licenseKey) => {
  try {
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const deviceFingerprint = getMachineId();
    const deviceName = os.hostname();

    const response = await fetchJson(`${serverUrl}/api/license/verify`, {
      method: 'POST',
      body: JSON.stringify({ licenseKey, deviceFingerprint, deviceName })
    });

    return response;
  } catch (e) {
    console.error('[License] Verify error:', e);
    // 오프라인 모드: 로컬 캐시 확인
    const cached = config.lastLicenseVerification;
    const gracePeriod = 7 * 24 * 60 * 60 * 1000; // 7일

    if (cached && (Date.now() - cached.timestamp < gracePeriod)) {
      return { ...cached.result, offline: true };
    }

    return { valid: false, error: 'network_error', offline: true };
  }
});

// JSON fetch helper
function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.request(parsedUrl, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              resolve({ valid: false, ...json });
            }
          } catch (e) {
            // 디버그용: 실제 응답 내용 로그
            console.error(`[FetchJson] Status: ${res.statusCode}, Response: ${data.substring(0, 200)}`);
            reject(new Error(`Invalid JSON response (status: ${res.statusCode})`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// 라이센스 검증 결과 캐시 저장
ipcMain.handle('cache-license-verification', (_, result) => {
  config.lastLicenseVerification = {
    result,
    timestamp: Date.now()
  };
  saveConfig(config);
  return true;
});

// ===== Memo Transfer API =====
ipcMain.handle('memo-send', async (_, recipientKey, content, metadata) => {
  try {
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const license = await getLicenseFromStorage();
    if (!license?.licenseKey) {
      return { success: false, error: 'License required' };
    }

    const response = await fetchJson(`${serverUrl}/api/memo/send`, {
      method: 'POST',
      headers: { 'X-License-Key': license.licenseKey },
      body: JSON.stringify({
        recipientLicenseKey: recipientKey,
        memoContent: content,
        memoMetadata: metadata
      })
    });

    return response;
  } catch (e) {
    console.error('[Memo] Send error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('memo-inbox', async () => {
  try {
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const license = await getLicenseFromStorage();
    if (!license?.licenseKey) {
      return [];
    }

    const response = await fetchJson(`${serverUrl}/api/memo/inbox`, {
      method: 'GET',
      headers: { 'X-License-Key': license.licenseKey }
    });

    return Array.isArray(response) ? response : [];
  } catch (e) {
    console.error('[Memo] Inbox error:', e);
    return [];
  }
});

ipcMain.handle('memo-receive', async (_, transferId) => {
  try {
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const license = await getLicenseFromStorage();
    if (!license?.licenseKey) {
      return { success: false, error: 'License required' };
    }

    const response = await fetchJson(`${serverUrl}/api/memo/receive/${transferId}`, {
      method: 'POST',
      headers: { 'X-License-Key': license.licenseKey }
    });

    return response;
  } catch (e) {
    console.error('[Memo] Receive error:', e);
    return { success: false, error: e.message };
  }
});

// 이메일로 메모 전달
ipcMain.handle('memo-send-by-email', async (_, recipientEmail, content, metadata) => {
  try {
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const license = await getLicenseFromStorage();
    if (!license?.licenseKey) {
      return { success: false, error: 'License required' };
    }

    const response = await fetchJson(`${serverUrl}/api/memo/send-by-email`, {
      method: 'POST',
      headers: { 'X-License-Key': license.licenseKey },
      body: JSON.stringify({
        recipientEmail,
        memoContent: content,
        memoMetadata: metadata
      })
    });

    return response;
  } catch (e) {
    console.error('[Memo] Send by email error:', e);
    return { success: false, error: e.message };
  }
});

// 최근 전달 연락처 조회
ipcMain.handle('memo-contacts', async () => {
  try {
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const license = await getLicenseFromStorage();
    if (!license?.licenseKey) {
      return [];
    }

    const response = await fetchJson(`${serverUrl}/api/memo/contacts`, {
      method: 'GET',
      headers: { 'X-License-Key': license.licenseKey }
    });

    return Array.isArray(response) ? response : [];
  } catch (e) {
    console.error('[Memo] Contacts error:', e);
    return [];
  }
});

// ===== 연락처 캐시 IPC 핸들러 =====

// 로컬 캐시에서 연락처 조회
ipcMain.handle('contacts-cache-getAll', () => {
  try {
    return db.prepare(`
      SELECT * FROM contacts_cache
      ORDER BY is_favorite DESC, last_sent_at DESC
    `).all();
  } catch (e) {
    console.error('[Contacts] Cache getAll error:', e);
    return [];
  }
});

// 연락처 캐시 업데이트 (서버에서 가져온 데이터로)
ipcMain.handle('contacts-cache-upsert', (_, contacts) => {
  if (!Array.isArray(contacts)) return false;
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO contacts_cache
      (email, name, avatar_url, last_sent_at, server_id, synced_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const upsertMany = db.transaction((items) => {
      for (const c of items) {
        stmt.run(c.email, c.name || null, c.avatarUrl || null, c.lastSentAt, c.id || null);
      }
    });

    upsertMany(contacts);
    return true;
  } catch (e) {
    console.error('[Contacts] Cache upsert error:', e);
    return false;
  }
});

// 즐겨찾기 토글
ipcMain.handle('contact-toggle-favorite', async (_, email) => {
  if (!email || typeof email !== 'string') return false;

  try {
    // 로컬 토글
    const contact = db.prepare('SELECT is_favorite FROM contacts_cache WHERE email = ?').get(email);
    const newFavorite = contact?.is_favorite ? 0 : 1;

    db.prepare(`
      UPDATE contacts_cache SET is_favorite = ?, synced_at = CURRENT_TIMESTAMP WHERE email = ?
    `).run(newFavorite, email);

    // 서버 동기화 (백그라운드)
    const license = await getLicenseFromStorage();
    if (license?.licenseKey) {
      const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
      fetchJson(`${serverUrl}/api/memo/contacts/${encodeURIComponent(email)}/favorite`, {
        method: 'POST',
        headers: { 'X-License-Key': license.licenseKey },
        body: JSON.stringify({ favorite: newFavorite === 1 })
      }).catch(() => {});
    }

    return newFavorite === 1;
  } catch (e) {
    console.error('[Contacts] Toggle favorite error:', e);
    return false;
  }
});

// ===== 설정 동기화 IPC 핸들러 =====

// 동기화할 설정 키 목록
const SYNCABLE_SETTINGS = ['shortcut', 'newMemoShortcut', 'snippetTrigger', 'snippetExecuteKey'];

// 단축키를 플랫폼 독립적인 형식으로 변환
function normalizeShortcut(shortcut) {
  if (typeof shortcut !== 'string') return shortcut;
  // Command, Cmd, Ctrl을 CommandOrControl로 통일
  return shortcut
    .replace(/\b(Command|Cmd|Ctrl|Control)\b/gi, 'CommandOrControl')
    .replace(/CommandOrControl\+CommandOrControl/g, 'CommandOrControl'); // 중복 제거
}

// 서버에서 설정 가져오기 (delta sync)
ipcMain.handle('settings-sync-pull', async () => {
  try {
    const license = await getLicenseFromStorage();
    if (!license?.licenseKey) return { success: false, error: 'No license' };

    const lastSync = db.prepare('SELECT MAX(synced_at) as last FROM settings_sync').get().last || 0;
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';

    const response = await fetchJson(`${serverUrl}/api/settings/sync?since=${lastSync}`, {
      method: 'GET',
      headers: { 'X-License-Key': license.licenseKey }
    });

    if (response.settings && response.settings.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO settings_sync (key, value, updated_at, synced_at)
        VALUES (?, ?, ?, ?)
      `);

      for (const setting of response.settings) {
        const local = db.prepare('SELECT updated_at FROM settings_sync WHERE key = ?').get(setting.key);

        // 서버가 더 최신이면 로컬에 적용
        if (!local || setting.updatedAt > local.updated_at) {
          stmt.run(setting.key, setting.value, setting.updatedAt, response.serverTime);

          // config에도 적용
          try {
            config[setting.key] = JSON.parse(setting.value);
          } catch {
            config[setting.key] = setting.value;
          }
        }
      }

      saveConfig(config);
    }

    return { success: true, updated: response.settings?.length || 0 };
  } catch (e) {
    console.error('[Settings] Sync pull error:', e);
    return { success: false, error: e.message };
  }
});

// 설정 변경 시 서버에 푸시
ipcMain.handle('settings-sync-push', async (_, key, value) => {
  if (!SYNCABLE_SETTINGS.includes(key)) return false;

  // 단축키인 경우 플랫폼 독립적 형식으로 변환
  let normalizedValue = value;
  if (key === 'shortcut' || key === 'newMemoShortcut') {
    normalizedValue = normalizeShortcut(value);
  }

  const timestamp = Date.now();

  // 로컬 저장
  db.prepare(`
    INSERT OR REPLACE INTO settings_sync (key, value, updated_at, synced_at)
    VALUES (?, ?, ?, 0)
  `).run(key, JSON.stringify(normalizedValue), timestamp);

  // 서버에 푸시 (백그라운드)
  try {
    const license = await getLicenseFromStorage();
    if (license?.licenseKey) {
      const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
      await fetchJson(`${serverUrl}/api/settings/sync`, {
        method: 'POST',
        headers: { 'X-License-Key': license.licenseKey },
        body: JSON.stringify({ settings: [{ key, value: JSON.stringify(normalizedValue), updatedAt: timestamp }] })
      });

      db.prepare('UPDATE settings_sync SET synced_at = ? WHERE key = ?').run(Date.now(), key);
    }
  } catch (e) {
    // 오프라인 - 나중에 동기화
    console.error('[Settings] Sync push error:', e);
  }

  return true;
});

// ===== 스니펫 동기화 IPC 핸들러 =====

ipcMain.handle('snippets-sync', async () => {
  try {
    const license = await getLicenseFromStorage();
    if (!license?.licenseKey) return { success: false, error: 'No license' };

    const lastSync = db.prepare('SELECT MAX(synced_at) as last FROM snippets WHERE synced_at > 0').get().last || 0;
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';

    // 로컬 변경사항 수집
    const localChanges = db.prepare(`
      SELECT id, type, shortcut, name, config, updated_at as updatedAt
      FROM snippets WHERE (updated_at > synced_at OR synced_at = 0)
    `).all();

    // 서버에 푸시 + 풀
    const response = await fetchJson(`${serverUrl}/api/snippets/sync?since=${lastSync}`, {
      method: 'POST',
      headers: { 'X-License-Key': license.licenseKey },
      body: JSON.stringify({ snippets: localChanges, deletedIds: [] })
    });

    // 서버 변경사항 로컬 적용
    if (response.snippets && response.snippets.length > 0) {
      for (const snippet of response.snippets) {
        const local = db.prepare('SELECT updated_at FROM snippets WHERE id = ?').get(snippet.id);

        if (!local || snippet.updatedAt > local.updated_at) {
          db.prepare(`
            INSERT OR REPLACE INTO snippets (id, type, shortcut, name, config, synced_at, updated_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM snippets WHERE id = ?), CURRENT_TIMESTAMP))
          `).run(snippet.id, snippet.type, snippet.shortcut, snippet.name, snippet.config, response.serverTime, snippet.updatedAt, snippet.id);
        }
      }
    }

    // 삭제된 스니펫 처리
    if (response.deletedIds && response.deletedIds.length > 0) {
      const deleteStmt = db.prepare('DELETE FROM snippets WHERE id = ?');
      for (const id of response.deletedIds) {
        deleteStmt.run(id);
      }
    }

    // 로컬 synced_at 업데이트
    db.prepare('UPDATE snippets SET synced_at = ? WHERE updated_at <= ?')
      .run(response.serverTime, response.serverTime);

    return { success: true };
  } catch (e) {
    console.error('[Snippets] Sync error:', e);
    return { success: false, error: e.message };
  }
});

// ===== 연락처 그룹 IPC 핸들러 =====

// 그룹 목록 조회
ipcMain.handle('groups-getAll', async () => {
  try {
    // 먼저 로컬에서 조회
    const localGroups = db.prepare(`
      SELECT id, name, color, sort_order, server_id,
             (SELECT COUNT(*) FROM contact_group_members WHERE group_id = contact_groups.id) as member_count
      FROM contact_groups
      ORDER BY sort_order ASC, created_at ASC
    `).all();

    // 서버에서 최신 데이터 가져오기 (백그라운드)
    const license = await getLicenseFromStorage();
    if (license?.licenseKey) {
      const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
      fetchJson(`${serverUrl}/api/contacts/groups`, {
        method: 'GET',
        headers: { 'X-License-Key': license.licenseKey }
      }).then(serverGroups => {
        // 서버 데이터로 로컬 업데이트 (나중에 사용)
      }).catch(() => {});
    }

    return localGroups.map(g => ({
      id: g.id,
      name: g.name,
      color: g.color,
      sortOrder: g.sort_order,
      memberCount: g.member_count
    }));
  } catch (e) {
    console.error('[Groups] GetAll error:', e);
    return [];
  }
});

// 그룹 생성
ipcMain.handle('group-create', async (_, { name, color }) => {
  try {
    const id = require('crypto').randomUUID();
    const timestamp = Date.now();

    db.prepare(`
      INSERT INTO contact_groups (id, name, color, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(id, name, color || '#007AFF', timestamp);

    // 서버 동기화 (백그라운드)
    const license = await getLicenseFromStorage();
    if (license?.licenseKey) {
      const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
      fetchJson(`${serverUrl}/api/contacts/groups`, {
        method: 'POST',
        headers: { 'X-License-Key': license.licenseKey },
        body: JSON.stringify({ name, color })
      }).then(res => {
        if (res.group?.id) {
          db.prepare('UPDATE contact_groups SET server_id = ?, synced_at = ? WHERE id = ?')
            .run(res.group.id, Date.now(), id);
        }
      }).catch(() => {});
    }

    return { success: true, id };
  } catch (e) {
    console.error('[Groups] Create error:', e);
    return { success: false, error: e.message };
  }
});

// 그룹 삭제
ipcMain.handle('group-delete', async (_, groupId) => {
  try {
    db.prepare('DELETE FROM contact_groups WHERE id = ?').run(groupId);

    // 서버 동기화 (백그라운드)
    const license = await getLicenseFromStorage();
    if (license?.licenseKey) {
      const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
      fetchJson(`${serverUrl}/api/contacts/groups/${groupId}`, {
        method: 'DELETE',
        headers: { 'X-License-Key': license.licenseKey }
      }).catch(() => {});
    }

    return true;
  } catch (e) {
    console.error('[Groups] Delete error:', e);
    return false;
  }
});

// 그룹에 멤버 추가
ipcMain.handle('group-add-member', async (_, groupId, email) => {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO contact_group_members (contact_email, group_id)
      VALUES (?, ?)
    `).run(email, groupId);

    // 서버 동기화 (백그라운드)
    const license = await getLicenseFromStorage();
    if (license?.licenseKey) {
      const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
      fetchJson(`${serverUrl}/api/contacts/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'X-License-Key': license.licenseKey },
        body: JSON.stringify({ emails: [email] })
      }).catch(() => {});
    }

    return true;
  } catch (e) {
    console.error('[Groups] Add member error:', e);
    return false;
  }
});

// 그룹에서 멤버 제거
ipcMain.handle('group-remove-member', async (_, groupId, email) => {
  try {
    db.prepare('DELETE FROM contact_group_members WHERE group_id = ? AND contact_email = ?')
      .run(groupId, email);

    // 서버 동기화 (백그라운드)
    const license = await getLicenseFromStorage();
    if (license?.licenseKey) {
      const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
      fetchJson(`${serverUrl}/api/contacts/groups/${groupId}/members/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers: { 'X-License-Key': license.licenseKey }
      }).catch(() => {});
    }

    return true;
  } catch (e) {
    console.error('[Groups] Remove member error:', e);
    return false;
  }
});

// 그룹별 연락처 조회
ipcMain.handle('contacts-by-group', (_, groupId) => {
  try {
    if (groupId === 'all') {
      return db.prepare(`
        SELECT * FROM contacts_cache
        ORDER BY is_favorite DESC, last_sent_at DESC
      `).all();
    }

    return db.prepare(`
      SELECT c.* FROM contacts_cache c
      INNER JOIN contact_group_members m ON c.email = m.contact_email
      WHERE m.group_id = ?
      ORDER BY c.is_favorite DESC, c.last_sent_at DESC
    `).all(groupId);
  } catch (e) {
    console.error('[Contacts] By group error:', e);
    return [];
  }
});

// 받은 메모 읽음 처리 (로컬 DB)
ipcMain.handle('memo-mark-read', (_, memoId) => {
  if (!isValidId(memoId)) return false;
  try {
    db.prepare('UPDATE memos SET is_read = 1 WHERE id = ?').run(memoId);
    notifyUnreadCountChange();
    return true;
  } catch (e) {
    console.error('[Memo] Mark read error:', e);
    return false;
  }
});

// 읽지 않은 메모 수 (로컬 DB)
ipcMain.handle('memo-unread-count', () => {
  try {
    return db.prepare('SELECT COUNT(*) as count FROM memos WHERE is_read = 0').get().count;
  } catch (e) {
    return 0;
  }
});

// ===== 리마인더 시스템 =====

// 리마인더 스케줄러 (1분마다 체크)
let reminderInterval = null;

function startReminderScheduler() {
  if (reminderInterval) return;

  reminderInterval = setInterval(() => {
    checkReminders();
  }, 60000); // 1분마다 체크

  // 앱 시작 시 즉시 한 번 체크
  checkReminders();
}

function stopReminderScheduler() {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
}

function checkReminders() {
  try {
    const now = Date.now();
    // 아직 알림 안 보낸 리마인더 중 시간이 된 것들
    const dueReminders = db.prepare(`
      SELECT * FROM reminders
      WHERE notified = 0 AND remind_at <= ?
      ORDER BY remind_at ASC
    `).all(now);

    const notificationEnabled = getNotificationEnabled();

    dueReminders.forEach(reminder => {
      // 알림 활성화 시에만 실제 알림 전송
      if (notificationEnabled) {
        showReminderNotification(reminder);
      }
      // 비활성화 중이라도 지난 리마인더는 처리 완료로 표시
      db.prepare('UPDATE reminders SET notified = 1 WHERE id = ?').run(reminder.id);
    });
  } catch (e) {
    console.error('[Reminder] Check error:', e);
  }
}

function showReminderNotification(reminder) {
  console.log('[Reminder] Showing notification:', reminder.text);

  // 메모 알림 시간 업데이트 (목록 상단으로 이동)
  try {
    const now = Date.now();
    console.log('[Reminder] memo_id:', reminder.memo_id);

    if (reminder.memo_id) {
      db.prepare('UPDATE memos SET last_notified_at = ?, is_read = 0 WHERE id = ?').run(now, reminder.memo_id);
      console.log('[Reminder] Updated last_notified_at for memo:', reminder.memo_id);
    }
  } catch (e) {
    console.error('[Notification] Update error:', e);
  }

  // 모든 창에 메모 목록 갱신 알림
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('memos-updated');
    }
  });

  // macOS 네이티브 알림
  const now = new Date();
  const hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours < 12 ? 'am' : 'pm';
  const hour12 = String(hours % 12 || 12).padStart(2, '0');
  const timeStr = `${ampm}${hour12}:${minutes}`;

  const notification = new Notification({
    title: reminder.text,
    body: timeStr,
    silent: false
  });

  notification.on('click', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) {
      wins[0].show();
      wins[0].focus();
      wins[0].webContents.send('memos-updated');
    }
  });

  notification.show();
}

// 앱 내부 알림 창
function showInAppNotification(message) {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const notifyWin = new BrowserWindow({
    width: 320,
    height: 100,
    x: screenWidth - 340,
    y: 20,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    transparent: true,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const isDark = nativeTheme.shouldUseDarkColors;
  const bgColor = isDark ? '#2d2d2d' : '#ffffff';
  const textColor = isDark ? '#ffffff' : '#1a1a1a';
  const borderColor = isDark ? '#3d3d3d' : '#e5e5e5';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: ${bgColor};
          color: ${textColor};
          border-radius: 12px;
          border: 1px solid ${borderColor};
          overflow: hidden;
          cursor: pointer;
          height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 16px;
        }
        .title {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 6px;
          opacity: 0.7;
        }
        .message {
          font-size: 15px;
          line-height: 1.4;
        }
      </style>
    </head>
    <body onclick="window.close()">
      <div class="title">⏰ handsub 알림</div>
      <div class="message">${message}</div>
    </body>
    </html>
  `;

  notifyWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  // 5초 후 자동 닫기
  setTimeout(() => {
    if (!notifyWin.isDestroyed()) {
      notifyWin.close();
    }
  }, 5000);

  // 클릭 시 메인 창 열기
  notifyWin.webContents.on('before-input-event', () => {
    const wins = BrowserWindow.getAllWindows().filter(w => w !== notifyWin);
    if (wins.length > 0) {
      wins[0].show();
      wins[0].focus();
    }
  });
}

// 리마인더 추가 (같은 텍스트 중복 방지)
ipcMain.handle('reminder-add', (_, { memoId, text, remindAt }) => {
  try {
    // 같은 텍스트의 미완료 리마인더가 있으면 먼저 삭제
    db.prepare('DELETE FROM reminders WHERE text = ? AND notified = 0').run(text);

    const result = db.prepare(`
      INSERT INTO reminders (memo_id, text, remind_at)
      VALUES (?, ?, ?)
    `).run(memoId || null, text, remindAt);
    return { success: true, id: result.lastInsertRowid };
  } catch (e) {
    console.error('[Reminder] Add error:', e);
    return { success: false, error: e.message };
  }
});

// 리마인더 삭제
ipcMain.handle('reminder-delete', (_, id) => {
  try {
    db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
    return { success: true };
  } catch (e) {
    console.error('[Reminder] Delete error:', e);
    return { success: false, error: e.message };
  }
});

// 메모별 리마인더 삭제 (텍스트 기준)
ipcMain.handle('reminder-delete-by-text', (_, text) => {
  try {
    db.prepare('DELETE FROM reminders WHERE text = ? AND notified = 0').run(text);
    return { success: true };
  } catch (e) {
    console.error('[Reminder] Delete by text error:', e);
    return { success: false, error: e.message };
  }
});

// 리마인더 목록 조회
ipcMain.handle('reminder-list', () => {
  try {
    return db.prepare(`
      SELECT * FROM reminders
      WHERE notified = 0
      ORDER BY remind_at ASC
    `).all();
  } catch (e) {
    console.error('[Reminder] List error:', e);
    return [];
  }
});

// 모든 리마인더 삭제 (초기화)
ipcMain.handle('reminder-clear-all', () => {
  try {
    db.prepare('DELETE FROM reminders').run();
    console.log('[Reminder] All reminders cleared');
    return { success: true };
  } catch (e) {
    console.error('[Reminder] Clear all error:', e);
    return { success: false, error: e.message };
  }
});

// 리마인더 업데이트 (시간 변경)
ipcMain.handle('reminder-update', (_, { id, remindAt }) => {
  try {
    db.prepare('UPDATE reminders SET remind_at = ?, notified = 0 WHERE id = ?').run(remindAt, id);
    return { success: true };
  } catch (e) {
    console.error('[Reminder] Update error:', e);
    return { success: false, error: e.message };
  }
});

// 알림 테스트 (즉시 알림 보내기)
ipcMain.handle('reminder-test', () => {
  try {
    showReminderNotification({ text: '알림 테스트입니다!' });
    console.log('[Reminder] Test notification sent');
    return { success: true };
  } catch (e) {
    console.error('[Reminder] Test error:', e);
    return { success: false, error: e.message };
  }
});

// ===== 알림 이력 API =====

// 읽지 않은 알림 조회
ipcMain.handle('notification-get-unread', () => {
  try {
    return db.prepare(`
      SELECT * FROM notification_history
      WHERE read = 0
      ORDER BY created_at DESC
      LIMIT 10
    `).all();
  } catch (e) {
    console.error('[Notification] Get unread error:', e);
    return [];
  }
});

// 알림 읽음 처리
ipcMain.handle('notification-mark-read', (_, id) => {
  try {
    db.prepare('UPDATE notification_history SET read = 1 WHERE id = ?').run(id);
    return { success: true };
  } catch (e) {
    console.error('[Notification] Mark read error:', e);
    return { success: false, error: e.message };
  }
});

// 모든 알림 읽음 처리
ipcMain.handle('notification-mark-all-read', () => {
  try {
    db.prepare('UPDATE notification_history SET read = 1 WHERE read = 0').run();
    return { success: true };
  } catch (e) {
    console.error('[Notification] Mark all read error:', e);
    return { success: false, error: e.message };
  }
});

// 알림 삭제
ipcMain.handle('notification-delete', (_, id) => {
  try {
    db.prepare('DELETE FROM notification_history WHERE id = ?').run(id);
    return { success: true };
  } catch (e) {
    console.error('[Notification] Delete error:', e);
    return { success: false, error: e.message };
  }
});

// HTML에서 플레인 텍스트 미리보기 추출
function getPlainTextPreview(html, maxLength = 50) {
  if (!html) return '';
  // HTML 태그 제거
  let text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/div>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > maxLength) {
    text = text.slice(0, maxLength) + '...';
  }
  return text;
}

// 받은 메모 조회 helper
async function getInboxMemos() {
  try {
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const license = await getLicenseFromStorage();
    if (!license?.licenseKey) return [];

    const response = await fetchJson(`${serverUrl}/api/memo/inbox`, {
      method: 'GET',
      headers: { 'X-License-Key': license.licenseKey }
    });

    return Array.isArray(response) ? response : [];
  } catch (e) {
    return [];
  }
}

// 읽지 않은 메모 수 변경 알림
function notifyUnreadCountChange() {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('unread-count-changed');
    }
  });
  updateTrayBadge();
}

// 트레이 배지 업데이트 (로컬 DB 기준)
function updateTrayBadge() {
  if (!tray) return;

  try {
    const unreadCount = db.prepare('SELECT COUNT(*) as count FROM memos WHERE is_read = 0').get().count;

    if (process.platform === 'darwin') {
      // macOS: Dock 배지
      app.setBadgeCount(unreadCount);
    }

    // 트레이 툴팁 업데이트
    if (unreadCount > 0) {
      tray.setToolTip(`handsub (${unreadCount}개의 새 메모)`);
    } else {
      tray.setToolTip('handsub');
    }
  } catch (e) {
    console.error('[Tray] Badge update error:', e);
  }
}

// 로컬 라이센스 조회 helper
async function getLicenseFromStorage() {
  try {
    const licensePath = getLicensePath();
    if (!fs.existsSync(licensePath)) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;

    const encrypted = fs.readFileSync(licensePath);
    const decrypted = safeStorage.decryptString(encrypted);
    return JSON.parse(decrypted);
  } catch (e) {
    return null;
  }
}

// New memo
ipcMain.on('new-memo', () => {
  showNewMemo();
});

// Close window
ipcMain.on('close-window', (event) => {
  const webContents = event.sender;
  const senderWin = BrowserWindow.fromWebContents(webContents);
  if (!senderWin || senderWin.isDestroyed()) return;

  if (senderWin === win) {
    // 메인 창은 숨기기
    win.hide();
  } else {
    // 서브 창은 닫기
    senderWin.close();
  }
});

// Force close (X 버튼)
ipcMain.on('force-close', (event) => {
  const webContents = event.sender;
  const senderWin = BrowserWindow.fromWebContents(webContents);
  if (!senderWin || senderWin.isDestroyed()) return;

  if (senderWin === win) {
    // 메인 창은 숨기기
    win.hide();
  } else {
    // 서브 창은 닫기
    senderWin.close();
  }
});

app.whenReady().then(() => {
  const firstRun = isFirstRun();

  // 앱 이름 설정 (알림에 표시됨)
  app.setName('handsub');

  createWindow();
  createTray();
  initAutoLaunch(); // 자동 실행 설정 적용
  startReminderScheduler(); // 리마인더 스케줄러 시작

  // Dock에 표시 (주석 해제하면 트레이 전용 앱으로 변경)
  // if (process.platform === 'darwin') {
  //   app.dock.hide();
  // }

  registerShortcuts();

  // 첫 실행 시 설정 창 표시
  if (firstRun) {
    createSettingsWindow();
    markFirstRunComplete();
  }

  // 받은편지함 주기적 확인 (30초마다)
  startInboxPolling();

  app.on('activate', () => {
    // 이미 창이 표시 중이면 무시
    if (win && win.isVisible()) return;
    showWindowAtCursor();
  });
});

// 받은편지함 폴링
let lastKnownInboxIds = [];

function startInboxPolling() {
  // 즉시 한 번 실행
  checkForNewMemos();

  // 30초마다 확인
  setInterval(() => {
    checkForNewMemos();
  }, 30 * 1000);
}

async function checkForNewMemos() {
  try {
    const inbox = await getInboxMemos();
    if (!inbox.length) {
      lastKnownInboxIds = [];
      return;
    }

    const currentIds = inbox.map(m => m.id);
    const newMemos = inbox.filter(m => !lastKnownInboxIds.includes(m.id));

    // 새 메모를 로컬에 자동 저장
    for (const memo of newMemos) {
      await importReceivedMemo(memo);
    }

    if (newMemos.length > 0 && lastKnownInboxIds.length > 0) {
      const notificationEnabled = getNotificationEnabled();

      // 알림 이력에 저장 + OS 알림
      for (const memo of newMemos) {
        try {
          const previewText = getPlainTextPreview(memo.content, 50);
          const displayText = memo.senderEmail ? `${memo.senderEmail}: ${previewText}` : previewText;

          // 알림 이력 저장
          db.prepare(`
            INSERT INTO notification_history (type, text, from_email, created_at)
            VALUES (?, ?, ?, ?)
          `).run('share', displayText, memo.senderEmail || null, Date.now());

          // OS 알림 표시
          if (notificationEnabled) {
            const notification = new Notification({
              title: memo.senderEmail || '새 메모',
              body: previewText,
              silent: false
            });
            notification.on('click', () => {
              const wins = BrowserWindow.getAllWindows();
              if (wins.length > 0) {
                wins[0].show();
                wins[0].focus();
              }
            });
            notification.show();
          }
        } catch (e) {
          console.error('[Notification] Share history save error:', e);
        }
      }

      // 새 메모 알림
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) {
          w.webContents.send('received-memo', newMemos);
          w.webContents.send('memos-updated');
        }
      });
    }

    lastKnownInboxIds = currentIds;
    updateTrayBadge();
  } catch (e) {
    console.error('[Inbox] Poll error:', e);
  }
}

// 받은 메모를 로컬 DB에 저장
async function importReceivedMemo(memo) {
  try {
    // 이미 존재하는지 확인 (transfer_id로)
    const existing = db.prepare('SELECT id FROM memos WHERE transfer_id = ?').get(memo.id);
    if (existing) {
      console.log('[Inbox] Memo already imported:', memo.id);
      return;
    }

    // 새 메모로 저장 (last_notified_at으로 목록 상단에 표시)
    const uuid = crypto.randomUUID();
    const now = Date.now();
    const result = db.prepare(
      `INSERT INTO memos (content, uuid, received_from, transfer_id, is_read, last_notified_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    ).run(memo.content, uuid, memo.senderEmail, memo.id, now);

    console.log('[Inbox] Imported memo:', result.lastInsertRowid, 'from', memo.senderEmail);

    // 서버에 수신 확인 전송
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const license = await getLicenseFromStorage();
    if (license?.licenseKey) {
      await fetchJson(`${serverUrl}/api/memo/receive/${memo.id}`, {
        method: 'POST',
        headers: { 'X-License-Key': license.licenseKey }
      });
    }

    return result.lastInsertRowid;
  } catch (e) {
    console.error('[Inbox] Import error:', e);
    return null;
  }
}

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep running in tray
});
