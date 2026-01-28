/**
 * collaboration.js - 실시간 협업 기능 (줄 단위 동기화)
 *
 * 각 줄을 독립적인 블록으로 취급하여 충돌 최소화
 * - 다른 줄 편집 시: 충돌 없음
 * - 같은 줄 편집 시: 마지막 값 적용 (한 줄이라 피해 최소)
 */

import { elements, memoState } from './state.js';

// ===== 협업 상태 =====
export const collabState = {
  // 세션 정보
  sessionId: null,
  isHost: false,

  // 참여자
  participants: new Map(),  // oduserId -> {name, cursorColor, lineIndex}
  myColor: null,

  // 연결 상태
  isConnected: false,
  isCollaborating: false,

  // 줄 단위 추적
  lines: [],              // [{id, text, editingBy}]
  lastLines: [],          // 이전 상태 (변경 감지용)
  currentLineIndex: -1,   // 현재 편집 중인 줄

  // 트래픽 최적화
  updateTimer: null,
  UPDATE_DEBOUNCE_MS: 100,  // 100ms 디바운싱

  // 로컬 변경 추적
  isApplyingRemote: false
};

// 커서 오버레이 관리
const cursorOverlays = new Map();

// 줄 ID 생성
let lineIdCounter = 0;
function generateLineId() {
  return `L${Date.now()}-${lineIdCounter++}`;
}

// ===== 줄 파싱/병합 =====

/**
 * 에디터 내용을 줄 배열로 파싱
 */
function parseEditorToLines() {
  const editor = elements.editor;
  const text = editor.innerText || '';
  const textLines = text.split('\n');

  // 기존 줄 ID 유지하면서 업데이트
  const newLines = textLines.map((lineText, index) => {
    const existingLine = collabState.lines[index];
    return {
      id: existingLine?.id || generateLineId(),
      text: lineText,
      editingBy: null
    };
  });

  return newLines;
}

/**
 * 줄 배열을 에디터에 반영
 */
function applyLinesToEditor(lines) {
  const editor = elements.editor;
  const newContent = lines.map(l => l.text).join('\n');

  if (editor.innerText !== newContent) {
    // 커서 위치 저장
    const cursorInfo = saveCursorPosition();

    editor.innerText = newContent;

    // 커서 복원
    if (cursorInfo) {
      restoreCursorPosition(cursorInfo);
    }
  }
}

/**
 * 변경된 줄 찾기
 */
function findChangedLines(oldLines, newLines) {
  const changes = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (!oldLine && newLine) {
      // 새 줄 추가
      changes.push({ type: 'add', index: i, line: newLine });
    } else if (oldLine && !newLine) {
      // 줄 삭제
      changes.push({ type: 'delete', index: i, lineId: oldLine.id });
    } else if (oldLine.text !== newLine.text) {
      // 줄 수정
      changes.push({ type: 'update', index: i, line: newLine });
    }
  }

  return changes;
}

// ===== 커서 위치 관리 =====

function saveCursorPosition() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  const editor = elements.editor;

  // 전체 오프셋 계산
  const preCaretRange = document.createRange();
  preCaretRange.selectNodeContents(editor);
  preCaretRange.setEnd(range.startContainer, range.startOffset);
  const offset = preCaretRange.toString().length;

  // 줄 번호와 줄 내 오프셋 계산
  const text = editor.innerText || '';
  const beforeCursor = text.substring(0, offset);
  const lineIndex = (beforeCursor.match(/\n/g) || []).length;
  const lastNewline = beforeCursor.lastIndexOf('\n');
  const columnOffset = lastNewline === -1 ? offset : offset - lastNewline - 1;

  return { offset, lineIndex, columnOffset };
}

function restoreCursorPosition(cursorInfo) {
  if (!cursorInfo) return;

  const editor = elements.editor;
  const text = editor.innerText || '';

  // 줄 기반으로 오프셋 재계산
  const lines = text.split('\n');
  let newOffset = 0;

  for (let i = 0; i < cursorInfo.lineIndex && i < lines.length; i++) {
    newOffset += lines[i].length + 1; // +1 for \n
  }

  if (cursorInfo.lineIndex < lines.length) {
    const lineLength = lines[cursorInfo.lineIndex].length;
    newOffset += Math.min(cursorInfo.columnOffset, lineLength);
  }

  // 오프셋으로 커서 설정
  setCaretPosition(editor, newOffset);
}

