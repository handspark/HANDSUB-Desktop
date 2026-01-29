const autoLaunchCheckbox = document.getElementById('autoLaunch');
const notificationCheckbox = document.getElementById('notificationEnabled');
const cloudSyncCheckbox = document.getElementById('cloudSyncEnabled');
const cloudSyncOption = document.getElementById('cloudSyncOption');
const cloudSyncProTag = document.getElementById('cloudSyncProTag');
const cloudSyncLock = document.getElementById('cloudSyncLock');
const cloudSyncToggleWrapper = cloudSyncLock?.parentElement;
const closeBtn = document.getElementById('closeBtn');
const shortcutInput = document.getElementById('shortcutInput');
const newMemoShortcutInput = document.getElementById('newMemoShortcutInput');
const triggerKeyInput = document.getElementById('triggerKeyInput');
const executeKeyInput = document.getElementById('executeKeyInput');
const versionText = document.getElementById('versionText');
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.section');

// Feature lock elements (로그인 필요 기능)
const snippetsLock = document.getElementById('snippetsLock');
const toolsLock = document.getElementById('toolsLock');
const snippetsOverlay = document.getElementById('snippetsOverlay');
const toolsOverlay = document.getElementById('toolsOverlay');
const snippetsLoginBtn = document.getElementById('snippetsLoginBtn');
const toolsLoginBtn = document.getElementById('toolsLoginBtn');

// 기능 탭 잠금 상태
let isFeatureTabsLocked = true;

// Confirm Modal elements
const confirmModal = document.getElementById('confirmModal');
const confirmModalMessage = document.getElementById('confirmModalMessage');
const confirmModalCancel = document.getElementById('confirmModalCancel');
const confirmModalOk = document.getElementById('confirmModalOk');
const confirmModalBackdrop = confirmModal?.querySelector('.confirm-modal-backdrop');

// Custom confirm function
let confirmResolve = null;

function showConfirmModal(message) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    if (confirmModalMessage) confirmModalMessage.textContent = message;
    confirmModal?.classList.remove('hidden');
  });
}

function hideConfirmModal(result) {
  confirmModal?.classList.add('hidden');
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

confirmModalCancel?.addEventListener('click', () => hideConfirmModal(false));
confirmModalOk?.addEventListener('click', () => hideConfirmModal(true));
confirmModalBackdrop?.addEventListener('click', () => hideConfirmModal(false));

// 클라우드 로그아웃 다이얼로그
function showCloudLogoutDialog(cloudMemoCount) {
  return new Promise((resolve) => {
    // 오버레이 생성
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    overlay.innerHTML = `
      <div style="
        background: var(--modal-bg, #fff);
        border-radius: 12px;
        padding: 24px;
        max-width: 360px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      ">
        <div style="text-align: center; margin-bottom: 16px;">
          <svg viewBox="0 0 512 512" width="48" height="48">
            <path fill="#007AFF" d="M421 406H91c-24.05 0-46.794-9.327-64.042-26.264C9.574 362.667 0 340.031 0 316s9.574-46.667 26.958-63.736c13.614-13.368 30.652-21.995 49.054-25.038-.008-.406-.012-.815-.012-1.226 0-66.168 53.832-120 120-120 24.538 0 48.119 7.387 68.194 21.363 14.132 9.838 25.865 22.443 34.587 37.043 14.079-8.733 30.318-13.406 47.219-13.406 44.886 0 82.202 33.026 88.921 76.056 18.811 2.88 36.244 11.581 50.122 25.208C502.426 269.333 512 291.969 512 316s-9.574 46.667-26.957 63.736C467.794 396.673 445.05 406 421 406z"/>
          </svg>
        </div>
        <div style="font-size: 18px; font-weight: 600; text-align: center; margin-bottom: 8px; color: var(--text-color, #333);">
          로그아웃
        </div>
        <div style="font-size: 13px; color: var(--text-muted, #666); text-align: center; margin-bottom: 20px;">
          이 기기에 클라우드 메모 ${cloudMemoCount}개가 있습니다
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
          <label class="cloud-opt" data-value="keep" style="
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 12px;
            border: 2px solid var(--border-color, #e0e0e0);
            border-radius: 8px;
            cursor: pointer;
          ">
            <input type="radio" name="logout-mode" value="keep" checked style="margin-top: 2px; accent-color: #007AFF;">
            <div>
              <div style="font-size: 14px; font-weight: 600; color: var(--text-color, #333);">이 기기에 남기기</div>
              <div style="font-size: 12px; color: var(--text-muted, #666); margin-top: 2px;">다른 사람도 이 기기에서 볼 수 있음</div>
            </div>
          </label>
          <label class="cloud-opt" data-value="delete" style="
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 12px;
            border: 2px solid var(--border-color, #e0e0e0);
            border-radius: 8px;
            cursor: pointer;
          ">
            <input type="radio" name="logout-mode" value="delete" style="margin-top: 2px; accent-color: #007AFF;">
            <div>
              <div style="font-size: 14px; font-weight: 600; color: var(--text-color, #333);">이 기기에서 삭제</div>
              <div style="font-size: 12px; color: var(--text-muted, #666); margin-top: 2px;">다음 로그인 시 클라우드에서 복원됨</div>
            </div>
          </label>
        </div>

        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button id="cloud-cancel" style="
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            background: var(--btn-secondary-bg, #f5f5f5);
            border: 1px solid var(--border-color, #e0e0e0);
            color: var(--text-color, #333);
          ">취소</button>
          <button id="cloud-confirm" style="
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            background: #007AFF;
            border: none;
            color: white;
          ">로그아웃</button>
        </div>
      </div>
    `;

    // 옵션 선택 이벤트
    overlay.querySelectorAll('.cloud-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        overlay.querySelectorAll('.cloud-opt').forEach(o => {
          o.style.borderColor = 'var(--border-color, #e0e0e0)';
          o.style.background = 'transparent';
        });
        opt.style.borderColor = '#007AFF';
        opt.style.background = 'rgba(0, 122, 255, 0.05)';
        opt.querySelector('input').checked = true;
      });
    });

    // 첫 번째 옵션 선택 상태 표시
    const firstOpt = overlay.querySelector('.cloud-opt');
    firstOpt.style.borderColor = '#007AFF';
    firstOpt.style.background = 'rgba(0, 122, 255, 0.05)';

    // 취소 버튼
    overlay.querySelector('#cloud-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve({ action: 'cancel' });
    });

    // 확인 버튼
    overlay.querySelector('#cloud-confirm').addEventListener('click', () => {
      const mode = overlay.querySelector('input[name="logout-mode"]:checked').value;
      overlay.remove();
      resolve({ action: mode, keepLocal: mode === 'keep' });
    });

    document.body.appendChild(overlay);
  });
}

