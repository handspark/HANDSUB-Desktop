/**
 * snippet.js - 단축어(스니펫) 기능
 * 가장 복잡한 모듈 - 단축어 감지, 폼 입력, 실행
 */

import { elements, snippetState } from './state.js';
import { getPlainText, insertTextAtCursor } from './editor.js';
import { triggerSave } from './memo.js';
import { escapeHtml, isValidIconPath, isSafeKey, safeJsonParse } from './security.js';

const { editor, toolLog } = elements;

// ===== 도구 로그 표시 =====

let logTimeout = null;

function showToolLog(result, snippet) {
  // tool-log 표시 비활성화
  return;

  // 기존 타이머 취소
  if (logTimeout) {
    clearTimeout(logTimeout);
  }

  // 클래스 초기화
  toolLog.classList.remove('show', 'success', 'error');
  toolLog.textContent = ''; // 기존 내용 제거

  const isSuccess = result && result.success;

  // 아이콘 추출: snippet.icon이 있으면 사용, 없으면 기본 아이콘
  const iconValue = snippet?.icon || '🔧';

  // 아이콘 컨테이너 생성
  const iconSpan = document.createElement('span');
  iconSpan.className = 'log-icon';

  // 아이콘이 파일 경로인지 이모지인지 구분 (XSS 방지)
  const isFilePath = iconValue.includes('/') || iconValue.includes('\\') || iconValue.endsWith('.png') || iconValue.endsWith('.svg');

  if (isFilePath && isValidIconPath(iconValue)) {
    const img = document.createElement('img');
    img.src = 'file://' + iconValue;
    img.alt = 'icon';
    img.className = 'log-icon-img';
    img.onerror = () => { img.style.display = 'none'; };
    iconSpan.appendChild(img);
  } else {
    // 이모지 또는 유효하지 않은 경로 - 텍스트로 표시
    const emojiSpan = document.createElement('span');
    emojiSpan.className = 'log-icon-emoji';
    emojiSpan.textContent = isFilePath ? '🔧' : iconValue; // 유효하지 않은 경로는 기본 아이콘
    iconSpan.appendChild(emojiSpan);
  }

  // 메시지 생성 (XSS 방지 - textContent 사용)
  const messageSpan = document.createElement('span');
  messageSpan.className = 'log-message';

  if (isSuccess) {
    messageSpan.textContent = '전송이 완료되었습니다';
  } else {
    // 에러 메시지 이스케이프
    const errorMsg = result?.error || result?.status || '알 수 없는 오류';
    messageSpan.textContent = '실패: ' + escapeHtml(String(errorMsg));
  }

  // DOM에 추가
  toolLog.appendChild(iconSpan);
  toolLog.appendChild(messageSpan);

  // 상태 클래스 추가
  toolLog.classList.add(isSuccess ? 'success' : 'error');

  // 표시
  requestAnimationFrame(() => {
    toolLog.classList.add('show');
  });

  // 3초 후 숨기기
  logTimeout = setTimeout(() => {
    toolLog.classList.remove('show');
  }, 3000);
}

// ===== 필드 추출 =====

function extractFields(body) {
  if (!body) return [];
  const regex = /\{\{([^}]+)\}\}/g;
  const fields = [];
  let match;
  while ((match = regex.exec(body)) !== null) {
    if (!fields.includes(match[1])) {
      fields.push(match[1]);
    }
  }
  return fields;
}

// ===== 스니펫 로드 =====

export async function loadSnippets() {
  // 스니펫 동기화 (백그라운드)
  window.api.syncSnippets().catch(() => {});

  // DB 스니펫 (main.js에서 도구의 icon 포함하여 반환)
  const dbSnippets = await window.api.getSnippets();
  const manifestCommands = await window.api.getManifestCommands();

  const manifestSnippets = manifestCommands.map(cmd => ({
    id: `manifest:${cmd.toolId}:${cmd.shortcut}`,
    type: 'manifest',
    shortcut: cmd.shortcut,
    name: `${cmd.toolIcon} ${cmd.shortcut}`,
    icon: cmd.toolIcon || '🔧',
    config: JSON.stringify({
      toolId: cmd.toolId,
      fields: cmd.fields,
      body: cmd.body
    }),
    isManifest: true
  }));

  snippetState.snippets = [...dbSnippets, ...manifestSnippets];
}

