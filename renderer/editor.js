/**
 * editor.js - 에디터 기본 기능
 * HTML 정리, 보안 처리, 콘텐츠 관리
 */

import { elements } from './state.js';
import { processLinksInEditor } from './linkPreview.js';
import { parseTime, getTimeRemaining } from './timeParser.js';

const { editor } = elements;

// ===== HTML 정리 (보안) =====

// 인라인 이벤트 핸들러 제거 (CSP 에러 방지)
export function stripInlineHandlers(html) {
  if (!html) return '';
  // onerror="...", onerror='...', onerror=value 형태 제거
  html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/\s+on\w+\s*=\s*[^\s>"']+/gi, '');
  // HTML 엔티티 인코딩된 형태도 제거
  html = html.replace(/\s+on&#?[a-z0-9]+;\w*\s*=/gi, ' data-removed=');
  // 이전에 저장된 link-preview, memo-link, link-preview-wrapper 요소들도 제거
  html = html.replace(/<a[^>]*class="[^"]*link-preview[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
  html = html.replace(/<a[^>]*class="[^"]*memo-link[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
  html = html.replace(/<div[^>]*class="[^"]*link-preview-wrapper[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  // 스니펫 힌트 요소 제거 (외부 공유 시 노출 방지)
  html = html.replace(/<span[^>]*class="[^"]*snippet-hint[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '');
  return html;
}

// XSS 방지를 위한 HTML sanitizer
export function sanitizeHtml(html) {
  if (!html) return '';

  // 파싱 전에 인라인 이벤트 핸들러 제거
  html = stripInlineHandlers(html);

  // 임시 div로 파싱
  const temp = document.createElement('div');
  temp.innerHTML = html;

  // 위험한 태그 제거
  const dangerousTags = [
    'script', 'iframe', 'object', 'embed', 'form', 'input', 'button',
    'base', 'link', 'meta', 'template', 'style', 'svg', 'math', 'noscript'
  ];
  dangerousTags.forEach(tag => {
    const elements = temp.getElementsByTagName(tag);
    while (elements.length > 0) {
      elements[0].remove();
    }
  });

  // 위험한 속성 제거
  const allElements = temp.getElementsByTagName('*');
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];
    const attrs = [...el.attributes];
    attrs.forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value.toLowerCase().trim();

      // on* 이벤트 핸들러 제거
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        return;
      }

      // style 속성 내 expression/url 제거
      if (name === 'style' && (value.includes('expression') || value.includes('javascript') || value.includes('url('))) {
        el.removeAttribute(attr.name);
        return;
      }

      // javascript:, data:, vbscript: URL 제거
      const dangerousProtocols = ['javascript:', 'data:', 'vbscript:'];
      if (['href', 'src', 'action', 'formaction', 'xlink:href', 'poster'].includes(name)) {
        if (dangerousProtocols.some(proto => value.startsWith(proto))) {
          el.removeAttribute(attr.name);
        }
      }
    });
  }

  return temp.innerHTML;
}

// ===== 에디터 콘텐츠 관리 =====

export function getEditorContent() {
  return stripInlineHandlers(editor.innerHTML);
}

export function setEditorContent(html) {
  editor.innerHTML = sanitizeHtml(html);
  processLinksInEditor();
}

export function getPlainText() {
  // 스니펫 힌트 요소 제외하고 텍스트 추출 (외부 공유 시 노출 방지)
  const hint = editor.querySelector('.snippet-hint');
  if (hint) {
    // 힌트를 임시로 숨기고 텍스트 추출
    const originalDisplay = hint.style.display;
    hint.style.display = 'none';
    const text = editor.innerText || editor.textContent || '';
    hint.style.display = originalDisplay;
    return text;
  }
  return editor.innerText || editor.textContent || '';
}

// HTML에서 텍스트만 추출
export function getPlainTextFromHtml(html) {
  if (!html) return '';
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n');
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = text;
  return tempDiv.textContent || tempDiv.innerText || '';
}

// ===== 텍스트 삽입 =====

export function insertTextAtCursor(text) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const textNode = document.createTextNode(text);
  range.insertNode(textNode);

  // 커서를 텍스트 끝으로 이동
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  selection.removeAllRanges();
  selection.addRange(range);
}

// ===== 체크박스 & 리스트 자동 변환 =====