// Tools page elements
const openToolsListBtn = document.getElementById('openToolsListBtn');
const backFromTools = document.getElementById('backFromTools');
const toolsMainPage = document.getElementById('toolsMainPage');
const toolsListPage = document.getElementById('toolsListPage');
const availableToolsList = document.getElementById('availableToolsList');

// Custom select elements
const snippetToolSelectEl = document.getElementById('snippetToolSelect');
const snippetToolValue = document.getElementById('snippetToolValue');
const customSelectTrigger = snippetToolSelectEl.querySelector('.custom-select-trigger');
const customSelectOptions = snippetToolSelectEl.querySelector('.custom-select-options');
const selectedIcon = snippetToolSelectEl.querySelector('.selected-icon');
const selectedText = snippetToolSelectEl.querySelector('.selected-text');

// Close button
closeBtn.addEventListener('click', () => {
  window.settingsApi.close();
});

// Navigation
navItems.forEach(item => {
  item.addEventListener('click', () => {
    const sectionId = item.dataset.section;

    // Update nav active state
    navItems.forEach(nav => nav.classList.remove('active'));
    item.classList.add('active');

    // Show corresponding section
    sections.forEach(section => section.classList.remove('active'));
    document.getElementById(`section-${sectionId}`).classList.add('active');
  });
});

// Load current settings
(async () => {
  // 클라우드 동기화 초기 잠금 (인증 확인 전까지)
  lockCloudSync();

  // 기능 탭 초기 잠금 (인증 확인 전까지)
  lockFeatureTabs();

  const shortcut = await window.settingsApi.getShortcut();
  shortcutInput.value = formatShortcut(shortcut);

  // 새 메모 단축키 로드
  const newMemoShortcut = await window.settingsApi.getNewMemoShortcut();
  newMemoShortcutInput.value = formatShortcut(newMemoShortcut);

  const version = await window.settingsApi.getVersion();
  versionText.textContent = version;

  // 자동 실행 설정 로드
  const autoLaunch = await window.settingsApi.getAutoLaunch();
  autoLaunchCheckbox.checked = autoLaunch;

  // 알림 설정 로드
  const notificationEnabled = await window.settingsApi.getNotificationEnabled();
  notificationCheckbox.checked = notificationEnabled;

  // 클라우드 동기화 설정 로드 (Pro 사용자만 값 적용)
  const cloudSyncEnabled = await window.settingsApi.getCloudSyncEnabled();
  if (cloudSyncCheckbox) cloudSyncCheckbox.dataset.savedValue = cloudSyncEnabled || false;

  // 호출키 로드
  const triggerKey = await window.settingsApi.getTriggerKey();
  triggerKeyInput.value = triggerKey;

  // 실행키 로드
  const executeKey = await window.settingsApi.getExecuteKey();
  executeKeyInput.value = formatExecuteKey(executeKey);
})();

function formatExecuteKey(key) {
  if (!key) return 'Enter';
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  // 수정자 키 표시
  let display = key
    .replace('CommandOrControl+', isMac ? '⌘+' : 'Ctrl+')
    .replace('Meta+', isMac ? '⌘+' : 'Win+')
    .replace('Control+', 'Ctrl+')
    .replace('Alt+', isMac ? '⌥+' : 'Alt+')
    .replace('Shift+', isMac ? '⇧+' : 'Shift+');

  // 특수 키 한글화
  const keyMap = {
    'Tab': 'Tab',
    'Enter': 'Enter',
    'Space': 'Space',
    ' ': 'Space'
  };

  // 마지막 키 부분만 변환
  const parts = display.split('+');
  const lastKey = parts[parts.length - 1];
  if (keyMap[lastKey]) {
    parts[parts.length - 1] = keyMap[lastKey];
  }

  return parts.join('+');
}

// 호출키 변경
triggerKeyInput.addEventListener('input', async () => {
  const key = triggerKeyInput.value;
  if (key.length === 1) {
    await window.settingsApi.setTriggerKey(key);
  }
});

// 실행키 변경 (키보드 이벤트로 캡처 - 수정자 키 지원)
executeKeyInput.addEventListener('keydown', async (e) => {
  e.preventDefault();

  // 단독 수정자 키는 무시
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    return;
  }

  // 허용된 기본 키 목록
  const allowedKeys = ['Tab', 'Enter', ' '];
  if (!allowedKeys.includes(e.key)) {
    return;
  }

  // Tab은 수정자 키 필수 (다른 곳에서 많이 사용되므로)
  const hasModifier = e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
  if (e.key === 'Tab' && !hasModifier) {
    return; // Tab 단독 사용 불가
  }

  // 수정자 키 조합 생성
  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key);

  const key = parts.join('+');
  const success = await window.settingsApi.setExecuteKey(key);
  if (success) {
    executeKeyInput.value = formatExecuteKey(key);
    executeKeyInput.blur();
  }
});

// Shortcut input - capture key combination
shortcutInput.addEventListener('keydown', async (e) => {
  e.preventDefault();

  // Ignore single modifier keys
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    return;
  }

  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  // Need at least one modifier
  if (parts.length === 0) {
    return;
  }

  // Get the key
  let key = e.key.toUpperCase();
  if (e.code.startsWith('Key')) {
    key = e.code.replace('Key', '');
  } else if (e.code.startsWith('Digit')) {
    key = e.code.replace('Digit', '');
  }

  parts.push(key);
  const shortcut = parts.join('+');

  const success = await window.settingsApi.setShortcut(shortcut);
  if (success) {
    shortcutInput.value = formatShortcut(shortcut);
    shortcutInput.blur();
  }
});

// 단축키 입력 시 전역 단축키 일시 중지
shortcutInput.addEventListener('focus', () => {
  window.settingsApi.suspendShortcuts();
});
shortcutInput.addEventListener('blur', () => {
  window.settingsApi.resumeShortcuts();
});

