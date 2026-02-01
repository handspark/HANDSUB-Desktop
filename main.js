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
const { isSafeKey, safeJsonParse, sanitizeObject } = require('./tools/security');

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

// ===== Cloud Sync Settings =====
function getCloudSyncEnabled() {
  return config.cloudSyncEnabled || false;
}

function setCloudSyncEnabled(enabled) {
  config.cloudSyncEnabled = enabled;
  saveConfig(config);
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

// shared_memo_id 컬럼 추가 (공유 메모 원본 UUID - 협업용)
try {
  db.exec(`ALTER TABLE memos ADD COLUMN shared_memo_id TEXT`);
} catch (e) {
  // 이미 존재하면 무시
}

// is_shared 컬럼 추가 (내가 공유한 메모 표시)
try {
  db.exec(`ALTER TABLE memos ADD COLUMN is_shared INTEGER DEFAULT 0`);
} catch (e) {
  // 이미 존재하면 무시
}

// owner_user_id 컬럼 추가 (메모 소유자 - NULL이면 로그아웃 상태에서 만든 메모)
try {
  db.exec(`ALTER TABLE memos ADD COLUMN owner_user_id TEXT`);
} catch (e) {
  // 이미 존재하면 무시
}

// is_cloud 컬럼 추가 (클라우드에서 가져온 메모 표시)
try {
  db.exec(`ALTER TABLE memos ADD COLUMN is_cloud INTEGER DEFAULT 0`);
} catch (e) {
  // 이미 존재하면 무시
}

// cloud_snapshot 컬럼 추가 (클라우드에서 처음 가져온 원본 - 로그아웃 시 복원용)
try {
  db.exec(`ALTER TABLE memos ADD COLUMN cloud_snapshot TEXT`);
} catch (e) {
  // 이미 존재하면 무시
}

// cloud_memo_id 컬럼 추가 (서버의 cloud_memos.id)
try {
  db.exec(`ALTER TABLE memos ADD COLUMN cloud_memo_id TEXT`);
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

// 할일 추적 테이블 (시간 없는 할일 리마인더용)
db.exec(`
  CREATE TABLE IF NOT EXISTS todo_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memo_id INTEGER NOT NULL,
    checkbox_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    has_time INTEGER DEFAULT 0,
    is_completed INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_reminded_at INTEGER DEFAULT 0,
    remind_count INTEGER DEFAULT 0,
    dismissed INTEGER DEFAULT 0,
    FOREIGN KEY (memo_id) REFERENCES memos(id) ON DELETE CASCADE,
    UNIQUE(memo_id, checkbox_index)
  );
`);

// 할일 추적 인덱스
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_todo_remind ON todo_tracking(is_completed, has_time, last_reminded_at)`);
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
// 매니페스트 오버라이드 컬럼 추가
if (!snippetColumns.includes('source')) {
  db.exec(`ALTER TABLE snippets ADD COLUMN source TEXT DEFAULT 'code'`);
}
if (!snippetColumns.includes('manifest_ref')) {
  db.exec(`ALTER TABLE snippets ADD COLUMN manifest_ref TEXT`);
}

// ===== 로컬-퍼스트 동기화 스키마 마이그레이션 =====

// memos 테이블에 동기화 컬럼 추가
try {
  db.exec(`ALTER TABLE memos ADD COLUMN sync_status TEXT DEFAULT 'local'`);
  // 'local': 로컬만 | 'pending': 동기화 대기 | 'synced': 동기화됨 | 'conflict': 충돌
} catch (e) {
  // 이미 존재하면 무시
}

try {
  db.exec(`ALTER TABLE memos ADD COLUMN local_updated_at INTEGER`);
} catch (e) {
  // 이미 존재하면 무시
}

try {
  db.exec(`ALTER TABLE memos ADD COLUMN server_updated_at INTEGER`);
} catch (e) {
  // 이미 존재하면 무시
}

// sync_queue 테이블 생성 (오프라인 큐)
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT,
    created_at INTEGER NOT NULL,
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    UNIQUE(entity_type, entity_id)
  );
`);

// sync_queue 인덱스
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id)`);
} catch (e) {
  // 이미 존재하면 무시
}

// ===== 기존 메모 체크박스 마이그레이션 (todo_tracking) =====
function migrateExistingTodos() {
  console.log('[Todo Migration] Function called');
  try {
    // 기존 데이터 삭제 후 새로 마이그레이션
    db.prepare('DELETE FROM todo_tracking').run();
    console.log('[Todo Migration] Starting migration of existing todos...');
    const memos = db.prepare('SELECT id, content, created_at FROM memos WHERE content IS NOT NULL').all();
    console.log('[Todo Migration] Found', memos.length, 'memos');
    const now = Date.now();

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO todo_tracking (memo_id, checkbox_index, text, has_time, is_completed, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let totalTodos = 0;

    for (const memo of memos) {
      if (!memo.content) continue;

      // HTML 태그 제거해서 텍스트 추출
      const plainText = memo.content
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

      const lines = plainText.split('\n');
      let checkboxIndex = 0;

      for (const line of lines) {
        const checkboxMatch = line.match(/^(\s*)(☐|☑)\s*(.+)/);
        if (checkboxMatch) {
          const isChecked = checkboxMatch[2] === '☑';
          const todoText = checkboxMatch[3].trim();

          // 시간 패턴 확인 (간단히)
          const hasTime = /\d{1,2}시|\d{1,2}:\d{2}/.test(todoText) ? 1 : 0;

          // 메모 생성 시간 사용 (없으면 현재 시간)
          const createdAt = memo.created_at ? new Date(memo.created_at).getTime() : now;

          insertStmt.run(
            memo.id,
            checkboxIndex,
            todoText.substring(0, 200), // 텍스트 길이 제한
            hasTime,
            isChecked ? 1 : 0,
            createdAt
          );

          checkboxIndex++;
          totalTodos++;
        }
      }
    }

    console.log(`[Todo Migration] Migrated ${totalTodos} todos from ${memos.length} memos`);
  } catch (e) {
    console.error('[Todo Migration] Error:', e);
  }
}

// 마이그레이션 실행
migrateExistingTodos();

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
  // 로컬 메모는 로그인 여부와 관계없이 모두 표시
  // 협업 시에만 (memo_uuid + user_id) 조합으로 서버에서 구분
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
  // 로컬 메모 생성 (user_id는 협업 시 서버에서 조합)
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

  const now = Date.now();

  // 메모 업데이트 (로컬-퍼스트: sync_status를 pending으로)
  db.prepare(`
    UPDATE memos
    SET content = ?,
        updated_at = CURRENT_TIMESTAMP,
        local_updated_at = ?,
        sync_status = CASE
          WHEN sync_status = 'synced' THEN 'pending'
          WHEN sync_status IS NULL THEN 'local'
          ELSE sync_status
        END
    WHERE id = ?
  `).run(content, now, id);

  // Pro 사용자면 동기화 큐에 추가
  if (isPro()) {
    const memo = db.prepare('SELECT uuid FROM memos WHERE id = ?').get(id);
    if (memo?.uuid) {
      SyncManager.queueForSync('memo', memo.uuid, 'update');
      SyncManager.scheduleBatchSync(); // 2초 디바운스
    }
  }

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

// ===== Cloud Memo IPC Handlers =====

// 로컬 메모 개수 (클라우드 메모 제외)
ipcMain.handle('cloud-get-local-count', () => {
  const result = db.prepare('SELECT COUNT(*) as count FROM memos WHERE is_cloud = 0 OR is_cloud IS NULL').get();
  return result.count;
});

// 클라우드 메모 개수 조회 (서버에서)
ipcMain.handle('cloud-get-count', async () => {
  try {
    const auth = getStoredAuth();
    if (!auth?.accessToken) return { count: 0 };

    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const response = await fetch(`${serverUrl}/api/v2/cloud/memos/count`, {
      headers: { 'Authorization': `Bearer ${auth.accessToken}` }
    });

    if (!response.ok) return { count: 0 };
    return await response.json();
  } catch (e) {
    console.error('[Cloud] Get count error:', e);
    return { count: 0 };
  }
});

// 클라우드 메모 목록 조회 (서버에서)
ipcMain.handle('cloud-get-memos', async () => {
  try {
    const auth = getStoredAuth();
    if (!auth?.accessToken) return { memos: [] };

    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const response = await fetch(`${serverUrl}/api/v2/cloud/memos`, {
      headers: { 'Authorization': `Bearer ${auth.accessToken}` }
    });

    if (!response.ok) return { memos: [] };
    return await response.json();
  } catch (e) {
    console.error('[Cloud] Get memos error:', e);
    return { memos: [] };
  }
});

// 메모를 클라우드에 동기화
ipcMain.handle('cloud-sync-memo', async (_, memoId) => {
  try {
    const auth = getStoredAuth();
    if (!auth?.accessToken || auth.user?.tier !== 'pro') {
      return { success: false, error: 'Pro subscription required' };
    }

    const memo = db.prepare('SELECT * FROM memos WHERE id = ?').get(memoId);
    if (!memo) return { success: false, error: 'Memo not found' };

    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const response = await fetch(`${serverUrl}/api/v2/cloud/memo/${memo.uuid}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: memo.content,
        pinned: memo.pinned === 1
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return { success: false, error: err.error };
    }

    const result = await response.json();

    // 로컬 메모에 클라우드 정보 업데이트
    db.prepare(`
      UPDATE memos SET is_cloud = 1, cloud_memo_id = ?, cloud_snapshot = ?
      WHERE id = ?
    `).run(result.id, memo.content, memoId);

    console.log('[Cloud] Memo synced:', memo.uuid);
    return { success: true, cloudMemoId: result.id };
  } catch (e) {
    console.error('[Cloud] Sync memo error:', e);
    return { success: false, error: e.message };
  }
});

