/**
 * collaboration.js - 협업 기능
 *
 * === 새 방식: 가벼운 협업 (알림 + Diff) ===
 * - 편집 종료 시 서버에 저장 (5초 idle / blur / 백그라운드)
 * - 다른 사용자가 수정하면 알림 + 변경된 줄 하이라이트
 * - 다음 편집 시 자동으로 최신 버전 적용
 * - 충돌 없음, 가벼움
 *
 * === 레거시: 줄 단위 실시간 동기화 ===
 * - 각 줄을 독립적인 블록으로 취급
 * - 100ms 디바운싱으로 변경사항 전송
 * - (점진적으로 새 방식으로 이전 예정)
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

  // 줄 단위 추적 (레거시 - 나중에 제거)
  lines: [],              // [{id, text, editingBy}]
  lastLines: [],          // 이전 상태 (변경 감지용)
  currentLineIndex: -1,   // 현재 편집 중인 줄

  // 트래픽 최적화 (레거시)
  updateTimer: null,
  UPDATE_DEBOUNCE_MS: 100,  // 100ms 디바운싱

  // 로컬 변경 추적 (레거시)
  isApplyingRemote: false,

  // ===== 가벼운 협업 (새 방식) =====
  localVersion: 1,           // 로컬 버전
  serverVersion: 1,          // 서버 버전
  changedLines: [],          // 하이라이트할 줄 번호
  hasPendingUpdate: false,   // 원격 업데이트 대기 중
  pendingContent: null,      // 대기 중인 원격 내용
  idleTimer: null,           // 5초 idle 타이머
  IDLE_SAVE_MS: 5000,        // 5초 후 저장
  isDirty: false,            // 로컬 변경 있음
  lastSavedContent: ''       // 마지막 저장된 내용
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
    collabState.sessionId = sessionId;
    collabState.isCollaborating = true;

    // 초기 줄 상태 설정
    collabState.lines = parseEditorToLines();
    collabState.lastLines = JSON.parse(JSON.stringify(collabState.lines));

    // 이벤트 리스너 먼저 설정 (중요: collabStart 전에 설정해야 collab-joined 메시지 수신 가능)
    setupCollabEventListeners();

    // WebSocket 세션 참가
    const result = await window.api.collabStart(sessionId, memoUuid);
    if (!result.success) {
      // 실패 시 정리
      removeCollabEventListeners();
      collabState.sessionId = null;
      collabState.isCollaborating = false;
      return { success: false, error: result.error };
    }

    // 호스트면 초기 상태 전송 (레거시)
    if (isOwner && !existing) {
      sendFullSync();
    }

    // 가벼운 협업 초기화
    initLiteCollab(sessionId, content);

    // 호스트가 새 세션 시작 → 서버에 초기 내용 저장
    if (isOwner && !existing && content) {
      console.log('[Collab] Host saving initial content to server...', { contentLength: content.length });
      await saveInitialContent(sessionId, content);
    }

    // 참여자(호스트 아님)면 서버에서 최신 내용 가져오기
    console.log('[Collab] Checking if should fetch server content - isOwner:', isOwner, 'existing:', existing);
    if (!isOwner || existing) {
      console.log('[Collab] Fetching server content for participant...');
      await fetchAndApplyServerContent(sessionId);
    } else {
      console.log('[Collab] Skipping server content fetch (is new owner)');
    }

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
    // 가벼운 협업 정리 (먼저 실행 - 저장되지 않은 변경사항 저장)
    cleanupLiteCollab();

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
    console.log('[Collab] Accepting invite:', inviteId);
    const result = await window.api.collabRespondInvite(inviteId, true);
    console.log('[Collab] Accept result:', JSON.stringify(result));
    if (result.success) {
      // 초대 목록에서 제거
      inviteState.invites = inviteState.invites.filter(i => i.id !== inviteId);
      renderInviteBanner();
      showCollabNotification('초대를 수락했습니다');

      // 세션 참가 - 해당 메모 열기
      if (result.sessionId && result.memoUuid) {
        console.log('[Collab] Joined session:', result.sessionId, 'memo:', result.memoUuid);

        // 해당 메모를 열고 협업 시작
        try {
          let found = false;

          // 전역 함수 사용 (memo.js에서 노출)
          if (window.goToMemoByUuid) {
            found = await window.goToMemoByUuid(result.memoUuid);
          }

          // 메모가 없으면 새로 생성
          if (!found) {
            console.log('[Collab] Memo not found locally, creating new memo for collaboration');
            console.log('[Collab] Server returned title:', result.title);
            // 새 메모 생성 (협업용)
            const newMemo = await window.api.create();
            if (newMemo) {
              // UUID 업데이트
              await window.api.updateUuid(newMemo.id, result.memoUuid);
              // 제목 설정 (서버에서 내용을 가져올 때까지 임시)
              const tempContent = result.title || '로딩 중...';
              console.log('[Collab] Setting temp content:', tempContent);
              await window.api.update(newMemo.id, tempContent);
              // 새 메모 열기
              if (window.goToMemoByUuid) {
                found = await window.goToMemoByUuid(result.memoUuid);
              }
            }
          }

          if (found) {
            // 메모 로드 후 협업 시작
            setTimeout(async () => {
              const editor = document.getElementById('editor');
              const content = editor?.innerText || '';
              const collabResult = await startCollaboration(result.memoUuid, content);
              if (collabResult.success) {
                showCollabNotification('협업에 참가했습니다');
              } else {
                showCollabNotification(collabResult.error || '협업 참가 실패');
              }
            }, 500);
          } else {
            showCollabNotification('메모 생성 실패');
          }
        } catch (e) {
          console.error('[Collab] Failed to open collab memo:', e);
        }
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
 * 알림 드롭다운 렌더링 (협업 초대 + 할일 리마인더)
 */