// 새 메모 단축키 입력
newMemoShortcutInput.addEventListener('keydown', async (e) => {
  e.preventDefault();

  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    return;
  }

  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  if (parts.length === 0) {
    return;
  }

  let key = e.key.toUpperCase();
  if (e.code.startsWith('Key')) {
    key = e.code.replace('Key', '');
  } else if (e.code.startsWith('Digit')) {
    key = e.code.replace('Digit', '');
  }

  parts.push(key);
  const shortcut = parts.join('+');

  const success = await window.settingsApi.setNewMemoShortcut(shortcut);
  if (success) {
    newMemoShortcutInput.value = formatShortcut(shortcut);
    newMemoShortcutInput.blur();
  }
});

// 새 메모 단축키 입력 시 전역 단축키 일시 중지
newMemoShortcutInput.addEventListener('focus', () => {
  window.settingsApi.suspendShortcuts();
});
newMemoShortcutInput.addEventListener('blur', () => {
  window.settingsApi.resumeShortcuts();
});

function formatShortcut(shortcut) {
  if (!shortcut) return '';
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  return shortcut
    .replace('CommandOrControl', isMac ? '⌘' : 'Ctrl')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace(/\+/g, ' + ');
}

// Save on change
autoLaunchCheckbox.addEventListener('change', async () => {
  await window.settingsApi.setAutoLaunch(autoLaunchCheckbox.checked);
});

// 알림 설정 변경
notificationCheckbox.addEventListener('change', async () => {
  await window.settingsApi.setNotificationEnabled(notificationCheckbox.checked);
});

// 클라우드 동기화 설정 변경
cloudSyncCheckbox.addEventListener('change', async () => {
  await window.settingsApi.setCloudSyncEnabled(cloudSyncCheckbox.checked);
});

// 클라우드 동기화 토글 클릭 시 Pro 아니면 업그레이드 안내
cloudSyncToggleWrapper?.addEventListener('click', (e) => {
  if (cloudSyncToggleWrapper.classList.contains('locked')) {
    e.preventDefault();
    e.stopPropagation();
    showConfirmModal('클라우드 동기화는 Pro 기능입니다.\n업그레이드 페이지로 이동하시겠습니까?').then((confirmed) => {
      if (confirmed) {
        window.settingsApi.openExternal(`${WP_SITE_URL}/pricing`);
      }
    });
  }
});

// ===== Snippet Management =====
const snippetList = document.getElementById('snippetList');
const snippetForm = document.getElementById('snippetForm');
const addSnippetBtn = document.getElementById('addSnippetBtn');
const snippetCancel = document.getElementById('snippetCancel');
const snippetSave = document.getElementById('snippetSave');
const snippetShortcut = document.getElementById('snippetShortcut');
const snippetEditId = document.getElementById('snippetEditId');
const snippetToolSelect = document.getElementById('snippetToolSelect');
const dynamicFields = document.getElementById('dynamicFields');

// 도구 목록 캐시
let toolsList = [];
let currentToolSchema = [];

// 도구 목록 로드 및 커스텀 셀렉트 채우기
async function loadTools() {
  toolsList = await window.settingsApi.getTools();
  customSelectOptions.innerHTML = '';

  toolsList.forEach(tool => {
    const option = document.createElement('div');
    option.className = 'custom-select-option';
    option.dataset.value = tool.id;

    // 아이콘 HTML 생성 (iconPath가 있으면 이미지, 없으면 이모지)
    const iconHtml = tool.iconPath
      ? `<img src="file://${tool.iconPath}" alt="${tool.name}">`
      : (tool.icon || '🔧');

    option.innerHTML = `
      <span class="option-icon">${iconHtml}</span>
      <span class="option-text">${escapeHtml(tool.name)}</span>
      <span class="option-check">✓</span>
    `;

    option.addEventListener('click', () => {
      selectToolOption(tool);
    });

    customSelectOptions.appendChild(option);
  });

  // 첫 번째 도구 선택
  if (toolsList.length > 0) {
    selectToolOption(toolsList[0]);
  }
}

// 도구 선택 처리
function selectToolOption(tool) {
  // 값 저장
  snippetToolValue.value = tool.id;

  // 트리거 UI 업데이트
  const iconHtml = tool.iconPath
    ? `<img src="file://${tool.iconPath}" alt="${tool.name}">`
    : (tool.icon || '🔧');
  selectedIcon.innerHTML = iconHtml;
  selectedText.textContent = tool.name;

  // 선택 표시 업데이트
  customSelectOptions.querySelectorAll('.custom-select-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.value === tool.id);
  });

  // 드롭다운 닫기
  snippetToolSelectEl.classList.remove('open');

  // 동적 폼 렌더링
  renderDynamicForm(tool.id);
}

// 커스텀 셀렉트 토글
customSelectTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  snippetToolSelectEl.classList.toggle('open');
});

// 외부 클릭 시 닫기
document.addEventListener('click', (e) => {
  if (!snippetToolSelectEl.contains(e.target)) {
    snippetToolSelectEl.classList.remove('open');
  }
});