// 클라우드 메모를 로컬에 가져오기 (로그인 시 - 모두 합치기)
ipcMain.handle('cloud-import-memos', async (_, mode) => {
  try {
    const auth = getStoredAuth();
    if (!auth?.accessToken) {
      return { success: false, error: 'Not authenticated' };
    }

    // mode: 'merge' (모두 합치기) | 'replace' (클라우드만 사용)
    if (mode === 'replace') {
      // 기존 로컬 메모 삭제 (클라우드 메모가 아닌 것들)
      db.prepare('DELETE FROM memos WHERE is_cloud = 0 OR is_cloud IS NULL').run();
    }

    // 클라우드 메모 가져오기
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const response = await fetch(`${serverUrl}/api/v2/cloud/memos`, {
      headers: { 'Authorization': `Bearer ${auth.accessToken}` }
    });

    if (!response.ok) {
      return { success: false, error: 'Failed to fetch cloud memos' };
    }

    const { memos } = await response.json();
    let importedCount = 0;

    for (const cloudMemo of memos) {
      // 이미 같은 uuid의 메모가 있는지 확인
      const existing = db.prepare('SELECT id FROM memos WHERE uuid = ?').get(cloudMemo.memoUuid);

      if (existing) {
        // 이미 있으면 클라우드 정보만 업데이트
        db.prepare(`
          UPDATE memos SET is_cloud = 1, cloud_memo_id = ?, cloud_snapshot = ?
          WHERE id = ?
        `).run(cloudMemo.id, cloudMemo.content, existing.id);
      } else {
        // 없으면 새로 추가 (클라우드 메모로 표시)
        db.prepare(`
          INSERT INTO memos (uuid, content, pinned, is_cloud, cloud_memo_id, cloud_snapshot, created_at, updated_at)
          VALUES (?, ?, ?, 1, ?, ?, ?, ?)
        `).run(
          cloudMemo.memoUuid,
          cloudMemo.content,
          cloudMemo.pinned ? 1 : 0,
          cloudMemo.id,
          cloudMemo.content,  // 스냅샷 = 원본 내용
          cloudMemo.createdAt,
          cloudMemo.updatedAt
        );
        importedCount++;
      }
    }

    console.log('[Cloud] Imported', importedCount, 'memos from cloud');

    // UI 갱신
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) {
        w.webContents.send('memos-updated');
      }
    });

    return { success: true, importedCount, totalCloud: memos.length };
  } catch (e) {
    console.error('[Cloud] Import memos error:', e);
    return { success: false, error: e.message };
  }
});

// 클라우드 메모 삭제 (서버에서)
ipcMain.handle('cloud-delete-memo', async (_, memoUuid) => {
  try {
    const auth = getStoredAuth();
    if (!auth?.accessToken) {
      return { success: false, error: 'Not authenticated' };
    }

    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const response = await fetch(`${serverUrl}/api/v2/cloud/memo/${memoUuid}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${auth.accessToken}` }
    });

    if (!response.ok) {
      return { success: false, error: 'Failed to delete' };
    }

    return { success: true };
  } catch (e) {
    console.error('[Cloud] Delete memo error:', e);
    return { success: false, error: e.message };
  }
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
    icon: s.icon || toolRegistry.getIcon(s.type),
    source: s.source || 'code',
    manifestRef: s.manifest_ref || null
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

// ===== 매니페스트 오버라이드 IPC 핸들러 =====

// 오버라이드 생성/수정
ipcMain.handle('manifest-override-upsert', (_, { toolId, originalShortcut, newShortcut, fields, body }) => {
  if (!isSafeKey(toolId)) return { success: false, error: 'Invalid toolId' };
  if (typeof originalShortcut !== 'string' || originalShortcut.length > 100) {
    return { success: false, error: 'Invalid originalShortcut' };
  }
  if (typeof newShortcut !== 'string' || newShortcut.length > 100) {
    return { success: false, error: 'Invalid newShortcut' };
  }

  const manifestRef = `${toolId}:${originalShortcut}`;
  const config = JSON.stringify({ fields: fields || [], body: body || '' });
  const now = Date.now();

  try {
    // 기존 오버라이드 확인
    const existing = db.prepare('SELECT id FROM snippets WHERE manifest_ref = ? AND source = ?')
      .get(manifestRef, 'manifest_override');

    if (existing) {
      // 업데이트
      db.prepare(`
        UPDATE snippets
        SET shortcut = ?, config = ?, updated_at = ?, synced_at = 0
        WHERE id = ?
      `).run(newShortcut.toLowerCase(), config, now, existing.id);
      return { success: true, id: existing.id, updated: true };
    } else {
      // 새로 생성
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO snippets (id, type, shortcut, name, config, source, manifest_ref, updated_at, synced_at)
        VALUES (?, 'manifest', ?, ?, ?, 'manifest_override', ?, ?, 0)
      `).run(id, newShortcut.toLowerCase(), newShortcut, config, manifestRef, now);
      return { success: true, id, updated: false };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 오버라이드 삭제 (원본 복원)
ipcMain.handle('manifest-override-reset', (_, toolId, originalShortcut) => {
  if (!isSafeKey(toolId)) return { success: false, error: 'Invalid toolId' };

  const manifestRef = `${toolId}:${originalShortcut}`;

  try {
    db.prepare('DELETE FROM snippets WHERE manifest_ref = ? AND source = ?')
      .run(manifestRef, 'manifest_override');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 특정 오버라이드 조회
ipcMain.handle('manifest-override-get', (_, toolId, originalShortcut) => {
  if (!isSafeKey(toolId)) return null;

  const manifestRef = `${toolId}:${originalShortcut}`;
  const override = db.prepare(`
    SELECT id, shortcut, config FROM snippets
    WHERE manifest_ref = ? AND source = ?
  `).get(manifestRef, 'manifest_override');

  if (!override) return null;

  const config = safeJsonParse(override.config) || {};
  return {
    id: override.id,
    shortcut: override.shortcut,
    fields: config.fields || [],
    body: config.body || ''
  };
});

// 전체 오버라이드 목록
ipcMain.handle('manifest-overrides-list', () => {
  const overrides = db.prepare(`
    SELECT id, shortcut, config, manifest_ref FROM snippets
    WHERE source = 'manifest_override'
  `).all();

  return overrides.map(o => {
    const config = safeJsonParse(o.config) || {};
    const [toolId, originalShortcut] = (o.manifest_ref || '').split(':');
    return {
      id: o.id,
      toolId,
      originalShortcut,
      shortcut: o.shortcut,
      fields: config.fields || [],
      body: config.body || ''
    };
  });
});

// 도구 목록 조회
ipcMain.handle('tools-list', () => {
  return toolRegistry.list();
});

// 도구 스키마 조회
ipcMain.handle('tools-schema', (_, type) => {
  return toolRegistry.getSchema(type);
});

// 도구 테스트 실행 (설정 저장 전 테스트용)
ipcMain.handle('tool-test', async (_, type, config) => {
  try {
    // 도구 타입 검증
    if (!toolRegistry.isValidType(type)) {
      return { success: false, error: 'Invalid tool type' };
    }

    // config 검증 (Prototype Pollution 방지)
    const safeConfig = sanitizeObject(config);
    if (!safeConfig) {
      return { success: false, error: 'Invalid config' };
    }

    // 테스트용 context (빈 값)
    const testContext = {
      content: '테스트 메시지',
      editorContent: '테스트 메모 내용'
    };

    // 도구 실행
    const result = await toolRegistry.execute(type, safeConfig, testContext);
    return result;
  } catch (e) {
    console.error('[Tool Test] Error:', e);
    return { success: false, error: e.message };
  }
});

// ===== 도구 연결 (암호화 저장) =====
function getToolConnectionsPath() {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  return path.join(configDir, 'tool-connections.enc');
}

function getSecureToolConnections() {
  try {
    const connPath = getToolConnectionsPath();
    if (!fs.existsSync(connPath)) return {};

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[Tools] Encryption not available');
      return {};
    }

    const encrypted = fs.readFileSync(connPath);
    const decrypted = safeStorage.decryptString(encrypted);
    return JSON.parse(decrypted);
  } catch (e) {
    console.error('[Tools] Failed to get connections:', e);
    return {};
  }
}

function saveSecureToolConnections(connections) {
  try {
    const connPath = getToolConnectionsPath();

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[Tools] Encryption not available');
      return false;
    }

    const dataStr = JSON.stringify(connections);
    const encrypted = safeStorage.encryptString(dataStr);
    fs.writeFileSync(connPath, encrypted);
    return true;
  } catch (e) {
    console.error('[Tools] Failed to save connections:', e);
    return false;
  }
}

// 도구 연결 상태 조회 (민감정보 제외)
ipcMain.handle('tools-get-connections', () => {
  const connections = getSecureToolConnections();
  // credentials 정보는 제외하고 연결 상태만 반환
  const safeConnections = {};
  for (const [toolId, conn] of Object.entries(connections)) {
    // Prototype Pollution 방지
    if (!isSafeKey(toolId)) continue;
    safeConnections[toolId] = {
      connected: conn.connected,
      connectedAt: conn.connectedAt
    };
  }
  return safeConnections;
});

// 도구 연결 설정 (암호화 저장)
ipcMain.handle('tools-connect', (_, toolId, credentials) => {
  // Prototype Pollution 방지
  if (!isSafeKey(toolId)) {
    return false;
  }
  const connections = getSecureToolConnections();
  connections[toolId] = {
    connected: true,
    credentials: sanitizeObject(credentials),
    connectedAt: Date.now()
  };
  return saveSecureToolConnections(connections);
});

// 도구 연결 해제
ipcMain.handle('tools-disconnect', (_, toolId) => {
  const connections = getSecureToolConnections();
  if (connections[toolId]) {
    delete connections[toolId];
    saveSecureToolConnections(connections);
  }
  return true;
});

// 도구 credentials 조회 (내부용 - IPC로 노출하지 않음)
function getToolCredentials(toolId) {
  const connections = getSecureToolConnections();
  return connections[toolId]?.credentials || null;
}

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
  // Prototype Pollution 방지
  if (!isSafeKey(toolId)) {
    return false;
  }
  if (!config.manifestToolSettings) config.manifestToolSettings = {};
  config.manifestToolSettings[toolId] = sanitizeObject(settings);
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

ipcMain.handle('snippet-execute', async (_, id, content, editorContent, meta) => {
  if (id === undefined || id === null) return { success: false, error: 'Invalid id' };

  const snippet = db.prepare('SELECT * FROM snippets WHERE id = ?').get(id);
  if (!snippet) return { success: false, error: 'Snippet not found' };

  // Prototype Pollution 방지
  const config = safeJsonParse(snippet.config);
  if (!config) return { success: false, error: 'Invalid config' };

  // 도구 레지스트리를 통해 실행 (editorContent = 메모장 전체 내용, meta = {{top}}, {{all}})
  return toolRegistry.execute(snippet.type, config, { content, editorContent, meta });
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

  // 앱 포커스/표시 시 renderer에 알림 (할일 리마인더용)
  win.on('focus', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('app-focused');
    }
  });

  win.on('show', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('app-focused');
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

ipcMain.handle('get-cloud-sync-enabled', () => {
  return getCloudSyncEnabled();
});

ipcMain.handle('set-cloud-sync-enabled', (_, enabled) => {
  if (typeof enabled !== 'boolean') return false;
  setCloudSyncEnabled(enabled);
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
  return config.syncServerUrl || 'https://api.handsub.com';
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

// ===== Device & Machine ID =====

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

ipcMain.handle('get-machine-id', () => {
  return getMachineId();
});

// ===== License API (Deprecated - 로그인 기반으로 마이그레이션) =====
// 레거시 호환성을 위해 유지하지만 모든 기능은 로그인 기반으로 전환됨

function getLicensePath() {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  return path.join(configDir, 'license.enc');
}

// 레거시: 라이센스 조회 (로그인으로 대체됨)
ipcMain.handle('get-license', () => {
  console.log('[License] Deprecated: Use auth-get-user instead');
  return null;
});

// 레거시: 라이센스 저장 (로그인으로 대체됨)
ipcMain.handle('set-license', () => {
  console.log('[License] Deprecated: Use auth login instead');
  return false;
});

// 레거시: 라이센스 검증 (로그인으로 대체됨)
ipcMain.handle('verify-license', async () => {
  console.log('[License] Deprecated: Use auth-refresh instead');
  return { valid: false, error: 'deprecated', message: '로그인이 필요합니다' };
});

// 레거시: 라이센스 검증 캐시 (더 이상 사용 안 함)
ipcMain.handle('cache-license-verification', () => {
  console.log('[License] Deprecated: No longer needed');
  return false;
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
              resolve({ success: false, valid: false, statusCode: res.statusCode, ...json });
            }
          } catch (e) {
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

// ===== Authenticated Fetch (v2 API용) =====

// JWT 토큰 자동 갱신 포함 인증된 요청
async function authenticatedFetch(url, options = {}) {
  const auth = getStoredAuth();

  if (!auth?.accessToken) {
    return { success: false, error: 'not_authenticated', message: '로그인이 필요합니다' };
  }

  const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
  const fullUrl = url.startsWith('http') ? url : `${serverUrl}${url}`;

  try {
    // 첫 번째 요청 시도
    const response = await fetchJson(fullUrl, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${auth.accessToken}`
      }
    });

    // 토큰 만료 시 갱신 후 재시도
    if (response.error === 'token_expired' && auth.refreshToken) {
      console.log('[Auth] Token expired, refreshing...');
      const refreshed = await refreshAuthTokens();
      if (refreshed) {
        const newAuth = getStoredAuth();
        return await fetchJson(fullUrl, {
          ...options,
          headers: {
            ...options.headers,
            'Authorization': `Bearer ${newAuth.accessToken}`
          }
        });
      } else {
        return { success: false, error: 'refresh_failed', message: '세션이 만료되었습니다. 다시 로그인해주세요.' };
      }
    }

    return response;
  } catch (e) {
    console.error('[AuthFetch] Error:', e);
    return { success: false, error: 'network_error', message: e.message };
  }
}

