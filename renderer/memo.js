/**
 * memo.js - 메모 로딩/저장 기능
 */

import { elements, memoState, timers, snippetState } from './state.js';
import { getEditorContent, setEditorContent, getPlainText, getPlainTextFromHtml, stripInlineHandlers, applyStrikethrough, highlightTodoTimes, updateTitleClass } from './editor.js';
import { clearLinkPreviews, processLinksInEditor } from './linkPreview.js';
import { parseAllTodoTimes, parseTime } from './timeParser.js';
import { startCollaboration, stopCollaboration, isCollaborating } from './collaboration.js';

const { editor, sidebar } = elements;

// renderMemoList 콜백 (순환 참조 방지)
let renderMemoListFn = null;
export function setRenderMemoListFn(fn) {
  renderMemoListFn = fn;
}

// ===== 상태바 업데이트 =====

export function updateStatusbar(time) {
  // 상단 타이틀바 날짜 업데이트
  const titlebarDate = document.getElementById('titlebar-date');

  if (!time) {
    if (titlebarDate) titlebarDate.textContent = '';
    return;
  }

  const date = new Date(time);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // 상단 바에 "2026년 1월 26일" 형식으로 표시
  const dateText = `${year}년 ${month}월 ${day}일`;
  if (titlebarDate) {
    titlebarDate.textContent = dateText;
  }

  // 프로필은 collab-participants에서 통합 관리 (collaboration.js)
  // 협업 중이 아니어도 내 프로필 표시하도록 updateParticipantsList 호출
  if (window.updateCollabParticipants) {
    window.updateCollabParticipants();
  }
}

export function formatDate(time) {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours < 12 ? 'am' : 'pm';
  const hour12 = String(hours % 12 || 12).padStart(2, '0');
  return `${month}.${day} ${ampm}${hour12}:${minutes}`;
}

// ===== 메모 로딩 =====

export async function loadMemo(index) {
  memoState.memos = await window.api.getAll();

  // 기존 링크 프리뷰 제거
  clearLinkPreviews();

  // 이전 협업 세션 종료
  if (isCollaborating()) {
    await stopCollaboration();
  }

  if (memoState.memos.length === 0 || index < 0) {
    memoState.currentIndex = -1;
    memoState.currentMemo = null;
    setEditorContent('');
    updateStatusbar(null);
    memoState.lastSavedContent = '';
  } else {
    memoState.currentIndex = Math.min(index, memoState.memos.length - 1);
    memoState.currentMemo = memoState.memos[memoState.currentIndex];

    // 오래된 메모의 인라인 핸들러 정리
    const originalContent = memoState.currentMemo.content || '';
    const cleanedContent = stripInlineHandlers(originalContent);

    // 정리가 필요했으면 자동으로 다시 저장
    if (originalContent !== cleanedContent && memoState.currentMemo.id) {
      await window.api.update(memoState.currentMemo.id, cleanedContent);
      memoState.currentMemo.content = cleanedContent;
    }

    setEditorContent(cleanedContent);
    updateStatusbar(memoState.currentMemo.updated_at);
    memoState.lastSavedContent = cleanedContent;

    // 링크 프리뷰 처리
    processLinksInEditor();

    // 체크된 항목 취소선 적용
    applyStrikethrough();

    // 할일 시간 하이라이트
    highlightTodoTimes();

    // 첫 줄 제목 스타일 체크
    updateTitleClass();

    // 공유 메모면 자동으로 협업 시작
    await tryAutoCollaboration(memoState.currentMemo);
  }
}

// 공유 메모 자동 협업 연결
async function tryAutoCollaboration(memo) {
  let sessionMemoId = null;

  // 1. 받은 공유 메모: shared_memo_id 사용
  if (memo.received_from && memo.shared_memo_id) {
    sessionMemoId = memo.shared_memo_id;
    console.log('[Collab] Received shared memo, session:', sessionMemoId);
  }
  // 2. 내가 공유한 메모: 내 uuid 사용
  else if (memo.is_shared && memo.uuid) {
    sessionMemoId = memo.uuid;
    console.log('[Collab] My shared memo, session:', sessionMemoId);
  }

  // 공유 메모면 자동 협업 시작
  if (sessionMemoId) {
    const result = await startCollaboration(sessionMemoId, memo.content);
    if (result.success) {
      console.log('[Collab] Auto-joined session:', result.sessionId);
    } else {
      console.log('[Collab] Auto-join failed:', result.error);
    }
  }
}

// ===== 저장 로직 =====

