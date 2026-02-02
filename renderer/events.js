/**
 * events.js - 이벤트 핸들러 모음
 */

import { elements, memoState, timers, snippetState } from './state.js';
import { getPlainText, insertTextAtCursor, processCheckboxes, setEditorContent, applyStrikethrough, highlightTodoTimes } from './editor.js';
import { processLinksInEditor, clearLinkPreviews } from './linkPreview.js';
import { loadMemo, saveCurrentContent, cleanupOnClose, triggerSave, updateStatusbar } from './memo.js';
import { toggleSidebar, renderMemoList, setLoadMemoFn, updateEditorPosition } from './sidebar.js';
import { handleImagePaste, handleVideoPaste, initMediaEvents } from './media.js';
import { handleEnterKey, handleEscKey, checkSnippetTrigger } from './snippet.js';

const { editor, newBtn, closeBtn, listBtn, sidebar, searchInput, memoList } = elements;

// ===== 커서 위치로 스크롤 =====

function scrollToCursor() {
  requestAnimationFrame(() => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();

    // 커서가 에디터 하단을 벗어났을 때
    if (rect.bottom > editorRect.bottom - 20) {
      editor.scrollTop += rect.bottom - editorRect.bottom + 40;
    }
    // 커서가 에디터 상단을 벗어났을 때
    else if (rect.top < editorRect.top + 20) {
      editor.scrollTop -= editorRect.top - rect.top + 40;
    }
  });
}

// ===== 에디터 입력 이벤트 =====

export function initEditorInputEvents() {
  editor.addEventListener('input', () => {
    triggerSave();
    processLinksInEditor();
    processCheckboxes();
    // 시간 하이라이트는 blur 시에만 적용 (커서 방해 방지)
  });

  // 에디터 포커스 아웃 시 시간 하이라이트 적용
  editor.addEventListener('blur', () => {
    highlightTodoTimes();
  });

  // 붙여넣기 즉시 저장
  editor.addEventListener('paste', () => {
    clearTimeout(timers.saveTimeout);
    setTimeout(() => {
      saveCurrentContent();
    }, 0);
  });
}

// ===== 체크박스 클릭 토글 =====

function isCheckboxAtPoint(x, y) {
  const range = document.caretRangeFromPoint(x, y);
  if (!range) return false;

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;

  const text = node.textContent;
  const offset = range.startOffset;

  return text[offset] === '☐' || text[offset] === '☑' ||
         text[offset - 1] === '☐' || text[offset - 1] === '☑';
}

export function initCheckboxToggle() {
  // 마우스 오버 시 커서 변경
  editor.addEventListener('mousemove', (e) => {
    if (isCheckboxAtPoint(e.clientX, e.clientY)) {
      editor.style.cursor = 'pointer';
    } else {
      editor.style.cursor = '';
    }
  });

  editor.addEventListener('mouseleave', () => {
    editor.style.cursor = '';
  });

  // 클릭 토글
  editor.addEventListener('click', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;

    const text = node.textContent;
    const offset = range.startOffset;

    const charOffset = text[offset] === '☐' || text[offset] === '☑' ? offset : offset - 1;

    if (text[charOffset] === '☐') {
      node.textContent = text.slice(0, charOffset) + '☑' + text.slice(charOffset + 1);
      triggerSave();
      applyStrikethrough();
    } else if (text[charOffset] === '☑') {
      node.textContent = text.slice(0, charOffset) + '☐' + text.slice(charOffset + 1);
      triggerSave();
      applyStrikethrough();
    }
  });
}

// ===== 리스트 자동 완성 (Enter) =====