// 스키마 기반 동적 폼 생성
function renderDynamicForm(toolId, existingConfig = {}) {
  const tool = toolsList.find(t => t.id === toolId);
  if (!tool) return;

  currentToolSchema = tool.schema || [];
  dynamicFields.innerHTML = '';

  currentToolSchema.forEach(field => {
    // showWhen 조건 체크
    if (field.showWhen) {
      const { field: depField, notEquals } = field.showWhen;
      const depValue = existingConfig[depField] || tool.defaults?.[depField];
      if (depValue === notEquals) return;
    }

    const row = document.createElement('div');
    row.className = 'form-row';
    row.dataset.fieldName = field.name;

    const label = document.createElement('label');
    label.textContent = field.label || field.name;
    row.appendChild(label);

    const defaultValue = existingConfig[field.name] ?? tool.defaults?.[field.name] ?? '';

    switch (field.type) {
      case 'text':
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `field_${field.name}`;
        input.placeholder = field.placeholder || '';
        input.value = defaultValue;
        row.appendChild(input);
        break;

      case 'textarea':
        const textarea = document.createElement('textarea');
        textarea.id = `field_${field.name}`;
        textarea.placeholder = field.placeholder || '';
        textarea.value = defaultValue;
        row.appendChild(textarea);
        if (field.hint) {
          const hint = document.createElement('small');
          hint.className = 'form-hint';
          hint.textContent = field.hint;
          row.appendChild(hint);
        }
        // Body 필드 다음에 테스트 실행 버튼 추가 (HTTP 도구만)
        if (field.name === 'body' && toolId === 'http') {
          const testBtnRow = document.createElement('div');
          testBtnRow.className = 'tool-test-inline';
          testBtnRow.innerHTML = `
            <button type="button" class="tool-test-btn-small" id="toolTestBtnInline">테스트 실행</button>
          `;
          row.appendChild(testBtnRow);
        }
        break;

      case 'select':
        const select = document.createElement('select');
        select.id = `field_${field.name}`;
        (field.options || []).forEach(opt => {
          const option = document.createElement('option');
          option.value = opt;
          option.textContent = opt;
          if (opt === (defaultValue || field.default)) {
            option.selected = true;
          }
          select.appendChild(option);
        });
        // showWhen 연동: 다른 필드에 영향을 주는 select인 경우
        select.addEventListener('change', () => {
          updateConditionalFields(toolId, getFormValues());
        });
        row.appendChild(select);
        break;

      case 'keyvalue':
        const container = document.createElement('div');
        container.className = 'key-value-container';
        container.id = `field_${field.name}`;

        // 기존 값 로드
        if (defaultValue && typeof defaultValue === 'object') {
          Object.entries(defaultValue).forEach(([k, v]) => {
            addKeyValueRow(container, k, v);
          });
        }

        row.appendChild(container);

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'add-field-btn';
        addBtn.textContent = `+ ${field.label || field.name} 추가`;
        addBtn.addEventListener('click', () => addKeyValueRow(container));
        row.appendChild(addBtn);
        break;

      case 'checkbox':
        const checkLabel = document.createElement('label');
        checkLabel.className = 'checkbox-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `field_${field.name}`;
        checkbox.checked = !!defaultValue;
        checkLabel.appendChild(checkbox);
        checkLabel.appendChild(document.createTextNode(field.label || field.name));
        row.innerHTML = '';
        row.appendChild(checkLabel);
        break;

      case 'result':
        // 결과 필드: 입력 + 테스트 결과 표시 통합
        row.className = 'form-row result-field-row';
        const resultInput = document.createElement('input');
        resultInput.type = 'text';
        resultInput.id = `field_${field.name}`;
        resultInput.placeholder = field.placeholder || '';
        resultInput.value = defaultValue;
        row.appendChild(resultInput);

        // 테스트 결과 표시 영역 (같은 row 안에)
        const resultDisplay = document.createElement('div');
        resultDisplay.id = 'toolTestResult';
        resultDisplay.className = 'tool-test-result-inline';
        resultDisplay.style.display = 'none';
        row.appendChild(resultDisplay);
        break;
    }

    dynamicFields.appendChild(row);
  });

  // HTTP 도구인 경우 테스트 버튼 이벤트 연결
  if (toolId === 'http') {
    setTimeout(() => {
      const inlineTestBtn = document.getElementById('toolTestBtnInline');
      if (inlineTestBtn) {
        inlineTestBtn.addEventListener('click', runToolTest);
      }
    }, 10);
  }
}

// 도구 테스트 실행
async function runToolTest() {
  const testBtn = document.getElementById('toolTestBtnInline');
  const resultDiv = document.getElementById('toolTestResult');

  const toolId = snippetToolValue.value;
  const config = getFormValues();

  // URL 필수 검증
  if (!config.url) {
    resultDiv.style.display = 'block';
    resultDiv.className = 'tool-test-result-inline error';
    resultDiv.innerHTML = `
      <div class="result-status error">✗ 오류</div>
      <pre>URL을 입력하세요</pre>
    `;
    return;
  }

  // 버튼 로딩 상태
  testBtn.disabled = true;
  testBtn.classList.add('loading');
  testBtn.textContent = '테스트 중...';
  resultDiv.style.display = 'none';

  try {
    const result = await window.settingsApi.testTool(toolId, config);

    resultDiv.style.display = 'block';
    resultDiv.className = result.success ? 'tool-test-result-inline success' : 'tool-test-result-inline error';

    if (result.success) {
      const jsonHtml = renderJsonWithPaths(result.data, '');
      resultDiv.innerHTML = `
        <div class="result-status success">✓ 성공 (${result.status}) - 클릭하여 선택</div>
        <pre>${jsonHtml}</pre>
      `;

      // JSON 키 클릭 이벤트 추가
      resultDiv.querySelectorAll('.json-key.clickable').forEach(el => {
        el.addEventListener('click', () => {
          const path = el.dataset.path;
          const resultPathInput = document.getElementById('field_resultPath');
          if (resultPathInput) {
            resultPathInput.value = path;
            resultPathInput.focus();
          }
        });
      });
    } else {
      resultDiv.innerHTML = `
        <div class="result-status error">✗ 실패 ${result.status ? `(${result.status})` : ''}</div>
        <pre>${escapeHtml(result.error || '알 수 없는 오류')}</pre>
      `;
    }
  } catch (e) {
    resultDiv.style.display = 'block';
    resultDiv.className = 'tool-test-result-inline error';
    resultDiv.innerHTML = `
      <div class="result-status error">✗ 오류</div>
      <pre>${escapeHtml(e.message)}</pre>
    `;
  } finally {
    testBtn.disabled = false;
    testBtn.classList.remove('loading');
    testBtn.textContent = '테스트 실행';
  }
}

// JSON을 클릭 가능한 경로로 렌더링
function renderJsonWithPaths(obj, prefix = '') {
  if (obj === null) return '<span class="json-null">null</span>';
  if (obj === undefined) return '<span class="json-undefined">undefined</span>';

  if (typeof obj === 'string') {
    return `<span class="json-string">"${escapeHtml(obj)}"</span>`;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return `<span class="json-${typeof obj}">${obj}</span>`;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    const items = obj.map((item, idx) => {
      const path = prefix ? `${prefix}[${idx}]` : `[${idx}]`;
      return `  ${renderJsonWithPaths(item, path)}`;
    });
    return `[\n${items.join(',\n')}\n]`;
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';

    const items = keys.map(key => {
      const path = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];
      const isLeaf = typeof value !== 'object' || value === null;
      const keyClass = isLeaf ? 'json-key clickable' : 'json-key';
      return `  <span class="${keyClass}" data-path="${path}">"${escapeHtml(key)}"</span>: ${renderJsonWithPaths(value, path)}`;
    });
    return `{\n${items.join(',\n')}\n}`;
  }

  return String(obj);
}

