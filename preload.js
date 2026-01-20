const { contextBridge, ipcRenderer } = require('electron');

// 안전한 IPC 리스너 래퍼 (메모리 누수 방지)
function createSafeListener(channel) {
  let currentCallback = null;

  return {
    on: (callback) => {
      // 기존 리스너 제거 후 새로 등록
      if (currentCallback) {
        ipcRenderer.removeListener(channel, currentCallback);
      }
      currentCallback = (_, ...args) => callback(...args);
      ipcRenderer.on(channel, currentCallback);
    },
    off: () => {
      if (currentCallback) {
        ipcRenderer.removeListener(channel, currentCallback);
        currentCallback = null;
      }
    }
  };
}

const requestCloseListener = createSafeListener('request-close');
const memosUpdatedListener = createSafeListener('memos-updated');
const triggerKeyChangedListener = createSafeListener('trigger-key-changed');
const executeKeyChangedListener = createSafeListener('execute-key-changed');
const syncServerChangedListener = createSafeListener('sync-server-changed');
const createNewMemoListener = createSafeListener('create-new-memo');
const focusSearchListener = createSafeListener('focus-search');
const saveBeforeQuitListener = createSafeListener('request-save-before-quit');
const receivedMemoListener = createSafeListener('received-memo');
const unreadCountChangedListener = createSafeListener('unread-count-changed');
const quickShareTriggerListener = createSafeListener('quick-share-trigger');