export function initListAutoComplete() {
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.isComposing || snippetState.isComposing) return;
    if (snippetState.snippetFormMode || editor.querySelector('.snippet-match')) return;

    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;

    const text = node.textContent;
    const offset = range.startOffset;

    const beforeCursor = text.slice(0, offset);
    const afterCursor = text.slice(offset);
    const lineStart = beforeCursor.lastIndexOf('\n') + 1;
    const lineEnd = afterCursor.indexOf('\n');
    const currentLine = beforeCursor.slice(lineStart);
    const restOfLine = lineEnd === -1 ? afterCursor : afterCursor.slice(0, lineEnd);

    const bulletMatch = currentLine.match(/^(\s*)•\s*/);
    const numberMatch = currentLine.match(/^(\s*)(\d+)\.\s*/);
    const checkboxMatch = currentLine.match(/^(\s*)[☐☑]\s*/);

    let prefix = '';

    if (bulletMatch) {
      if (currentLine.trim() === '•' && restOfLine.trim() === '') {
        e.preventDefault();
        const newText = text.slice(0, lineStart) + text.slice(offset);
        node.textContent = newText;
        const newPos = Math.max(0, lineStart);
        range.setStart(node, newPos);
        range.setEnd(node, newPos);
        sel.removeAllRanges();
        sel.addRange(range);
        triggerSave();
        scrollToCursor();
        return;
      }
      prefix = bulletMatch[1] + '• ';
    } else if (numberMatch) {
      if (currentLine.trim() === numberMatch[2] + '.' && restOfLine.trim() === '') {
        e.preventDefault();
        const newText = text.slice(0, lineStart) + text.slice(offset);
        node.textContent = newText;
        const newPos = Math.max(0, lineStart);
        range.setStart(node, newPos);
        range.setEnd(node, newPos);
        sel.removeAllRanges();
        sel.addRange(range);
        triggerSave();
        scrollToCursor();
        return;
      }
      const nextNum = parseInt(numberMatch[2]) + 1;
      prefix = numberMatch[1] + nextNum + '. ';
    } else if (checkboxMatch) {
      if ((currentLine.trim() === '☐' || currentLine.trim() === '☑') && restOfLine.trim() === '') {
        e.preventDefault();
        const newText = text.slice(0, lineStart) + text.slice(offset);
        node.textContent = newText;
        const newPos = Math.max(0, lineStart);
        range.setStart(node, newPos);
        range.setEnd(node, newPos);
        sel.removeAllRanges();
        sel.addRange(range);
        triggerSave();
        scrollToCursor();
        return;
      }
      prefix = checkboxMatch[1] + '☐ ';
    }

    if (prefix) {
      e.preventDefault();
      const newText = beforeCursor + '\n' + prefix + afterCursor;
      node.textContent = newText;

      const newOffset = offset + 1 + prefix.length;
      range.setStart(node, newOffset);
      range.setEnd(node, newOffset);
      sel.removeAllRanges();
      sel.addRange(range);
      triggerSave();
      scrollToCursor();
    }
  });
}

// ===== Paste 이벤트 (이미지/비디오/텍스트) =====

export function initPasteEvent() {
  editor.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await handleImagePaste(file);
        }
        return;
      }
      if (item.type.startsWith('video/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await handleVideoPaste(file);
        }
        return;
      }
    }

    const text = e.clipboardData.getData('text/plain');
    if (text) {
      e.preventDefault();
      insertTextAtCursor(text);
    }
  });
}

// ===== Drag & Drop =====

export function initDragDrop() {
  editor.addEventListener('dragover', (e) => {
    e.preventDefault();
    editor.classList.add('dragover');
  });

  editor.addEventListener('dragleave', () => {
    editor.classList.remove('dragover');
  });

  editor.addEventListener('drop', async (e) => {
    e.preventDefault();
    editor.classList.remove('dragover');

    const files = e.dataTransfer?.files;

    if (files && files.length > 0) {
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          await handleImagePaste(file);
          return;
        }
        if (file.type.startsWith('video/')) {
          await handleVideoPaste(file);
          return;
        }
      }
    }

    const text = e.dataTransfer?.getData('text/plain');
    if (text) {
      insertTextAtCursor(text);
    }
  });
}

// ===== 버튼 클릭 =====

export function initButtonEvents() {
  listBtn.addEventListener('click', () => {
    toggleSidebar();
  });

  newBtn.addEventListener('click', () => {
    window.api.newMemo();
  });

  closeBtn.addEventListener('click', async () => {
    await cleanupOnClose();
    window.api.forceClose();
  });
}

// ===== 앱 이벤트 =====