export async function loadTriggerKey() {
  snippetState.snippetTrigger = await window.api.getTriggerKey() || '/';
}

// ===== 매치 관리 =====

export function clearMatch() {
  const match = editor.querySelector('span.snippet-match');
  if (match) {
    const text = document.createTextNode(match.textContent);
    match.parentNode.replaceChild(text, match);
    editor.normalize();
  }
  // 힌트 제거
  const hint = editor.querySelector('.snippet-hint');
  if (hint) {
    hint.remove();
  }
  snippetState.matchedSnippet = null;
}

function deleteMatch() {
  return new Promise((resolve) => {
    // 힌트 제거
    const hint = editor.querySelector('.snippet-hint');
    if (hint) {
      hint.remove();
    }

    const match = editor.querySelector('span.snippet-match');
    if (!match) {
      snippetState.matchedSnippet = null;
      snippetState.snippetContent = '';
      resolve();
      return;
    }

    const prevSibling = match.previousSibling;
    const prevText = prevSibling?.nodeType === Node.TEXT_NODE ? prevSibling.textContent : '';

    editor.blur();

    setTimeout(() => {
      const currentMatch = editor.querySelector('span.snippet-match');
      if (!currentMatch) {
        snippetState.matchedSnippet = null;
        snippetState.snippetContent = '';
        resolve();
        return;
      }

      const parent = currentMatch.parentNode;

      while (currentMatch.nextSibling) {
        currentMatch.nextSibling.remove();
      }

      currentMatch.remove();

      if (prevSibling?.nodeType === Node.TEXT_NODE && prevSibling.textContent !== prevText) {
        prevSibling.textContent = prevText;
      }

      const sel = window.getSelection();
      const range = document.createRange();

      if (prevSibling && prevSibling.nodeType === Node.TEXT_NODE) {
        range.setStart(prevSibling, prevSibling.textContent.length);
        range.setEnd(prevSibling, prevSibling.textContent.length);
      } else if (parent && parent.firstChild) {
        range.setStart(parent, 0);
        range.setEnd(parent, 0);
      } else {
        range.selectNodeContents(editor);
        range.collapse(true);
      }

      sel.removeAllRanges();
      sel.addRange(range);
      editor.normalize();

      snippetState.matchedSnippet = null;
      snippetState.snippetContent = '';
      resolve();
    }, 100);
  });
}

// ===== 트리거 체크 =====