// 조건부 필드 업데이트 (showWhen)
function updateConditionalFields(toolId, currentValues) {
  const tool = toolsList.find(t => t.id === toolId);
  if (!tool) return;

  (tool.schema || []).forEach(field => {
    if (field.showWhen) {
      const { field: depField, notEquals } = field.showWhen;
      const depValue = currentValues[depField];
      const row = dynamicFields.querySelector(`[data-field-name="${field.name}"]`);

      if (depValue === notEquals) {
        // 숨기기
        if (row) row.remove();
      } else {
        // 표시 (없으면 추가)
        if (!row) {
          renderDynamicForm(toolId, currentValues);
        }
      }
    }
  });
}

// Key-Value 행 추가 함수
function addKeyValueRow(container, key = '', value = '') {
  const row = document.createElement('div');
  row.className = 'key-value-row';
  row.innerHTML = `
    <input type="text" class="kv-key" placeholder="Key" value="${escapeHtml(key)}">
    <input type="text" class="kv-value" placeholder="Value" value="${escapeHtml(value)}">
    <button type="button" class="remove-btn">×</button>
  `;
  row.querySelector('.remove-btn').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

// Key-Value 쌍 추출 함수
function getKeyValuePairs(container) {
  const pairs = {};
  container.querySelectorAll('.key-value-row').forEach(row => {
    const key = row.querySelector('.kv-key').value.trim();
    const value = row.querySelector('.kv-value').value.trim();
    if (key) {
      pairs[key] = value;
    }
  });
  return pairs;
}

// 동적 폼에서 값 추출
function getFormValues() {
  const values = {};

  currentToolSchema.forEach(field => {
    const el = document.getElementById(`field_${field.name}`);
    if (!el) return;

    switch (field.type) {
      case 'text':
      case 'textarea':
      case 'select':
      case 'result':
        values[field.name] = el.value;
        break;
      case 'keyvalue':
        values[field.name] = getKeyValuePairs(el);
        break;
      case 'checkbox':
        values[field.name] = el.checked;
        break;
    }
  });

  return values;
}

// Load snippets on init
loadTools();
loadSnippets();

async function loadSnippets() {
  const snippets = await window.settingsApi.getSnippets();
  renderSnippetList(snippets);
}

function renderSnippetList(snippets) {
  snippetList.innerHTML = '';

  snippets.forEach(snippet => {
    const config = JSON.parse(snippet.config);
    const tool = toolsList.find(t => t.id === snippet.type);
    const toolName = tool ? tool.name : snippet.type.toUpperCase();

    // 아이콘 HTML 생성
    let iconHtml = '';
    if (tool?.iconPath) {
      iconHtml = `<img src="file://${tool.iconPath}" class="snippet-tool-icon" alt="${toolName}">`;
    } else if (tool?.icon) {
      iconHtml = `<span class="snippet-tool-emoji">${tool.icon}</span>`;
    }

    const item = document.createElement('div');
    item.className = 'snippet-item';
    item.innerHTML = `
      <div class="snippet-info">
        <span class="snippet-name">${escapeHtml(snippet.name || snippet.shortcut)}</span>
        <span class="snippet-meta">${iconHtml} ${toolName}${snippet.type === 'http' ? ' ' + (config.method || 'POST') : ''}</span>
      </div>
      <div class="snippet-actions">
        <button class="edit-btn" data-id="${snippet.id}">수정</button>
        <button class="delete-btn" data-id="${snippet.id}">삭제</button>
      </div>
    `;
    snippetList.appendChild(item);
  });

  // Add event listeners
  snippetList.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => editSnippet(btn.dataset.id, snippets));
  });

  snippetList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteSnippet(btn.dataset.id));
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Show/hide form
addSnippetBtn.addEventListener('click', () => {
  resetForm();
  snippetForm.classList.remove('hidden');
  addSnippetBtn.classList.add('hidden');
});

snippetCancel.addEventListener('click', () => {
  snippetForm.classList.add('hidden');
  addSnippetBtn.classList.remove('hidden');
  resetForm();
});

function resetForm() {
  snippetEditId.value = '';
  snippetShortcut.value = '';

  // 첫 번째 도구 선택
  if (toolsList.length > 0) {
    selectToolOption(toolsList[0]);
  }
}

// Edit snippet
function editSnippet(id, snippets) {
  const snippet = snippets.find(s => s.id === id);
  if (!snippet) return;

  const config = JSON.parse(snippet.config);

  snippetEditId.value = snippet.id;
  snippetShortcut.value = snippet.shortcut;

  // 해당 도구 선택
  const tool = toolsList.find(t => t.id === snippet.type);
  if (tool) {
    selectToolOption(tool);
  }

  // 해당 도구의 폼 생성 (기존 값 로드)
  renderDynamicForm(snippet.type, config);

  snippetForm.classList.remove('hidden');
  addSnippetBtn.classList.add('hidden');
}

// Delete snippet
async function deleteSnippet(id) {
  await window.settingsApi.deleteSnippet(id);
  loadSnippets();
}

// Save snippet
snippetSave.addEventListener('click', async () => {
  const type = snippetToolValue.value;
  const shortcut = snippetShortcut.value.trim();

  if (!shortcut) {
    alert('단축어를 입력하세요');
    return;
  }

  // 동적 폼에서 config 값 추출
  const config = getFormValues();

  // URL 필수 검증 (해당 도구에서 필요한 경우)
  const urlField = currentToolSchema.find(f => f.name === 'url' && f.required);
  if (urlField && !config.url) {
    alert('URL을 입력하세요');
    return;
  }

  const data = {
    type,
    shortcut,
    name: shortcut,
    config
  };

  const editId = snippetEditId.value;
  let result;

  if (editId) {
    data.id = editId;
    result = await window.settingsApi.updateSnippet(data);
  } else {
    result = await window.settingsApi.createSnippet(data);
  }

  if (!result?.success) {
    alert('저장 실패: ' + (result?.error || '알 수 없는 오류'));
    return;
  }

  snippetForm.classList.add('hidden');
  addSnippetBtn.classList.remove('hidden');
  resetForm();
  loadSnippets();
});

// ===== Auth & License Management =====
// 서버 URL
const SYNC_SERVER_URL = 'https://api.handsub.com';
const WP_SITE_URL = 'https://handsub.com';