// 토큰 갱신 (동시 호출 방지를 위한 Promise 캐싱)
let refreshTokenPromise = null;

async function refreshAuthTokens() {
  // 이미 갱신 중이면 기존 Promise 반환
  if (refreshTokenPromise) {
    console.log('[Auth] Refresh already in progress, waiting...');
    return refreshTokenPromise;
  }

  const auth = getStoredAuth();
  if (!auth?.refreshToken) return null;

  // 새 갱신 시작
  refreshTokenPromise = (async () => {
    try {
      console.log('[Auth] Starting token refresh...');
      const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
      const response = await fetchJson(`${serverUrl}/api/auth/refresh`, {
        method: 'POST',
        body: JSON.stringify({
          refreshToken: auth.refreshToken,
          deviceFingerprint: getMachineId(),
          deviceName: os.hostname()
        })
      });

      if (response.accessToken) {
        await saveAuthTokens({
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          user: response.user
        });
        console.log('[Auth] Token refreshed successfully');
        return response;
      }
      console.log('[Auth] Refresh failed - no accessToken in response');
      return null;
    } catch (e) {
      console.error('[Auth] Refresh failed:', e);
      return null;
    } finally {
      // 갱신 완료 후 Promise 초기화
      refreshTokenPromise = null;
    }
  })();

  return refreshTokenPromise;
}

// Pro 사용자 여부 확인
function isPro() {
  const auth = getStoredAuth();
  return auth?.user?.tier === 'pro' || auth?.user?.tier === 'lifetime';
}

// ===== SyncManager - 로컬-퍼스트 동기화 모듈 =====

const SYNC_CONFIG = {
  debounceDelay: 2000,     // 2초 디바운스
  maxBatchSize: 20,        // 최대 20개씩 배치
  maxRetries: 5,           // 최대 5회 재시도
  retryDelays: [1000, 5000, 30000, 120000, 600000], // 1초, 5초, 30초, 2분, 10분
  connectivityCheckInterval: 30000 // 30초마다 연결 확인
};

let isOnline = true;
let syncDebounceTimer = null;
let syncInProgress = false;

