const autoLaunchCheckbox = document.getElementById('autoLaunch');
const notificationCheckbox = document.getElementById('notificationEnabled');
const cloudSyncCheckbox = document.getElementById('cloudSyncEnabled');
const closeBtn = document.getElementById('closeBtn');
const shortcutInput = document.getElementById('shortcutInput');
const newMemoShortcutInput = document.getElementById('newMemoShortcutInput');
const triggerKeyInput = document.getElementById('triggerKeyInput');
const executeKeyInput = document.getElementById('executeKeyInput');
const versionText = document.getElementById('versionText');
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.section');

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

  // 클라우드 동기화 설정 로드
  const cloudSyncEnabled = await window.settingsApi.getCloudSyncEnabled();
  cloudSyncCheckbox.checked = cloudSyncEnabled || false;

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
    }

    dynamicFields.appendChild(row);
  });
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

// ===== License Management =====
// 서버 URL
const SYNC_SERVER_URL = 'https://api.handsub.com';

// 라이센스 UI 요소
const licenseInputState = document.getElementById('licenseInputState');
const licenseActiveState = document.getElementById('licenseActiveState');
const licenseExpiredState = document.getElementById('licenseExpiredState');
const licenseKeyInput = document.getElementById('licenseKeyInput');
const activateLicenseBtn = document.getElementById('activateLicenseBtn');
const licenseError = document.getElementById('licenseError');
const deactivateLicenseBtn = document.getElementById('deactivateLicenseBtn');
const licenseTypeText = document.getElementById('licenseTypeText');
const licenseExpiry = document.getElementById('licenseExpiry');
const licenseDevices = document.getElementById('licenseDevices');
const expiryRow = document.getElementById('expiryRow');
const renewLicenseBtn = document.getElementById('renewLicenseBtn');
const enterNewLicenseBtn = document.getElementById('enterNewLicenseBtn');
const expiredDate = document.getElementById('expiredDate');

// 프로필 UI 요소
const userProfile = document.getElementById('userProfile');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');

// 기본 아바타 (Gravatar default)
const DEFAULT_AVATAR = 'https://www.gravatar.com/avatar/?d=mp&s=96';

// 현재 라이센스 정보
let currentLicense = null;
let currentLicenseState = null; // 현재 UI 상태 추적 (재렌더링 방지)

// 에러 표시
function showLicenseError(msg) {
  licenseError.textContent = msg;
  licenseError.classList.remove('hidden');
}

function hideLicenseError() {
  licenseError.classList.add('hidden');
}

// 로딩 상태 표시
function showLicenseLoadingState() {
  // 기존 상태 숨기기
  licenseInputState.classList.add('hidden');
  licenseActiveState.classList.add('hidden');
  licenseExpiredState.classList.add('hidden');
  hideLicenseError();

  // 로딩 표시 (activeState 재활용, 로딩 텍스트로)
  licenseActiveState.classList.remove('hidden');
  userProfile.classList.remove('hidden');
  userAvatar.src = DEFAULT_AVATAR;
  userName.textContent = '확인 중...';
  userEmail.textContent = '';
  licenseTypeText.textContent = '-';
  licenseDevices.textContent = '-';
  expiryRow.classList.add('hidden');

  currentLicenseState = 'loading';
}

// 라이센스 상태별 UI 표시
function showLicenseInputState() {
  // 이미 같은 상태면 스킵 (깜빡임 방지)
  if (currentLicenseState === 'input') return;

  licenseInputState.classList.remove('hidden');
  licenseActiveState.classList.add('hidden');
  licenseExpiredState.classList.add('hidden');
  licenseKeyInput.value = '';
  hideLicenseError();

  currentLicenseState = 'input';
}

