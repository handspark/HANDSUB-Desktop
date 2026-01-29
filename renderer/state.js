/**
 * state.js - 공유 상태 변수 및 DOM 요소
 * 모든 모듈에서 사용하는 상태를 중앙 관리
 */

// ===== DOM 요소 =====
export const elements = {
  editor: document.getElementById('editor'),
  newBtn: document.getElementById('newBtn'),
  closeBtn: document.getElementById('closeBtn'),
  statusbar: document.getElementById('statusbar'),
  toolLog: document.getElementById('tool-log'),
  listBtn: document.getElementById('listBtn'),
  sidebar: document.getElementById('sidebar'),
  memoList: document.getElementById('memo-list'),
  sidebarResize: document.getElementById('sidebar-resize'),
  searchInput: document.getElementById('search-input'),
  linkPreviewsContainer: document.getElementById('link-previews')
};

// ===== 메모 상태 =====
export const memoState = {
  memos: [],
  currentIndex: -1,
  currentMemo: null,
  imagesPath: '',
  lastSavedContent: '',
  filteredIndices: [],
  openMenuId: null,
  pendingNewMemo: false
};

// ===== 사이드바 상태 =====
export const sidebarState = {
  isResizing: false,
  sidebarWidth: 160
};

// ===== 타이머 =====
export const timers = {
  saveTimeout: null,
  linkProcessTimeout: null,
  editorScrollTimeout: null,
  memoListScrollTimeout: null,
  timeHighlightTimeout: null
};

// ===== 미디어 상태 =====
export const mediaState = {
  selectedMedia: null
};

// ===== 링크 프리뷰 =====
export const linkState = {
  cache: new Map()
};

// ===== 스니펫 상태 =====
export const snippetState = {
  snippets: [],
  matchedSnippet: null,
  snippetContent: '',
  snippetTrigger: '/',
  isComposing: false,
  snippetFormMode: false,
  currentSnippetForForm: null,
  isProcessingSnippet: false,
  snippetMatchActive: false,
  // 순차 입력용
  snippetFields: [],
  snippetFieldIndex: 0,
  snippetFieldValues: {},
  savedEditorNodes: null,
  // 메타 변수 ({{top}}, {{all}})
  meta: { top: '', all: '' }
};

// ===== 라이센스 =====
export const licenseState = {
  license: null,
  verificationInterval: null
};

// 이미지 경로 초기화
window.api.getImagePath().then(path => {
  memoState.imagesPath = path;
});