function setCaretPosition(element, offset) {
  const textContent = element.innerText || '';
  if (offset > textContent.length) offset = textContent.length;

  const range = document.createRange();
  const selection = window.getSelection();

  let currentOffset = 0;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);

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

  // 끝에 커서 설정
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getCurrentLineIndex() {
  const cursorInfo = saveCursorPosition();
  return cursorInfo ? cursorInfo.lineIndex : -1;
}

// ===== 협업 세션 관리 =====

/**
 * 협업 세션 시작
 */
export async function startCollaboration(memoUuid, content) {
  if (collabState.isCollaborating) {
    console.log('[Collab] Already collaborating');
    return { success: false, error: 'Already in session' };
  }

  try {
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

    const { sessionId, existing, isOwner } = await response.json();
    console.log('[Collab] API returned sessionId:', sessionId, 'existing:', existing, 'isOwner:', isOwner);

    // 방장 여부 저장
    collabState.isHost = isOwner;

    // WebSocket 세션 참가
    const result = await window.api.collabStart(sessionId, memoUuid);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // 초기 줄 상태 설정
    collabState.lines = parseEditorToLines();
    collabState.lastLines = JSON.parse(JSON.stringify(collabState.lines));

    collabState.sessionId = sessionId;
    collabState.isCollaborating = true;

    // 호스트면 초기 상태 전송
    if (isOwner && !existing) {
      sendFullSync();
    }

    setupCollabEventListeners();

    console.log('[Collab] Session started:', sessionId, 'lines:', collabState.lines.length);
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
    await window.api.collabStop();

    // 상태 초기화
    collabState.sessionId = null;
    collabState.isHost = false;
    collabState.isCollaborating = false;
    collabState.participants.clear();
    collabState.lines = [];
    collabState.lastLines = [];
    collabState.currentLineIndex = -1;

    removeAllCursorOverlays();
    removeCollabEventListeners();

    console.log('[Collab] Session stopped');
  } catch (e) {
    console.error('[Collab] Failed to stop collaboration:', e);
  }
}

// ===== 동기화 =====

/**
 * 전체 동기화 전송 (초기 또는 재동기화)
 */
function sendFullSync() {
  window.api.collabSendUpdate({
    type: 'full-sync',
    lines: collabState.lines
  });
}

/**
 * 줄 변경사항 전송
 */
function sendLineChanges(changes) {
  if (changes.length === 0) return;

  window.api.collabSendUpdate({
    type: 'line-changes',
    changes: changes,
    lineIndex: collabState.currentLineIndex
  });
}

/**
 * 로컬 변경 감지 및 전송
 */
function syncLocalChanges() {
  if (!collabState.isCollaborating || collabState.isApplyingRemote) {
    console.log('[Collab] syncLocalChanges skipped - isCollaborating:', collabState.isCollaborating, 'isApplyingRemote:', collabState.isApplyingRemote);
    return;
  }

  const newLines = parseEditorToLines();
  const changes = findChangedLines(collabState.lastLines, newLines);

  console.log('[Collab] syncLocalChanges - found', changes.length, 'changes');

  if (changes.length > 0) {
    // 현재 편집 중인 줄 업데이트
    collabState.currentLineIndex = getCurrentLineIndex();

    console.log('[Collab] Sending changes:', changes.map(c => ({ type: c.type, index: c.index })));

    // 변경사항 전송
    sendLineChanges(changes);

    // 상태 업데이트
    collabState.lines = newLines;
    collabState.lastLines = JSON.parse(JSON.stringify(newLines));
  }
}

/**
 * 원격 업데이트 적용
 */
export function applyRemoteUpdate(data) {
  console.log('[Collab] applyRemoteUpdate called:', data?.type, 'isCollaborating:', collabState.isCollaborating);

  if (!collabState.isCollaborating) {
    console.log('[Collab] applyRemoteUpdate skipped - not collaborating');
    return;
  }

  try {
    collabState.isApplyingRemote = true;

    if (data.type === 'full-sync') {
      // 전체 동기화
      collabState.lines = data.lines;
      collabState.lastLines = JSON.parse(JSON.stringify(data.lines));
      applyLinesToEditor(data.lines);
      console.log('[Collab] Full sync applied:', data.lines.length, 'lines');

    } else if (data.type === 'line-changes') {
      // 줄 단위 변경 적용
      console.log('[Collab] Applying line changes:', data.changes?.length, 'changes from user:', data.userId);
      applyLineChanges(data.changes, data.lineIndex, data.userId);
    } else {
      console.log('[Collab] Unknown update type:', data.type);
    }

    collabState.isApplyingRemote = false;
  } catch (e) {
    console.error('[Collab] Failed to apply remote update:', e);
    collabState.isApplyingRemote = false;
  }
}

