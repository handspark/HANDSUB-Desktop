/**
 * memo.js - 메모 로딩/저장 기능
 */

import { elements, memoState, timers, snippetState } from './state.js';
import { getEditorContent, setEditorContent, getPlainText, getPlainTextFromHtml, stripInlineHandlers, applyStrikethrough, highlightTodoTimes } from './editor.js';
import { clearLinkPreviews, processLinksInEditor } from './linkPreview.js';
import { parseAllTodoTimes } from './timeParser.js';
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

// 리마인더 등록 디바운싱 (2초 대기)
let reminderSyncTimeout = null;
function scheduleReminderSync(content, memoId) {
  clearTimeout(reminderSyncTimeout);
  reminderSyncTimeout = setTimeout(() => {
    syncReminders(content, memoId);
  }, 2000);
}

// 리마인더 동기화 (체크박스 시간 파싱 → 리마인더 등록)
async function syncReminders(content, memoId) {
  if (!memoId) return;

  try {
    const plainText = getPlainTextFromHtml(content);
    const todoTimes = parseAllTodoTimes(plainText);

    // 해당 메모의 모든 미완료 리마인더 삭제 (깔끔하게 초기화)
    await window.api.deleteReminderByMemo(memoId);

    // 미완료 체크박스만 리마인더 등록
    const uncompletedTodos = todoTimes.filter(t => !t.isChecked);

    for (const todo of uncompletedTodos) {
      const todoText = todo.cleanText;
      if (!todoText || todoText.length < 2) continue;

      const dayOffset = todo.dayOffset || 0;
      const now = new Date();
      let targetDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + dayOffset,
        todo.hour24,
        todo.minute
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