function renderInviteBanner() {
  renderNotificationDropdown();
}

// 시간 포맷 헬퍼
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  return `${days}일 전`;
}

// HTML 이스케이프
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function renderNotificationDropdown() {
  const dropdown = document.getElementById('notification-dropdown');
  const list = document.getElementById('notification-dropdown-list');
  const empty = document.getElementById('notification-dropdown-empty');
  const badge = document.getElementById('notification-badge');

  if (!dropdown || !list || !badge) return;

  // 1. 협업 초대 목록
  const pendingInvites = inviteState.invites;

  // 2. 할일 리마인더 (시간 없는 할일)
  let todoReminders = [];
  try {
    todoReminders = await window.api.getTodoReminders() || [];
  } catch (e) {
    console.error('[Notification] Get todo reminders error:', e);
  }

  // 3. 공유 메모 알림 (notification_history)
  let shareNotifications = [];
  try {
    const allNotifications = await window.api.getUnreadNotifications() || [];
    shareNotifications = allNotifications.filter(n => n.type === 'share');
  } catch (e) {
    console.error('[Notification] Get share notifications error:', e);
  }

  const totalCount = pendingInvites.length + todoReminders.length + shareNotifications.length;

  // 배지 업데이트 (점 스타일 - 있으면 표시, 없으면 숨김)
  if (totalCount > 0) {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  // 목록 렌더링
  list.innerHTML = '';

  if (totalCount === 0) {
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');

  // 협업 초대 렌더링
  pendingInvites.forEach(invite => {
    const item = document.createElement('div');
    item.className = 'notification-item';
    const inviterName = invite.inviter?.name || invite.inviter?.email || invite.inviterName || invite.inviterEmail || '알 수 없음';
    const sessionTitle = invite.title || invite.sessionTitle || '';
    const truncatedTitle = sessionTitle.length > 25 ? sessionTitle.substring(0, 25) + '...' : sessionTitle;

    item.innerHTML = `
      <div style="display: flex; gap: 10px; align-items: flex-start;">
        <div class="notification-icon invite">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
        </div>
        <div class="notification-content">
          <div class="notification-text">
            <strong>${inviterName}</strong>님이 협업에 초대했습니다
          </div>
          ${truncatedTitle ? `<div class="notification-meta">${truncatedTitle}</div>` : ''}
        </div>
      </div>
      <div class="notification-actions">
        <button class="btn-secondary invite-decline" data-id="${invite.id}">거절</button>
        <button class="btn-primary invite-accept" data-id="${invite.id}">수락</button>
      </div>
    `;
    list.appendChild(item);
  });

  // 할일 리마인더 렌더링
  todoReminders.forEach(todo => {
    const item = document.createElement('div');
    item.className = 'notification-item todo-reminder';
    item.dataset.memoId = todo.memo_id;
    item.dataset.checkboxIndex = todo.checkbox_index;
    item.dataset.todoId = todo.id;

    const timeAgo = formatTimeAgo(todo.created_at);
    const truncatedText = todo.text.length > 30 ? todo.text.substring(0, 30) + '...' : todo.text;

    item.innerHTML = `
      <div style="display: flex; gap: 10px; align-items: flex-start; width: 100%;">
        <span class="todo-dot"></span>
        <div class="notification-content" style="flex: 1; cursor: pointer;">
          <div class="notification-text">${escapeHtml(truncatedText)}</div>
          <div class="notification-meta">${timeAgo}에 작성</div>
        </div>
        <button class="todo-dismiss" data-id="${todo.id}" title="무시">✕</button>
      </div>
    `;
    list.appendChild(item);
  });

  // 공유 메모 알림 렌더링
  shareNotifications.forEach(notification => {
    const item = document.createElement('div');
    item.className = 'notification-item share-notification';
    item.dataset.notificationId = notification.id;
    item.dataset.memoId = notification.memo_id || '';

    const timeAgo = formatTimeAgo(notification.created_at);
    const senderEmail = notification.from_email || '알 수 없음';
    const truncatedText = notification.text.length > 35 ? notification.text.substring(0, 35) + '...' : notification.text;

    item.innerHTML = `
      <div style="display: flex; gap: 10px; align-items: flex-start; width: 100%;">
        <div class="notification-icon share">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
        </div>
        <div class="notification-content" style="flex: 1; cursor: pointer;">
          <div class="notification-text">${escapeHtml(truncatedText)}</div>
          <div class="notification-meta">${senderEmail} · ${timeAgo}</div>
        </div>
        <button class="share-dismiss" data-id="${notification.id}" title="읽음">✕</button>
      </div>
    `;
    list.appendChild(item);
  });

  // 이벤트 바인딩 - 협업 초대
  list.querySelectorAll('.invite-accept').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      acceptInvite(btn.dataset.id);
    });
  });
  list.querySelectorAll('.invite-decline').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      declineInvite(btn.dataset.id);
    });
  });

  // 이벤트 바인딩 - 할일 리마인더
  list.querySelectorAll('.todo-reminder .notification-content').forEach(content => {
    content.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = content.closest('.todo-reminder');
      const memoId = parseInt(item.dataset.memoId);
      const checkboxIndex = parseInt(item.dataset.checkboxIndex);

      // goToTodo 함수 호출 (memo.js에서 전역으로 노출)
      if (window.goToTodo) {
        await window.goToTodo(memoId, checkboxIndex);
      }
      dropdown.classList.add('hidden');
    });
  });

  list.querySelectorAll('.todo-dismiss').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const todoId = parseInt(btn.dataset.id);
      await window.api.dismissTodoReminder(todoId);
      renderNotificationDropdown();
    });
  });

  // 이벤트 바인딩 - 공유 메모 알림
  list.querySelectorAll('.share-notification .notification-content').forEach(content => {
    content.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = content.closest('.share-notification');
      const notificationId = parseInt(item.dataset.notificationId);
      const memoId = item.dataset.memoId ? parseInt(item.dataset.memoId) : null;

      // 읽음 처리
      await window.api.markNotificationRead(notificationId);

      // 해당 메모로 이동 (memoId가 있으면)
      if (memoId && window.goToMemo) {
        await window.goToMemo(memoId);
      }

      dropdown.classList.add('hidden');
      renderNotificationDropdown();
    });
  });

  list.querySelectorAll('.share-dismiss').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const notificationId = parseInt(btn.dataset.id);
      await window.api.markNotificationRead(notificationId);
      renderNotificationDropdown();
    });
  });
}