/**
 * 줄 변경사항 적용
 */
function applyLineChanges(changes, remoteLineIndex, userId) {
  const myLineIndex = getCurrentLineIndex();

  for (const change of changes) {
    switch (change.type) {
      case 'add':
        // 새 줄 삽입
        collabState.lines.splice(change.index, 0, change.line);
        break;

      case 'delete':
        // 줄 삭제
        const deleteIndex = collabState.lines.findIndex(l => l.id === change.lineId);
        if (deleteIndex !== -1) {
          collabState.lines.splice(deleteIndex, 1);
        }
        break;

      case 'update':
        // 줄 업데이트 (같은 줄 편집 중이 아닐 때만)
        if (change.index !== myLineIndex) {
          if (collabState.lines[change.index]) {
            collabState.lines[change.index].text = change.line.text;
          }
        } else {
          // 같은 줄 편집 중 - 내 변경 유지 (충돌 무시)
          console.log('[Collab] Conflict on line', change.index, '- keeping local');
        }
        break;
    }
  }

  collabState.lastLines = JSON.parse(JSON.stringify(collabState.lines));
  applyLinesToEditor(collabState.lines);

  // 원격 사용자 편집 위치 업데이트
  if (userId && remoteLineIndex >= 0) {
    const participant = collabState.participants.get(userId);
    if (participant) {
      participant.lineIndex = remoteLineIndex;
      renderRemoteLineIndicator(userId, participant);
    }
  }
}

// ===== 커서/편집 표시 =====

/**
 * 원격 사용자의 편집 줄 표시
 */
function renderRemoteLineIndicator(userId, participant) {
  removeCursorOverlay(userId);

  if (participant.lineIndex < 0) return;

  const editor = elements.editor;
  const editorRect = editor.getBoundingClientRect();
  const lines = editor.innerText.split('\n');

  if (participant.lineIndex >= lines.length) return;

  // 해당 줄의 위치 계산
  let offset = 0;
  for (let i = 0; i < participant.lineIndex; i++) {
    offset += lines[i].length + 1;
  }

  const rect = getCaretRect(editor, offset);
  if (!rect) return;

  // 커서 컨테이너 (에디터 기준 상대 위치)
  const cursorLeft = editorRect.left + 2;
  const cursorTop = rect.top;

  // 기본 Gravatar 아바타
  const defaultAvatar = 'https://www.gravatar.com/avatar/?d=mp&s=32';
  const avatarUrl = participant.avatarUrl || defaultAvatar;

  // 커서 오버레이 (세로 막대 + 호버 영역)
  const overlay = document.createElement('div');
  overlay.className = 'remote-cursor';
  overlay.dataset.userId = userId;
  overlay.style.left = (cursorLeft - 8) + 'px';  // 패딩 보정
  overlay.style.top = cursorTop + 'px';
  overlay.style.height = rect.height + 'px';
  overlay.style.backgroundColor = participant.cursorColor || '#666';

  // 툴팁 (프로필 + 이름) - hover 시에만 표시
  const tooltip = document.createElement('div');
  tooltip.className = 'remote-cursor-tooltip';
  tooltip.innerHTML = `
    <img src="${avatarUrl}" alt="" onerror="this.src='${defaultAvatar}'">
    <span>${participant.name || '참여자'}</span>
  `;
  tooltip.style.backgroundColor = participant.cursorColor || '#666';

  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);
  cursorOverlays.set(userId, overlay);
}

function getCaretRect(element, offset) {
  const text = element.innerText || '';
  if (offset > text.length) offset = text.length;

  const range = document.createRange();
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

  // 빈 에디터일 경우
  range.selectNodeContents(element);
  range.collapse(true);
  return range.getBoundingClientRect();
}

function removeCursorOverlay(userId) {
  const overlay = cursorOverlays.get(userId);
  if (overlay) {
    overlay.remove();
    cursorOverlays.delete(userId);
  }
}

function removeAllCursorOverlays() {
  cursorOverlays.forEach(overlay => overlay.remove());
  cursorOverlays.clear();
}

// ===== 참여자 관리 =====

