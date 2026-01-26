/**
 * index.js - 메인 진입점
 * 모든 모듈을 초기화하고 연결
 */

import { elements, memoState, sidebarState, timers, snippetState } from './state.js';
import { setEditorContent } from './editor.js';
import { loadMemo, setRenderMemoListFn, updateStatusbar } from './memo.js';
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
import { authManager, isPro } from './auth.js';
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
import { collabState, stopCollaboration } from './collaboration.js';

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

  authManager.cleanup();

  // 협업 세션 종료
  if (collabState.isCollaborating) {
    stopCollaboration();
  }

  snippetState.isProcessingSnippet = false;
  snippetState.snippetFormMode = false;
  snippetState.currentSnippetForForm = null;
  snippetState.matchedSnippet = null;
}

// ===== WebSocket 연결 상태 =====

function initWebSocketStatus() {
  const statusIndicator = document.getElementById('ws-status');

  window.api.onWsConnected(() => {
    collabState.isConnected = true;
    if (statusIndicator) {
      statusIndicator.className = 'ws-status connected';
      statusIndicator.title = '실시간 연결됨';
    }
    console.log('[WS] Connected to server');
  });

  window.api.onWsDisconnected(() => {
    collabState.isConnected = false;
    if (statusIndicator) {
      statusIndicator.className = 'ws-status disconnected';
      statusIndicator.title = '오프라인 - 재연결 시도 중...';
    }
    console.log('[WS] Disconnected from server');
  });
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

  // WebSocket 연결 상태
  initWebSocketStatus();

  // 창 닫힘
  window.addEventListener('beforeunload', cleanupAllResources);

  // visibilitychange
  initVisibilityChange();
}

// ===== 시작 =====

// 빠른 초기화 (병렬 처리)
async function bootstrap() {
  // 1. 스니펫과 인증을 병렬로 로드
  const [, , authResult] = await Promise.all([
    loadSnippets(),
    loadTriggerKey(),
    authManager.init() // 인증을 기다림
  ]);

  // 2. 인증 완료 후 연락처 미리 로드 (백그라운드)
  if (window.userProfile) {
    preloadContacts();
  }

  // 3. 인증 상태 변경 시 UI 업데이트 (auth.js에서 이벤트 발생)
  window.addEventListener('auth-verified', () => {
    preloadContacts();
    // 프로필 로드 후 현재 메모 상태바 업데이트
    if (memoState.currentMemo) {
      updateStatusbar(memoState.currentMemo.updated_at);
    }
  });

  window.addEventListener('auth-logout', () => {
    // 로그아웃 시 상태바 업데이트 (프로필 제거됨)
    if (memoState.currentMemo) {
      updateStatusbar(memoState.currentMemo.updated_at);
    }
  });

  // 4. 이벤트 초기화
  initAllEvents();

  // 5. 앱 초기화 (메모 로드 포함)
  await initApp();

  // 6. 상태바 업데이트 (인증 후 프로필 표시)
  if (memoState.currentMemo) {
    updateStatusbar(memoState.currentMemo.updated_at);
  }

  editor.focus();
}

// 부트스트랩 실행
bootstrap();