/**
 * 알림 아이콘 드롭다운 토글
 */
function initInviteBellEvents() {
  const bellBtn = document.getElementById('notificationBellBtn');
  const dropdown = document.getElementById('notification-dropdown');

  if (!bellBtn || !dropdown) return;

  bellBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isHidden = dropdown.classList.contains('hidden');

    if (isHidden) {
      // 공유 팝업 닫기 (팝업 중복 방지)
      const sharePopup = document.getElementById('share-popup');
      if (sharePopup) sharePopup.classList.add('hidden');

      // 열 때마다 새로 렌더링
      await renderNotificationDropdown();
      dropdown.classList.remove('hidden');
    } else {
      dropdown.classList.add('hidden');
    }
  });

  // 바깥 클릭 시 닫기
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== bellBtn) {
      dropdown.classList.add('hidden');
    }
  });
}

// DOM 로드 후 이벤트 초기화
setTimeout(() => {
  initInviteBellEvents();
  initAddFriendButton();
}, 100);

/**
 * 친구 추가 버튼 이벤트
 */
function initAddFriendButton() {
  const addFriendBtn = document.getElementById('addFriendBtn');
  if (!addFriendBtn) return;

  addFriendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (memoState.currentMemo && window.openSharePopupFromStatusbar) {
      window.openSharePopupFromStatusbar(memoState.currentMemo, addFriendBtn);
    }
  });
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