export function processCheckboxes() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;

  const text = node.textContent;
  const offset = range.startOffset;

  // 현재 줄의 시작 찾기
  const beforeCursor = text.slice(0, offset);
  const lineStart = beforeCursor.lastIndexOf('\n') + 1;

  // 패턴 목록 (모두 현재 줄에서만 검색)
  const patterns = [
    { regex: /\[\s?\]$/, replacement: '☐ ', lineStart: true },
    { regex: /\[[xX]\]$/, replacement: '☑ ', lineStart: true },
    { regex: /^- $/, replacement: '• ', lineStart: true },
    { regex: /^\* $/, replacement: '• ', lineStart: true },
  ];

  for (const pattern of patterns) {
    const searchText = pattern.lineStart ? text.slice(lineStart, offset) : text;
    const match = searchText.match(pattern.regex);

    if (match) {
      const matchStart = pattern.lineStart ? lineStart + match.index : match.index;
      const matchEnd = matchStart + match[0].length;

      if (offset === matchEnd) {
        const before = text.slice(0, matchStart);
        const after = text.slice(matchEnd);
        node.textContent = before + pattern.replacement + after;

        const newOffset = before.length + pattern.replacement.length;
        range.setStart(node, newOffset);
        range.setEnd(node, newOffset);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
  }
}

// ===== 첫 줄 제목 스타일 체크 =====

export function updateTitleClass() {
  const text = editor.innerText || '';
  const firstLine = text.split('\n')[0].trim();

  // []체크박스, /스니펫, ☐☑ 체크박스로 시작하면 제목 아님
  const isNotTitle = firstLine.startsWith('[') ||
                     firstLine.startsWith('/') ||
                     firstLine.startsWith('☐') ||
                     firstLine.startsWith('☑') ||
                     firstLine === '';

  if (isNotTitle) {
    editor.classList.remove('has-title');
  } else {
    editor.classList.add('has-title');
  }
}

// ===== 체크된 항목 취소선 적용 =====

export function applyStrikethrough() {
  requestAnimationFrame(() => {
    const sel = window.getSelection();
    const savedRange = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;

    // 기존 취소선 span 제거
    editor.querySelectorAll('.completed-task').forEach(span => {
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
    });

    // 텍스트 노드 정규화
    editor.normalize();

    // ☑가 있는 줄에 취소선 적용
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
    const nodesToWrap = [];

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent;
      const lines = text.split('\n');

      let hasChecked = false;
      for (const line of lines) {
        if (line.includes('☑')) {
          hasChecked = true;
          break;
        }
      }

      if (hasChecked) {
        nodesToWrap.push(node);
      }
    }

    nodesToWrap.forEach(node => {
      const text = node.textContent;
      const parts = text.split('\n');
      const fragment = document.createDocumentFragment();

      parts.forEach((line, i) => {
        if (i > 0) {
          fragment.appendChild(document.createTextNode('\n'));
        }

        if (line.includes('☑')) {
          // ☑ 뒤의 텍스트에만 취소선
          const checkIndex = line.indexOf('☑');
          const beforeCheck = line.slice(0, checkIndex + 1);
          const afterCheck = line.slice(checkIndex + 1);

          fragment.appendChild(document.createTextNode(beforeCheck));

          if (afterCheck.trim()) {
            const span = document.createElement('span');
            span.className = 'completed-task';
            span.textContent = afterCheck;
            fragment.appendChild(span);
          } else {
            fragment.appendChild(document.createTextNode(afterCheck));
          }
        } else {
          fragment.appendChild(document.createTextNode(line));
        }
      });

      node.parentNode.replaceChild(fragment, node);
    });

    // 커서 위치 복원
    if (savedRange) {
      try {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } catch (e) {
        // 커서 복원 실패 시 무시
      }
    }
  });
}

// ===== 체크박스 시간 하이라이트 =====

export function highlightTodoTimes() {
  requestAnimationFrame(() => {
    const sel = window.getSelection();
    const savedRange = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;

    // 기존 시간 하이라이트 제거
    editor.querySelectorAll('.todo-time').forEach(span => {
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
    });

    // 기존 시간 배지 제거
    editor.querySelectorAll('.todo-time-badge').forEach(badge => {
      badge.remove();
    });

    // 텍스트 노드 정규화
    editor.normalize();

    // 체크박스가 있는 줄에서 시간 찾기
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
    const nodesToProcess = [];

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent;

      // 체크박스가 있는 줄만 처리
      if (text.includes('☐') || text.includes('☑')) {
        nodesToProcess.push(node);
      }
    }

    nodesToProcess.forEach(node => {
      const text = node.textContent;
      const lines = text.split('\n');
      const fragment = document.createDocumentFragment();

      lines.forEach((line, i) => {
        if (i > 0) {
          fragment.appendChild(document.createTextNode('\n'));
        }

        // 체크박스로 시작하는 줄인지 확인
        const checkboxMatch = line.match(/^(\s*[☐☑]\s*)/);
        // 체크된 항목(☑)은 시간 하이라이트 건너뛰기 (취소선과 충돌 방지)
        const isChecked = line.includes('☑');
        if (checkboxMatch && !isChecked) {
          const afterCheckbox = line.slice(checkboxMatch[0].length);
          const timeInfo = parseTime(afterCheckbox);

          if (timeInfo) {
            // 체크박스 부분
            fragment.appendChild(document.createTextNode(checkboxMatch[0]));

            // 시간 부분 찾기
            const timeStart = afterCheckbox.indexOf(timeInfo.original);
            const beforeTime = afterCheckbox.slice(0, timeStart);
            const afterTime = afterCheckbox.slice(timeStart + timeInfo.original.length);

            // 시간 전 텍스트
            if (beforeTime) {
              fragment.appendChild(document.createTextNode(beforeTime));
            }

            // 시간 span (하이라이트)
            const timeSpan = document.createElement('span');
            timeSpan.className = 'todo-time';
            timeSpan.textContent = timeInfo.original;

            // 남은 시간 정보 추가
            const remaining = getTimeRemaining(timeInfo.hour24, timeInfo.minute);
            timeSpan.setAttribute('data-remaining', remaining.text);
            timeSpan.setAttribute('data-formatted', timeInfo.formatted);

            if (remaining.isNextDay) {
              timeSpan.classList.add('next-day');
            } else if (remaining.minutes <= 30) {
              timeSpan.classList.add('soon');
            }

            fragment.appendChild(timeSpan);

            // 시간 후 텍스트
            if (afterTime) {
              fragment.appendChild(document.createTextNode(afterTime));
            }
          } else {
            fragment.appendChild(document.createTextNode(line));
          }
        } else {
          fragment.appendChild(document.createTextNode(line));
        }
      });

      node.parentNode.replaceChild(fragment, node);
    });

    // 커서 위치 복원
    if (savedRange) {
      try {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } catch (e) {
        // 커서 복원 실패 시 무시
      }
    }
  });
}