export function checkSnippetTrigger() {
  const { snippetTrigger, snippets, snippetFormMode, isComposing } = snippetState;

  const triggerIsAscii = snippetTrigger && snippetTrigger.charCodeAt(0) < 128;
  const shouldSkipForComposing = isComposing && !triggerIsAscii;

  if (snippetFormMode || shouldSkipForComposing || snippets.length === 0) {
    return;
  }

  const existingMatch = editor.querySelector('span.snippet-match');
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;

  // 이미 매치가 있으면 content 추적
  if (existingMatch) {
    const nextSibling = existingMatch.nextSibling;
    if (nextSibling && nextSibling.nodeType === Node.TEXT_NODE) {
      const text = nextSibling.textContent;
      if (text.startsWith(' ')) {
        snippetState.snippetContent = text.substring(1);
      } else {
        snippetState.snippetContent = '';
      }
    } else {
      snippetState.snippetContent = '';
    }

    // 매치 밖으로 나갔는지 체크
    if (node.nodeType === Node.TEXT_NODE) {
      const nodeParent = node.parentNode;
      if (nodeParent !== existingMatch &&
          nodeParent !== existingMatch.parentNode &&
          !existingMatch.parentNode.contains(node)) {
        clearMatch();
      }
    }
    return;
  }

  if (node.nodeType !== Node.TEXT_NODE) return;

  const text = node.textContent;
  const cursorPos = range.startOffset;

  // 트리거 위치 찾기
  let triggerIdx = -1;
  for (let i = cursorPos - 1; i >= 0; i--) {
    const char = text[i];
    if (char === snippetTrigger) {
      if (i === 0 || /\s/.test(text[i - 1])) {
        triggerIdx = i;
      }
      break;
    }
    if (/\s/.test(char)) break;
  }

  if (triggerIdx === -1) return;

  const keyword = text.substring(triggerIdx + 1, cursorPos);
  if (!keyword) return;

  const match = snippets.find(s =>
    s.shortcut.toLowerCase() === keyword.toLowerCase()
  );
  if (!match) return;

  snippetState.matchedSnippet = match;
  snippetState.snippetContent = '';

  // 배경 반전 적용
  const before = text.substring(0, triggerIdx);
  const matchText = text.substring(triggerIdx, cursorPos);
  const after = text.substring(cursorPos);

  const span = document.createElement('span');
  span.className = 'snippet-match';
  span.textContent = matchText;

  const frag = document.createDocumentFragment();
  if (before) frag.appendChild(document.createTextNode(before));
  frag.appendChild(span);
  if (after) frag.appendChild(document.createTextNode(after));

  node.parentNode.replaceChild(frag, node);

  requestAnimationFrame(() => {
    const newMatch = editor.querySelector('span.snippet-match');
    if (newMatch) {
      const r = document.createRange();
      r.selectNodeContents(newMatch);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);

      // 힌트 생성
      createSnippetHint(newMatch);
    }
  });
}

// ===== 힌트 생성 =====

function createSnippetHint(matchEl) {
  // 기존 힌트 제거
  const existingHint = editor.querySelector('.snippet-hint');
  if (existingHint) {
    existingHint.remove();
  }

  const hint = document.createElement('span');
  hint.className = 'snippet-hint';
  hint.innerHTML = '<span class="snippet-hint-key"><kbd>ESC</kbd> 취소</span><span class="snippet-hint-key"><kbd>Enter</kbd> 실행</span>';

  // match 요소의 위치 계산
  const matchRect = matchEl.getBoundingClientRect();
  const editorRect = editor.getBoundingClientRect();

  hint.style.left = (matchRect.left - editorRect.left + editor.scrollLeft) + 'px';
  hint.style.top = (matchRect.bottom - editorRect.top + editor.scrollTop + 2) + 'px';

  editor.appendChild(hint);
}

// ===== 폼 관리 =====

function deleteSnippetForm() {
  snippetState.snippetFormMode = false;
  snippetState.currentSnippetForForm = null;
  snippetState.matchedSnippet = null;
  snippetState.snippetFields = [];
  snippetState.snippetFieldIndex = 0;
  snippetState.snippetFieldValues = {};

  // 힌트 제거
  const hint = editor.querySelector('.snippet-hint');
  if (hint) {
    hint.remove();
  }

  const formContainer = editor.querySelector('.snippet-form');
  if (formContainer) {
    while (formContainer.nextSibling) {
      formContainer.nextSibling.remove();
    }
    formContainer.remove();
  }
  editor.normalize();
  editor.contentEditable = 'true';
}

function getFormValues() {
  return { ...snippetState.snippetFieldValues };
}