export async function saveCurrentContent() {
  // 폼 모드에서는 저장하지 않음
  if (snippetState.snippetFormMode) {
    return;
  }

  const content = getEditorContent();
  const plainText = getPlainText().trim();

  // 텍스트가 없어도 이미지/비디오가 있으면 저장
  const hasMedia = editor.querySelector('.memo-image, .memo-video, .link-preview');

  // 빈 메모면 저장하지 않고, 기존 메모가 있다면 삭제
  if (plainText === '' && !hasMedia) {
    if (memoState.currentMemo) {
      await window.api.delete(memoState.currentMemo.id);
      memoState.currentMemo = null;
      memoState.currentIndex = -1;
      memoState.lastSavedContent = '';
      memoState.memos = await window.api.getAll();
      if (sidebar.classList.contains('open') && renderMemoListFn) {
        renderMemoListFn();
      }
    }
    return;
  }

  if (memoState.currentMemo) {
    await window.api.update(memoState.currentMemo.id, content);
    memoState.lastSavedContent = content;
  } else {
    memoState.currentMemo = await window.api.create();
    await window.api.update(memoState.currentMemo.id, content);
    memoState.memos = await window.api.getAll();
    memoState.currentIndex = 0;
    memoState.lastSavedContent = content;
  }
  updateStatusbar(new Date().toISOString());

  // 리마인더 자동 등록 (디바운싱 - 타이핑 완료 후 등록)
  scheduleReminderSync(content, memoState.currentMemo?.id);
}

// 리마인더 등록 디바운싱 (0.5초 대기)
let reminderSyncTimeout = null;
function scheduleReminderSync(content, memoId) {
  clearTimeout(reminderSyncTimeout);
  reminderSyncTimeout = setTimeout(() => {
    syncReminders(content, memoId);
  }, 500);
}

// 리마인더 동기화 (체크박스 시간 파싱 → 리마인더 등록)
async function syncReminders(content, memoId) {
  if (!memoId) return;

  try {
    const plainText = getPlainTextFromHtml(content);
    const lines = plainText.split('\n');

    // 모든 체크박스 파싱
    const allTodos = [];
    let checkboxIndex = 0;

    lines.forEach(line => {
      const checkboxMatch = line.match(/^(\s*)(☐|☑)\s*(.+)/);
      if (checkboxMatch) {
        const isChecked = checkboxMatch[2] === '☑';
        const todoText = checkboxMatch[3].trim();
        const timeInfo = parseTime(todoText);

        allTodos.push({
          checkboxIndex,
          text: timeInfo?.cleanText || todoText,
          hasTime: timeInfo ? 1 : 0,
          isCompleted: isChecked ? 1 : 0,
          timeInfo
        });

        checkboxIndex++;
      }
    });

    // 할일 추적 동기화 (시간 없는 할일 리마인더용)
    await window.api.syncTodoTracking(memoId, allTodos);

    // 해당 메모의 모든 미완료 리마인더 삭제 (깔끔하게 초기화)
    await window.api.deleteReminderByMemo(memoId);

    // 시간이 있는 미완료 체크박스만 시간 기반 리마인더 등록
    const timedTodos = allTodos.filter(t => t.hasTime && !t.isCompleted && t.timeInfo);

    for (const todo of timedTodos) {
      const todoText = todo.text;
      if (!todoText || todoText.length < 2) continue;

      const timeInfo = todo.timeInfo;
      const dayOffset = timeInfo.dayOffset || 0;
      const now = new Date();
      let targetDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + dayOffset,
        timeInfo.hour24,
        timeInfo.minute
      );
      let remindAt = targetDate.getTime();

      // dayOffset이 0이고 이미 지난 시간이면 내일로 설정
      if (dayOffset === 0 && remindAt <= Date.now()) {
        targetDate.setDate(targetDate.getDate() + 1);
        remindAt = targetDate.getTime();
      }

      await window.api.addReminder({
        memoId,
        text: todoText,
        remindAt
      });

      console.log('[Reminder] Registered:', todoText, 'at', new Date(remindAt).toLocaleString());
    }
  } catch (e) {
    console.error('[Reminder] Sync error:', e);
  }
}

// 할일로 이동 (알림 클릭 시)
export async function goToTodo(memoId, checkboxIndex) {
  try {
    // 1. 메모 목록에서 해당 메모 인덱스 찾기
    const memos = await window.api.getAll();
    const memoIndex = memos.findIndex(m => m.id === memoId);

    if (memoIndex === -1) {
      console.warn('[Todo] Memo not found:', memoId);
      return;
    }

    // 2. 메모 로드
    await loadMemo(memoIndex);

    // 3. 약간의 딜레이 후 체크박스 찾기 & 스크롤
    setTimeout(() => {
      const checkboxes = editor.querySelectorAll('.checkbox');

      if (checkboxes[checkboxIndex]) {
        const target = checkboxes[checkboxIndex];

        // 스크롤
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 하이라이트 효과 (부모 div에 적용)
        const parent = target.closest('div') || target.parentElement;
        if (parent) {
          parent.classList.add('highlight-todo');
          setTimeout(() => {
            parent.classList.remove('highlight-todo');
          }, 2000);
        }
      }
    }, 150);
  } catch (e) {
    console.error('[Todo] Go to todo error:', e);
  }
}