const SyncManager = {
  // 대기 중인 메모 조회
  getPendingMemos() {
    return db.prepare(`
      SELECT m.*, sq.operation
      FROM memos m
      LEFT JOIN sync_queue sq ON sq.entity_type = 'memo' AND sq.entity_id = m.uuid
      WHERE m.sync_status = 'pending' OR sq.id IS NOT NULL
      ORDER BY m.local_updated_at ASC
      LIMIT ?
    `).all(SYNC_CONFIG.maxBatchSize);
  },

  // 동기화 완료 표시
  markSynced(memoUuids, serverTimestamp) {
    const stmt = db.prepare(`
      UPDATE memos
      SET sync_status = 'synced', server_updated_at = ?
      WHERE uuid = ?
    `);
    const deleteQueueStmt = db.prepare(`
      DELETE FROM sync_queue WHERE entity_type = 'memo' AND entity_id = ?
    `);

    const markMany = db.transaction((uuids) => {
      for (const uuid of uuids) {
        stmt.run(serverTimestamp, uuid);
        deleteQueueStmt.run(uuid);
      }
    });
    markMany(memoUuids);
  },

  // 충돌 표시
  markConflict(memoUuid, serverContent, serverUpdatedAt) {
    db.prepare(`
      UPDATE memos
      SET sync_status = 'conflict', server_updated_at = ?
      WHERE uuid = ?
    `).run(serverUpdatedAt, memoUuid);
    console.log('[Sync] Conflict detected for memo:', memoUuid);
  },

  // 큐에 추가 (중복 병합)
  queueForSync(entityType, entityId, operation, payload = null) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO sync_queue (entity_type, entity_id, operation, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        operation = ?,
        payload = ?,
        created_at = ?,
        retry_count = 0,
        last_error = NULL
    `).run(entityType, entityId, operation, payload, now, operation, payload, now);
  },

  // 배치 동기화 스케줄링 (디바운스)
  scheduleBatchSync() {
    if (syncDebounceTimer) {
      clearTimeout(syncDebounceTimer);
    }
    syncDebounceTimer = setTimeout(() => {
      SyncManager.performBatchSync();
    }, SYNC_CONFIG.debounceDelay);
  },

  // 배치 동기화 실행
  async performBatchSync() {
    if (!isOnline || !isPro() || syncInProgress) {
      console.log('[Sync] Skip batch sync - online:', isOnline, 'isPro:', isPro(), 'inProgress:', syncInProgress);
      return;
    }

    syncInProgress = true;
    notifySyncStatus('syncing');

    try {
      const pendingMemos = this.getPendingMemos();
      const pendingSettings = this.getPendingSettings();
      const pendingSnippets = this.getPendingSnippets();

      if (pendingMemos.length === 0 && pendingSettings.length === 0 && pendingSnippets.length === 0) {
        console.log('[Sync] No pending items');
        notifySyncStatus('synced');
        return;
      }

      console.log('[Sync] Batch sync starting - memos:', pendingMemos.length, 'settings:', pendingSettings.length, 'snippets:', pendingSnippets.length);

      // 배치 요청 데이터 구성
      const batchData = {
        memos: pendingMemos.map(m => ({
          memoUuid: m.uuid,
          content: m.content,
          pinned: m.pinned === 1,
          localUpdatedAt: m.local_updated_at || Date.now()
        })),
        settings: pendingSettings,
        snippets: pendingSnippets,
        lastSyncTimestamp: this.getLastSyncTimestamp()
      };

      const auth = getStoredAuth();
      if (!auth?.accessToken) {
        console.log('[Sync] No auth token');
        notifySyncStatus('error');
        return;
      }

      const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
      const response = await fetch(`${serverUrl}/api/v2/cloud/batch-sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(batchData)
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`);
      }

      const result = await response.json();
      this.handleSyncResult(result);

      notifySyncStatus('synced', result.syncedCount);
      console.log('[Sync] Batch sync completed - synced:', result.syncedCount);

    } catch (e) {
      console.error('[Sync] Batch sync error:', e);
      notifySyncStatus('error');

      // 재시도 스케줄링
      this.scheduleRetry();
    } finally {
      syncInProgress = false;
    }
  },

  // 동기화 결과 처리
  handleSyncResult(result) {
    const { synced = [], conflicts = [], serverChanges = [], serverTime } = result;

    // 성공한 메모 마킹
    if (synced.length > 0) {
      const syncedUuids = synced.map(s => s.memoUuid);
      this.markSynced(syncedUuids, serverTime);
    }

    // 충돌 처리
    for (const conflict of conflicts) {
      this.handleConflict(conflict);
    }

    // 서버 변경사항 적용 (다른 기기에서 변경된 것)
    for (const serverMemo of serverChanges) {
      this.applyServerChange(serverMemo);
    }

    // 마지막 동기화 시간 저장
    this.setLastSyncTimestamp(serverTime);
  },

  // 충돌 해결
  handleConflict(conflict) {
    const { memoUuid, serverContent, serverUpdatedAt } = conflict;

    // 로컬 메모 조회
    const localMemo = db.prepare('SELECT content FROM memos WHERE uuid = ?').get(memoUuid);
    if (!localMemo) return;

    const clientContent = localMemo.content;

    // 내용이 같으면 충돌 아님
    if (clientContent.trim() === serverContent.trim()) {
      this.markSynced([memoUuid], serverUpdatedAt);
      return;
    }

    // 스마트 머지 시도 (라인 기반)
    const merged = this.attemptLineMerge(clientContent, serverContent);

    if (merged !== null) {
      // 머지 성공 → 적용 후 재동기화
      db.prepare(`
        UPDATE memos SET content = ?, local_updated_at = ?, sync_status = 'pending'
        WHERE uuid = ?
      `).run(merged, Date.now(), memoUuid);
      this.queueForSync('memo', memoUuid, 'update');
      console.log('[Sync] Merge successful for memo:', memoUuid);
    } else {
      // 머지 실패 → 충돌 표시 및 사용자 알림
      this.markConflict(memoUuid, serverContent, serverUpdatedAt);
      notifySyncStatus('conflict', 1);
    }
  },

  // 라인 기반 스마트 머지 (단순 버전)
  attemptLineMerge(clientContent, serverContent) {
    const clientLines = clientContent.split('\n');
    const serverLines = serverContent.split('\n');

    // 라인 수가 같고 차이가 적으면 머지 시도
    if (Math.abs(clientLines.length - serverLines.length) > 5) {
      return null; // 차이가 너무 큼
    }

    // 간단한 머지: 긴 쪽을 선택하되, 체크박스 상태는 클라이언트 우선
    const merged = [];
    const maxLen = Math.max(clientLines.length, serverLines.length);

    for (let i = 0; i < maxLen; i++) {
      const clientLine = clientLines[i] || '';
      const serverLine = serverLines[i] || '';

      if (clientLine === serverLine) {
        merged.push(clientLine);
      } else if (clientLine.includes('☑') || clientLine.includes('☐')) {
        // 체크박스 라인은 클라이언트 우선
        merged.push(clientLine);
      } else if (serverLine.includes('☑') || serverLine.includes('☐')) {
        merged.push(serverLine);
      } else if (clientLine.length > serverLine.length) {
        merged.push(clientLine);
      } else {
        merged.push(serverLine);
      }
    }

    return merged.join('\n');
  },

  // 서버 변경사항 적용
  applyServerChange(serverMemo) {
    const { memoUuid, content, pinned, serverUpdatedAt, deleted } = serverMemo;

    if (deleted) {
      // 삭제된 메모
      db.prepare('DELETE FROM memos WHERE uuid = ?').run(memoUuid);
      return;
    }

    const existing = db.prepare('SELECT id, local_updated_at FROM memos WHERE uuid = ?').get(memoUuid);

    if (existing) {
      // 로컬 변경이 없으면 서버 내용 적용
      if (!existing.local_updated_at || existing.local_updated_at < serverUpdatedAt) {
        db.prepare(`
          UPDATE memos SET content = ?, pinned = ?, server_updated_at = ?, sync_status = 'synced'
          WHERE uuid = ?
        `).run(content, pinned ? 1 : 0, serverUpdatedAt, memoUuid);
      }
    } else {
      // 새 메모 추가
      db.prepare(`
        INSERT INTO memos (uuid, content, pinned, sync_status, server_updated_at, is_cloud)
        VALUES (?, ?, ?, 'synced', ?, 1)
      `).run(memoUuid, content, pinned ? 1 : 0, serverUpdatedAt);
    }

    // UI 갱신
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) {
        w.webContents.send('memos-updated');
      }
    });
  },

  // 대기 중인 설정 조회
  getPendingSettings() {
    return db.prepare(`
      SELECT key, value, updated_at FROM settings_sync
      WHERE synced_at < updated_at
    `).all().map(s => ({
      key: s.key,
      value: s.value,
      updatedAt: s.updated_at
    }));
  },

  // 대기 중인 스니펫 조회
  getPendingSnippets() {
    return db.prepare(`
      SELECT * FROM snippets
      WHERE synced_at < updated_at OR synced_at = 0
    `).all().map(s => ({
      id: s.id,
      type: s.type,
      shortcut: s.shortcut,
      name: s.name,
      config: s.config,
      updatedAt: s.updated_at
    }));
  },

  // 마지막 동기화 시간 조회/저장
  getLastSyncTimestamp() {
    const result = db.prepare("SELECT value FROM settings_sync WHERE key = 'lastSyncTimestamp'").get();
    return result ? parseInt(result.value) : 0;
  },

  setLastSyncTimestamp(timestamp) {
    db.prepare(`
      INSERT OR REPLACE INTO settings_sync (key, value, updated_at, synced_at)
      VALUES ('lastSyncTimestamp', ?, ?, ?)
    `).run(String(timestamp), timestamp, timestamp);
  },

  // 재시도 스케줄링
  scheduleRetry() {
    const queueItem = db.prepare(`
      SELECT retry_count FROM sync_queue ORDER BY retry_count ASC LIMIT 1
    `).get();

    if (!queueItem) return;

    const retryCount = queueItem.retry_count || 0;
    if (retryCount >= SYNC_CONFIG.maxRetries) {
      console.log('[Sync] Max retries reached');
      return;
    }

    const delay = SYNC_CONFIG.retryDelays[Math.min(retryCount, SYNC_CONFIG.retryDelays.length - 1)];

    // 재시도 카운터 증가
    db.prepare('UPDATE sync_queue SET retry_count = retry_count + 1').run();

    setTimeout(() => {
      SyncManager.performBatchSync();
    }, delay);

    console.log('[Sync] Retry scheduled in', delay, 'ms');
  },

  // 서버 변경사항 가져오기 (풀)
  async pullServerChanges() {
    if (!isOnline || !isPro()) return;

    try {
      const auth = getStoredAuth();
      if (!auth?.accessToken) return;

      const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
      const lastSync = this.getLastSyncTimestamp();

      const response = await fetch(`${serverUrl}/api/v2/cloud/changes?since=${lastSync}`, {
        headers: { 'Authorization': `Bearer ${auth.accessToken}` }
      });

      if (!response.ok) return;

      const { changes, serverTime } = await response.json();

      for (const change of changes || []) {
        this.applyServerChange(change);
      }

      this.setLastSyncTimestamp(serverTime);
    } catch (e) {
      console.error('[Sync] Pull changes error:', e);
    }
  }
};

// 동기화 상태 알림 함수
function notifySyncStatus(status, count = 0) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('sync-status', status, count);
    }
  });
}

// 온라인/오프라인 감지
async function checkConnectivity() {
  try {
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${serverUrl}/health`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!isOnline && response.ok) {
      isOnline = true;
      console.log('[Sync] Back online - triggering sync');
      SyncManager.performBatchSync();
    }
    isOnline = response.ok;
  } catch (e) {
    if (isOnline) {
      console.log('[Sync] Went offline');
    }
    isOnline = false;
  }

  notifySyncStatus(isOnline ? 'idle' : 'offline');
}

// 주기적 연결 확인 시작 (앱 ready 후)
function startConnectivityCheck() {
  checkConnectivity();
  setInterval(checkConnectivity, SYNC_CONFIG.connectivityCheckInterval);
}

// ===== Memo Transfer API (v2 - 로그인 기반) =====

// 레거시 라이센스 기반 전달 (deprecated)
ipcMain.handle('memo-send', async () => {
  console.log('[Memo] Deprecated: Use memo-send-by-email instead');
  return { success: false, error: 'deprecated', message: '로그인이 필요합니다' };
});

// 받은 메모 목록 (v2)
ipcMain.handle('memo-inbox', async () => {
  try {
    if (!isPro()) {
      return [];
    }

    const response = await authenticatedFetch('/api/v2/memo/inbox', {
      method: 'GET'
    });

    return Array.isArray(response) ? response : [];
  } catch (e) {
    console.error('[Memo] Inbox error:', e);
    return [];
  }
});

// 메모 수신 확인 (v2)
ipcMain.handle('memo-receive', async (_, transferId) => {
  try {
    if (!isPro()) {
      return { success: false, error: 'pro_required', message: 'Pro 플랜이 필요합니다' };
    }

    const response = await authenticatedFetch(`/api/v2/memo/receive/${transferId}`, {
      method: 'POST'
    });

    return response;
  } catch (e) {
    console.error('[Memo] Receive error:', e);
    return { success: false, error: e.message };
  }
});

// 이메일로 메모 전달 (v2)
ipcMain.handle('memo-send-by-email', async (_, recipientEmail, content, metadata) => {
  try {
    if (!isPro()) {
      return { success: false, error: 'pro_required', message: 'Pro 플랜이 필요합니다' };
    }

    const response = await authenticatedFetch('/api/v2/memo/send-by-email', {
      method: 'POST',
      body: JSON.stringify({
        recipientEmail,
        memoContent: content,
        memoMetadata: metadata
      })
    });

    // 전달 성공 시 해당 메모를 공유됨으로 마킹 (협업용)
    if (response.success && metadata?.sourceUuid) {
      try {
        db.prepare('UPDATE memos SET is_shared = 1 WHERE uuid = ?').run(metadata.sourceUuid);
        console.log('[Memo] Marked as shared:', metadata.sourceUuid);
      } catch (e) {
        console.error('[Memo] Failed to mark as shared:', e);
      }
    }

    return response;
  } catch (e) {
    console.error('[Memo] Send by email error:', e);
    return { success: false, error: e.message };
  }
});