function showNextFieldInline(container) {
  const field = snippetState.snippetFields[snippetState.snippetFieldIndex];
  if (!field || !container) return;

  if (snippetState.snippetFieldIndex === 0) {
    container.textContent = '';
  }

  editor.contentEditable = 'false';

  const label = document.createElement('span');
  label.className = 'snippet-label';
  label.textContent = field + ': ';
  container.appendChild(label);

  const input = document.createElement('span');
  input.className = 'snippet-input';
  input.contentEditable = 'true';
  input.dataset.field = field;
  input.dataset.index = snippetState.snippetFieldIndex;
  container.appendChild(input);

  // IME 조합 상태 추적
  input.addEventListener('compositionstart', () => {
    snippetState.isComposing = true;
  });
  input.addEventListener('compositionend', () => {
    snippetState.isComposing = false;
  });

  // ESC 키 처리
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const currentValue = input.textContent || '';

      snippetState.isComposing = false;
      input.blur();
      input.contentEditable = 'false';

      setTimeout(() => {
        const formContainer = editor.querySelector('.snippet-form');
        if (formContainer && formContainer.parentNode) {
          const labelEl = formContainer.querySelector('.snippet-label');
          const labelText = labelEl ? labelEl.textContent : '';
          const finalText = labelText + currentValue;
          const textNode = document.createTextNode(finalText);
          const parent = formContainer.parentNode;
          parent.replaceChild(textNode, formContainer);
          editor.normalize();

          try {
            if (textNode.parentNode) {
              const sel = window.getSelection();
              const range = document.createRange();
              range.setStartAfter(textNode);
              range.setEndAfter(textNode);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          } catch (e) {
            // cursor error
          }
        }

        snippetState.snippetFormMode = false;
        snippetState.currentSnippetForForm = null;
        snippetState.matchedSnippet = null;
        snippetState.snippetFields = [];
        snippetState.snippetFieldIndex = 0;
        snippetState.snippetFieldValues = {};
        snippetState.isProcessingSnippet = false;

        editor.contentEditable = 'true';
        editor.focus();
      }, 30);

      return;
    }
  });

  // Enter 키 처리
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (snippetState.isProcessingSnippet) return;
      snippetState.isProcessingSnippet = true;

      const fieldName = input.dataset.field;

      let value = input.textContent || '';
      value = value.replace(/[\u00A0\s]+/g, ' ').trim();

      // Prototype Pollution 방지
      if (fieldName && isSafeKey(fieldName)) {
        snippetState.snippetFieldValues[fieldName] = value;
      }

      snippetState.isComposing = false;
      input.blur();
      input.contentEditable = 'false';

      setTimeout(() => {
        snippetState.snippetFieldIndex++;
        const formContainer = editor.querySelector('.snippet-form');

        if (snippetState.snippetFieldIndex < snippetState.snippetFields.length) {
          showNextFieldInline(formContainer);
          snippetState.isProcessingSnippet = false;
        } else {
          const snippet = snippetState.currentSnippetForForm;
          const values = getFormValues();

          deleteSnippetForm();

          setTimeout(async () => {
            editor.focus();
            const editorContent = getPlainText().trim();
            let result;
            try {
              if (snippet.isManifest) {
                // Prototype Pollution 방지
                const cfg = safeJsonParse(snippet.config);
                if (!cfg) {
                  result = { success: false, error: 'Invalid config' };
                } else {
                  result = await window.api.executeManifestTool(cfg.toolId, snippet.shortcut, { ...values, editorContent });
                }
              } else {
                result = await window.api.executeSnippet(snippet.id, JSON.stringify(values), editorContent);
              }
            } catch (err) {
              result = { success: false, error: err.message };
            }

            // 디버그 로그
            console.log('[Snippet] Execute result:', result);

            // 결과 텍스트 삽입 (insertText가 있으면)
            if (result && result.success && result.insertText) {
              console.log('[Snippet] Inserting text:', result.insertText);
              insertTextAtCursor(result.insertText);
            }

            showToolLog(result, snippet);
            triggerSave();
            snippetState.isProcessingSnippet = false;
          }, 50);
        }
      }, 30);
    }
  });

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  input.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
      e.preventDefault();
    }
  });

  setTimeout(() => {
    input.focus();
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(input);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }, 10);
}

