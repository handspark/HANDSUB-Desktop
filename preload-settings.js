const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  // Shell
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  getNotificationEnabled: () => ipcRenderer.invoke('get-notification-enabled'),
  setNotificationEnabled: (enabled) => ipcRenderer.invoke('set-notification-enabled', enabled),
  getCloudSyncEnabled: () => ipcRenderer.invoke('get-cloud-sync-enabled'),
  setCloudSyncEnabled: (enabled) => ipcRenderer.invoke('set-cloud-sync-enabled', enabled),
  getShortcut: () => ipcRenderer.invoke('get-shortcut'),
  setShortcut: (shortcut) => ipcRenderer.invoke('set-shortcut', shortcut),
  getNewMemoShortcut: () => ipcRenderer.invoke('get-new-memo-shortcut'),
  setNewMemoShortcut: (shortcut) => ipcRenderer.invoke('set-new-memo-shortcut', shortcut),
  suspendShortcuts: () => ipcRenderer.invoke('suspend-shortcuts'),
  resumeShortcuts: () => ipcRenderer.invoke('resume-shortcuts'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (_, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', () => callback()),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (_, error) => callback(error)),
  close: () => ipcRenderer.send('close-settings'),

  // Snippet API
  getSnippets: () => ipcRenderer.invoke('snippet-getAll'),
  createSnippet: (data) => ipcRenderer.invoke('snippet-create', data),
  updateSnippet: (data) => ipcRenderer.invoke('snippet-update', data),
  deleteSnippet: (id) => ipcRenderer.invoke('snippet-delete', id),

  // Tools API
  getTools: () => ipcRenderer.invoke('tools-list'),
  getToolSchema: (type) => ipcRenderer.invoke('tools-schema', type),
  testTool: (type, config) => ipcRenderer.invoke('tool-test', type, config),
  getToolConnections: () => ipcRenderer.invoke('tools-get-connections'),
  connectTool: (toolId, credentials) => ipcRenderer.invoke('tools-connect', toolId, credentials),
  disconnectTool: (toolId) => ipcRenderer.invoke('tools-disconnect', toolId),

  // Manifest Tools API
  getManifestTools: () => ipcRenderer.invoke('manifest-tools-list'),
  getManifestToolSettings: (toolId) => ipcRenderer.invoke('manifest-tool-settings-get', toolId),
  saveManifestToolSettings: (toolId, settings) => ipcRenderer.invoke('manifest-tool-settings-save', toolId, settings),

  // Manifest Override API (매니페스트 단축어 커스터마이즈)
  manifestOverrideUpsert: (data) => ipcRenderer.invoke('manifest-override-upsert', data),
  manifestOverrideReset: (toolId, shortcut) => ipcRenderer.invoke('manifest-override-reset', toolId, shortcut),
  manifestOverrideGet: (toolId, shortcut) => ipcRenderer.invoke('manifest-override-get', toolId, shortcut),
  manifestOverridesList: () => ipcRenderer.invoke('manifest-overrides-list'),

  // Trigger key
  getTriggerKey: () => ipcRenderer.invoke('get-trigger-key'),
  setTriggerKey: (key) => ipcRenderer.invoke('set-trigger-key', key),

  // Execute key
  getExecuteKey: () => ipcRenderer.invoke('get-execute-key'),
  setExecuteKey: (key) => ipcRenderer.invoke('set-execute-key', key),

  // Sync settings
  getSyncServer: () => ipcRenderer.invoke('get-sync-server'),
  setSyncServer: (url) => ipcRenderer.invoke('set-sync-server', url),

  // License API (레거시 지원)
  getLicense: () => ipcRenderer.invoke('get-license'),
  setLicense: (data) => ipcRenderer.invoke('set-license', data),
  verifyLicense: (key) => ipcRenderer.invoke('verify-license', key),
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  cacheLicenseVerification: (result) => ipcRenderer.invoke('cache-license-verification', result),

  // Auth API (로그인 기반 인증)
  authLogin: () => ipcRenderer.invoke('auth-login'),
  authGetUser: () => ipcRenderer.invoke('auth-get-user'),
  authLogout: (options) => ipcRenderer.invoke('auth-logout', options),  // options: { keepLocal: boolean }
  authRefresh: () => ipcRenderer.invoke('auth-refresh'),
  authIsPro: () => ipcRenderer.invoke('auth-is-pro'),

  // Cloud Memo API
  cloudGetMemos: () => ipcRenderer.invoke('cloud-get-memos'),
  getAll: () => ipcRenderer.invoke('memo-getAll'),  // 로컬 메모 목록 (클라우드 메모 개수 확인용)

  // Auth 이벤트 리스너
  onAuthSuccess: (callback) => ipcRenderer.on('auth-success', (_, data) => callback(data)),
  onAuthError: (callback) => ipcRenderer.on('auth-error', (_, data) => callback(data)),
  onAuthLogout: (callback) => ipcRenderer.on('auth-logout', () => callback()),

  // 티어 실시간 업데이트 (WebSocket)
  onTierUpdated: (callback) => ipcRenderer.on('tier-updated', (_, data) => callback(data)),

  // 동기화 상태 이벤트 (로컬-퍼스트)
  onSyncStatus: (callback) => ipcRenderer.on('sync-status', (_, status) => callback(status)),
});
