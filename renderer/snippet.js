/**
 * snippet.js - 단축어(스니펫) 기능
 * 가장 복잡한 모듈 - 단축어 감지, 폼 입력, 실행
 */

import { elements, snippetState } from './state.js';
import { getPlainText } from './editor.js';
import { triggerSave } from './memo.js';

const { editor } = elements;

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

  const dbSnippets = await window.api.getSnippets();
  const manifestCommands = await window.api.getManifestCommands();

  const manifestSnippets = manifestCommands.map(cmd => ({
    id: `manifest:${cmd.toolId}:${cmd.shortcut}`,
    type: 'manifest',
    shortcut: cmd.shortcut,
    name: `${cmd.toolIcon} ${cmd.shortcut}`,
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
  snippetState.matchedSnippet = null;
}

function deleteMatch() {
  return new Promise((resolve) => {
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
  console.log('[Trigger] keyword:', keyword, 'found:', !!match, 'snippets count:', snippets.length);
  if (!match) return;

  snippetState.matchedSnippet = match;
  snippetState.snippetContent = '';
  console.log('[Trigger] Matched snippet:', match.shortcut, match.id);

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
    }
  });
}

// ===== 폼 관리 =====

function deleteSnippetForm() {
  snippetState.snippetFormMode = false;
  snippetState.currentSnippetForForm = null;
  snippetState.matchedSnippet = null;
  snippetState.snippetFields = [];
  snippetState.snippetFieldIndex = 0;
  snippetState.snippetFieldValues = {};

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
    console.log('[Input] Composition start');
  });
  input.addEventListener('compositionend', () => {
    snippetState.isComposing = false;
    console.log('[Input] Composition end');
  });

  // ESC 키 처리
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const currentValue = input.textContent || '';
      console.log('[Input ESC] value before blur:', currentValue);

      snippetState.isComposing = false;
      input.blur();
      input.contentEditable = 'false';

      setTimeout(() => {
        const formContainer = editor.querySelector('.snippet-form');
        if (formContainer && formContainer.parentNode) {
          const labelEl = formContainer.querySelector('.snippet-label');
          const labelText = labelEl ? labelEl.textContent : '';
          const finalText = labelText + currentValue;

          console.log('[Input ESC] final text:', finalText);

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
            console.log('[Input ESC] cursor error:', e);
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

      console.log('[Input Enter] value:', value, 'composing:', snippetState.isComposing);

      if (fieldName) {
        snippetState.snippetFieldValues[fieldName] = value;
        console.log('[Input Enter] Field saved:', fieldName, '=', value);
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
          console.log('[Input Enter] Executing with values:', values);

          deleteSnippetForm();

          setTimeout(async () => {
            editor.focus();
            const editorContent = getPlainText().trim();
            console.log('[Execute] Starting execution, snippet:', snippet);
            console.log('[Execute] editorContent:', editorContent);
            try {
              let result;
              if (snippet.isManifest) {
                const cfg = JSON.parse(snippet.config);
                console.log('[Execute] Calling executeManifestTool:', cfg.toolId);
                result = await window.api.executeManifestTool(cfg.toolId, snippet.shortcut, { ...values, editorContent });
              } else {
                console.log('[Execute] Calling executeSnippet:', snippet.id, values);
                result = await window.api.executeSnippet(snippet.id, JSON.stringify(values), editorContent);
              }
              console.log('[Execute] Result:', result);
              if (result && !result.success) {
                console.error('[Execute] Failed:', result.error || result.status || result.data);
              }
            } catch (err) {
              console.error('[Execute] Error:', err);
            }
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
  console.log('[Form] expandSnippetForm called, fields:', fields);
  const match = editor.querySelector('.snippet-match');
  if (!match) {
    console.log('[Form] No match found, returning');
    return;
  }

  snippetState.isProcessingSnippet = true;
  setTimeout(() => {
    snippetState.isProcessingSnippet = false;
    console.log('[Form] Ready for input');
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
}

// ===== Enter 키 핸들러 =====

export function handleEnterKey(e) {
  if (e.key !== 'Enter') return;

  if (snippetState.snippetFormMode) {
    return;
  }

  console.log('[Enter] Key pressed, isProcessingSnippet:', snippetState.isProcessingSnippet);

  if (snippetState.isProcessingSnippet) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  const match = editor.querySelector('.snippet-match:not(.snippet-form)');

  console.log('[Enter] match:', !!match, 'matchedSnippet:', !!snippetState.matchedSnippet, 'snippetFormMode:', snippetState.snippetFormMode);

  if (!match) return;

  // match는 있지만 matchedSnippet이 없는 경우 복구 시도
  if (match && !snippetState.matchedSnippet) {
    const matchText = match.textContent;
    const keyword = matchText.startsWith(snippetState.snippetTrigger) ? matchText.slice(1) : matchText;

    const foundSnippet = snippetState.snippets.find(s =>
      s.shortcut.toLowerCase() === keyword.toLowerCase()
    );

    if (foundSnippet) {
      console.log('[Enter] Recovered matchedSnippet from DOM:', foundSnippet.shortcut);
      snippetState.matchedSnippet = foundSnippet;
    } else {
      console.log('[Enter] Could not recover snippet, clearing match');
      clearMatch();
      return;
    }
  }

  if (match && snippetState.matchedSnippet) {
    e.preventDefault();
    e.stopPropagation();
    snippetState.isProcessingSnippet = true;

    const snippet = snippetState.matchedSnippet;
    console.log('[Enter] Snippet object:', snippet);

    let config;
    try {
      config = JSON.parse(snippet.config);
    } catch (parseErr) {
      console.error('[Enter] Failed to parse snippet config:', parseErr, snippet.config);
      snippetState.isProcessingSnippet = false;
      return;
    }

    const fields = snippet.isManifest ? (config.fields || []) : extractFields(config.body);
    console.log('[Enter] Fields:', fields, 'isManifest:', snippet.isManifest);

    if (fields.length > 0) {
      const matchTextBeforeBlur = match.textContent;
      console.log('[Enter] Match text before blur:', matchTextBeforeBlur);

      snippetState.isComposing = false;
      editor.blur();

      setTimeout(() => {
        const currentMatch = editor.querySelector('.snippet-match:not(.snippet-form)');
        if (currentMatch && currentMatch.textContent !== matchTextBeforeBlur) {
          console.log('[Enter] Match text after blur:', currentMatch.textContent, '-> restoring to:', matchTextBeforeBlur);
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
      console.log('[Enter] No fields, executing directly. content:', content);

      deleteMatch().then(async () => {
        try {
          editor.focus();
          const editorContent = getPlainText().trim();
          console.log('[Snippet] Executing:', snippet.isManifest ? 'manifest' : 'db', snippet.id || snippet.shortcut, 'content:', content, 'editorContent length:', editorContent.length);
          if (snippet.isManifest) {
            const cfg = JSON.parse(snippet.config);
            console.log('[Snippet] Manifest config:', cfg);
            const result = await window.api.executeManifestTool(cfg.toolId, snippet.shortcut, { content, editorContent });
            console.log('[Snippet] Manifest result:', result);
          } else {
            console.log('[Snippet] DB snippet id:', snippet.id);
            const result = await window.api.executeSnippet(snippet.id, content, editorContent);
            console.log('[Snippet] Execute result:', result);
          }
          triggerSave();
        } catch (execErr) {
          console.error('[Snippet] Execution error:', execErr);
        } finally {
          snippetState.isProcessingSnippet = false;
        }
      }).catch(err => {
        console.error('[Snippet] deleteMatch error:', err);
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