function expandSnippetForm(fields, snippet) {
  const match = editor.querySelector('.snippet-match');
  if (!match) return;

  snippetState.isProcessingSnippet = true;
  setTimeout(() => {
    snippetState.isProcessingSnippet = false;
  }, 200);

  const nextSibling = match.nextSibling;
  if (nextSibling && nextSibling.nodeType === Node.TEXT_NODE) {
    const text = nextSibling.textContent;
    if (snippetState.snippetContent) {
      const contentIdx = text.indexOf(snippetState.snippetContent);
      if (contentIdx !== -1) {
        nextSibling.textContent = text.substring(contentIdx + snippetState.snippetContent.length);
      }
    }
    nextSibling.textContent = nextSibling.textContent.replace(/^\S*/, '');
  }

  snippetState.snippetFields = fields;
  snippetState.snippetFieldIndex = 0;
  snippetState.snippetFieldValues = {};
  snippetState.snippetFormMode = true;
  snippetState.currentSnippetForForm = snippet;
  snippetState.matchedSnippet = null;
  snippetState.snippetContent = '';

  const formContainer = document.createElement('span');
  formContainer.className = 'snippet-form snippet-match';
  match.parentNode.replaceChild(formContainer, match);

  showNextFieldInline(formContainer);

  // 힌트 위치 업데이트 (폼 아래로)
  requestAnimationFrame(() => {
    updateHintPosition(formContainer);
  });
}

// 힌트 위치 업데이트
function updateHintPosition(targetEl) {
  let hint = editor.querySelector('.snippet-hint');
  if (!hint) {
    // 힌트가 없으면 새로 생성
    hint = document.createElement('span');
    hint.className = 'snippet-hint';
    hint.innerHTML = '<span class="snippet-hint-key"><kbd>ESC</kbd> 취소</span><span class="snippet-hint-key"><kbd>Enter</kbd> 실행</span>';
    editor.appendChild(hint);
  }

  const targetRect = targetEl.getBoundingClientRect();
  const editorRect = editor.getBoundingClientRect();

  hint.style.left = (targetRect.left - editorRect.left + editor.scrollLeft) + 'px';
  hint.style.top = (targetRect.bottom - editorRect.top + editor.scrollTop + 2) + 'px';
}

// ===== Enter 키 핸들러 =====

export function handleEnterKey(e) {
  if (e.key !== 'Enter') return;

  if (snippetState.snippetFormMode) {
    return;
  }

  if (snippetState.isProcessingSnippet) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  const match = editor.querySelector('.snippet-match:not(.snippet-form)');

  if (!match) return;

  // match는 있지만 matchedSnippet이 없는 경우 복구 시도
  if (match && !snippetState.matchedSnippet) {
    const matchText = match.textContent;
    const keyword = matchText.startsWith(snippetState.snippetTrigger) ? matchText.slice(1) : matchText;

    const foundSnippet = snippetState.snippets.find(s =>
      s.shortcut.toLowerCase() === keyword.toLowerCase()
    );

    if (foundSnippet) {
      snippetState.matchedSnippet = foundSnippet;
    } else {
      clearMatch();
      return;
    }
  }

  if (match && snippetState.matchedSnippet) {
    e.preventDefault();
    e.stopPropagation();
    snippetState.isProcessingSnippet = true;

    const snippet = snippetState.matchedSnippet;

    // Prototype Pollution 방지
    const config = safeJsonParse(snippet.config);
    if (!config) {
      snippetState.isProcessingSnippet = false;
      return;
    }

    const fields = snippet.isManifest ? (config.fields || []) : extractFields(config.body);

    if (fields.length > 0) {
      const matchTextBeforeBlur = match.textContent;

      snippetState.isComposing = false;
      editor.blur();

      setTimeout(() => {
        const currentMatch = editor.querySelector('.snippet-match:not(.snippet-form)');
        if (currentMatch && currentMatch.textContent !== matchTextBeforeBlur) {
          currentMatch.textContent = matchTextBeforeBlur;
        }

        if (currentMatch) {
          while (currentMatch.nextSibling && currentMatch.nextSibling.nodeType === Node.TEXT_NODE) {
            const siblingText = currentMatch.nextSibling.textContent.trim();
            if (siblingText.length <= 2) {
              currentMatch.nextSibling.remove();
            } else {
              break;
            }
          }
        }

        expandSnippetForm(fields, snippet);
        snippetState.isProcessingSnippet = false;
      }, 50);
    } else {
      const content = snippetState.snippetContent.trim();

      deleteMatch().then(async () => {
        let result;
        try {
          editor.focus();
          const editorContent = getPlainText().trim();
          if (snippet.isManifest) {
            // Prototype Pollution 방지
            const cfg = safeJsonParse(snippet.config);
            if (!cfg) {
              result = { success: false, error: 'Invalid config' };
            } else {
              result = await window.api.executeManifestTool(cfg.toolId, snippet.shortcut, { content, editorContent });
            }
          } else {
            result = await window.api.executeSnippet(snippet.id, content, editorContent);
          }
          // 디버그 로그
          console.log('[Snippet] Execute result:', result);

          // 결과 텍스트 삽입 (insertText가 있으면)
          if (result && result.success && result.insertText) {
            console.log('[Snippet] Inserting text:', result.insertText);
            insertTextAtCursor(result.insertText);
          }

          triggerSave();
        } catch (execErr) {
          result = { success: false, error: execErr.message };
        } finally {
          showToolLog(result, snippet);
          snippetState.isProcessingSnippet = false;
        }
      }).catch(err => {
        showToolLog({ success: false, error: err.message }, snippet);
        snippetState.isProcessingSnippet = false;
      });
    }
    return true; // handled
  }
  return false;
}