// Auth UI 요소 (로그인 기반)
const loginState = document.getElementById('loginState');
const loggedInState = document.getElementById('loggedInState');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const upgradeBtn = document.getElementById('upgradeBtn');
const tierBadge = document.getElementById('tierBadge');
const tierText = document.getElementById('tierText');

// 프로필 UI 요소
const userProfile = document.getElementById('userProfile');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');

// 기본 아바타 (Gravatar default)
const DEFAULT_AVATAR = 'https://www.gravatar.com/avatar/?d=mp&s=96';

// 현재 인증 상태
let currentUser = null;
let currentAuthState = null;
let lastProfileRefreshTime = 0;
const PROFILE_REFRESH_THROTTLE = 5 * 60 * 1000;  // 5분

// ===== Auth Functions (로그인 기반) =====

// 모든 상태 숨기기
function hideAllAuthStates() {
  loginState?.classList.add('hidden');
  loggedInState?.classList.add('hidden');
}

// 기능 탭 잠금 (로그인 필요)
function lockFeatureTabs() {
  isFeatureTabsLocked = true;

  // 사이드바 자물쇠 아이콘 표시
  snippetsLock?.classList.remove('hidden');
  toolsLock?.classList.remove('hidden');

  // 탭에 locked 클래스 추가
  document.querySelector('[data-section="snippets"]')?.classList.add('locked');
  document.querySelector('[data-section="tools"]')?.classList.add('locked');

  // 오버레이 표시
  snippetsOverlay?.classList.remove('hidden');
  toolsOverlay?.classList.remove('hidden');
}

// 기능 탭 잠금 해제 (로그인됨)
function unlockFeatureTabs() {
  isFeatureTabsLocked = false;

  // 사이드바 자물쇠 아이콘 숨김
  snippetsLock?.classList.add('hidden');
  toolsLock?.classList.add('hidden');

  // 탭에서 locked 클래스 제거
  document.querySelector('[data-section="snippets"]')?.classList.remove('locked');
  document.querySelector('[data-section="tools"]')?.classList.remove('locked');

  // 오버레이 숨김
  snippetsOverlay?.classList.add('hidden');
  toolsOverlay?.classList.add('hidden');
}

// 클라우드 동기화 잠금 (Pro 필요)
function lockCloudSync() {
  cloudSyncOption?.classList.add('locked');
  cloudSyncProTag?.classList.remove('hidden');
  cloudSyncLock?.classList.remove('hidden');
  cloudSyncToggleWrapper?.classList.add('locked');
  if (cloudSyncCheckbox) {
    cloudSyncCheckbox.checked = false;
    cloudSyncCheckbox.disabled = true;
  }
}

// 클라우드 동기화 잠금 해제 (Pro 사용자)
function unlockCloudSync() {
  cloudSyncOption?.classList.remove('locked');
  cloudSyncProTag?.classList.add('hidden');
  cloudSyncLock?.classList.add('hidden');
  cloudSyncToggleWrapper?.classList.remove('locked');
  if (cloudSyncCheckbox) {
    cloudSyncCheckbox.disabled = false;
    // 저장된 값 복원
    const savedValue = cloudSyncCheckbox.dataset.savedValue;
    if (savedValue !== undefined) {
      cloudSyncCheckbox.checked = savedValue === 'true';
    }
  }
}

// 로그인 전 상태 표시
function showLoginState() {
  if (currentAuthState === 'login') return;

  hideAllAuthStates();
  loginState?.classList.remove('hidden');
  currentAuthState = 'login';

  // 클라우드 동기화 잠금 (로그인 안 됨)
  lockCloudSync();

  // 기능 탭 잠금 (로그인 필요)
  lockFeatureTabs();
}

// 로그인됨 상태 표시
function showLoggedInState(user) {
  if (!user) return;

  hideAllAuthStates();
  loggedInState?.classList.remove('hidden');

  // 프로필 정보 표시
  if (userAvatar) {
    userAvatar.src = user.avatarUrl || DEFAULT_AVATAR;
    userAvatar.onerror = () => { userAvatar.src = DEFAULT_AVATAR; };
  }
  if (userName) userName.textContent = user.name || '사용자';
  if (userEmail) userEmail.textContent = user.email || '-';

  // 티어 배지 표시
  const tier = user.tier || 'free';
  if (tierBadge) {
    tierBadge.className = 'tier-badge ' + tier;
  }
  if (tierText) {
    tierText.textContent = tier === 'lifetime' ? 'LIFETIME' : tier.toUpperCase();
  }

  // 무료 사용자에게 업그레이드 버튼 표시
  if (upgradeBtn) {
    if (tier === 'free') {
      upgradeBtn.classList.remove('hidden');
    } else {
      upgradeBtn.classList.add('hidden');
    }
  }

  // 클라우드 동기화 Pro 잠금 처리
  if (tier === 'pro' || tier === 'lifetime') {
    unlockCloudSync();
  } else {
    lockCloudSync();
  }

  // 기능 탭 잠금 해제 (로그인됨)
  unlockFeatureTabs();

  currentAuthState = 'logged_in';
  currentUser = user;
}

// 인증 초기화
async function initAuth() {
  try {
    // 먼저 로컬 저장된 사용자 정보 표시 (빠른 UI 반응)
    const user = await window.settingsApi.authGetUser();
    if (user) {
      showLoggedInState(user);

      // 백그라운드에서 서버에서 최신 프로필 가져오기 (티어 업데이트 반영)
      refreshUserProfile();
      return;
    }

    // 로그인 정보 없으면 로그인 화면 표시
    showLoginState();
  } catch (e) {
    console.error('[Auth] Init error:', e);
    showLoginState();
  }
}

// 서버에서 최신 프로필 가져오기 (구매 후 티어 반영)
// 쓰로틀링: 마지막 갱신 후 5분 이내면 스킵
async function refreshUserProfile(force = false) {
  const now = Date.now();
  const timeSinceLastRefresh = now - lastProfileRefreshTime;

  if (!force && timeSinceLastRefresh < PROFILE_REFRESH_THROTTLE) {
    console.log(`[Auth] Profile refresh skipped (${Math.round(timeSinceLastRefresh / 1000)}s ago)`);
    return;
  }

  try {
    const result = await window.settingsApi.authRefresh();
    if (result?.success && result?.user) {
      lastProfileRefreshTime = now;
      console.log('[Auth] Profile refreshed:', result.user.email, '| tier:', result.user.tier);
      showLoggedInState(result.user);
    }
  } catch (e) {
    console.log('[Auth] Profile refresh failed (using cached):', e.message);
    // 실패해도 기존 정보 유지
  }
}

