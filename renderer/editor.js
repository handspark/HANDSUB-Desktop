/**
 * editor.js - 에디터 기본 기능
 * HTML 정리, 보안 처리, 콘텐츠 관리
 */

import { elements } from './state.js';
import { processLinksInEditor } from './linkPreview.js';

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

  // 패턴 목록
  const patterns = [
    { regex: /\[\s?\]/, replacement: '☐ ', lineStart: false },
    { regex: /\[[xX]\]/, replacement: '☑ ', lineStart: false },
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