export function handleParticipantJoin(userId, userName, cursorColor, avatarUrl) {
  console.log('[Collab] Participant joined:', userName, 'avatarUrl:', avatarUrl);
  collabState.participants.set(userId, {
    name: userName,
    cursorColor,
    avatarUrl: avatarUrl || null,
    lineIndex: -1,
    isTyping: false
  });
  updateParticipantsList();
  showCollabNotification(`${userName}님이 참가했습니다`);

  // 새 참여자에게 현재 상태 전송 (호스트만)
  if (collabState.isHost) {
    sendFullSync();
  }
}

export function handleParticipantLeave(userId, userName) {
  collabState.participants.delete(userId);
  removeCursorOverlay(userId);
  updateParticipantsList();
  showCollabNotification(`${userName}님이 나갔습니다`);
}

function updateParticipantsList() {
  const container = document.getElementById('collab-participants');
  if (!container) {
    console.log('[Collab] No container found');
    return;
  }

  container.innerHTML = '';

  // 로그인하지 않으면 프로필 표시 안 함
  if (!window.userProfile) {
    console.log('[Collab] No userProfile');
    return;
  }

  // 내 프로필 표시
  const myColor = collabState.isCollaborating ? collabState.myColor : '#666';
  const isHost = collabState.isHost;
  const myAvatar = createParticipantAvatar({
    name: '나',
    cursorColor: myColor,
    avatarUrl: window.userProfile.avatarUrl,
    isTyping: false
  }, true, isHost);

  container.appendChild(myAvatar);

  // 협업 중이면 다른 참여자들도 표시
  if (collabState.isCollaborating) {
    collabState.participants.forEach((participant, odUserId) => {
      const avatar = createParticipantAvatar(participant, false, false, odUserId);
      container.appendChild(avatar);
    });
  }

  // 전체 컨테이너 클릭 시 공유 팝업 열기
  container.style.cursor = 'pointer';
  container.onclick = (e) => {
    e.stopPropagation();
    if (memoState.currentMemo && window.openSharePopupFromStatusbar) {
      window.openSharePopupFromStatusbar(memoState.currentMemo, container);
    }
  };
}

// 전역 함수로 등록 (memo.js에서 호출용)
window.updateCollabParticipants = updateParticipantsList;

function createParticipantAvatar(participant, isMe, isHost, userId) {
  const avatar = document.createElement('div');
  avatar.className = 'collab-participant' + (isMe ? ' is-me' : '');
  avatar.title = participant.name || '참여자';

  // 기본 Gravatar 아바타
  const defaultAvatar = 'https://www.gravatar.com/avatar/?d=mp&s=32';
  const avatarUrl = participant.avatarUrl || defaultAvatar;

  const img = document.createElement('img');
  img.src = avatarUrl;
  img.alt = '';
  img.onerror = () => {
    img.src = defaultAvatar;
  };
  avatar.appendChild(img);

  // 타이핑 중 표시 (현재 편집 중인 줄이 있으면)
  if (participant.lineIndex >= 0 || participant.isTyping) {
    const typingDot = document.createElement('div');
    typingDot.className = 'typing-indicator';
    avatar.appendChild(typingDot);
  }

  // 호스트가 다른 참여자 클릭 시 내보내기 확인
  if (!isMe && collabState.isHost && userId) {
    avatar.style.cursor = 'pointer';
    avatar.addEventListener('click', (e) => {
      e.stopPropagation();
      showKickConfirm(userId, participant.name);
    });
  }

  return avatar;
}

// 참여자 내보내기 확인
function showKickConfirm(userId, userName) {
  // 기존 다이얼로그 제거
  const existing = document.querySelector('.kick-confirm-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.className = 'kick-confirm-dialog';
  dialog.innerHTML = `
    <div class="kick-confirm-content">
      <p><strong>${userName}</strong>님을 내보내시겠습니까?</p>
      <div class="kick-confirm-actions">
        <button class="kick-cancel">취소</button>
        <button class="kick-confirm">내보내기</button>
      </div>
    </div>
  `;

  // 취소 버튼
  dialog.querySelector('.kick-cancel').addEventListener('click', () => {
    dialog.remove();
  });

  // 내보내기 버튼
  dialog.querySelector('.kick-confirm').addEventListener('click', async () => {
    dialog.remove();
    await kickParticipant(userId, userName);
  });

  // 바깥 클릭 시 닫기
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.remove();
  });

  document.body.appendChild(dialog);
}

// 참여자 내보내기
async function kickParticipant(userId, userName) {
  if (!collabState.sessionId) return;

  try {
    const result = await window.api.collabKick(collabState.sessionId, userId);
    if (result.success) {
      showCollabNotification(`${userName}님을 내보냈습니다`);
    } else {
      showCollabNotification('내보내기 실패');
    }
  } catch (e) {
    console.error('[Collab] Kick error:', e);
    showCollabNotification('내보내기 실패');
  }
}

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