// 로그인 버튼 클릭
loginBtn?.addEventListener('click', async () => {
  loginBtn.disabled = true;
  loginBtn.textContent = '브라우저에서 로그인 중...';

  try {
    await window.settingsApi.authLogin();
  } catch (e) {
    console.error('[Auth] Login error:', e);
    loginBtn.disabled = false;
    loginBtn.textContent = '로그인하기';
  }
});

// 로그아웃 버튼 클릭
logoutBtn?.addEventListener('click', async () => {
  // 프로 사용자인지 확인
  const isPro = currentUser?.tier === 'pro' || currentUser?.tier === 'lifetime';

  if (isPro) {
    // 프로 사용자: 클라우드 메모 다이얼로그 표시
    const memos = await window.settingsApi.getAll?.() || [];
    const cloudMemoCount = memos.filter(m => m.is_cloud).length;

    if (cloudMemoCount > 0) {
      const result = await showCloudLogoutDialog(cloudMemoCount);
      if (result.action === 'cancel') return;

      logoutBtn.disabled = true;
      logoutBtn.textContent = '로그아웃 중...';

      try {
        await window.settingsApi.authLogout({ keepLocal: result.keepLocal });
        currentUser = null;
        showLoginState();
      } catch (e) {
        console.error('[Auth] Logout error:', e);
      } finally {
        logoutBtn.disabled = false;
        logoutBtn.textContent = '로그아웃';
      }
      return;
    }
  }

  // 일반 사용자 또는 클라우드 메모 없음: 기존 확인 모달
  const confirmed = await showConfirmModal('로그아웃하시겠습니까?');
  if (!confirmed) return;

  logoutBtn.disabled = true;
  logoutBtn.textContent = '로그아웃 중...';

  try {
    await window.settingsApi.authLogout({ keepLocal: true });
    currentUser = null;
    showLoginState();
  } catch (e) {
    console.error('[Auth] Logout error:', e);
  } finally {
    logoutBtn.disabled = false;
    logoutBtn.textContent = '로그아웃';
  }
});

// 업그레이드 버튼 클릭
upgradeBtn?.addEventListener('click', () => {
  window.settingsApi.openExternal(`${WP_SITE_URL}/pricing`);
});

// Auth 이벤트 리스너
window.settingsApi.onAuthSuccess?.((data) => {
  console.log('[Auth] Login successful');
  loginBtn.disabled = false;
  loginBtn.textContent = '로그인하기';
  showLoggedInState(data.user);
});

window.settingsApi.onAuthError?.((data) => {
  console.error('[Auth] Login error:', data);
  loginBtn.disabled = false;
  loginBtn.textContent = '로그인하기';
  alert(data.message || '로그인에 실패했습니다.');
});

window.settingsApi.onAuthLogout?.(() => {
  console.log('[Auth] Logged out');
  currentUser = null;
  showLoginState();
});

// 티어 실시간 업데이트 (WebSocket으로 구매 완료 시 즉시 반영)
window.settingsApi.onTierUpdated?.((data) => {
  console.log('[Auth] Tier updated via WebSocket:', data.tier);

  if (currentUser) {
    currentUser.tier = data.tier;
    currentUser.tierExpiresAt = data.expiresAt;
    showLoggedInState(currentUser);
  }
});

// 오버레이 로그인 버튼 이벤트
snippetsLoginBtn?.addEventListener('click', async () => {
  try {
    await window.settingsApi.authLogin();
  } catch (e) {
    console.error('[Auth] Login error:', e);
  }
});

toolsLoginBtn?.addEventListener('click', async () => {
  try {
    await window.settingsApi.authLogin();
  } catch (e) {
    console.error('[Auth] Login error:', e);
  }
});

// Auth 초기화
initAuth();

// ===== Update Check =====
const checkUpdateBtn = document.getElementById('checkUpdateBtn');
const updateAvailable = document.getElementById('updateAvailable');
const updateDownloading = document.getElementById('updateDownloading');
const updateReady = document.getElementById('updateReady');
const latestVersionText = document.getElementById('latestVersionText');
const downloadUpdateBtn = document.getElementById('downloadUpdateBtn');
const downloadPercent = document.getElementById('downloadPercent');
const progressFill = document.getElementById('progressFill');
const restartBtn = document.getElementById('restartBtn');

let latestVersion = null;

// 앱 시작 시 자동 업데이트 확인
(async () => {
  try {
    const result = await window.settingsApi.checkUpdate();
    // 업데이트가 있고, 버전 정보가 유효할 때만 표시
    if (result?.hasUpdate && result?.latestVersion) {
      latestVersion = result.latestVersion;
      latestVersionText.textContent = `v${result.latestVersion}`;
      checkUpdateBtn.classList.remove('hidden');
    }
  } catch (e) {
    // 업데이트 확인 실패 - 버튼 숨김 유지
    console.log('Update check failed:', e);
  }
})();

// 업데이트 버튼 클릭 - 업데이트 패널 표시
checkUpdateBtn?.addEventListener('click', () => {
  if (latestVersion) {
    updateAvailable.classList.remove('hidden');
    checkUpdateBtn.classList.add('hidden');
  }
});

// 업데이트 다운로드 버튼
downloadUpdateBtn?.addEventListener('click', async () => {
  updateAvailable.classList.add('hidden');
  updateDownloading.classList.remove('hidden');

  const result = await window.settingsApi.downloadUpdate();
  if (!result.success) {
    updateDownloading.classList.add('hidden');
    updateAvailable.classList.remove('hidden');
    alert('다운로드 실패: ' + (result.error || '알 수 없는 오류'));
  }
});

// 재시작 버튼
restartBtn?.addEventListener('click', () => {
  window.settingsApi.installUpdate();
});

// 다운로드 진행률 업데이트
window.settingsApi.onUpdateProgress?.((data) => {
  const percent = Math.round(data.percent);
  downloadPercent.textContent = `${percent}%`;
  progressFill.style.width = `${percent}%`;
});

// 다운로드 완료
window.settingsApi.onUpdateDownloaded?.(() => {
  updateDownloading.classList.add('hidden');
  updateReady.classList.remove('hidden');
});

