/**
 * collaboration.js - 실시간 협업 기능 (Yjs CRDT 기반)
 */

import * as Y from 'yjs';
import { elements, memoState } from './state.js';

// 협업 상태
export const collabState = {
  // Yjs
  doc: null,           // Y.Doc
  yText: null,         // Y.Text (에디터 내용)

  // 세션 정보
  sessionId: null,
  isHost: false,

  // 참여자
  participants: new Map(),  // userId -> {name, email, cursorColor, cursor}
  myColor: null,

  // 연결 상태
  isConnected: false,
  isCollaborating: false,

  // 트래픽 최적화
  updateBuffer: [],
  updateTimer: null,
  UPDATE_DEBOUNCE_MS: 50,  // 50ms 디바운싱

  // 로컬 변경 추적 (무한 루프 방지)
  isApplyingRemote: false
};

// 커서 오버레이 관리
const cursorOverlays = new Map();

/**
 * 협업 세션 시작
 */
export async function startCollaboration(memoUuid, content) {
  if (collabState.isCollaborating) {
    console.log('[Collab] Already collaborating');
    return { success: false, error: 'Already in session' };
  }

  try {
    // 1. 서버에 세션 생성 요청
    const token = await window.api.authGetToken();
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    const syncServer = await window.api.getSyncServer();
    const response = await fetch(`${syncServer}/api/v2/collab/session`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        memoUuid,
        title: content?.split('\n')[0]?.substring(0, 100) || 'Untitled'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to create session' };
    }

    const { sessionId, existing } = await response.json();

    // 2. Yjs 문서 초기화
    collabState.doc = new Y.Doc();
    collabState.yText = collabState.doc.getText('content');

    // 초기 콘텐츠 설정 (호스트인 경우)
    if (!existing && content) {
      collabState.yText.insert(0, content);
    }

    // 3. Yjs 변경 감지
    collabState.yText.observe((event, transaction) => {
      if (transaction.local && !collabState.isApplyingRemote) {
        // 로컬 변경을 서버로 전송
        const update = Y.encodeStateAsUpdate(collabState.doc);
        queueUpdate(update);
      }
    });

    // 4. WebSocket으로 세션 참가
    const result = await window.api.collabStart(sessionId, memoUuid);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    collabState.sessionId = sessionId;
    collabState.isHost = !existing;
    collabState.isCollaborating = true;

    // 5. 이벤트 리스너 설정
    setupCollabEventListeners();

    console.log('[Collab] Session started:', sessionId);
    return { success: true, sessionId };
  } catch (e) {
    console.error('[Collab] Failed to start collaboration:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 협업 세션 종료
 */
export async function stopCollaboration() {
  if (!collabState.isCollaborating) return;

  try {
    // WebSocket 세션 나가기
    await window.api.collabStop();

    // 상태 초기화
    collabState.doc?.destroy();
    collabState.doc = null;
    collabState.yText = null;
    collabState.sessionId = null;
    collabState.isHost = false;
    collabState.isCollaborating = false;
    collabState.participants.clear();

    // 커서 오버레이 제거
    removeAllCursorOverlays();

    // 이벤트 리스너 해제
    removeCollabEventListeners();

    console.log('[Collab] Session stopped');
  } catch (e) {
    console.error('[Collab] Failed to stop collaboration:', e);
  }
}

/**
 * 원격 업데이트 적용
 */
export function applyRemoteUpdate(update) {
  if (!collabState.doc) return;

  try {
    collabState.isApplyingRemote = true;

    // Base64 디코딩
    const updateArray = Uint8Array.from(atob(update), c => c.charCodeAt(0));
    Y.applyUpdate(collabState.doc, updateArray);

    // 에디터에 반영
    syncEditorFromYjs();

    collabState.isApplyingRemote = false;
  } catch (e) {
    console.error('[Collab] Failed to apply remote update:', e);
    collabState.isApplyingRemote = false;
  }
}

/**
 * 원격 커서 업데이트
 */
export function updateRemoteCursor(userId, userName, cursorColor, cursor) {
  const participant = collabState.participants.get(userId) || {};
  participant.name = userName;
  participant.cursorColor = cursorColor;
  participant.cursor = cursor;
  collabState.participants.set(userId, participant);

  // 커서 오버레이 업데이트
  renderRemoteCursor(userId, userName, cursorColor, cursor);
}

/**
 * 참여자 입장 처리
 */
export function handleParticipantJoin(userId, userName, cursorColor) {
  collabState.participants.set(userId, { name: userName, cursorColor });
  updateParticipantsList();
  showCollabNotification(`${userName}님이 참가했습니다`);
}

/**
 * 참여자 퇴장 처리
 */
export function handleParticipantLeave(userId, userName) {
  collabState.participants.delete(userId);
  removeCursorOverlay(userId);
  updateParticipantsList();
  showCollabNotification(`${userName}님이 나갔습니다`);
}

/**
 * 로컬 변경사항을 Yjs로 동기화
 */
export function syncYjsFromEditor() {
  if (!collabState.yText || collabState.isApplyingRemote) return;

  const editor = elements.editor;
  const content = editor.innerText || '';

  // 차이 계산 및 적용 (간단한 전체 교체 방식)
  const currentContent = collabState.yText.toString();
  if (content !== currentContent) {
    collabState.doc.transact(() => {
      collabState.yText.delete(0, collabState.yText.length);
      collabState.yText.insert(0, content);
    });
  }
}

/**
 * 로컬 커서 위치 전송
 */
export function sendLocalCursor() {
  if (!collabState.isCollaborating) return;

  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const editor = elements.editor;

  // 커서 위치 계산 (에디터 내 오프셋)
  const preCaretRange = document.createRange();
  preCaretRange.selectNodeContents(editor);
  preCaretRange.setEnd(range.startContainer, range.startOffset);
  const index = preCaretRange.toString().length;
  const length = range.toString().length;

  window.api.collabSendCursor({ index, length });
}

// ===== 내부 함수들 =====

/**
 * 업데이트 큐에 추가 (디바운싱)
 */
function queueUpdate(update) {
  // Base64 인코딩
  const base64Update = btoa(String.fromCharCode.apply(null, update));

  collabState.updateBuffer.push(base64Update);

  if (collabState.updateTimer) {
    clearTimeout(collabState.updateTimer);
  }

  collabState.updateTimer = setTimeout(() => {
    flushUpdates();
  }, collabState.UPDATE_DEBOUNCE_MS);
}

/**
 * 대기 중인 업데이트 전송
 */
function flushUpdates() {
  if (collabState.updateBuffer.length === 0) return;

  // 마지막 업데이트만 전송 (Yjs는 누적이므로)
  const lastUpdate = collabState.updateBuffer[collabState.updateBuffer.length - 1];
  collabState.updateBuffer = [];

  window.api.collabSendUpdate(lastUpdate);
}

/**
 * Yjs에서 에디터로 동기화
 */
function syncEditorFromYjs() {
  if (!collabState.yText) return;

  const editor = elements.editor;
  const content = collabState.yText.toString();

  // 커서 위치 저장
  const selection = window.getSelection();
  let savedOffset = 0;
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const preCaretRange = document.createRange();
    preCaretRange.selectNodeContents(editor);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    savedOffset = preCaretRange.toString().length;
  }

  // 콘텐츠 업데이트
  if (editor.innerText !== content) {
    editor.innerText = content;

    // 커서 복원
    restoreCursorPosition(editor, savedOffset);
  }
}

/**
 * 커서 위치 복원
 */
function restoreCursorPosition(editor, offset) {
  const textContent = editor.innerText;
  if (offset > textContent.length) offset = textContent.length;

  const range = document.createRange();
  const selection = window.getSelection();

  let currentOffset = 0;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const nodeLength = node.textContent.length;

    if (currentOffset + nodeLength >= offset) {
      range.setStart(node, offset - currentOffset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    currentOffset += nodeLength;
  }
}

/**
 * 원격 커서 오버레이 렌더링
 */
function renderRemoteCursor(userId, userName, color, cursor) {
  // 기존 오버레이 제거
  removeCursorOverlay(userId);

  if (!cursor) return;

  const editor = elements.editor;
  const { index, length } = cursor;

  // 커서 위치에 오버레이 생성
  const overlay = document.createElement('div');
  overlay.className = 'remote-cursor';
  overlay.dataset.userId = userId;
  overlay.style.backgroundColor = color;

  const label = document.createElement('div');
  label.className = 'remote-cursor-label';
  label.textContent = userName;
  label.style.backgroundColor = color;

  overlay.appendChild(label);

  // 위치 계산
  const rect = getCaretRect(editor, index);
  if (rect) {
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.height = rect.height + 'px';
  }

  document.body.appendChild(overlay);
  cursorOverlays.set(userId, overlay);
}

/**
 * 특정 오프셋의 캐럿 위치 가져오기
 */
function getCaretRect(element, offset) {
  const range = document.createRange();
  const textContent = element.innerText;

  if (offset > textContent.length) offset = textContent.length;

  let currentOffset = 0;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const nodeLength = node.textContent.length;

    if (currentOffset + nodeLength >= offset) {
      range.setStart(node, offset - currentOffset);
      range.collapse(true);
      return range.getBoundingClientRect();
    }

    currentOffset += nodeLength;
  }

  return null;
}

/**
 * 커서 오버레이 제거
 */
function removeCursorOverlay(userId) {
  const overlay = cursorOverlays.get(userId);
  if (overlay) {
    overlay.remove();
    cursorOverlays.delete(userId);
  }
}

/**
 * 모든 커서 오버레이 제거
 */
function removeAllCursorOverlays() {
  cursorOverlays.forEach(overlay => overlay.remove());
  cursorOverlays.clear();
}

/**
 * 참여자 목록 UI 업데이트
 */
function updateParticipantsList() {
  const container = document.getElementById('collab-participants');
  if (!container) return;

  container.innerHTML = '';

  collabState.participants.forEach((participant, userId) => {
    const avatar = document.createElement('div');
    avatar.className = 'collab-participant';
    avatar.style.borderColor = participant.cursorColor;
    avatar.title = participant.name;
    avatar.textContent = participant.name?.charAt(0)?.toUpperCase() || '?';
    container.appendChild(avatar);
  });
}

/**
 * 협업 알림 표시
 */
function showCollabNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'collab-notification';
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

/**
 * 이벤트 리스너 설정
 */
function setupCollabEventListeners() {
  // WebSocket 이벤트
  window.api.onCollabUpdate((data) => {
    if (data.update) {
      applyRemoteUpdate(data.update);
    }
  });

  window.api.onCollabCursor((data) => {
    updateRemoteCursor(data.userId, data.userName, data.cursorColor, data.cursor);
  });

  window.api.onCollabJoin((data) => {
    handleParticipantJoin(data.userId, data.userName, data.cursorColor);
  });

  window.api.onCollabLeave((data) => {
    handleParticipantLeave(data.userId, data.userName);
  });

  // 에디터 이벤트
  elements.editor.addEventListener('input', handleEditorInput);
  elements.editor.addEventListener('selectionchange', handleSelectionChange);
}

/**
 * 이벤트 리스너 해제
 */
function removeCollabEventListeners() {
  window.api.offCollabUpdate();
  window.api.offCollabCursor();
  window.api.offCollabJoin();
  window.api.offCollabLeave();

  elements.editor.removeEventListener('input', handleEditorInput);
  elements.editor.removeEventListener('selectionchange', handleSelectionChange);
}

/**
 * 에디터 입력 핸들러
 */
function handleEditorInput() {
  if (collabState.isCollaborating && !collabState.isApplyingRemote) {
    syncYjsFromEditor();
  }
}

/**
 * 선택 변경 핸들러
 */
let cursorDebounceTimer = null;
function handleSelectionChange() {
  if (!collabState.isCollaborating) return;

  if (cursorDebounceTimer) {
    clearTimeout(cursorDebounceTimer);
  }

  cursorDebounceTimer = setTimeout(() => {
    sendLocalCursor();
  }, 100);
}

// ===== 상태 확인 함수들 =====

export function isCollaborating() {
  return collabState.isCollaborating;
}

export function getParticipants() {
  return Array.from(collabState.participants.entries()).map(([id, p]) => ({
    id,
    ...p
  }));
}

export function getSessionId() {
  return collabState.sessionId;
}