// 최근 전달 연락처 조회 (v2)
ipcMain.handle('memo-contacts', async () => {
  try {
    if (!isPro()) {
      return [];
    }

    const response = await authenticatedFetch('/api/v2/memo/contacts', {
      method: 'GET'
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

    // 서버 동기화 (백그라운드) - v2 API 사용
    if (isPro()) {
      authenticatedFetch(`/api/v2/contacts/favorites/${encodeURIComponent(email)}`, {
        method: newFavorite === 1 ? 'POST' : 'DELETE'
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

// 서버에서 설정 가져오기 (delta sync) - v2 API 사용
ipcMain.handle('settings-sync-pull', async () => {
  try {
    if (!isPro()) return { success: false, error: 'Pro 플랜이 필요합니다' };

    const lastSync = db.prepare('SELECT MAX(synced_at) as last FROM settings_sync').get().last || 0;

    const response = await authenticatedFetch(`/api/v2/settings/sync?since=${lastSync}`, {
      method: 'GET'
    });

    if (response.settings && response.settings.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO settings_sync (key, value, updated_at, synced_at)
        VALUES (?, ?, ?, ?)
      `);

      for (const setting of response.settings) {
        // Prototype Pollution 방지
        if (!isSafeKey(setting.key)) continue;

        const local = db.prepare('SELECT updated_at FROM settings_sync WHERE key = ?').get(setting.key);

        // 서버가 더 최신이면 로컬에 적용
        if (!local || setting.updatedAt > local.updated_at) {
          stmt.run(setting.key, setting.value, setting.updatedAt, response.serverTime);

          // config에도 적용 (안전한 파싱)
          const parsed = safeJsonParse(setting.value);
          if (parsed !== null) {
            config[setting.key] = parsed;
          } else {
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

// 설정 변경 시 서버에 푸시 - v2 API 사용
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

  // 서버에 푸시 (백그라운드) - v2 API 사용
  try {
    if (isPro()) {
      await authenticatedFetch('/api/v2/settings/sync', {
        method: 'POST',
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

// ===== 스니펫 동기화 IPC 핸들러 (v2 API) =====

ipcMain.handle('snippets-sync', async () => {
  try {
    if (!isPro()) return { success: false, error: 'Pro 플랜이 필요합니다' };

    const lastSync = db.prepare('SELECT MAX(synced_at) as last FROM snippets WHERE synced_at > 0').get().last || 0;

    // 로컬 변경사항 수집 (source, manifest_ref 포함)
    const localChanges = db.prepare(`
      SELECT id, type, shortcut, name, config, source, manifest_ref as manifestRef, updated_at as updatedAt
      FROM snippets WHERE (updated_at > synced_at OR synced_at = 0)
    `).all();

    // 서버에 푸시 + 풀 (v2 API)
    const response = await authenticatedFetch(`/api/v2/snippets/sync?since=${lastSync}`, {
      method: 'POST',
      body: JSON.stringify({ snippets: localChanges, deletedIds: [] })
    });

    // 서버 변경사항 로컬 적용
    if (response.snippets && response.snippets.length > 0) {
      for (const snippet of response.snippets) {
        const local = db.prepare('SELECT updated_at FROM snippets WHERE id = ?').get(snippet.id);

        if (!local || snippet.updatedAt > local.updated_at) {
          db.prepare(`
            INSERT OR REPLACE INTO snippets (id, type, shortcut, name, config, source, manifest_ref, synced_at, updated_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM snippets WHERE id = ?), CURRENT_TIMESTAMP))
          `).run(
            snippet.id,
            snippet.type,
            snippet.shortcut,
            snippet.name,
            snippet.config,
            snippet.source || 'code',
            snippet.manifestRef || null,
            response.serverTime,
            snippet.updatedAt,
            snippet.id
          );
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

// ===== 연락처 그룹 IPC 핸들러 (v2 API) =====

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

    // 서버에서 최신 데이터 가져오기 (백그라운드) - v2 API
    if (isPro()) {
      authenticatedFetch('/api/v2/contacts/groups', {
        method: 'GET'
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

    // 서버 동기화 (백그라운드) - v2 API
    if (isPro()) {
      authenticatedFetch('/api/v2/contacts/groups', {
        method: 'POST',
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

    // 서버 동기화 (백그라운드) - v2 API
    if (isPro()) {
      authenticatedFetch(`/api/v2/contacts/groups/${groupId}`, {
        method: 'DELETE'
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

    // 서버 동기화 (백그라운드) - v2 API
    if (isPro()) {
      authenticatedFetch(`/api/v2/contacts/groups/${groupId}/members`, {
        method: 'POST',
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

    // 서버 동기화 (백그라운드) - v2 API
    if (isPro()) {
      authenticatedFetch(`/api/v2/contacts/groups/${groupId}/members/${encodeURIComponent(email)}`, {
        method: 'DELETE'
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
let reminderTimeout = null;

function startReminderScheduler() {
  // 앱 시작 시 이미 지난 리마인더 처리
  processOverdueReminders();
  // 다음 알림 스케줄링
  scheduleNextReminder();
}

function stopReminderScheduler() {
  if (reminderTimeout) {
    clearTimeout(reminderTimeout);
    reminderTimeout = null;
  }
}

// 이미 지난 리마인더 처리
function processOverdueReminders() {
  try {
    const now = Date.now();
    const overdueReminders = db.prepare(`
      SELECT * FROM reminders
      WHERE notified = 0 AND remind_at <= ?
      ORDER BY remind_at ASC
    `).all(now);

    const notificationEnabled = getNotificationEnabled();

    overdueReminders.forEach(reminder => {
      if (notificationEnabled) {
        showReminderNotification(reminder);
      }
      db.prepare('UPDATE reminders SET notified = 1 WHERE id = ?').run(reminder.id);
    });
  } catch (e) {
    console.error('[Reminder] Process overdue error:', e);
  }
}

// 다음 알림 스케줄링
function scheduleNextReminder() {
  if (reminderTimeout) {
    clearTimeout(reminderTimeout);
    reminderTimeout = null;
  }

  try {
    const now = Date.now();
    // 다음 알림 조회
    const nextReminder = db.prepare(`
      SELECT * FROM reminders
      WHERE notified = 0 AND remind_at > ?
      ORDER BY remind_at ASC
      LIMIT 1
    `).get(now);

    if (nextReminder) {
      const delay = nextReminder.remind_at - now;
      console.log('[Reminder] Next alarm in', Math.round(delay / 1000), 'seconds:', nextReminder.text);

      reminderTimeout = setTimeout(() => {
        fireReminder(nextReminder);
      }, delay);
    } else {
      // 예정된 알림이 없으면 1분 후 다시 체크 (새 알림 등록 대비)
      reminderTimeout = setTimeout(() => {
        scheduleNextReminder();
      }, 60000);
    }
  } catch (e) {
    console.error('[Reminder] Schedule error:', e);
    // 에러 시 1분 후 재시도
    reminderTimeout = setTimeout(() => {
      scheduleNextReminder();
    }, 60000);
  }
}

// 알림 발송
function fireReminder(reminder) {
  try {
    const notificationEnabled = getNotificationEnabled();

    if (notificationEnabled) {
      showReminderNotification(reminder);
    }
    db.prepare('UPDATE reminders SET notified = 1 WHERE id = ?').run(reminder.id);
  } catch (e) {
    console.error('[Reminder] Fire error:', e);
  }

  // 다음 알림 스케줄링
  scheduleNextReminder();
}

// 리마인더 추가/수정 시 재스케줄링 (외부에서 호출)
function rescheduleReminders() {
  scheduleNextReminder();
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

    // 새 알림이 더 빠르면 재스케줄링
    rescheduleReminders();

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
    rescheduleReminders();
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
    rescheduleReminders();
    return { success: true };
  } catch (e) {
    console.error('[Reminder] Delete by text error:', e);
    return { success: false, error: e.message };
  }
});

// 메모별 리마인더 전체 삭제 (memoId 기준)
ipcMain.handle('reminder-delete-by-memo', (_, memoId) => {
  try {
    db.prepare('DELETE FROM reminders WHERE memo_id = ? AND notified = 0').run(memoId);
    rescheduleReminders();
    return { success: true };
  } catch (e) {
    console.error('[Reminder] Delete by memo error:', e);
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
    rescheduleReminders();
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

// ===== 할일 추적 API (시간 없는 할일 리마인더) =====

// 리마인드 설정값
const TODO_REMIND_CONFIG = {
  minAgeHours: 0,        // 테스트용: 즉시 (배포 시 3으로 변경)
  cooldownHours: 8,      // 같은 할일 재알림 간격
  maxRemindCount: 5,     // 최대 알림 횟수
  maxDisplayCount: 50,   // 모든 할일 표시
};

// 리마인드 대상 할일 조회
ipcMain.handle('todo-get-reminders', () => {
  try {
    const now = Date.now();
    const minAge = now - (TODO_REMIND_CONFIG.minAgeHours * 3600000);
    const cooldown = now - (TODO_REMIND_CONFIG.cooldownHours * 3600000);

    return db.prepare(`
      SELECT t.*, m.content as memo_content
      FROM todo_tracking t
      JOIN memos m ON t.memo_id = m.id
      WHERE t.is_completed = 0
        AND t.has_time = 0
        AND t.dismissed = 0
        AND t.created_at <= ?
        AND t.last_reminded_at <= ?
        AND t.remind_count < ?
      ORDER BY t.created_at ASC
      LIMIT ?
    `).all(minAge, cooldown, TODO_REMIND_CONFIG.maxRemindCount, TODO_REMIND_CONFIG.maxDisplayCount);
  } catch (e) {
    console.error('[Todo] Get reminders error:', e);
    return [];
  }
});

// 할일 무시
ipcMain.handle('todo-dismiss', (_, id) => {
  try {
    db.prepare('UPDATE todo_tracking SET dismissed = 1 WHERE id = ?').run(id);
    return { success: true };
  } catch (e) {
    console.error('[Todo] Dismiss error:', e);
    return { success: false, error: e.message };
  }
});

// 알림 표시됨 기록
ipcMain.handle('todo-update-reminded', (_, id) => {
  try {
    const now = Date.now();
    db.prepare(`
      UPDATE todo_tracking
      SET last_reminded_at = ?, remind_count = remind_count + 1
      WHERE id = ?
    `).run(now, id);
    return { success: true };
  } catch (e) {
    console.error('[Todo] Update reminded error:', e);
    return { success: false, error: e.message };
  }
});

// 할일 동기화 (메모 저장 시 호출)
ipcMain.handle('todo-sync', (_, memoId, todos) => {
  try {
    const now = Date.now();

    // 기존 할일 조회 (텍스트 기준 매칭용)
    const existingTodos = db.prepare('SELECT * FROM todo_tracking WHERE memo_id = ?').all(memoId);
    const existingMap = new Map(existingTodos.map(t => [t.text, t]));

    // 기존 할일 모두 삭제 후 새로 삽입 (checkbox_index가 변경될 수 있으므로)
    db.prepare('DELETE FROM todo_tracking WHERE memo_id = ?').run(memoId);

    const insertStmt = db.prepare(`
      INSERT INTO todo_tracking (memo_id, checkbox_index, text, has_time, is_completed, created_at, last_reminded_at, remind_count, dismissed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const todo of todos) {
      // 기존 할일과 텍스트가 같으면 상태 유지
      const existing = existingMap.get(todo.text);

      insertStmt.run(
        memoId,
        todo.checkboxIndex,
        todo.text,
        todo.hasTime,
        todo.isCompleted,
        existing?.created_at || now,
        existing?.last_reminded_at || 0,
        existing?.remind_count || 0,
        existing?.dismissed || 0
      );
    }

    return { success: true };
  } catch (e) {
    console.error('[Todo] Sync error:', e);
    return { success: false, error: e.message };
  }
});

// 할일 리마인더 유무 확인 (배지 표시용)
ipcMain.handle('todo-has-reminders', () => {
  try {
    const now = Date.now();
    const minAge = now - (TODO_REMIND_CONFIG.minAgeHours * 3600000);
    const cooldown = now - (TODO_REMIND_CONFIG.cooldownHours * 3600000);

    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM todo_tracking
      WHERE is_completed = 0
        AND has_time = 0
        AND dismissed = 0
        AND created_at <= ?
        AND last_reminded_at <= ?
        AND remind_count < ?
    `).get(minAge, cooldown, TODO_REMIND_CONFIG.maxRemindCount);

    return result.count > 0;
  } catch (e) {
    console.error('[Todo] Has reminders error:', e);
    return false;
  }
});

// ===== Share Link API (v2 - 로그인 기반) =====

// 공유 링크 생성 (v2)
ipcMain.handle('share-link-create', async (_, { content, memoUuid, expiresIn, password }) => {
  try {
    if (!isPro()) {
      return { success: false, error: 'pro_required', message: 'Pro 플랜이 필요합니다' };
    }

    const response = await authenticatedFetch('/api/v2/share/create', {
      method: 'POST',
      body: JSON.stringify({ content, memoUuid, expiresIn, password })
    });

    return response;
  } catch (e) {
    console.error('[Share] Create error:', e);
    return { success: false, error: e.message || 'Failed to create share link' };
  }
});

// 공유 링크 업데이트 (v2)
ipcMain.handle('share-link-update', async (_, { token, content }) => {
  try {
    if (!isPro()) {
      return { success: false, error: 'pro_required', message: 'Pro 플랜이 필요합니다' };
    }

    const response = await authenticatedFetch(`/api/v2/share/${token}`, {
      method: 'PUT',
      body: JSON.stringify({ content })
    });

    return response;
  } catch (e) {
    console.error('[Share] Update error:', e);
    return { success: false, error: e.message || 'Failed to update share link' };
  }
});

// 공유 링크 삭제 (v2)
ipcMain.handle('share-link-delete', async (_, token) => {
  try {
    if (!isPro()) {
      return { success: false, error: 'pro_required' };
    }

    const response = await authenticatedFetch(`/api/v2/share/${token}`, {
      method: 'DELETE'
    });

    return response;
  } catch (e) {
    console.error('[Share] Delete error:', e);
    return { success: false, error: e.message };
  }
});

// 내 공유 목록 조회 (v2)
ipcMain.handle('share-link-list', async () => {
  try {
    if (!isPro()) {
      return [];
    }

    const response = await authenticatedFetch('/api/v2/share/my', {
      method: 'GET'
    });

    return Array.isArray(response) ? response : [];
  } catch (e) {
    console.error('[Share] List error:', e);
    return [];
  }
});

// 클립보드 쓰기
ipcMain.handle('clipboard-write', (_, text) => {
  try {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
    return { success: true };
  } catch (e) {
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

// 받은 메모 조회 helper (v2 API)
async function getInboxMemos() {
  try {
    if (!isPro()) return [];

    const response = await authenticatedFetch('/api/v2/memo/inbox', {
      method: 'GET'
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

// 로컬 라이센스 조회 helper (Deprecated - 더 이상 사용하지 않음)
async function getLicenseFromStorage() {
  console.log('[License] getLicenseFromStorage is deprecated');
  return null;
}

// ===== Auth (로그인 기반 인증) =====

// 메모리 캐시 (매번 파일 읽기 방지)
let authCache = null;
let authCacheLoaded = false;

function getAuthPath() {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  return path.join(configDir, 'auth.enc');
}

// 인증 토큰 저장
async function saveAuthTokens({ accessToken, refreshToken, user }) {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[Auth] Encryption not available');
      return false;
    }

    const authData = {
      accessToken,
      refreshToken,
      user,
      savedAt: Date.now()
    };

    const data = JSON.stringify(authData);
    const encrypted = safeStorage.encryptString(data);
    fs.writeFileSync(getAuthPath(), encrypted);

    // 캐시 업데이트
    authCache = authData;
    authCacheLoaded = true;

    return true;
  } catch (e) {
    console.error('[Auth] Failed to save tokens:', e);
    return false;
  }
}

// 저장된 인증 정보 조회 (캐시 우선)
function getStoredAuth() {
  // 캐시가 있으면 바로 반환 (성능 최적화)
  if (authCacheLoaded) {
    return authCache;
  }

  try {
    const authPath = getAuthPath();
    if (!fs.existsSync(authPath)) {
      authCache = null;
      authCacheLoaded = true;
      return null;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      authCache = null;
      authCacheLoaded = true;
      return null;
    }

    const encrypted = fs.readFileSync(authPath);
    const decrypted = safeStorage.decryptString(encrypted);
    authCache = JSON.parse(decrypted);
    authCacheLoaded = true;
    return authCache;
  } catch (e) {
    console.warn('[Auth] Failed to get stored auth, clearing corrupted data');
    // 손상된 인증 파일 자동 삭제
    try {
      const authPath = getAuthPath();
      if (fs.existsSync(authPath)) {
        fs.unlinkSync(authPath);
        console.log('[Auth] Corrupted auth file removed');
      }
    } catch (unlinkErr) {
      // 삭제 실패는 무시
    }
    authCache = null;
    authCacheLoaded = true;
    return null;
  }
}

// 저장된 사용자 정보 조회
function getStoredUser() {
  const auth = getStoredAuth();
  return auth?.user || null;
}

// 인증 정보 삭제
function clearStoredAuth() {
  try {
    const authPath = getAuthPath();
    if (fs.existsSync(authPath)) {
      fs.unlinkSync(authPath);
    }
    // 캐시 초기화
    authCache = null;
    authCacheLoaded = true;
    return true;
  } catch (e) {
    console.error('[Auth] Failed to clear auth:', e);
    return false;
  }
}

// 대기 중인 인증 상태 (CSRF 방지)
let pendingAuthState = null;
let pendingAuthStateExpires = null;

// 처리된 인증 코드 추적 (중복 처리 방지)
const processedAuthCodes = new Set();

// 프로토콜 콜백 처리
function handleAuthCallback(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.host === 'auth' && urlObj.pathname === '/callback') {
      const code = urlObj.searchParams.get('code');
      const state = urlObj.searchParams.get('state');

      console.log('[Auth] Received callback:', {
        code: code?.substring(0, 8) + '...',
        state: state?.substring(0, 8) + '...',
        pendingState: pendingAuthState?.substring(0, 8) + '...'
      });

      // 이미 처리된 코드면 스킵 (중복 콜백 방지)
      if (processedAuthCodes.has(code)) {
        console.log('[Auth] Code already processed, skipping duplicate callback');
        return;
      }
      processedAuthCodes.add(code);

      // 오래된 코드 정리 (10개 초과시)
      if (processedAuthCodes.size > 10) {
        const first = processedAuthCodes.values().next().value;
        processedAuthCodes.delete(first);
      }

      // state 검증 (앱에서 시작한 로그인인 경우에만)
      if (pendingAuthState) {
        // 만료 체크 (5분)
        const isExpired = pendingAuthStateExpires && Date.now() > pendingAuthStateExpires;
        if (isExpired) {
          console.log('[Auth] Pending state expired, accepting new login');
          pendingAuthState = null;
          pendingAuthStateExpires = null;
        } else if (state !== pendingAuthState) {
          // state 불일치 - 경고만 로그하고 진행 (서버에서 최종 검증)
          console.warn('[Auth] State mismatch, but proceeding (server will validate)');
        }
      }

      // 서버에 코드 교환 요청 (서버에서 코드 유효성 검증)
      exchangeCodeForTokens(code, state);
    }
  } catch (e) {
    console.error('[Auth] Callback handling error:', e);
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) {
        w.webContents.send('auth-error', { error: 'callback_error', message: '인증 처리 중 오류가 발생했습니다' });
      }
    });
  }
}

// 인증 코드를 토큰으로 교환
async function exchangeCodeForTokens(code, state) {
  try {
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const deviceFingerprint = getMachineId();
    const deviceName = os.hostname();

    const response = await fetchJson(`${serverUrl}/api/auth/callback`, {
      method: 'POST',
      body: JSON.stringify({
        code,
        state,
        deviceFingerprint,
        deviceName
      })
    });

    if (response.accessToken) {
      await saveAuthTokens(response);
      pendingAuthState = null;
      pendingAuthStateExpires = null;

      console.log('[Auth] Login successful:', response.user?.email, '| tier:', response.user?.tier);

      // 모든 창에 로그인 성공 알림 및 메모 목록 갱신
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) {
          w.webContents.send('auth-success', { user: response.user });
          w.webContents.send('memos-updated');  // 로그인 시 메모 목록 갱신 (owner_user_id 필터링)
        }
      });

      // WebSocket 연결 시작
      connectWebSocket();
    } else {
      console.error('[Auth] Token exchange failed:', JSON.stringify(response, null, 2));
      const errorMessage = response.message || response.detail || '인증에 실패했습니다';
      const errorCode = response.error || 'unknown';
      const statusCode = response.statusCode;
      console.error(`[Auth] Error: ${errorCode}, Status: ${statusCode}, Message: ${errorMessage}`);
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) {
          w.webContents.send('auth-error', {
            error: errorCode,
            message: errorMessage,
            statusCode
          });
        }
      });
    }
  } catch (e) {
    console.error('[Auth] Token exchange error:', e.message, e.stack);
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) {
        w.webContents.send('auth-error', { error: 'network_error', message: `서버 연결에 실패했습니다: ${e.message}` });
      }
    });
  }
}

// 인증된 API 호출 helper
async function fetchWithAuth(url, options = {}) {
  const auth = getStoredAuth();
  if (!auth?.accessToken) {
    throw new Error('Not authenticated');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${auth.accessToken}`,
    ...options.headers
  };

  try {
    const response = await fetchJson(url, { ...options, headers });

    // 토큰 만료 시 갱신 시도
    if (response.error === 'token_expired') {
      const refreshed = await refreshAuthTokens();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${refreshed.accessToken}`;
        return fetchJson(url, { ...options, headers });
      }
      throw new Error('Session expired');
    }

    return response;
  } catch (e) {
    throw e;
  }
}

// ===== Auth IPC Handlers =====
ipcMain.handle('auth-login', async () => {
  // state 생성 (CSRF 방지, 5분 만료)
  pendingAuthState = crypto.randomBytes(16).toString('hex');
  pendingAuthStateExpires = Date.now() + 5 * 60 * 1000; // 5분

  const wpSiteUrl = config.wpSiteUrl || 'https://handsub.com';
  const redirectUri = 'handsub://auth/callback';

  const loginUrl = `${wpSiteUrl}/?handsub_login=1&redirect_uri=${encodeURIComponent(redirectUri)}&state=${pendingAuthState}`;

  console.log('[Auth] Opening login URL, state:', pendingAuthState.substring(0, 8) + '...');
  shell.openExternal(loginUrl);

  return { state: pendingAuthState };
});

ipcMain.handle('auth-get-user', () => {
  return getStoredUser();
});

ipcMain.handle('auth-logout', async (_, options = {}) => {
  // options: { keepLocal: boolean } - 로컬에 메모 남길지 여부
  const { keepLocal = true } = options;

  try {
    const auth = getStoredAuth();
    if (auth?.refreshToken) {
      const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
      await fetchJson(`${serverUrl}/api/auth/logout`, {
        method: 'POST',
        body: JSON.stringify({ refreshToken: auth.refreshToken })
      }).catch(() => {}); // 서버 오류는 무시
    }
  } catch (e) {
    console.error('[Auth] Logout server error:', e);
  }

  // 클라우드 메모 처리
  if (keepLocal) {
    // 로컬에 남기기: 스냅샷으로 복원하고 클라우드 플래그 제거
    db.prepare(`
      UPDATE memos
      SET content = COALESCE(cloud_snapshot, content),
          is_cloud = 0,
          cloud_memo_id = NULL,
          cloud_snapshot = NULL
      WHERE is_cloud = 1
    `).run();
    console.log('[Auth] Cloud memos restored to snapshot');
  } else {
    // 로컬에서 삭제
    db.prepare('DELETE FROM memos WHERE is_cloud = 1').run();
    console.log('[Auth] Cloud memos deleted from local');
  }

  // 매니페스트 오버라이드 삭제 (클라우드 동기화 활성화된 Pro 사용자만)
  // 동기화가 꺼져있으면 삭제 시 복구 불가하므로 유지
  if (getCloudSyncEnabled() && isPro()) {
    db.prepare("DELETE FROM snippets WHERE source = 'manifest_override'").run();
    console.log('[Auth] Manifest overrides deleted (cloud sync enabled)');
  } else {
    console.log('[Auth] Manifest overrides kept (cloud sync disabled or not Pro)');
  }

  clearStoredAuth();
  pendingAuthState = null;
  pendingAuthStateExpires = null;

  // WebSocket 연결 해제
  disconnectWebSocket();

  // 모든 창에 로그아웃 알림 및 메모 목록 갱신
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('auth-logout');
      w.webContents.send('memos-updated');
    }
  });

  return true;
});

ipcMain.handle('auth-refresh', async () => {
  const result = await refreshAuthTokens();
  return result ? { success: true, user: result.user } : { success: false };
});

// 앱 시작 시 프로필 갱신 (구매 후 티어 반영)
async function refreshUserProfileOnStartup() {
  try {
    const auth = getStoredAuth();
    if (!auth?.refreshToken) return;

    console.log('[Auth] Refreshing profile on startup...');
    const result = await refreshAuthTokens();
    if (result?.user) {
      console.log('[Auth] Profile refreshed:', result.user.email, '| tier:', result.user.tier);
    }
  } catch (e) {
    console.log('[Auth] Startup profile refresh failed (using cached):', e.message);
  }
}

// ===== WebSocket 실시간 알림 =====
const WebSocket = require('ws');
let wsConnection = null;
let wsReconnectTimer = null;
const WS_RECONNECT_DELAY = 5000;  // 5초 후 재연결

function connectWebSocket() {
  const auth = getStoredAuth();
  if (!auth?.accessToken) {
    console.log('[WS] Not logged in, skipping WebSocket connection');
    return;
  }

  // 기존 연결이 있으면 닫기
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }

  const wsUrl = `wss://api.handsub.com/ws?token=${auth.accessToken}`;
  console.log('[WS] Connecting...');

  try {
    wsConnection = new WebSocket(wsUrl);

    wsConnection.on('open', () => {
      console.log('[WS] Connected');
      // 재연결 타이머 초기화
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
    });

    wsConnection.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('[WS] Message received:', message.type);

        switch (message.type) {
          case 'tier-updated':
            handleTierUpdate(message);
            break;
          case 'memo-received':
            handleMemoReceived(message.memo);
            break;
          case 'collab-joined':
            // 내가 협업 세션에 참가 완료
            handleCollabJoined(message);
            break;
          case 'collab-update':
            handleCollabUpdate(message);
            break;
          case 'collab-cursor':
            handleCollabCursor(message);
            break;
          case 'collab-join':
            // 다른 사람이 참가함
            handleCollabJoin(message);
            break;
          case 'collab-leave':
            handleCollabLeave(message);
            break;
          case 'collab-kicked':
            handleCollabKicked(message);
            break;
          case 'collab-error':
            handleCollabError(message);
            break;
          case 'collab-invite':
            handleCollabInviteNotify(message);
            break;
          case 'connected':
            console.log('[WS] Connected to server');
            // 연결 성공 시 렌더러에 알림
            BrowserWindow.getAllWindows().forEach(w => {
              if (!w.isDestroyed()) {
                w.webContents.send('ws-connected');
              }
            });
            break;
        }
      } catch (e) {
        console.error('[WS] Message parse error:', e);
      }
    });

    wsConnection.on('close', () => {
      console.log('[WS] Disconnected');
      wsConnection = null;

      // 렌더러에 연결 해제 알림
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) {
          w.webContents.send('ws-disconnected');
        }
      });

      // 협업 세션 종료
      currentCollabSession = null;

      // 재연결 시도
      scheduleReconnect();
    });

    wsConnection.on('error', (error) => {
      console.error('[WS] Error:', error.message);
    });

  } catch (e) {
    console.error('[WS] Connection error:', e);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;  // 이미 예약됨

  const auth = getStoredAuth();
  if (!auth?.accessToken) return;  // 로그인 안 됨

  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, WS_RECONNECT_DELAY);
}

function disconnectWebSocket() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }
}

// ===== 실시간 메모 수신 처리 =====
async function handleMemoReceived(memo) {
  console.log('[WS] Memo received from:', memo.senderEmail);

  try {
    // 1. 로컬 DB에 받은 메모 저장 (전역 db 사용)
    const uuid = crypto.randomUUID();
    const now = Date.now();
    const content = memo.content;
    // 보낸 사람의 원본 메모 UUID (협업 세션 ID로 사용)
    const sharedMemoId = memo.metadata?.sourceUuid || null;

    // 받은 메모로 저장 (shared_memo_id로 협업 연결, last_notified_at으로 상단 정렬)
    db.prepare(`
      INSERT INTO memos (uuid, content, created_at, updated_at, received_from, is_read, shared_memo_id, last_notified_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(uuid, content, now, now, memo.senderEmail, sharedMemoId, now);

    // 2. OS 알림 표시
    const notifier = require('node-notifier');
    const firstLine = content.split('\n')[0].substring(0, 50) || '새 메모';
    notifier.notify({
      title: `${memo.senderName || memo.senderEmail}님의 메모`,
      message: firstLine,
      sound: true,
      wait: false
    });

    // 3. 렌더러에 이벤트 전송
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) {
        w.webContents.send('received-memo', {
          uuid,
          content,
          senderEmail: memo.senderEmail,
          senderName: memo.senderName,
          senderAvatar: memo.senderAvatar,
          createdAt: memo.createdAt,
          sharedMemoId  // 협업용 원본 메모 ID
        });
        w.webContents.send('memos-updated');
      }
    });

    // 4. 읽지 않은 메모 수 업데이트
    const unreadCount = db.prepare('SELECT COUNT(*) as count FROM memos WHERE is_read = 0').get().count;
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) {
        w.webContents.send('unread-count-changed', unreadCount);
      }
    });

    // 5. 서버에 수신 확인 전송 (선택적)
    try {
      const auth = getStoredAuth();
      const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
      if (auth?.accessToken) {
        await fetch(`${serverUrl}/api/v2/memo/receive/${memo.id}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (e) {
      console.log('[WS] Failed to confirm memo receipt:', e.message);
    }

    console.log('[WS] Memo saved and notified');
  } catch (e) {
    console.error('[WS] Failed to handle received memo:', e);
  }
}

// ===== 협업 WebSocket 핸들러 (Phase 2용 스텁) =====
function handleCollabUpdate(message) {
  // 협업 업데이트를 렌더러로 전달
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('collab-update', message);
    }
  });
}