// 앱 포커스 시 알림 배지 업데이트 (할일 리마인더)
let appFocusTimeout = null;
const APP_FOCUS_DELAY = 3000; // 3초 대기

// 타이핑 중인지 확인
function isUserTyping() {
  const editor = document.getElementById('editor');
  if (!editor) return false;
  return document.activeElement === editor;
}

// 앱 포커스 이벤트 처리
window.api.onAppFocused?.(() => {
  clearTimeout(appFocusTimeout);

  appFocusTimeout = setTimeout(async () => {
    // 타이핑 중이면 무시
    if (isUserTyping()) return;

    // 배지 업데이트만 (드롭다운은 열었을 때 렌더링)
    try {
      const hasReminders = await window.api.hasTodoReminders();
      const hasInvites = inviteState.invites.length > 0;

      // 공유 알림 확인
      let hasShareNotifications = false;
      try {
        const notifications = await window.api.getUnreadNotifications() || [];
        hasShareNotifications = notifications.some(n => n.type === 'share');
      } catch (e) {
        // 무시
      }

      const badge = document.getElementById('notification-badge');

      if (badge) {
        if (hasReminders || hasInvites || hasShareNotifications) {
          badge.classList.remove('hidden');
        }
        // 숨기는 건 드롭다운 렌더링 시 처리
      }
    } catch (e) {
      console.error('[Notification] Check reminders error:', e);
    }
  }, APP_FOCUS_DELAY);
});

// ===== 가벼운 협업 (알림 + Diff 방식) =====

/**
 * 호스트가 협업 시작 시 초기 내용을 서버에 저장
 */
async function saveInitialContent(sessionId, content) {
  try {
    const result = await window.api.collabSaveMemo(sessionId, content, 0);
    if (result.success) {
      collabState.localVersion = result.version;
      collabState.serverVersion = result.version;
      collabState.lastSavedContent = content;
      console.log('[Collab-Lite] Initial content saved, version:', result.version);
    }
  } catch (e) {
    console.error('[Collab-Lite] Save initial content error:', e);
  }
}

/**
 * 서버에서 최신 내용 가져와서 에디터에 적용 (참여자용)
 */