// 업데이트 오류
window.settingsApi.onUpdateError?.((error) => {
  updateDownloading.classList.add('hidden');
  updateAvailable.classList.remove('hidden');
  console.error('Update error:', error);
});

// ===== Tools List Page =====
// 도구 추가 버튼 클릭 - 도구 목록 페이지로 전환
openToolsListBtn.addEventListener('click', async () => {
  toolsMainPage.classList.add('hidden');
  toolsListPage.classList.remove('hidden');
  await loadAvailableTools();
});

// 뒤로 버튼 클릭 - 메인 페이지로 복귀
backFromTools.addEventListener('click', () => {
  toolsListPage.classList.add('hidden');
  toolsMainPage.classList.remove('hidden');
});

// 도구 연결 상태 저장
let toolConnections = {};

// 사용 가능한 도구 목록 로드
async function loadAvailableTools() {
  const tools = await window.settingsApi.getTools();
  const manifestTools = await window.settingsApi.getManifestTools();

  // 로컬 연결 상태 가져오기
  toolConnections = await window.settingsApi.getToolConnections();

  renderToolsList(tools, manifestTools);
}

// 도구 목록 렌더링
function renderToolsList(tools, manifestTools = []) {
  availableToolsList.innerHTML = '';

  // 매니페스트 도구 먼저 표시
  if (manifestTools.length > 0) {
    const manifestHeader = document.createElement('div');
    manifestHeader.className = 'tools-section-header';
    manifestHeader.textContent = '사용자 정의 도구';
    availableToolsList.appendChild(manifestHeader);

    manifestTools.forEach(tool => {
      const item = document.createElement('div');
      item.className = 'tool-item manifest-tool';
      item.dataset.toolId = tool.id;

      item.innerHTML = `
        <div class="tool-icon">${tool.icon || '🔧'}</div>
        <div class="tool-info">
          <div class="tool-name">${escapeHtml(tool.name)}</div>
          <div class="tool-desc">${tool.commands.map(c => '/' + c.shortcut).join(', ')}</div>
        </div>
        <button class="tool-settings-btn" data-tool-id="${tool.id}">설정</button>
      `;

      // 설정 버튼 클릭
      item.querySelector('.tool-settings-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openManifestToolSettings(tool);
      });

      availableToolsList.appendChild(item);
    });
  }

  // 기존 도구
  if (tools.length > 0) {
    if (manifestTools.length > 0) {
      const codeHeader = document.createElement('div');
      codeHeader.className = 'tools-section-header';
      codeHeader.textContent = '기본 도구';
      availableToolsList.appendChild(codeHeader);
    }

    tools.forEach(tool => {
      const isConnected = !tool.requiresAuth || toolConnections[tool.id]?.connected;
      const item = document.createElement('div');
      item.className = 'tool-item';
      item.dataset.toolId = tool.id;

      const iconHtml = tool.iconPath
        ? `<img src="file://${tool.iconPath}" alt="${tool.name}">`
        : tool.name.charAt(0).toUpperCase();

      const connectionHtml = tool.requiresAuth
        ? `<button class="tool-connect-btn ${isConnected ? 'connected' : ''}" data-tool-id="${tool.id}">
             ${isConnected ? '연결됨' : '연결'}
           </button>`
        : '<span class="tool-status connected">연결됨</span>';

      item.innerHTML = `
        <div class="tool-icon">${iconHtml}</div>
        <div class="tool-info">
          <div class="tool-name">${escapeHtml(tool.name)}</div>
          <div class="tool-desc">${escapeHtml(tool.description || '')}</div>
        </div>
        ${connectionHtml}
      `;

      // 연결된 도구만 클릭 가능
      if (isConnected) {
        item.addEventListener('click', (e) => {
          if (!e.target.classList.contains('tool-connect-btn')) {
            selectTool(tool);
          }
        });
      }

      // 연결 버튼 이벤트
      const connectBtn = item.querySelector('.tool-connect-btn');
      if (connectBtn) {
        connectBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleToolConnection(tool, isConnected);
        });
      }

      availableToolsList.appendChild(item);
    });
  }

  if (tools.length === 0 && manifestTools.length === 0) {
    availableToolsList.innerHTML = '<div class="empty-text">사용 가능한 도구가 없습니다</div>';
  }
}

// 매니페스트 도구 설정 열기
async function openManifestToolSettings(tool) {
  const settings = await window.settingsApi.getManifestToolSettings(tool.id);

  // 간단한 프롬프트로 URL 입력
  const urlLabel = tool.settings.find(s => s.name === 'url')?.label || 'URL';
  const currentUrl = settings.url || '';

  const newUrl = prompt(`${tool.name} ${urlLabel}:`, currentUrl);
  if (newUrl !== null) {
    await window.settingsApi.saveManifestToolSettings(tool.id, { ...settings, url: newUrl });
    alert('저장되었습니다!');
  }
}

// 도구 연결/해제 처리
async function handleToolConnection(tool, isCurrentlyConnected) {
  if (isCurrentlyConnected) {
    // 연결 해제
    if (confirm(`${tool.name} 연결을 해제하시겠습니까?`)) {
      await window.settingsApi.disconnectTool(tool.id);
      await loadAvailableTools();
    }
  } else {
    // 연결 - auth 타입에 따라 처리
    if (tool.authType === 'apiKey') {
      // API Key 입력
      const apiKey = prompt(`${tool.name} API Key를 입력하세요:`);
      if (apiKey) {
        await window.settingsApi.connectTool(tool.id, { apiKey });
        await loadAvailableTools();
      }
    } else {
      // 인증 불필요 - 로컬 저장
      await window.settingsApi.connectTool(tool.id, {});
      await loadAvailableTools();
    }
  }
}

// 도구 선택 시 단축어 폼으로 이동
function selectTool(tool) {
  // 도구 목록 페이지 닫기
  toolsListPage.classList.add('hidden');
  toolsMainPage.classList.remove('hidden');

  // 단축어 섹션으로 이동
  navItems.forEach(nav => nav.classList.remove('active'));
  document.querySelector('[data-section="snippets"]').classList.add('active');
  sections.forEach(section => section.classList.remove('active'));
  document.getElementById('section-snippets').classList.add('active');

  // 단축어 폼 열기
  snippetEditId.value = '';
  snippetShortcut.value = '';
  snippetForm.classList.remove('hidden');
  addSnippetBtn.classList.add('hidden');

  // 해당 도구 선택 및 폼 생성
  selectToolOption(tool);
}