// ===== ESC 키 핸들러 =====

let lastEscTime = 0;

export function handleEscKey(e) {
  if (e.key !== 'Escape') return false;

  const now = Date.now();
  if (now - lastEscTime < 100) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return true;
  }
  lastEscTime = now;

  const snippetMatchEl = editor.querySelector('span.snippet-match');
  const snippetFormEl = editor.querySelector('.snippet-form');

  if (snippetState.snippetFormMode) {
    return false; // input 핸들러가 처리
  }

  if (snippetMatchEl || snippetFormEl || snippetState.matchedSnippet) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const matchText = snippetMatchEl ? snippetMatchEl.textContent : '';

    snippetState.isComposing = false;
    editor.blur();

    setTimeout(() => {
      // 힌트 제거
      const hint = editor.querySelector('.snippet-hint');
      if (hint) {
        hint.remove();
      }

      const currentMatch = editor.querySelector('span.snippet-match');
      if (currentMatch) {
        if (currentMatch.textContent !== matchText) {
          currentMatch.textContent = matchText;
        }
        const text = document.createTextNode(currentMatch.textContent);
        currentMatch.parentNode.replaceChild(text, currentMatch);
        editor.normalize();
      }
      snippetState.matchedSnippet = null;

      editor.focus();
    }, 20);
    return true;
  }

  return false;
}

// ===== IME 이벤트 =====

export function initIMEEvents() {
  editor.addEventListener('compositionstart', () => {
    snippetState.isComposing = true;
  });
  editor.addEventListener('compositionend', () => {
    snippetState.isComposing = false;
    setTimeout(checkSnippetTrigger, 50);
  });

  editor.addEventListener('blur', () => {
    snippetState.isComposing = false;
  });
  editor.addEventListener('focus', () => {
    snippetState.isComposing = false;
  });
}

// ===== 입력 감지 =====

export function initInputDetection() {
  editor.addEventListener('input', () => {
    const triggerIsAscii = snippetState.snippetTrigger && snippetState.snippetTrigger.charCodeAt(0) < 128;

    if (triggerIsAscii) {
      setTimeout(checkSnippetTrigger, 20);
    } else if (!snippetState.isComposing) {
      setTimeout(checkSnippetTrigger, 20);
    }
  });

  editor.addEventListener('keydown', (e) => {
    if (e.key === snippetState.snippetTrigger && e.key.charCodeAt(0) < 128) {
      snippetState.isComposing = false;
    }
  }, true);
}

// ===== 트리거 키 변경 =====

export function initTriggerKeyChange() {
  window.api.onTriggerKeyChanged((key) => {
    snippetState.snippetTrigger = key;
  });
}