function handleCollabCursor(message) {
  // 커서 업데이트를 렌더러로 전달
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('collab-cursor', message);
    }
  });
}

function handleCollabJoined(message) {
  // 내가 협업 세션에 참가 완료 - 내 색상과 기존 참여자 정보 전달
  console.log('[WS] Collab joined, my color:', message.yourColor);
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('collab-joined', message);
    }
  });
}

function handleCollabJoin(message) {
  // 다른 참여자 입장 알림을 렌더러로 전달
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('collab-join', message);
    }
  });
}

function handleCollabLeave(message) {
  // 참여자 퇴장 알림을 렌더러로 전달
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('collab-leave', message);
    }
  });
}

function handleCollabKicked(message) {
  // 강퇴 알림을 렌더러로 전달
  currentCollabSession = null;
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('collab-kicked', message);
    }
  });
}

function handleCollabError(message) {
  // 협업 에러 알림을 렌더러로 전달 (not_invited, session_not_found 등)
  console.log('[WS] Collab error:', message.error, message.message);
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('collab-error', message);
    }
  });
}

function handleCollabInviteNotify(message) {
  // 협업 초대 알림을 렌더러로 전달
  console.log('[WS] Collab invite received:', message.sessionId, 'from', message.inviterEmail);
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('collab-invite', message);
    }
  });

  // 시스템 알림 표시
  const { Notification } = require('electron');
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: '협업 초대',
      body: `${message.inviterName || message.inviterEmail}님이 협업에 초대했습니다`,
      silent: false
    });
    notification.on('click', () => {
      // 알림 클릭 시 앱 창 표시
      const mainWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
      if (mainWin) {
        mainWin.show();
        mainWin.focus();
      }
    });
    notification.show();
  }
}

