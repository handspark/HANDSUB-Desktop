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
const authSuccessListener = createSafeListener('auth-success');
const authErrorListener = createSafeListener('auth-error');
const authLogoutListener = createSafeListener('auth-logout');
const tierUpdatedListener = createSafeListener('tier-updated');

// 협업 관련 리스너
const wsConnectedListener = createSafeListener('ws-connected');
const wsDisconnectedListener = createSafeListener('ws-disconnected');
const collabJoinedListener = createSafeListener('collab-joined');  // 내가 참가 완료
const collabUpdateListener = createSafeListener('collab-update');
const collabCursorListener = createSafeListener('collab-cursor');
const collabJoinListener = createSafeListener('collab-join');      // 다른 사람 참가
const collabLeaveListener = createSafeListener('collab-leave');
const collabKickedListener = createSafeListener('collab-kicked');  // 강퇴당함
const collabErrorListener = createSafeListener('collab-error');    // 협업 오류 (not_invited 등)
const collabInviteListener = createSafeListener('collab-invite');  // 협업 초대 알림

// API for renderer (all DB operations go through main process)
contextBridge.exposeInMainWorld('api', {
  // ===== Memo CRUD (async via IPC) =====
  getAll: () => ipcRenderer.invoke('memo-getAll'),
  get: (id) => ipcRenderer.invoke('memo-get', id),
  create: () => ipcRenderer.invoke('memo-create'),
  update: (id, content) => ipcRenderer.invoke('memo-update', id, content),
  delete: (id) => ipcRenderer.invoke('memo-delete', id),
  toggleMemoPin: (id) => ipcRenderer.invoke('memo-togglePin', id),

  // ===== Cloud Memo Operations (Pro only) =====
  cloudGetLocalCount: () => ipcRenderer.invoke('cloud-get-local-count'),   // 로컬 메모 개수
  cloudGetCount: () => ipcRenderer.invoke('cloud-get-count'),              // 클라우드 메모 개수
  cloudGetMemos: () => ipcRenderer.invoke('cloud-get-memos'),              // 클라우드 메모 목록
  cloudSyncMemo: (memoId) => ipcRenderer.invoke('cloud-sync-memo', memoId),// 메모를 클라우드에 동기화
  cloudImportMemos: (mode) => ipcRenderer.invoke('cloud-import-memos', mode), // 클라우드 메모 가져오기 (merge | replace)
  cloudDeleteMemo: (memoUuid) => ipcRenderer.invoke('cloud-delete-memo', memoUuid), // 클라우드 메모 삭제

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

  // ===== Device API =====
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  getSyncServer: () => ipcRenderer.invoke('get-sync-server'),

  // ===== Auth API (로그인 기반) =====
  authLogin: () => ipcRenderer.invoke('auth-login'),
  authGetUser: () => ipcRenderer.invoke('auth-get-user'),
  getUser: () => ipcRenderer.invoke('auth-get-user'),
  authLogout: (options) => ipcRenderer.invoke('auth-logout', options),  // options: { keepLocal: boolean }
  authRefresh: () => ipcRenderer.invoke('auth-refresh'),
  authIsPro: () => ipcRenderer.invoke('auth-is-pro'),
  authGetToken: () => ipcRenderer.invoke('auth-get-token'),

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

  // ===== Share Link API =====
  createShareLink: (data) => ipcRenderer.invoke('share-link-create', data),
  updateShareLink: (data) => ipcRenderer.invoke('share-link-update', data),
  deleteShareLink: (token) => ipcRenderer.invoke('share-link-delete', token),
  getMyShares: () => ipcRenderer.invoke('share-link-list'),
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard-write', text),

  // ===== Reminder API =====
  addReminder: (data) => ipcRenderer.invoke('reminder-add', data),
  deleteReminder: (id) => ipcRenderer.invoke('reminder-delete', id),
  deleteReminderByText: (text) => ipcRenderer.invoke('reminder-delete-by-text', text),
  deleteReminderByMemo: (memoId) => ipcRenderer.invoke('reminder-delete-by-memo', memoId),
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
  offQuickShareTrigger: () => quickShareTriggerListener.off(),

  // ===== Auth Event Listeners =====
  onAuthSuccess: (callback) => authSuccessListener.on(callback),
  offAuthSuccess: () => authSuccessListener.off(),
  onAuthError: (callback) => authErrorListener.on(callback),
  offAuthError: () => authErrorListener.off(),
  onAuthLogout: (callback) => authLogoutListener.on(callback),
  offAuthLogout: () => authLogoutListener.off(),

  // ===== Tier Update (WebSocket) =====
  onTierUpdated: (callback) => tierUpdatedListener.on(callback),
  offTierUpdated: () => tierUpdatedListener.off(),

  // ===== WebSocket 연결 상태 =====
  onWsConnected: (callback) => wsConnectedListener.on(callback),
  offWsConnected: () => wsConnectedListener.off(),
  onWsDisconnected: (callback) => wsDisconnectedListener.on(callback),
  offWsDisconnected: () => wsDisconnectedListener.off(),

  // ===== 협업 (Collaboration) =====
  onCollabJoined: (callback) => collabJoinedListener.on(callback),  // 내가 참가 완료
  offCollabJoined: () => collabJoinedListener.off(),
  onCollabUpdate: (callback) => collabUpdateListener.on(callback),
  offCollabUpdate: () => collabUpdateListener.off(),
  onCollabCursor: (callback) => collabCursorListener.on(callback),
  offCollabCursor: () => collabCursorListener.off(),
  onCollabJoin: (callback) => collabJoinListener.on(callback),      // 다른 사람 참가
  offCollabJoin: () => collabJoinListener.off(),
  onCollabLeave: (callback) => collabLeaveListener.on(callback),
  offCollabLeave: () => collabLeaveListener.off(),
  onCollabKicked: (callback) => collabKickedListener.on(callback),  // 강퇴당함
  offCollabKicked: () => collabKickedListener.off(),
  onCollabError: (callback) => collabErrorListener.on(callback),    // 협업 오류 (not_invited 등)
  offCollabError: () => collabErrorListener.off(),
  onCollabInvite: (callback) => collabInviteListener.on(callback),  // 협업 초대 알림
  offCollabInvite: () => collabInviteListener.off(),

  // ===== 협업 API =====
  collabStart: (sessionId, memoUuid) => ipcRenderer.invoke('collab-start', sessionId, memoUuid),
  collabStop: () => ipcRenderer.invoke('collab-stop'),
  collabSendUpdate: (update) => ipcRenderer.invoke('collab-send-update', update),
  collabSendCursor: (cursor) => ipcRenderer.invoke('collab-send-cursor', cursor),
  collabKick: (sessionId, targetUserId) => ipcRenderer.invoke('collab-kick', sessionId, targetUserId),
  collabGetInvites: () => ipcRenderer.invoke('collab-get-invites'),
  collabRespondInvite: (inviteId, accept) => ipcRenderer.invoke('collab-respond-invite', inviteId, accept)
});