// ===== 이벤트 리스너 =====

function setupCollabEventListeners() {
  // 내가 세션에 참가 완료
  window.api.onCollabJoined((data) => {
    // data = { sessionId, participants, yourColor }
    console.log('[Collab] Joined session, my color:', data.yourColor);
    collabState.myColor = data.yourColor;

    // 기존 참여자들 추가
    if (data.participants) {
      for (const p of data.participants) {
        collabState.participants.set(p.userId, {
          name: p.userName,
          cursorColor: p.cursorColor,
          avatarUrl: p.avatarUrl || null,
          lineIndex: -1,
          isTyping: false
        });
      }
    }
    updateParticipantsList();
  });

  window.api.onCollabUpdate((data) => {
    // data = { type: 'collab-update', userId, update: {...} }
    // applyRemoteUpdate expects update.type to be 'full-sync' or 'line-changes'
    console.log('[Collab] Received collab-update event:', data);
    if (data.update) {
      data.update.userId = data.userId;  // 보낸 사람 ID 전달
      applyRemoteUpdate(data.update);
    } else {
      console.log('[Collab] Warning: collab-update has no update field');
    }
  });

  window.api.onCollabCursor((data) => {
    // 줄 기반 커서 업데이트
    const participant = collabState.participants.get(data.userId);
    if (participant) {
      participant.lineIndex = data.cursor?.lineIndex ?? -1;
      participant.isTyping = data.cursor?.lineIndex >= 0;
      renderRemoteLineIndicator(data.userId, participant);
      updateParticipantsList();  // 타이핑 상태 갱신
    }
  });

  window.api.onCollabJoin((data) => {
    // 다른 사람이 참가함
    handleParticipantJoin(data.userId, data.userName, data.cursorColor, data.avatarUrl);
  });

  window.api.onCollabLeave((data) => {
    handleParticipantLeave(data.userId, data.userName);
  });

  window.api.onCollabKicked(() => {
    // 강퇴당함 - 협업 세션 종료
    showCollabNotification('방장이 나를 내보냈습니다');
    stopCollaboration();
  });

  elements.editor.addEventListener('input', handleEditorInput);
  document.addEventListener('selectionchange', handleSelectionChange);
}

function removeCollabEventListeners() {
  window.api.offCollabJoined();
  window.api.offCollabUpdate();
  window.api.offCollabCursor();
  window.api.offCollabJoin();
  window.api.offCollabLeave();
  window.api.offCollabKicked();

  elements.editor.removeEventListener('input', handleEditorInput);
  document.removeEventListener('selectionchange', handleSelectionChange);
}

function handleEditorInput() {
  if (collabState.isCollaborating && !collabState.isApplyingRemote) {
    // 디바운싱
    if (collabState.updateTimer) {
      clearTimeout(collabState.updateTimer);
    }

    collabState.updateTimer = setTimeout(() => {
      syncLocalChanges();
    }, collabState.UPDATE_DEBOUNCE_MS);
  }
}

let cursorDebounceTimer = null;
function handleSelectionChange() {
  if (!collabState.isCollaborating) return;

  if (cursorDebounceTimer) {
    clearTimeout(cursorDebounceTimer);
  }

  cursorDebounceTimer = setTimeout(() => {
    const lineIndex = getCurrentLineIndex();
    if (lineIndex !== collabState.currentLineIndex) {
      collabState.currentLineIndex = lineIndex;
      window.api.collabSendCursor({ lineIndex });
    }
  }, 150);
}

// ===== 상태 확인 함수 =====

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

// 하위 호환성
export function updateRemoteCursor(userId, userName, cursorColor, cursor) {
  const participant = collabState.participants.get(userId) || { name: userName, cursorColor };
  participant.lineIndex = cursor?.lineIndex ?? -1;
  collabState.participants.set(userId, participant);
  renderRemoteLineIndicator(userId, participant);
}

export function sendLocalCursor() {
  if (!collabState.isCollaborating) return;
  const lineIndex = getCurrentLineIndex();
  window.api.collabSendCursor({ lineIndex });
}

// ===== 초기화 =====
// 앱 시작 시 프로필 표시 (로그인 상태면)
setTimeout(() => {
  updateParticipantsList();
}, 100);

// ===== 초대 알림 및 목록 =====

// 초대 목록 상태
export const inviteState = {
  invites: [],
  isLoading: false
};