async function fetchAndApplyServerContent(sessionId) {
  try {
    console.log('[Collab-Lite] Fetching content for session:', sessionId);
    const result = await window.api.collabGetContent(sessionId);
    console.log('[Collab-Lite] Server response:', { hasContent: result.content !== undefined, version: result.version, contentLength: result.content?.length });

    if (result.content !== undefined && result.content.length > 0) {
      const editor = elements.editor;
      if (editor) {
        editor.innerText = result.content;

        // 상태 업데이트
        collabState.localVersion = result.version || 1;
        collabState.serverVersion = result.version || 1;
        collabState.lastSavedContent = result.content;

        // 줄 상태도 업데이트 (레거시 호환)
        collabState.lines = parseEditorToLines();
        collabState.lastLines = JSON.parse(JSON.stringify(collabState.lines));

        // 로컬 메모에도 저장 (중요!)
        if (memoState.currentMemo?.id) {
          await window.api.update(memoState.currentMemo.id, result.content);
          memoState.currentMemo.content = result.content;
          memoState.lastSavedContent = result.content;
          console.log('[Collab-Lite] Saved server content to local memo:', memoState.currentMemo.id);
        }

        console.log('[Collab-Lite] Applied server content, version:', result.version, 'length:', result.content.length);
      }
    } else {
      console.log('[Collab-Lite] No server content yet or empty');
    }
  } catch (e) {
    console.error('[Collab-Lite] Fetch server content error:', e);
  }
}

/**
 * 편집 종료 시 서버에 저장
 * - 5초 idle
 * - 앱 백그라운드
 * - 에디터 포커스 잃음
 */
async function saveToServerIfDirty() {
  if (!collabState.isCollaborating || !collabState.isDirty) return;

  const editor = elements.editor;
  const content = editor?.innerText || '';

  // 마지막 저장 내용과 같으면 스킵
  if (content === collabState.lastSavedContent) {
    collabState.isDirty = false;
    return;
  }

  console.log('[Collab-Lite] Saving to server, version:', collabState.localVersion);

  try {
    const result = await window.api.collabSaveMemo(
      collabState.sessionId,
      content,
      collabState.localVersion
    );

    if (result.conflict) {
      // 버전 충돌 - 서버 내용이 더 최신
      console.log('[Collab-Lite] Version conflict, server version:', result.serverVersion);
      handleRemoteUpdate({
        version: result.serverVersion,
        content: result.serverContent,
        changedLines: result.changedLines
      });
    } else if (result.success) {
      collabState.localVersion = result.version;
      collabState.serverVersion = result.version;
      collabState.lastSavedContent = content;
      collabState.isDirty = false;
      console.log('[Collab-Lite] Saved, new version:', result.version);
    }
  } catch (e) {
    console.error('[Collab-Lite] Save error:', e);
  }
}

/**
 * 원격 업데이트 처리 (memo-changed 이벤트)
 */
function handleRemoteUpdate(data) {
  console.log('[Collab-Lite] Remote update received, version:', data.version);

  // 내가 수정한 버전보다 낮으면 무시
  if (data.version <= collabState.localVersion) {
    console.log('[Collab-Lite] Ignoring older version');
    return;
  }

  collabState.serverVersion = data.version;
  collabState.changedLines = data.changedLines || [];
  collabState.hasPendingUpdate = true;

  // 내용이 포함된 경우 (충돌 시)
  if (data.content !== undefined) {
    collabState.pendingContent = data.content;
  }

  // 배너 표시
  showUpdateBanner(data.changedLines?.length || 0, data.editorName);

  // 변경된 줄 하이라이트
  highlightChangedLines(data.changedLines || []);
}

/**
 * 업데이트 배너 표시
 */