function showLicenseActiveState(license, forceUpdate = false) {
  // 이미 같은 상태 + 같은 라이센스면 스킵 (깜빡임 방지)
  const licenseKey = license?.licenseKey || license?.email;
  if (!forceUpdate && currentLicenseState === 'active' && currentLicense?.licenseKey === licenseKey) {
    return;
  }

  licenseInputState.classList.add('hidden');
  licenseActiveState.classList.remove('hidden');
  licenseExpiredState.classList.add('hidden');

  // 프로필 표시
  if (license.user) {
    userAvatar.src = license.user.avatarUrl || DEFAULT_AVATAR;
    userAvatar.onerror = () => { userAvatar.src = DEFAULT_AVATAR; };
    userName.textContent = license.user.name || '사용자';
    userEmail.textContent = license.user.email || license.email || '-';
    userProfile.classList.remove('hidden');
  } else {
    // user 객체가 없으면 기본 정보로 표시
    userAvatar.src = DEFAULT_AVATAR;
    userName.textContent = '사용자';
    userEmail.textContent = license.email || '-';
    userProfile.classList.remove('hidden');
  }

  // 라이센스 배지 표시
  licenseTypeText.textContent = license.type === 'lifetime' ? '라이프타임' : '구독';

  // 만료일 표시 (yearly만)
  if (license.type === 'yearly' && license.expiresAt) {
    const expDate = new Date(license.expiresAt);
    licenseExpiry.textContent = expDate.toLocaleDateString('ko-KR');
    expiryRow.classList.remove('hidden');
  } else {
    expiryRow.classList.add('hidden');
  }

  // 기기 수
  licenseDevices.textContent = `${license.deviceCount || 1} / ${license.maxDevices || (license.type === 'lifetime' ? 2 : 3)}`;

  currentLicenseState = 'active';
}

function showLicenseExpiredState(license) {
  // 이미 같은 상태면 스킵
  if (currentLicenseState === 'expired') return;

  licenseInputState.classList.add('hidden');
  licenseActiveState.classList.add('hidden');
  licenseExpiredState.classList.remove('hidden');

  if (license?.expiresAt) {
    const expDate = new Date(license.expiresAt);
    expiredDate.textContent = `만료일: ${expDate.toLocaleDateString('ko-KR')}`;
  }

  currentLicenseState = 'expired';
}

// 라이센스 초기화
async function initLicense() {
  try {
    // 저장된 라이센스 정보 불러오기
    const saved = await window.settingsApi.getLicense();

    if (!saved?.licenseKey) {
      showLicenseInputState();
      return;
    }

    currentLicense = saved;
    let cacheValid = false;

    // 캐시가 있으면 먼저 즉시 UI 표시 (깜빡임 방지)
    if (saved.cachedVerification) {
      const cachedTime = new Date(saved.cachedVerification.verifiedAt);
      const now = new Date();
      const daysSinceVerification = (now - cachedTime) / (1000 * 60 * 60 * 24);

      if (daysSinceVerification <= 7) {
        currentLicense = {
          ...saved,
          ...saved.cachedVerification,
          user: saved.cachedVerification.user || saved.user || null,
          fromCache: true
        };
        showLicenseActiveState(currentLicense);
        cacheValid = true;
      }
    }

    // 캐시 없으면 로딩 상태 표시
    if (!cacheValid) {
      showLicenseLoadingState();
    }

    // 서버 검증 (캐시 있으면 백그라운드, 없으면 포그라운드)
    const deviceFingerprint = await window.settingsApi.getMachineId();
    const result = await verifyLicenseOnServer(saved.licenseKey, deviceFingerprint);

    if (result.valid) {
      // 검증 결과 캐시 (user 객체 포함)
      await window.settingsApi.cacheLicenseVerification({
        ...result,
        user: result.user || null,
        verifiedAt: new Date().toISOString()
      });

      currentLicense = {
        ...saved,
        ...result,
        user: result.user || saved.user || null,
        fromCache: false
      };

      // 캐시가 없었거나 정보가 변경된 경우만 UI 업데이트
      if (!cacheValid) {
        showLicenseActiveState(currentLicense, true);
      }
    } else if (result.error === 'expired') {
      showLicenseExpiredState(saved);
    } else if (result.error === 'network_error') {
      // 네트워크 오류 시
      if (cacheValid) {
        // 캐시 유지 (이미 표시됨)
        console.log('[License] Using cached verification (offline)');
      } else {
        // 캐시도 없으면 입력 화면
        showLicenseInputState();
      }
    } else {
      // 기타 오류 (invalid_key 등)
      if (!cacheValid) {
        showLicenseInputState();
      }
    }
  } catch (e) {
    console.error('License init error:', e);
    // 오프라인인 경우 - 캐시가 이미 표시되어 있으면 유지
    if (currentLicenseState === 'active') {
      return;
    }

    const saved = await window.settingsApi.getLicense();
    if (saved?.cachedVerification) {
      const cachedTime = new Date(saved.cachedVerification.verifiedAt);
      const now = new Date();
      const daysSinceVerification = (now - cachedTime) / (1000 * 60 * 60 * 24);

      if (daysSinceVerification <= 7) {
        currentLicense = {
          ...saved,
          ...saved.cachedVerification,
          fromCache: true
        };
        showLicenseActiveState(currentLicense);
        return;
      }
    }
    showLicenseInputState();
  }
}