// API for renderer (all DB operations go through main process)
contextBridge.exposeInMainWorld('api', {
  // ===== Memo CRUD (async via IPC) =====
  getAll: () => ipcRenderer.invoke('memo-getAll'),
  get: (id) => ipcRenderer.invoke('memo-get', id),
  create: () => ipcRenderer.invoke('memo-create'),
  update: (id, content) => ipcRenderer.invoke('memo-update', id, content),
  delete: (id) => ipcRenderer.invoke('memo-delete', id),
  toggleMemoPin: (id) => ipcRenderer.invoke('memo-togglePin', id),

  // ===== Image Operations =====
  saveImage: (base64Data, mimeType) => ipcRenderer.invoke('image-save', base64Data, mimeType),
  getImagePath: () => ipcRenderer.invoke('image-get-path'),

  // ===== Video Operations =====
  saveVideo: (base64Data, mimeType) => ipcRenderer.invoke('video-save', base64Data, mimeType),

  // ===== Link Preview =====
  fetchLinkMeta: (url) => ipcRenderer.invoke('link-fetch-meta', url),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // ===== Snippet Operations =====
  getSnippets: () => ipcRenderer.invoke('snippet-getAll'),
  executeSnippet: (id, content, editorContent) => ipcRenderer.invoke('snippet-execute', id, content, editorContent),
  getTriggerKey: () => ipcRenderer.invoke('get-trigger-key'),
  getExecuteKey: () => ipcRenderer.invoke('get-execute-key'),

  // ===== Tools API =====
  getTools: () => ipcRenderer.invoke('tools-list'),
  getToolSchema: (type) => ipcRenderer.invoke('tools-schema', type),

  // ===== Manifest Tools API =====
  getManifestTools: () => ipcRenderer.invoke('manifest-tools-list'),
  getManifestCommands: () => ipcRenderer.invoke('manifest-commands-list'),
  getManifestToolSettings: (toolId) => ipcRenderer.invoke('manifest-tool-settings-get', toolId),
  saveManifestToolSettings: (toolId, settings) => ipcRenderer.invoke('manifest-tool-settings-save', toolId, settings),
  executeManifestTool: (toolId, shortcut, fieldValues) => ipcRenderer.invoke('manifest-tool-execute', toolId, shortcut, fieldValues),

  // ===== License API =====
  getLicense: () => ipcRenderer.invoke('get-license'),
  setLicense: (data) => ipcRenderer.invoke('set-license', data),
  verifyLicense: (key) => ipcRenderer.invoke('verify-license', key),
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  cacheLicenseVerification: (result) => ipcRenderer.invoke('cache-license-verification', result),
  getSyncServer: () => ipcRenderer.invoke('get-sync-server'),

  // ===== Memo Transfer API =====
  sendMemo: (recipientKey, content, metadata) => ipcRenderer.invoke('memo-send', recipientKey, content, metadata),
  sendMemoByEmail: (email, content, metadata) => ipcRenderer.invoke('memo-send-by-email', email, content, metadata),
  getMemoInbox: () => ipcRenderer.invoke('memo-inbox'),
  getMemoContacts: () => ipcRenderer.invoke('memo-contacts'),
  receiveMemo: (transferId) => ipcRenderer.invoke('memo-receive', transferId),
  markMemoRead: (memoId) => ipcRenderer.invoke('memo-mark-read', memoId),
  getUnreadCount: () => ipcRenderer.invoke('memo-unread-count'),

  // ===== Contacts Cache API =====
  getContactsCache: () => ipcRenderer.invoke('contacts-cache-getAll'),
  upsertContactsCache: (contacts) => ipcRenderer.invoke('contacts-cache-upsert', contacts),
  toggleContactFavorite: (email) => ipcRenderer.invoke('contact-toggle-favorite', email),

  // ===== Settings Sync API =====
  syncSettingsPull: () => ipcRenderer.invoke('settings-sync-pull'),
  syncSettingsPush: (key, value) => ipcRenderer.invoke('settings-sync-push', key, value),

  // ===== Snippets Sync API =====
  syncSnippets: () => ipcRenderer.invoke('snippets-sync'),

  // ===== Groups API =====
  getGroups: () => ipcRenderer.invoke('groups-getAll'),
  createGroup: (data) => ipcRenderer.invoke('group-create', data),
  deleteGroup: (groupId) => ipcRenderer.invoke('group-delete', groupId),
  addGroupMember: (groupId, email) => ipcRenderer.invoke('group-add-member', groupId, email),
  removeGroupMember: (groupId, email) => ipcRenderer.invoke('group-remove-member', groupId, email),
  getContactsByGroup: (groupId) => ipcRenderer.invoke('contacts-by-group', groupId),

  // ===== Reminder API =====
  addReminder: (data) => ipcRenderer.invoke('reminder-add', data),
  deleteReminder: (id) => ipcRenderer.invoke('reminder-delete', id),
  deleteReminderByText: (text) => ipcRenderer.invoke('reminder-delete-by-text', text),
  getReminders: () => ipcRenderer.invoke('reminder-list'),
  updateReminder: (data) => ipcRenderer.invoke('reminder-update', data),
  testReminder: () => ipcRenderer.invoke('reminder-test'),
  clearAllReminders: () => ipcRenderer.invoke('reminder-clear-all'),

  // ===== Notification History API =====
  getUnreadNotifications: () => ipcRenderer.invoke('notification-get-unread'),
  markNotificationRead: (id) => ipcRenderer.invoke('notification-mark-read', id),
  markAllNotificationsRead: () => ipcRenderer.invoke('notification-mark-all-read'),
  deleteNotification: (id) => ipcRenderer.invoke('notification-delete', id),

  // ===== Legacy (for compatibility) =====
  getByUuid: (uuid) => ipcRenderer.invoke('memo-get-by-uuid', uuid),

  // ===== Window Controls =====
  newMemo: () => ipcRenderer.send('new-memo'),
  closeWindow: () => ipcRenderer.send('close-window'),
  forceClose: () => ipcRenderer.send('force-close'),

  // ===== Event Listeners (안전한 버전) =====
  onRequestClose: (callback) => requestCloseListener.on(callback),
  offRequestClose: () => requestCloseListener.off(),
  onMemosUpdated: (callback) => memosUpdatedListener.on(callback),
  offMemosUpdated: () => memosUpdatedListener.off(),
  onTriggerKeyChanged: (callback) => triggerKeyChangedListener.on(callback),
  offTriggerKeyChanged: () => triggerKeyChangedListener.off(),
  onExecuteKeyChanged: (callback) => executeKeyChangedListener.on(callback),
  offExecuteKeyChanged: () => executeKeyChangedListener.off(),
  onSyncServerChanged: (callback) => syncServerChangedListener.on(callback),
  offSyncServerChanged: () => syncServerChangedListener.off(),
  onCreateNewMemo: (callback) => createNewMemoListener.on(callback),
  offCreateNewMemo: () => createNewMemoListener.off(),
  onFocusSearch: (callback) => focusSearchListener.on(callback),
  offFocusSearch: () => focusSearchListener.off(),
  onSaveBeforeQuit: (callback) => saveBeforeQuitListener.on(callback),
  offSaveBeforeQuit: () => saveBeforeQuitListener.off(),
  onReceivedMemo: (callback) => receivedMemoListener.on(callback),
  offReceivedMemo: () => receivedMemoListener.off(),
  onUnreadCountChanged: (callback) => unreadCountChangedListener.on(callback),
  offUnreadCountChanged: () => unreadCountChangedListener.off(),
  onQuickShareTrigger: (callback) => quickShareTriggerListener.on(callback),
  offQuickShareTrigger: () => quickShareTriggerListener.off()
});