function showUpdateBanner(changedCount, editorName) {
  // 기존 배너 제거
  const existing = document.getElementById('collab-update-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'collab-update-banner';
  banner.className = 'collab-update-banner';
  banner.innerHTML = `
    <span class="banner-icon">📝</span>
    <span class="banner-text">
      새 버전이 있습니다 ${changedCount > 0 ? `(${changedCount}줄 변경)` : ''}
      ${editorName ? `- ${editorName}` : ''}
    </span>
  `;

  // 에디터 위에 배너 삽입
  const editorContainer = document.querySelector('.editor-container') || elements.editor?.parentElement;
  if (editorContainer) {
    editorContainer.insertBefore(banner, editorContainer.firstChild);
  } else {
    document.body.appendChild(banner);
  }
}

/**
 * 업데이트 배너 제거
 */
function hideUpdateBanner() {
  const banner = document.getElementById('collab-update-banner');
  if (banner) banner.remove();
}

/**
 * 변경된 줄 하이라이트
 */
function highlightChangedLines(lineNumbers) {
  // 기존 하이라이트 제거
  clearLineHighlights();

  if (lineNumbers.length === 0) return;

  const editor = elements.editor;
  if (!editor) return;

  // 에디터 내용을 줄로 분리
  const content = editor.innerText || '';
  const lines = content.split('\n');

  // 하이라이트 오버레이 생성
  const overlay = document.createElement('div');
  overlay.id = 'collab-line-highlights';
  overlay.className = 'collab-line-highlights';

  // 각 변경된 줄에 대해 하이라이트 요소 생성
  lineNumbers.forEach(lineNum => {
    const lineIndex = lineNum - 1; // 0-based
    if (lineIndex < 0 || lineIndex >= lines.length) return;

    // 해당 줄의 위치 계산
    const lineRect = getLineRect(editor, lineIndex);
    if (!lineRect) return;

    const highlight = document.createElement('div');
    highlight.className = 'collab-line-highlight';
    highlight.style.top = lineRect.top + 'px';
    highlight.style.height = lineRect.height + 'px';
    highlight.dataset.line = lineNum;

    overlay.appendChild(highlight);
  });

  // 에디터 컨테이너에 오버레이 추가
  const container = editor.parentElement;
  if (container) {
    container.style.position = 'relative';
    container.appendChild(overlay);
  }
}

/**
 * 줄의 위치 계산
 */
function getLineRect(editor, lineIndex) {
  const content = editor.innerText || '';
  const lines = content.split('\n');

  if (lineIndex >= lines.length) return null;

  // 해당 줄까지의 오프셋 계산
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) {
    offset += lines[i].length + 1; // +1 for \n
  }

  // 줄의 시작 위치에서 rect 가져오기
  const range = document.createRange();
  let currentOffset = 0;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const nodeLength = node.textContent.length;

    if (currentOffset + nodeLength >= offset) {
      const nodeOffset = Math.min(offset - currentOffset, nodeLength);
      range.setStart(node, nodeOffset);
      range.setEnd(node, Math.min(nodeOffset + lines[lineIndex].length, nodeLength));
      const rect = range.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();

      return {
        top: rect.top - editorRect.top,
        height: rect.height || 20 // 기본 높이
      };
    }

    currentOffset += nodeLength;
  }

  return null;
}

/**
 * 하이라이트 제거
 */
function clearLineHighlights() {
  const overlay = document.getElementById('collab-line-highlights');
  if (overlay) overlay.remove();
}

/**
 * 원격 변경 적용 (편집 시작 시)
 */
async function applyPendingUpdate() {
  if (!collabState.hasPendingUpdate) return;

  console.log('[Collab-Lite] Applying pending update');

  // 서버에서 최신 내용 가져오기
  const result = await window.api.collabGetContent(collabState.sessionId);

  if (result.hasUpdate && result.content !== undefined) {
    const editor = elements.editor;
    if (editor) {
      // 커서 위치 저장
      const cursorInfo = saveCursorPosition();

      // 내용 적용
      editor.innerText = result.content;

      // 커서 복원
      if (cursorInfo) {
        restoreCursorPosition(cursorInfo);
      }

      collabState.localVersion = result.version;
      collabState.serverVersion = result.version;
      collabState.lastSavedContent = result.content;
    }
  }

  // 상태 초기화
  collabState.hasPendingUpdate = false;
  collabState.pendingContent = null;
  collabState.changedLines = [];

  // UI 정리
  hideUpdateBanner();
  clearLineHighlights();
}

