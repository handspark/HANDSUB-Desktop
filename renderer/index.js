/**
 * index.js - 메인 진입점
 * 모든 모듈을 초기화하고 연결
 */

import { elements, memoState, sidebarState, timers, snippetState } from './state.js';
import { setEditorContent } from './editor.js';
import { loadMemo, setRenderMemoListFn } from './memo.js';
import {
  renderMemoList,
  toggleSidebar,
  updateEditorPosition,
  initSidebarResize,
  initSearchEvents,
  initMenuCloseHandler,
  initSharePopupEvents,
  preloadContacts
} from './sidebar.js';
import { initMediaEvents } from './media.js';
import {
  loadSnippets,
  loadTriggerKey,
  initIMEEvents,
  initInputDetection,
  initTriggerKeyChange
} from './snippet.js';
import { licenseManager } from './license.js';
import {
  initEditorInputEvents,
  initCheckboxToggle,
  initListAutoComplete,
  initPasteEvent,
  initDragDrop,
  initButtonEvents,
  initAppEvents,
  initMemoNavigation,
  initScrollVisibility,
  initSnippetKeyEvents,
  initQuickShareEvents,
  setupCircularDependencies
} from './events.js';
import { clearLinkPreviews } from './linkPreview.js';

const { editor, sidebar, listBtn } = elements;

// ===== 앱 초기화 =====

async function initApp() {
  // 순환 참조 해결
  setupCircularDependencies();
  setRenderMemoListFn(renderMemoList);

  // 새 메모 모드 확인
  const urlParams = new URLSearchParams(window.location.search);
  const isNewMemoMode = urlParams.get('mode') === 'new';

  // 초기 로드 시 트랜지션 비활성화
  sidebar.style.transition = 'none';
  editor.style.transition = 'none';

  memoState.memos = await window.api.getAll();

  if (isNewMemoMode) {
    memoState.currentMemo = null;
    memoState.currentIndex = -1;
    setEditorContent('');
  } else if (memoState.memos.length > 0) {
    await loadMemo(0);
  }

  // 사이드바 열기
  sidebar.classList.add('open');
  listBtn.classList.add('active');
  sidebar.style.width = sidebarState.sidebarWidth + 'px';
  updateEditorPosition();
  renderMemoList();

  // 트랜지션 복원
  requestAnimationFrame(() => {
    sidebar.style.transition = '';
    editor.style.transition = '';
  });

  editor.focus();
}

// ===== 리소스 정리 =====

function cleanupAllResources() {
  clearTimeout(timers.saveTimeout);
  clearTimeout(timers.linkProcessTimeout);
  clearTimeout(timers.editorScrollTimeout);
  clearTimeout(timers.memoListScrollTimeout);
  clearTimeout(timers.timeHighlightTimeout);

  licenseManager.cleanup();

  snippetState.isProcessingSnippet = false;
  snippetState.snippetFormMode = false;
  snippetState.currentSnippetForForm = null;
  snippetState.matchedSnippet = null;
}

// ===== visibilitychange 처리 =====

function initVisibilityChange() {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      if (memoState.pendingNewMemo) return;

      // 스니펫 목록 갱신
      await loadSnippets();
      await loadTriggerKey();

      // 최신 메모로 새로고침
      memoState.memos = await window.api.getAll();
      if (memoState.memos.length > 0) {
        await loadMemo(0);
      }
      renderMemoList();
    }
  });
}

// ===== 모든 이벤트 초기화 =====

function initAllEvents() {
  // 사이드바
  initSidebarResize();
  initSearchEvents();
  initMenuCloseHandler();
  initSharePopupEvents();

  // 에디터
  initEditorInputEvents();
  initCheckboxToggle();
  initListAutoComplete();
  initPasteEvent();
  initDragDrop();
  initMediaEvents();

  // 버튼 & 앱
  initButtonEvents();
  initAppEvents();
  initMemoNavigation();
  initScrollVisibility();

  // 스니펫
  initIMEEvents();
  initInputDetection();
  initTriggerKeyChange();
  initSnippetKeyEvents();

  // 빠른 전달
  initQuickShareEvents();

  // 창 닫힘
  window.addEventListener('beforeunload', cleanupAllResources);

  // visibilitychange
  initVisibilityChange();
}

// ===== 시작 =====

// 스니펫 로드
loadSnippets();
loadTriggerKey();

// 초기 메모 로드
loadMemo(-1);
editor.focus();

// 라이센스 초기화
licenseManager.init();

// 라이센스 검증 완료 시 연락처 미리 로드
window.addEventListener('license-verified', () => {
  preloadContacts();
});

// 이벤트 초기화
initAllEvents();

// 앱 초기화
initApp();