// 티어 업데이트 처리 (구매 완료 시 실시간 반영)
async function handleTierUpdate(message) {
  console.log('[WS] Tier updated:', message.tier);

  // 저장된 인증 정보 업데이트
  const auth = getStoredAuth();
  if (auth?.user) {
    auth.user.tier = message.tier;
    auth.user.tierExpiresAt = message.expiresAt;
    await saveAuthTokens(auth);

    // 캐시 업데이트
    authCache = auth;

    console.log('[WS] User tier saved:', message.tier);

    // 모든 창에 알림 전송
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) {
        w.webContents.send('tier-updated', {
          tier: message.tier,
          expiresAt: message.expiresAt
        });
      }
    });
  }
}

ipcMain.handle('auth-get-token', async () => {
  const auth = getStoredAuth();
  if (!auth?.accessToken) {
    console.log('[Auth] auth-get-token: No token stored');
    return null;
  }

  // JWT 토큰 만료 확인 (Base64 디코딩)
  try {
    const payload = JSON.parse(Buffer.from(auth.accessToken.split('.')[1], 'base64').toString());
    const expiresAt = payload.exp * 1000; // 초 -> 밀리초
    const now = Date.now();
    const remainingMs = expiresAt - now;

    console.log('[Auth] auth-get-token: Token expires in', Math.round(remainingMs / 1000), 'seconds');

    // 만료되었거나 5분 이내면 갱신 (통합된 함수 사용으로 중복 호출 방지)
    if (remainingMs < 5 * 60 * 1000) {
      const refreshed = await refreshAuthTokens();
      if (refreshed?.accessToken) {
        return refreshed.accessToken;
      }
    }
  } catch (e) {
    console.error('[Auth] Token parse error:', e.message);
  }

  return auth.accessToken;
});