/**
 * 편집 시작 감지 - 대기 중인 업데이트 적용
 */
function onEditorFocus() {
  if (collabState.isCollaborating && collabState.hasPendingUpdate) {
    applyPendingUpdate();
  }
}

/**
 * 에디터 입력 - dirty 플래그 설정 + idle 타이머 리셋
 */
function onEditorInputLite() {
  if (!collabState.isCollaborating) return;

  collabState.isDirty = true;

  // 대기 중인 업데이트가 있으면 먼저 적용
  if (collabState.hasPendingUpdate) {
    applyPendingUpdate();
  }

  // idle 타이머 리셋
  if (collabState.idleTimer) {
    clearTimeout(collabState.idleTimer);
  }

  collabState.idleTimer = setTimeout(() => {
    saveToServerIfDirty();
  }, collabState.IDLE_SAVE_MS);
}

/**
 * 가벼운 협업 이벤트 리스너 설정
 */
function setupLiteCollabListeners() {
  const editor = elements.editor;
  if (!editor) return;

  // 에디터 포커스 - 대기 중인 업데이트 적용
  editor.addEventListener('focus', onEditorFocus);

  // 에디터 입력 - dirty 플래그 + idle 타이머
  editor.addEventListener('input', onEditorInputLite);

  // 에디터 blur - 저장
  editor.addEventListener('blur', () => {
    if (collabState.isCollaborating) {
      saveToServerIfDirty();
    }
  });

  // 앱 백그라운드 전환 - 저장
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && collabState.isCollaborating) {
      saveToServerIfDirty();
    }
  });

  // memo-changed 이벤트 수신
  window.api.onMemoChanged((data) => {
    if (data.sessionId === collabState.sessionId) {
      handleRemoteUpdate(data);
    }
  });
}

/**
 * 가벼운 협업 이벤트 리스너 해제
 */
function removeLiteCollabListeners() {
  const editor = elements.editor;
  if (!editor) return;

  editor.removeEventListener('focus', onEditorFocus);
  editor.removeEventListener('input', onEditorInputLite);

  window.api.offMemoChanged();

  // 타이머 정리
  if (collabState.idleTimer) {
    clearTimeout(collabState.idleTimer);
    collabState.idleTimer = null;
  }

  // UI 정리
  hideUpdateBanner();
  clearLineHighlights();
}

/**
 * 가벼운 협업 시작 시 초기화
 */
export function initLiteCollab(sessionId, initialContent) {
  collabState.localVersion = 1;
  collabState.serverVersion = 1;
  collabState.lastSavedContent = initialContent || '';
  collabState.isDirty = false;
  collabState.hasPendingUpdate = false;
  collabState.changedLines = [];

  setupLiteCollabListeners();

  console.log('[Collab-Lite] Initialized for session:', sessionId);
}

/**
 * 가벼운 협업 종료 시 정리
 */
export function cleanupLiteCollab() {
  // 저장되지 않은 변경사항 저장
  if (collabState.isDirty) {
    saveToServerIfDirty();
  }

  removeLiteCollabListeners();

  // 상태 초기화
  collabState.localVersion = 1;
  collabState.serverVersion = 1;
  collabState.lastSavedContent = '';
  collabState.isDirty = false;
  collabState.hasPendingUpdate = false;
  collabState.changedLines = [];

  console.log('[Collab-Lite] Cleaned up');
}

// 전역 모듈로 노출 (sidebar.js에서 참여자 탭 사용)
window.collabModule = {
  collabState,
  kickParticipant,
  updateParticipantsList,
  loadInvites,
  acceptInvite,
  declineInvite,
  inviteState,
  initInviteBellEvents,
  // 협업 세션 시작/종료
  startCollaboration,
  stopCollaboration,
  isCollaborating,
  // 가벼운 협업
  initLiteCollab,
  cleanupLiteCollab,
  saveToServerIfDirty
};