export function initAppEvents() {
  // ESC close
  window.api.onRequestClose(async () => {
    await cleanupOnClose();
    window.api.forceClose();
  });

  // 앱 종료 전 저장
  window.api.onSaveBeforeQuit(async () => {
    clearTimeout(timers.saveTimeout);
    await saveCurrentContent();
  });

  // 메모 동기화
  window.api.onMemosUpdated(async () => {
    // 현재 선택된 메모 ID 기억
    const currentMemoId = memoState.currentMemo?.id;

    memoState.memos = await window.api.getAll();

    // 기존 메모 ID로 새 인덱스 찾기
    if (currentMemoId) {
      const newIndex = memoState.memos.findIndex(m => m.id === currentMemoId);
      if (newIndex !== -1) {
        memoState.currentIndex = newIndex;
      }
    }

    if (sidebar.classList.contains('open')) {
      renderMemoList();
    }
  });

  // 새 메모 생성
  window.api.onCreateNewMemo(async () => {
    memoState.pendingNewMemo = true;

    await saveCurrentContent();

    memoState.currentMemo = null;
    memoState.currentIndex = -1;
    setEditorContent('');
    memoState.lastSavedContent = '';
    clearLinkPreviews();
    updateStatusbar(null);

    memoState.memos = await window.api.getAll();
    if (sidebar.classList.contains('open')) {
      renderMemoList();
    }

    updateEditorPosition();
    editor.focus();

    setTimeout(() => {
      memoState.pendingNewMemo = false;
    }, 200);
  });

  // 검색창 포커스
  window.api.onFocusSearch(() => {
    searchInput.focus();
    searchInput.select();
  });
}

// ===== 메모 탐색 =====

export function initMemoNavigation() {
  document.addEventListener('keydown', async (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

    const isSidebarOpen = sidebar.classList.contains('open');
    const isCmdPressed = e.metaKey || e.ctrlKey;

    const shouldNavigate = isSidebarOpen
      ? (document.activeElement !== editor)
      : isCmdPressed;

    if (!shouldNavigate) return;

    e.preventDefault();

    const indices = isSidebarOpen ? memoState.filteredIndices : memoState.memos.map((_, i) => i);
    if (indices.length === 0) return;

    const currentPosInFiltered = indices.indexOf(memoState.currentIndex);

    if (e.key === 'ArrowUp') {
      if (currentPosInFiltered > 0) {
        await loadMemo(indices[currentPosInFiltered - 1]);
        if (isSidebarOpen) renderMemoList();
      }
    } else {
      if (currentPosInFiltered < indices.length - 1) {
        await loadMemo(indices[currentPosInFiltered + 1]);
        if (isSidebarOpen) renderMemoList();
      } else if (currentPosInFiltered === -1 && indices.length > 0) {
        await loadMemo(indices[0]);
        if (isSidebarOpen) renderMemoList();
      }
    }
  });
}

// ===== 스크롤바 표시 =====

export function initScrollVisibility() {
  const titlebarCenter = document.querySelector('.titlebar-center');

  editor.addEventListener('scroll', () => {
    editor.classList.add('scrolling');
    clearTimeout(timers.editorScrollTimeout);
    timers.editorScrollTimeout = setTimeout(() => {
      editor.classList.remove('scrolling');
    }, 1000);

    // 스크롤하면 날짜 숨김, 맨 위면 표시
    if (titlebarCenter) {
      if (editor.scrollTop > 10) {
        titlebarCenter.classList.add('hidden');
      } else {
        titlebarCenter.classList.remove('hidden');
      }
    }
  });

  memoList.addEventListener('scroll', () => {
    memoList.classList.add('scrolling');
    clearTimeout(timers.memoListScrollTimeout);
    timers.memoListScrollTimeout = setTimeout(() => {
      memoList.classList.remove('scrolling');
    }, 1000);
  });
}

// ===== 스니펫 키 이벤트 (Enter, ESC) =====

export function initSnippetKeyEvents() {
  // Enter 키 (캡처 단계)
  document.addEventListener('keydown', (e) => {
    handleEnterKey(e);
  }, true);

  // ESC 키 (캡처 단계)
  document.addEventListener('keydown', (e) => {
    const handled = handleEscKey(e);
    if (!handled && e.key === 'Escape') {
      // 스니펫 관련 없으면 창 닫기
      e.preventDefault();
      window.api.closeWindow();
    }
  }, true);
}

// ===== 빠른 전달 이벤트 =====

export function initQuickShareEvents() {
  window.api.onQuickShareTrigger(() => {
    // 현재 메모가 있을 때만 동작
    if (memoState.currentMemo && memoState.currentMemo.content?.trim()) {
      // 공유 팝업 열기
      if (window.openSharePopupFromStatusbar) {
        window.openSharePopupFromStatusbar(memoState.currentMemo, null);
      }
    }
  });
}

// ===== 순환 참조 해결을 위한 설정 =====

export function setupCircularDependencies() {
  setLoadMemoFn(loadMemo);
}