// 서버에서 라이센스 검증
async function verifyLicenseOnServer(licenseKey, deviceFingerprint) {
  try {
    const res = await fetch(`${SYNC_SERVER_URL}/api/license/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, deviceFingerprint })
    });
    const result = await res.json();

    // 필드명 호환성 처리 (서버: licenseType/customerEmail → 클라이언트: type/email)
    if (result.valid) {
      result.type = result.licenseType || result.type;
      result.email = result.customerEmail || result.email;
    }

    return result;
  } catch (e) {
    console.error('License verification error:', e);
    return { valid: false, error: 'network_error' };
  }
}

// 라이센스 활성화 버튼
activateLicenseBtn?.addEventListener('click', async () => {
  const key = licenseKeyInput.value.trim().toUpperCase();

  // 라이센스 키 형식 검증 (XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX)
  const keyRegex = /^[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$/;
  if (!keyRegex.test(key)) {
    showLicenseError('올바른 라이센스 키 형식이 아닙니다');
    return;
  }

  hideLicenseError();
  activateLicenseBtn.disabled = true;
  activateLicenseBtn.textContent = '확인 중...';

  try {
    const deviceFingerprint = await window.settingsApi.getMachineId();
    const result = await verifyLicenseOnServer(key, deviceFingerprint);

    if (result.valid) {
      // 라이센스 저장 (user 객체 포함)
      const licenseData = {
        licenseKey: key,
        type: result.type,
        email: result.email,
        expiresAt: result.expiresAt,
        maxDevices: result.maxDevices,
        deviceCount: result.deviceCount,
        user: result.user || null,
        cachedVerification: {
          ...result,
          verifiedAt: new Date().toISOString()
        }
      };

      await window.settingsApi.setLicense(licenseData);
      currentLicense = { ...licenseData, fromCache: false };
      showLicenseActiveState(currentLicense);
    } else {
      let errorMsg = '라이센스 검증에 실패했습니다';
      if (result.error === 'invalid_key') {
        errorMsg = '유효하지 않은 라이센스 키입니다';
      } else if (result.error === 'expired') {
        errorMsg = '라이센스가 만료되었습니다';
      } else if (result.error === 'cancelled') {
        errorMsg = '취소된 라이센스입니다';
      } else if (result.error === 'device_limit') {
        errorMsg = `기기 제한에 도달했습니다 (최대 ${result.maxDevices}대)`;
      }
      showLicenseError(errorMsg);
    }
  } catch (e) {
    showLicenseError('서버 연결에 실패했습니다');
  } finally {
    activateLicenseBtn.disabled = false;
    activateLicenseBtn.textContent = '라이센스 활성화';
  }
});

// 라이센스 비활성화 버튼
deactivateLicenseBtn?.addEventListener('click', async () => {
  if (!confirm('이 기기에서 라이센스를 비활성화하시겠습니까?\n\n다른 기기에서 이 라이센스를 사용할 수 있게 됩니다.')) {
    return;
  }

  let serverSuccess = false;

  try {
    // 서버에서 기기 등록 해제
    if (currentLicense?.licenseKey) {
      const deviceFingerprint = await window.settingsApi.getMachineId();
      const response = await fetch(`${SYNC_SERVER_URL}/api/license/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: currentLicense.licenseKey,
          deviceFingerprint
        })
      });

      const result = await response.json();
      serverSuccess = result.success;
      console.log('[License] Deactivation result:', result);
    }
  } catch (e) {
    console.error('[License] Deactivation server error:', e);
    // 서버 오류여도 로컬은 삭제 진행 (오프라인 등)
  }

  // 로컬 라이센스 정보 삭제
  await window.settingsApi.setLicense(null);
  currentLicense = null;
  showLicenseInputState();

  // 사용자 피드백
  if (serverSuccess) {
    console.log('[License] Device deactivated successfully');
  }
});

// 갱신하기 버튼 (만료 상태에서)
renewLicenseBtn?.addEventListener('click', () => {
  // 구매 페이지로 이동
  window.settingsApi.openExternal('https://handsub.app/renew');
});

// 다른 라이센스 입력 버튼 (만료 상태에서)
enterNewLicenseBtn?.addEventListener('click', async () => {
  await window.settingsApi.setLicense(null);
  currentLicense = null;
  showLicenseInputState();
});

// 라이센스 초기화 실행
initLicense();

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