/**
 * 받은 초대 목록 조회
 */
export async function loadInvites() {
  inviteState.isLoading = true;
  try {
    const result = await window.api.collabGetInvites();
    if (result.success) {
      inviteState.invites = result.invites || [];
      renderInviteBanner();
    }
  } catch (e) {
    console.error('[Collab] Failed to load invites:', e);
  }
  inviteState.isLoading = false;
}

/**
 * 초대 수락
 */
export async function acceptInvite(inviteId) {
  try {
    const result = await window.api.collabRespondInvite(inviteId, true);
    if (result.success) {
      // 초대 목록에서 제거
      inviteState.invites = inviteState.invites.filter(i => i.id !== inviteId);
      renderInviteBanner();
      showCollabNotification('초대를 수락했습니다');

      // 세션 참가
      if (result.sessionId) {
        // TODO: 해당 세션의 메모를 열고 협업 시작
        console.log('[Collab] Joined session:', result.sessionId);
      }
    } else {
      showCollabNotification(result.error || '수락 실패');
    }
  } catch (e) {
    console.error('[Collab] Accept invite error:', e);
    showCollabNotification('수락 실패');
  }
}

/**
 * 초대 거절
 */
export async function declineInvite(inviteId) {
  try {
    const result = await window.api.collabRespondInvite(inviteId, false);
    if (result.success) {
      inviteState.invites = inviteState.invites.filter(i => i.id !== inviteId);
      renderInviteBanner();
      showCollabNotification('초대를 거절했습니다');
    } else {
      showCollabNotification(result.error || '거절 실패');
    }
  } catch (e) {
    console.error('[Collab] Decline invite error:', e);
    showCollabNotification('거절 실패');
  }
}

/**
 * 초대 배너 렌더링
 */
function renderInviteBanner() {
  // 기존 배너 제거
  const existing = document.getElementById('collab-invite-banner');
  if (existing) existing.remove();

  const pendingInvites = inviteState.invites.filter(i => i.status === 'pending');
  if (pendingInvites.length === 0) return;

  const banner = document.createElement('div');
  banner.id = 'collab-invite-banner';
  banner.className = 'collab-invite-banner';

  pendingInvites.forEach(invite => {
    const item = document.createElement('div');
    item.className = 'invite-item';
    // API 응답: invite.inviter = { email, name }, invite.title
    const inviterName = invite.inviter?.name || invite.inviter?.email || invite.inviterName || invite.inviterEmail || '알 수 없음';
    const sessionTitle = invite.title || invite.sessionTitle || '';
    item.innerHTML = `
      <div class="invite-info">
        <strong>${inviterName}</strong>님이 협업에 초대했습니다
        ${sessionTitle ? `<span class="invite-title">${sessionTitle}</span>` : ''}
      </div>
      <div class="invite-actions">
        <button class="invite-decline" data-id="${invite.id}">거절</button>
        <button class="invite-accept" data-id="${invite.id}">수락</button>
      </div>
    `;
    banner.appendChild(item);
  });

  // 이벤트 바인딩
  banner.querySelectorAll('.invite-accept').forEach(btn => {
    btn.addEventListener('click', () => acceptInvite(btn.dataset.id));
  });
  banner.querySelectorAll('.invite-decline').forEach(btn => {
    btn.addEventListener('click', () => declineInvite(btn.dataset.id));
  });

  // 사이드바 상단에 삽입
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.insertBefore(banner, sidebar.firstChild);
  }
}

/**
 * 실시간 초대 알림 처리
 */
function handleInviteNotification(data) {
  console.log('[Collab] Invite notification:', data);

  // 초대 목록에 추가
  inviteState.invites.push({
    id: data.inviteId || Date.now().toString(),
    sessionId: data.sessionId,
    inviterEmail: data.inviterEmail,
    inviterName: data.inviterName,
    sessionTitle: data.sessionTitle || '',
    status: 'pending'
  });

  renderInviteBanner();
}

// 초대 알림 리스너 등록
window.api.onCollabInvite(handleInviteNotification);

// 앱 시작 시 초대 목록 로드 (로그인된 경우)
setTimeout(async () => {
  const user = await window.api.authGetUser?.();
  if (user) {
    loadInvites();
  }
}, 500);

// 전역 모듈로 노출 (sidebar.js에서 참여자 탭 사용)
window.collabModule = {
  collabState,
  kickParticipant,
  updateParticipantsList,
  loadInvites,
  acceptInvite,
  declineInvite,
  inviteState
};