// Pro 사용자 확인
ipcMain.handle('auth-is-pro', () => {
  const user = getStoredUser();
  return user?.tier === 'pro' || user?.tier === 'lifetime';
});

// ===== 협업 IPC 핸들러 =====
let currentCollabSession = null;

ipcMain.handle('collab-start', async (event, sessionId, memoUuid) => {
  console.log('[IPC] collab-start - sessionId:', sessionId, 'memoUuid:', memoUuid);

  if (!wsConnection || wsConnection.readyState !== 1) {
    console.log('[IPC] collab-start failed: WebSocket not connected');
    return { success: false, error: 'WebSocket not connected' };
  }

  currentCollabSession = { sessionId, memoUuid };

  wsConnection.send(JSON.stringify({
    type: 'collab-join',
    sessionId,
    memoUuid
  }));

  console.log('[IPC] collab-start success, sent collab-join to server');
  return { success: true, sessionId };
});

ipcMain.handle('collab-stop', async () => {
  if (!currentCollabSession) return { success: true };

  if (wsConnection && wsConnection.readyState === 1) {
    wsConnection.send(JSON.stringify({
      type: 'collab-leave',
      sessionId: currentCollabSession.sessionId
    }));
  }

  currentCollabSession = null;
  return { success: true };
});

ipcMain.handle('collab-send-update', async (event, update) => {
  if (!wsConnection || wsConnection.readyState !== 1 || !currentCollabSession) {
    console.log('[IPC] collab-send-update failed: no connection or session', {
      wsConnected: wsConnection?.readyState === 1,
      hasSession: !!currentCollabSession
    });
    return { success: false };
  }

  console.log('[IPC] collab-send-update - sessionId:', currentCollabSession.sessionId, 'updateType:', update?.type);

  wsConnection.send(JSON.stringify({
    type: 'collab-update',
    sessionId: currentCollabSession.sessionId,
    update
  }));

  return { success: true };
});

ipcMain.handle('collab-send-cursor', async (event, cursor) => {
  if (!wsConnection || wsConnection.readyState !== 1 || !currentCollabSession) {
    return { success: false };
  }

  wsConnection.send(JSON.stringify({
    type: 'collab-cursor',
    sessionId: currentCollabSession.sessionId,
    cursor
  }));

  return { success: true };
});

// 참여자 내보내기
ipcMain.handle('collab-kick', async (event, sessionId, targetUserId) => {
  if (!wsConnection || wsConnection.readyState !== 1) {
    return { success: false, error: 'Not connected' };
  }

  wsConnection.send(JSON.stringify({
    type: 'collab-kick',
    sessionId,
    targetUserId
  }));

  return { success: true };
});

// 받은 초대 목록 조회
ipcMain.handle('collab-get-invites', async () => {
  const auth = getStoredAuth();
  if (!auth?.accessToken) {
    return { success: false, error: 'Not logged in', invites: [] };
  }

  try {
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const response = await fetch(`${serverUrl}/api/v2/collab/invites`, {
      headers: {
        'Authorization': `Bearer ${auth.accessToken}`
      }
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { success: false, error: err.error || 'Failed to get invites', invites: [] };
    }

    const data = await response.json();
    return { success: true, invites: data.invites || [] };
  } catch (e) {
    console.error('[IPC] collab-get-invites error:', e);
    return { success: false, error: e.message, invites: [] };
  }
});

// 초대 수락/거절
ipcMain.handle('collab-respond-invite', async (event, inviteId, accept) => {
  const auth = getStoredAuth();
  if (!auth?.accessToken) {
    return { success: false, error: 'Not logged in' };
  }

  try {
    const serverUrl = config.syncServerUrl || 'https://api.handsub.com';
    const response = await fetch(`${serverUrl}/api/v2/collab/invite/${inviteId}/respond`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ accept })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { success: false, error: err.error || 'Failed to respond' };
    }

    const data = await response.json();
    return { success: true, sessionId: data.sessionId };
  } catch (e) {
    console.error('[IPC] collab-respond-invite error:', e);
    return { success: false, error: e.message };
  }
});

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

// 보안 마이그레이션: 평문 toolConnections를 암호화 저장소로 이동
function migrateToolConnectionsToSecureStorage() {
  if (config.toolConnections && Object.keys(config.toolConnections).length > 0) {
    console.log('[Security] Migrating toolConnections to secure storage...');
    try {
      if (safeStorage.isEncryptionAvailable()) {
        // 기존 연결 정보를 암호화 저장소로 이동
        const existingSecure = getSecureToolConnections();
        const merged = { ...existingSecure, ...config.toolConnections };
        saveSecureToolConnections(merged);

        // 평문 config에서 제거
        delete config.toolConnections;
        saveConfig(config);
        console.log('[Security] Migration completed successfully');
      } else {
        console.warn('[Security] Cannot migrate - encryption not available');
      }
    } catch (e) {
      console.error('[Security] Migration failed:', e);
    }
  }
}

// ===== Custom Protocol Registration =====
// handsub:// 프로토콜 등록 (앱 인증 콜백용)
if (process.defaultApp) {
  // 개발 모드: electron . 로 실행 시
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('handsub', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  // 프로덕션 모드
  app.setAsDefaultProtocolClient('handsub');
}

// 단일 인스턴스 보장 (Windows/Linux)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // 두 번째 인스턴스 실행 시 (Windows: 프로토콜 URL 전달)
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Windows에서 프로토콜 URL 찾기
    const url = commandLine.find(arg => arg.startsWith('handsub://'));
    if (url) {
      handleAuthCallback(url);
    }

    // 기존 창 포커스
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

// macOS: open-url 이벤트 (프로토콜 URL)
app.on('open-url', (event, url) => {
  event.preventDefault();
  console.log('[Protocol] Received URL:', url);
  handleAuthCallback(url);
});

app.whenReady().then(() => {
  const firstRun = isFirstRun();

  // 인증 캐시 미리 로드 (창 생성 전에 실행하여 초기 렌더링 속도 향상)
  getStoredAuth();

  // 보안 마이그레이션 실행
  migrateToolConnectionsToSecureStorage();

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

  // 앱 시작 시 프로필 갱신 (구매 후 티어 반영)
  refreshUserProfileOnStartup();

  // WebSocket 실시간 알림 연결
  connectWebSocket();

  // 로컬-퍼스트 동기화: 연결성 확인 시작
  startConnectivityCheck();

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

// 받은 메모를 로컬 DB에 저장 (v2 API)
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

    // 서버에 수신 확인 전송 (v2 API)
    if (isPro()) {
      await authenticatedFetch(`/api/v2/memo/receive/${memo.id}`, {
        method: 'POST'
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