// 전역으로 노출 (collaboration.js에서 사용)
window.goToTodo = goToTodo;

// 메모로 이동 (공유 알림 클릭 시)
export async function goToMemo(memoId) {
  try {
    // 메모 목록에서 해당 메모 인덱스 찾기
    const memos = await window.api.getAll();
    const memoIndex = memos.findIndex(m => m.id === memoId);

    if (memoIndex === -1) {
      console.warn('[Memo] Memo not found:', memoId);
      return;
    }

    // 메모 로드
    await loadMemo(memoIndex);
  } catch (e) {
    console.error('[Memo] Go to memo error:', e);
  }
}

// UUID로 메모 이동 (협업용)
export async function goToMemoByUuid(memoUuid) {
  try {
    const memos = await window.api.getAll();
    const memoIndex = memos.findIndex(m => m.uuid === memoUuid);

    if (memoIndex === -1) {
      console.warn('[Memo] Memo not found by UUID:', memoUuid);
      // 메모가 없으면 새로 생성할 수도 있음
      return false;
    }

    await loadMemo(memoIndex);
    return true;
  } catch (e) {
    console.error('[Memo] Go to memo by UUID error:', e);
    return false;
  }
}

// 전역으로 노출
window.goToMemo = goToMemo;
window.goToMemoByUuid = goToMemoByUuid;

export async function cleanupOnClose() {
  try {
    clearTimeout(timers.saveTimeout);

    const plainText = getPlainText().trim();
    const hasMedia = editor.querySelector('.memo-image, .memo-video, .link-preview');

    if (plainText === '' && !hasMedia && memoState.currentMemo) {
      await window.api.delete(memoState.currentMemo.id);
    } else if (plainText !== '' || hasMedia) {
      await saveCurrentContent();
    }
  } catch (e) {
    console.error('Cleanup error:', e);
  }
}

// ===== 저장 트리거 =====

export function triggerSave() {
  clearTimeout(timers.saveTimeout);
  timers.saveTimeout = setTimeout(() => {
    saveCurrentContent();
  }, 300);
}

// ===== 동기화 상태 UI (로컬-퍼스트) =====

let syncIndicator = null;
let syncHideTimer = null;

// 동기화 인디케이터 생성
function createSyncIndicator() {
  if (syncIndicator) return syncIndicator;

  syncIndicator = document.createElement('div');
  syncIndicator.className = 'sync-indicator';
  syncIndicator.innerHTML = `
    <span class="sync-dot"></span>
    <span class="sync-text"></span>
  `;
  document.body.appendChild(syncIndicator);
  return syncIndicator;
}

// 동기화 상태 표시
function showSyncStatus(status, count = 0) {
  const indicator = createSyncIndicator();
  const textEl = indicator.querySelector('.sync-text');

  // 기존 타이머 취소
  if (syncHideTimer) {
    clearTimeout(syncHideTimer);
    syncHideTimer = null;
  }

  // 상태별 클래스 및 텍스트 설정
  indicator.className = 'sync-indicator';

  switch (status) {
    case 'syncing':
      indicator.classList.add('syncing', 'visible');
      textEl.textContent = '동기화 중...';
      break;

    case 'synced':
      // 저장됨 상태는 메모 화면에서 표시하지 않음 (방해됨)
      // 설정 화면의 계정 섹션에서만 표시
      indicator.classList.remove('visible');
      break;

    case 'offline':
      indicator.classList.add('offline', 'visible');
      textEl.textContent = '오프라인';
      break;

    case 'error':
      indicator.classList.add('error', 'visible');
      textEl.textContent = '동기화 오류';
      // 3초 후 숨기기
      syncHideTimer = setTimeout(() => {
        indicator.classList.remove('visible');
      }, 3000);
      break;

    case 'conflict':
      indicator.classList.add('conflict', 'visible');
      textEl.textContent = count > 0 ? `${count}개 충돌` : '동기화 충돌';
      break;

    case 'idle':
    default:
      // 숨기기
      indicator.classList.remove('visible');
      break;
  }
}

// 동기화 상태는 설정 화면에서만 표시 (메모 화면에서는 방해됨)
// 메모 화면의 플로팅 인디케이터 비활성화
// if (window.api?.onSyncStatus) {
//   window.api.onSyncStatus((status, count) => {
//     showSyncStatus(status, count);
//   });
// }

// 전역 노출 (테스트/디버그용)
window.showSyncStatus = showSyncStatus;
