/**
 * sidebar.js - 사이드바 기능
 */

import { elements, memoState, sidebarState } from './state.js';
import { getPlainTextFromHtml, setEditorContent, getEditorContent } from './editor.js';
import { escapeHtml, isValidColor } from './security.js';
import { isPro } from './auth.js';

// 날짜 포맷 (순환 참조 방지를 위해 여기서 직접 구현)
function formatDate(time) {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours < 12 ? 'am' : 'pm';
  const hour12 = String(hours % 12 || 12).padStart(2, '0');
  return `${month}.${day} ${ampm}${hour12}:${minutes}`;
}

const { editor, sidebar, memoList, listBtn, sidebarResize, searchInput, linkPreviewsContainer, toolLog } = elements;

// 공유 팝업 관련 상태
let sharePopupMemo = null;
let sharePopupSessionId = null;  // 공유 팝업의 현재 세션 ID
let receivedMemoIds = [];  // 받은 메모 ID 목록 (하이라이트용)
let contactsCache = null;  // 연락처 캐시
let groupsCache = [];      // 그룹 캐시
let currentGroupFilter = 'all';  // 현재 선택된 그룹 필터
let editingGroup = null;   // 편집 중인 그룹
let currentShareTab = 'share';  // 현재 공유 탭
let currentShareToken = null;  // 현재 생성된 공유 토큰
let mySharesCache = [];  // 내 공유 목록 캐시
let membersCache = new Map();  // 멤버 목록 캐시 (memoUuid -> { members, canManage, sessionId })

// loadMemo는 순환 참조 방지를 위해 나중에 설정
let loadMemoFn = null;
export function setLoadMemoFn(fn) {
  loadMemoFn = fn;
}

// ===== 에디터 위치 업데이트 =====

export function updateEditorPosition() {
  const titlebarCenter = document.querySelector('.titlebar-center');

  if (sidebar.classList.contains('open')) {
    const left = (sidebarState.sidebarWidth + 20) + 'px';
    const toolLogLeft = (sidebarState.sidebarWidth + 12) + 'px';
    editor.style.left = left;
    linkPreviewsContainer.style.left = left;
    if (toolLog) toolLog.style.left = toolLogLeft;
    // 사이드바 너비에 따라 날짜도 에디터 영역 가운데로
    if (titlebarCenter) titlebarCenter.style.left = left;
  } else {
    editor.style.left = '20px';
    linkPreviewsContainer.style.left = '20px';
    if (toolLog) toolLog.style.left = '12px';
    if (titlebarCenter) titlebarCenter.style.left = '20px';
  }
}

// ===== 메뉴 관리 =====

export function closeAllMenus() {
  document.querySelectorAll('.memo-item-menu').forEach(m => m.remove());
  memoState.openMenuId = null;
}

function toggleMemoMenu(memo, _itemEl, btnEl) {
  if (memoState.openMenuId === memo.id) {
    closeAllMenus();
    return;
  }
  closeAllMenus();

  const menu = document.createElement('div');
  menu.className = 'memo-item-menu';

  const rect = btnEl.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = (rect.right + 4) + 'px';
  menu.style.top = (rect.top + rect.height / 2) + 'px';
  menu.style.transform = 'translateY(-50%)';

  // 고정 옵션
  const pinOption = document.createElement('div');
  pinOption.className = 'memo-item-menu-option';
  pinOption.textContent = memo.pinned ? '고정 해제' : '고정';
  pinOption.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.api.toggleMemoPin(memo.id);
    closeAllMenus();
    memoState.memos = await window.api.getAll();
    renderMemoList();
  });

  // 삭제 옵션
  const deleteOption = document.createElement('div');
  deleteOption.className = 'memo-item-menu-option delete';
  deleteOption.textContent = '삭제';
  deleteOption.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.api.delete(memo.id);
    closeAllMenus();
    memoState.memos = await window.api.getAll();
    if (memoState.currentMemo && memoState.currentMemo.id === memo.id) {
      memoState.currentMemo = null;
      memoState.currentIndex = -1;
      setEditorContent('');
    }
    renderMemoList();
  });

  menu.appendChild(pinOption);
  menu.appendChild(deleteOption);
  document.body.appendChild(menu);
  memoState.openMenuId = memo.id;
}

// ===== 메모 목록 렌더링 =====

export function renderMemoList() {
  const searchQuery = searchInput.value.toLowerCase().trim();
  memoList.innerHTML = '';
  memoState.filteredIndices = [];

  memoState.memos.forEach((memo, index) => {
    const plainText = getPlainTextFromHtml(memo.content);

    // 검색어 필터링
    if (searchQuery && !plainText.toLowerCase().includes(searchQuery)) {
      return;
    }

    memoState.filteredIndices.push(index);

    const item = document.createElement('div');
    let itemClass = 'memo-item';
    if (index === memoState.currentIndex) itemClass += ' active';
    if (memo.pinned) itemClass += ' pinned';
    if (memo.received_from && !memo.is_read) itemClass += ' received';
    if (memo.last_notified_at && !memo.is_read) itemClass += ' notified';
    item.className = itemClass;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'memo-item-content';

    // HTML에서 첫 줄만 추출
    const getFirstLine = (html, plain) => {
      if (!html) return '';
      // 1. HTML 태그 기준으로 첫 줄 추출 (<br>, <div> 전까지)
      const tagMatch = html.match(/^([^<]*?)(?:<br|<\/div|<div)/i);
      if (tagMatch && tagMatch[1].trim()) {
        const temp = document.createElement('div');
        temp.innerHTML = tagMatch[1];
        return (temp.textContent || '').trim();
      }
      // 2. \n 문자 기준으로 분리 (외부 붙여넣기 등)
      const lines = plain.split(/[\n\r]+/).filter(l => l.trim());
      return lines[0]?.trim() || '';
    };
    const firstLine = getFirstLine(memo.content, plainText);
    const preview = firstLine.substring(0, 30) || '(빈 메모)';
    const dateStr = formatDate(memo.updated_at);

    const previewDiv = document.createElement('div');
    previewDiv.className = 'memo-item-preview';

    const previewText = document.createTextNode((memo.pinned ? '* ' : '') + preview);
    previewDiv.appendChild(previewText);

    const dateDiv = document.createElement('div');
    dateDiv.className = 'memo-item-date';
    dateDiv.textContent = dateStr;

    contentDiv.appendChild(previewDiv);
    contentDiv.appendChild(dateDiv);

    // 설정 버튼
    const menuBtn = document.createElement('button');
    menuBtn.className = 'memo-item-menu-btn';
    menuBtn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><circle cx="4" cy="12" r="2"/><circle cx="20" cy="12" r="2"/></svg>';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMemoMenu(memo, item, menuBtn);
    });

    item.appendChild(contentDiv);
    item.appendChild(menuBtn);

    item.addEventListener('click', async () => {
      closeAllMenus();
      if (loadMemoFn) {
        await loadMemoFn(index);
        // 받은 메모 또는 알림 온 메모 읽음 처리
        if (!memo.is_read) {
          await window.api.markMemoRead(memo.id);
          memo.is_read = 1;
        }
        renderMemoList();
      }
    });

    memoList.appendChild(item);

    if (index === memoState.currentIndex) {
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

// ===== 사이드바 토글 =====

export async function toggleSidebar() {
  const isOpen = sidebar.classList.toggle('open');
  document.body.classList.toggle('sidebar-open', isOpen);
  listBtn.classList.toggle('active', isOpen);
  if (isOpen) {
    renderMemoList();
    sidebar.style.width = sidebarState.sidebarWidth + 'px';
    // 첫 번째 메모 자동 선택
    if (memoState.memos.length > 0 && !memoState.currentMemo && loadMemoFn) {
      await loadMemoFn(0);
      renderMemoList();
    }
  } else {
    sidebar.style.width = '';
  }
  updateEditorPosition();
}

// ===== 사이드바 리사이즈 =====

export function initSidebarResize() {
  sidebarResize.addEventListener('mousedown', (e) => {
    if (!sidebar.classList.contains('open')) return;
    sidebarState.isResizing = true;
    sidebar.classList.add('resizing');
    editor.style.transition = 'none';
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!sidebarState.isResizing) return;
    const newWidth = Math.min(Math.max(e.clientX, 100), 400);
    sidebar.style.width = newWidth + 'px';
    sidebarState.sidebarWidth = newWidth;
    updateEditorPosition();
  });

  document.addEventListener('mouseup', () => {
    if (!sidebarState.isResizing) return;
    sidebarState.isResizing = false;
    sidebar.classList.remove('resizing');
    editor.style.transition = '';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ===== 검색 이벤트 =====

export function initSearchEvents() {
  searchInput.addEventListener('input', () => {
    renderMemoList();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();

      // 현재 검색 결과 인덱스 캡처
      const targetIndex = memoState.filteredIndices.length > 0 ? memoState.filteredIndices[0] : -1;
      const targetMemo = targetIndex >= 0 ? memoState.memos[targetIndex] : null;

      // 검색창 즉시 초기화 (composition 텍스트 방지)
      searchInput.value = '';
      searchInput.blur();

      // 다음 프레임에서 처리
      requestAnimationFrame(async () => {
        if (targetMemo && loadMemoFn) {
          await loadMemoFn(targetIndex);

          // 받은 메모인 경우 읽음 처리
          if (targetMemo.received_from && !targetMemo.is_read) {
            await window.api.markMemoRead(targetMemo.id);
            targetMemo.is_read = 1;
          }

          renderMemoList();
        }

        editor.focus();
      });
    }
  });
}

// ===== 외부 클릭 시 메뉴 닫기 =====

export function initMenuCloseHandler() {
  document.addEventListener('click', (e) => {
    closeAllMenus();
    // 공유 팝업 외부 클릭 시 닫기
    const sharePopup = document.getElementById('share-popup');
    if (sharePopup && !sharePopup.contains(e.target) && !e.target.closest('.memo-item-share-btn')) {
      closeSharePopup();
    }
  });
}

// ===== 공유 팝업 기능 =====

const DEFAULT_AVATAR = 'https://www.gravatar.com/avatar/?d=mp&s=56';

function openSharePopup(memo, btnEl) {
  sharePopupMemo = memo;

  const popup = document.getElementById('share-popup');
  const emailInput = document.getElementById('share-email-input');
  const status = document.getElementById('share-status');
  const proLock = document.getElementById('share-pro-lock');

  // 알림 드롭다운 닫기 (팝업 중복 방지)
  const notificationDropdown = document.getElementById('notification-dropdown');
  if (notificationDropdown) notificationDropdown.classList.add('hidden');

  // 상단 우측 (타이틀바 아래)
  popup.style.right = '12px';
  popup.style.top = '45px';
  popup.style.left = 'auto';
  popup.style.bottom = 'auto';

  // 초기화
  emailInput.value = '';
  status.className = 'share-status hidden';
  status.textContent = '';

  // Pro 사용자가 아니면 자물쇠 오버레이 표시
  if (isPro()) {
    proLock.classList.add('hidden');
  } else {
    proLock.classList.remove('hidden');
  }

  popup.classList.remove('hidden');

  // 기본 탭을 '공유'로 설정하고 참여자 목록 렌더링
  switchMainTab('share');

  // Pro 사용자만 입력 필드에 포커스
  if (isPro()) {
    emailInput.focus();
  }
}

function closeSharePopup() {
  const popup = document.getElementById('share-popup');
  popup.classList.add('hidden');
  sharePopupMemo = null;
  sharePopupSessionId = null;
}

function toggleSharePopup(memo, btnEl) {
  const popup = document.getElementById('share-popup');
  if (popup.classList.contains('hidden')) {
    openSharePopup(memo, btnEl);
  } else {
    closeSharePopup();
  }
}

// 연락처 미리 로드 (라이센스 검증 후 호출)
export async function preloadContacts() {
  if (!window.userProfile) return;

  try {
    // 1. 로컬 DB 캐시 먼저 로드
    const localCache = await window.api.getContactsCache();
    if (localCache.length > 0) {
      contactsCache = localCache.map(c => ({
        email: c.email,
        name: c.name,
        avatarUrl: c.avatar_url,
        lastSentAt: c.last_sent_at,
        isFavorite: c.is_favorite === 1
      }));
    }

    // 2. 서버에서 최신 데이터 가져오기
    const serverContacts = await window.api.getMemoContacts();
    if (serverContacts.length > 0) {
      // 로컬 즐겨찾기 정보 유지하면서 병합
      const favoriteEmails = new Set(
        (contactsCache || []).filter(c => c.isFavorite).map(c => c.email)
      );

      contactsCache = serverContacts.map(c => ({
        ...c,
        isFavorite: favoriteEmails.has(c.email)
      }));

      // 3. 로컬 DB에 저장
      await window.api.upsertContactsCache(serverContacts);
    }
  } catch (e) {
    console.error('[Sidebar] Failed to preload contacts:', e);
  }
}

// 연락처 UI 렌더링
function renderContacts(contacts) {
  const contactsContainer = document.getElementById('share-contacts');

  if (!contacts || contacts.length === 0) {
    contactsContainer.textContent = '';
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'share-contacts-title';
    emptyDiv.textContent = '최근 전달 기록 없음';
    contactsContainer.appendChild(emptyDiv);
    return;
  }

  // 그룹 필터링
  let filtered = contacts;
  if (currentGroupFilter !== 'all') {
    filtered = contacts.filter(c => c.groups?.includes(currentGroupFilter));
  }

  if (filtered.length === 0) {
    contactsContainer.textContent = '';
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'share-contacts-title';
    emptyDiv.textContent = '그룹에 연락처 없음';
    contactsContainer.appendChild(emptyDiv);
    return;
  }

  // 즐겨찾기 먼저, 그 다음 최근 순
  const sorted = [...filtered].sort((a, b) => {
    if ((a.isFavorite ? 1 : 0) !== (b.isFavorite ? 1 : 0)) {
      return (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0);
    }
    return new Date(b.lastSentAt || 0) - new Date(a.lastSentAt || 0);
  });

  const titleText = currentGroupFilter === 'all' ? '최근 전달' :
    (groupsCache.find(g => g.id === currentGroupFilter)?.name || '그룹');
  contactsContainer.textContent = ''; // XSS 방지
  const titleDiv = document.createElement('div');
  titleDiv.className = 'share-contacts-title';
  titleDiv.textContent = titleText; // 자동 이스케이프
  contactsContainer.appendChild(titleDiv);

  sorted.forEach(contact => {
    const item = document.createElement('div');
    item.className = 'share-contact-item';

    const avatar = document.createElement('img');
    avatar.className = 'share-contact-avatar';
    avatar.src = contact.avatarUrl || DEFAULT_AVATAR;
    avatar.onerror = () => { avatar.src = DEFAULT_AVATAR; };

    const info = document.createElement('div');
    info.className = 'share-contact-info';

    const email = document.createElement('div');
    email.className = 'share-contact-email';
    email.textContent = contact.email;

    const time = document.createElement('div');
    time.className = 'share-contact-time';
    time.textContent = formatRelativeTime(contact.lastSentAt);

    // 그룹 배지
    if (contact.groups && contact.groups.length > 0 && currentGroupFilter === 'all') {
      const groupsDiv = document.createElement('div');
      groupsDiv.className = 'share-contact-groups';
      contact.groups.forEach(groupId => {
        const group = groupsCache.find(g => g.id === groupId);
        if (group) {
          const badge = document.createElement('span');
          badge.className = 'share-contact-group-badge';
          badge.style.background = group.color;
          badge.textContent = group.name;
          badge.addEventListener('click', (e) => {
            e.stopPropagation();
            // 클릭 시 해당 그룹으로 필터링
            currentGroupFilter = groupId;
            renderGroupTabs();
            renderContacts(contactsCache);
          });
          groupsDiv.appendChild(badge);
        }
      });
      info.appendChild(groupsDiv);
    }

    info.insertBefore(time, info.lastChild);
    info.insertBefore(email, time);

    // 그룹에 추가 버튼 (그룹이 있을 때만)
    if (groupsCache.length > 0) {
      const addGroupBtn = document.createElement('button');
      addGroupBtn.className = 'share-contact-add-group-btn';
      addGroupBtn.textContent = '+';
      addGroupBtn.title = '그룹에 추가';
      addGroupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showGroupSelector(contact.email, addGroupBtn);
      });
      item.appendChild(addGroupBtn);
    }

    // 즐겨찾기 버튼
    const favBtn = document.createElement('button');
    favBtn.className = 'share-contact-fav-btn' + (contact.isFavorite ? ' active' : '');
    favBtn.textContent = '★';
    favBtn.title = contact.isFavorite ? '즐겨찾기 해제' : '즐겨찾기';
    favBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newFav = await window.api.toggleContactFavorite(contact.email);
      contact.isFavorite = newFav;
      renderContacts(contactsCache); // 재렌더링
    });

    item.appendChild(avatar);
    item.appendChild(info);
    item.appendChild(favBtn);

    item.addEventListener('click', () => {
      document.getElementById('share-email-input').value = contact.email;
    });

    contactsContainer.appendChild(item);
  });
}

// 그룹 선택 드롭다운
function showGroupSelector(email, btnEl) {
  // 기존 선택자 제거
  document.querySelectorAll('.group-selector-dropdown').forEach(el => el.remove());

  const contact = contactsCache?.find(c => c.email === email);
  const contactGroups = contact?.groups || [];

  const dropdown = document.createElement('div');
  dropdown.className = 'group-selector-dropdown';
  dropdown.style.cssText = `
    position: fixed;
    background: var(--sidebar-bg);
    border: 1px solid var(--status-color);
    border-radius: 6px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    z-index: 2500;
    min-width: 120px;
    max-height: 150px;
    overflow-y: auto;
  `;

  const rect = btnEl.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  dropdown.style.top = (rect.bottom + 4) + 'px';

  groupsCache.forEach(group => {
    const isInGroup = contactGroups.includes(group.id);
    const item = document.createElement('div');
    item.style.cssText = `
      padding: 8px 12px;
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--memo-title-color);
    `;

    // XSS 방지 - DOM API 사용
    const colorDot = document.createElement('span');
    colorDot.style.cssText = 'width:10px;height:10px;border-radius:50%;';
    // 색상 검증
    colorDot.style.background = isValidColor(group.color) ? group.color : '#007AFF';

    const nameSpan = document.createElement('span');
    nameSpan.style.flex = '1';
    nameSpan.textContent = group.name; // 자동 이스케이프

    item.appendChild(colorDot);
    item.appendChild(nameSpan);

    if (isInGroup) {
      const checkSpan = document.createElement('span');
      checkSpan.style.color = '#34C759';
      checkSpan.textContent = '✓';
      item.appendChild(checkSpan);
    }

    item.addEventListener('mouseenter', () => {
      item.style.background = 'var(--hover-bg)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
    });
    item.addEventListener('click', async () => {
      if (isInGroup) {
        await removeContactFromGroup(email, group.id);
      } else {
        await addContactToGroup(email, group.id);
      }
      dropdown.remove();
    });
    dropdown.appendChild(item);
  });

  document.body.appendChild(dropdown);

  // 외부 클릭 시 닫기
  const closeHandler = (e) => {
    if (!dropdown.contains(e.target) && e.target !== btnEl) {
      dropdown.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

async function loadShareContacts() {
  const contactsContainer = document.getElementById('share-contacts');

  // 그룹 로드 (백그라운드)
  loadGroups().then(() => renderGroupTabs());

  // 1. 메모리 캐시가 있으면 즉시 표시
  if (contactsCache !== null && contactsCache.length > 0) {
    renderContacts(contactsCache);
  } else {
    // 2. 로컬 DB 캐시 확인
    try {
      const localCache = await window.api.getContactsCache();
      if (localCache.length > 0) {
        contactsCache = localCache.map(c => ({
          email: c.email,
          name: c.name,
          avatarUrl: c.avatar_url,
          lastSentAt: c.last_sent_at,
          isFavorite: c.is_favorite === 1,
          groups: []
        }));
        renderContacts(contactsCache);
      } else {
        // 캐시 없으면 빈 상태 표시 (로딩 메시지 대신)
        renderContacts([]);
      }
    } catch (e) {
      renderContacts([]);
    }
  }

  // 3. 백그라운드에서 서버 동기화
  try {
    const serverContacts = await window.api.getMemoContacts();

    // 즐겨찾기 정보 유지
    const favoriteEmails = new Set(
      (contactsCache || []).filter(c => c.isFavorite).map(c => c.email)
    );

    // 그룹 멤버 정보 병합 (병렬 로딩)
    const contactGroupMap = {};
    if (groupsCache.length > 0) {
      const groupMemberResults = await Promise.all(
        groupsCache.map(async (group) => {
          try {
            const members = await window.api.getContactsByGroup(group.id);
            return { groupId: group.id, members };
          } catch (e) {
            return { groupId: group.id, members: [] };
          }
        })
      );
      groupMemberResults.forEach(({ groupId, members }) => {
        members.forEach(email => {
          if (!contactGroupMap[email]) contactGroupMap[email] = [];
          contactGroupMap[email].push(groupId);
        });
      });
    }

    contactsCache = serverContacts.map(c => ({
      ...c,
      isFavorite: favoriteEmails.has(c.email),
      groups: contactGroupMap[c.email] || []
    }));

    renderContacts(contactsCache);

    if (serverContacts.length > 0) {
      await window.api.upsertContactsCache(serverContacts);
    }
  } catch (e) {
    // 오프라인 - 기존 캐시 유지
    console.log('[Contacts] Using cached data (offline)');
  }
}

function formatRelativeTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days < 7) return `${days}일 전`;
  return formatDate(dateStr);
}

async function sendMemoByEmail(email) {
  if (!sharePopupMemo) return;

  const status = document.getElementById('share-status');
  const sendBtn = document.getElementById('share-send-btn');

  sendBtn.disabled = true;
  status.className = 'share-status loading';
  status.textContent = '초대 중...';

  try {
    const token = await window.api.authGetToken();
    const syncServer = await window.api.getSyncServer();

    // 세션 ID가 없으면 먼저 생성
    if (!sharePopupSessionId) {
      const sessionRes = await fetch(`${syncServer}/api/v2/collab/session`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          memoUuid: sharePopupMemo.uuid,
          title: sharePopupMemo.content?.split('\n')[0]?.substring(0, 100) || 'Untitled'
        })
      });

      if (sessionRes.ok) {
        const sessionData = await sessionRes.json();
        sharePopupSessionId = sessionData.sessionId;
      } else {
        throw new Error('세션 생성 실패');
      }
    }

    // 협업 초대 API 호출
    const inviteRes = await fetch(`${syncServer}/api/v2/collab/invite`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId: sharePopupSessionId,
        inviteeEmail: email
      })
    });

    if (inviteRes.ok) {
      status.className = 'share-status success';
      status.textContent = '초대 완료!';

      // 참여자 목록 새로고침
      setTimeout(() => {
        renderMembersTab();
      }, 500);

      // 입력 필드 초기화
      const emailInput = document.getElementById('share-email-input');
      if (emailInput) emailInput.value = '';
    } else {
      const error = await inviteRes.json();
      status.className = 'share-status error';
      if (error.error === 'Only users with full permission can invite') {
        status.textContent = '초대 권한이 없습니다';
      } else if (error.error === 'Cannot invite yourself') {
        status.textContent = '자신은 초대할 수 없습니다';
      } else {
        status.textContent = error.message || error.error || '초대 실패';
      }
    }
  } catch (e) {
    console.error('[Share] Invite error:', e);
    status.className = 'share-status error';
    status.textContent = '초대 중 오류 발생';
  } finally {
    sendBtn.disabled = false;
  }
}

// ===== 공유 팝업 이벤트 초기화 =====

export function initSharePopupEvents() {
  // 전역 함수로 노출 (상태바에서 호출용 - 토글 방식)
  window.openSharePopupFromStatusbar = toggleSharePopup;

  const closeBtn = document.getElementById('share-popup-close');
  const sendBtn = document.getElementById('share-send-btn');
  const emailInput = document.getElementById('share-email-input');

  if (closeBtn) {
    closeBtn.addEventListener('click', closeSharePopup);
  }

  // Pro 잠금 오버레이 클릭 시 팝업 닫기 + 업그레이드 페이지 이동
  const proLock = document.getElementById('share-pro-lock');
  if (proLock) {
    proLock.addEventListener('click', () => {
      closeSharePopup();
      window.api.openExternal?.('https://handsub.com/pricing');
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const email = emailInput.value.trim();
      if (email && validateEmail(email)) {
        sendMemoByEmail(email);
      } else {
        const status = document.getElementById('share-status');
        status.className = 'share-status error';
        status.textContent = '올바른 이메일 주소를 입력하세요';
      }
    });
  }

  if (emailInput) {
    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendBtn.click();
      } else if (e.key === 'Escape') {
        closeSharePopup();
      }
    });
  }

  // 메인 탭 이벤트 (직접 전달 / 링크 공유)
  initMainTabEvents();

  // 링크 공유 이벤트 초기화
  initShareLinkEvents();

  // 그룹 이벤트 초기화
  initGroupEvents();
}

// ===== 메인 탭 이벤트 =====

function initMainTabEvents() {
  const mainTabs = document.querySelectorAll('.share-main-tab');

  mainTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchMainTab(tabName);
    });
  });
}

function switchMainTab(tabName) {
  currentShareTab = tabName;

  // 탭 버튼 active 상태 업데이트
  const mainTabs = document.querySelectorAll('.share-main-tab');
  mainTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  // 탭 콘텐츠 표시/숨김
  const shareTab = document.getElementById('share-tab-share');
  const publishTab = document.getElementById('share-tab-publish');

  shareTab.classList.add('hidden');
  publishTab.classList.add('hidden');

  if (tabName === 'share') {
    shareTab.classList.remove('hidden');
    renderMembersTab();  // 공유 탭에서 참여자 목록 렌더링
  } else if (tabName === 'publish') {
    publishTab.classList.remove('hidden');
    initLinkShareTab();
  }
}

// ===== 링크 공유 기능 =====

function initShareLinkEvents() {
  const createBtn = document.getElementById('share-link-create-btn');
  const copyBtn = document.getElementById('share-link-copy-btn');
  const updateBtn = document.getElementById('share-link-update-btn');
  const deleteBtn = document.getElementById('share-link-delete-btn');
  const viewBtn = document.getElementById('share-link-view-btn');

  if (createBtn) {
    createBtn.addEventListener('click', createShareLink);
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', copyShareLink);
  }

  if (updateBtn) {
    updateBtn.addEventListener('click', updateShareLink);
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', deleteShareLink);
  }

  if (viewBtn) {
    viewBtn.addEventListener('click', viewShareLink);
  }
}

function viewShareLink() {
  const linkUrl = document.getElementById('share-link-url')?.value;
  if (linkUrl) {
    window.api.openExternal(linkUrl);
  }
}

// ===== 참여자 탭 =====

async function renderMembersTab() {
  const listContainer = document.getElementById('share-members-list');
  if (!listContainer) return;

  // 메모가 없으면 빈 상태
  if (!sharePopupMemo?.uuid) {
    listContainer.innerHTML = '<div class="share-members-empty">메모를 선택해주세요</div>';
    sharePopupSessionId = null;
    return;
  }

  const memoUuid = sharePopupMemo.uuid;

  // 캐시된 데이터가 있으면 먼저 표시
  const cached = membersCache.get(memoUuid);
  if (cached) {
    sharePopupSessionId = cached.sessionId;
    renderMembersList(listContainer, cached.members, cached.canManage);
  } else {
    // 캐시가 없을 때만 스켈레톤 UI 표시
    listContainer.innerHTML = `
      <div class="share-member-skeleton">
        <div class="skeleton-avatar"></div>
        <div class="skeleton-info">
          <div class="skeleton-name"></div>
          <div class="skeleton-email"></div>
        </div>
      </div>
    `;
  }

  // DB에서 참여자 목록 가져오기
  const members = [];
  let canManage = false;  // 초대/제거 권한 (소유자 또는 full 권한)

  try {
    const token = await window.api.authGetToken();
    const syncServer = await window.api.getSyncServer();

    if (token) {
      // 세션 생성/조회 (이미 있으면 기존 세션 반환)
      const sessionRes = await fetch(`${syncServer}/api/v2/collab/session`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          memoUuid: sharePopupMemo.uuid,
          title: sharePopupMemo.content?.split('\n')[0]?.substring(0, 100) || 'Untitled'
        })
      });

      if (sessionRes.ok) {
        const sessionData = await sessionRes.json();
        sharePopupSessionId = sessionData.sessionId;
        canManage = sessionData.isOwner;  // 소유자면 관리 가능

        // 세션 상세 정보 (참여자 목록) 가져오기
        const detailRes = await fetch(`${syncServer}/api/v2/collab/session/${sharePopupSessionId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (detailRes.ok) {
          const detail = await detailRes.json();

          // 소유자 추가
          if (detail.owner) {
            const isMe = detail.owner.id === window.userProfile?.id;
            members.push({
              id: detail.owner.id,
              name: detail.owner.name || detail.owner.email?.split('@')[0] || '소유자',
              email: detail.owner.email || '',
              avatarUrl: detail.owner.avatarUrl || null,
              isMe,
              isHost: true,
              permission: 'full'
            });
          }

          // 참여자 추가
          detail.participants?.forEach(p => {
            // 소유자는 이미 추가됨
            if (p.userId === detail.owner?.id) return;

            const isMe = p.userId === window.userProfile?.id;
            const perm = p.permission || 'edit';

            // 내가 full 권한이면 관리 가능
            if (isMe && perm === 'full') {
              canManage = true;
            }

            members.push({
              id: p.userId,
              name: p.name || p.email?.split('@')[0] || '참여자',
              email: p.email || '',
              avatarUrl: p.avatarUrl || null,
              isMe,
              isHost: false,
              permission: perm
            });
          });
        }
      }
    }
  } catch (e) {
    console.error('[Share] Failed to fetch participants:', e);
  }

  // 로그인 안 했거나 API 실패 시 나만 표시
  if (members.length === 0 && window.userProfile) {
    members.push({
      id: window.userProfile.id || 'me',
      name: window.userProfile.name || window.userProfile.email?.split('@')[0] || '나',
      email: window.userProfile.email || '',
      avatarUrl: window.userProfile.avatarUrl,
      isMe: true,
      isHost: true,
      permission: 'full'
    });
    canManage = true;
  }

  // 캐시 저장
  membersCache.set(memoUuid, { members, canManage, sessionId: sharePopupSessionId });

  // 렌더링
  renderMembersList(listContainer, members, canManage);
}

// 멤버 목록 렌더링 (분리된 함수)
function renderMembersList(listContainer, members, canManage) {
  // 빈 상태 처리
  if (members.length === 0) {
    listContainer.innerHTML = '<div class="share-members-empty">아직 참여자가 없습니다</div>';
    return;
  }

  listContainer.innerHTML = '';

  // 멤버 목록 렌더링
  members.forEach(member => {
    const item = document.createElement('div');
    item.className = 'share-member-item';

    const defaultAvatar = 'https://www.gravatar.com/avatar/?d=mp&s=64';
    const permissionLabels = {
      full: '전체 허용',
      edit: '편집 허용',
      view: '읽기 허용'
    };

    item.innerHTML = `
      <div class="share-member-avatar">
        <img src="${member.avatarUrl || defaultAvatar}" alt="" onerror="this.src='${defaultAvatar}'">
      </div>
      <div class="share-member-info">
        <div class="share-member-name">
          ${member.name}${member.isMe ? ' (나)' : ''}
        </div>
        <div class="share-member-email">${member.email}</div>
      </div>
      <button class="share-member-permission-btn" ${!canManage || member.isMe || member.isHost ? 'disabled' : ''}>
        ${permissionLabels[member.permission] || '전체 허용'}
        <svg viewBox="0 0 24 24" width="12" height="12"><path d="M7 10l5 5 5-5z" fill="currentColor"/></svg>
      </button>
    `;

    // 권한 버튼 클릭 이벤트 (소유자는 권한 변경 불가)
    const permBtn = item.querySelector('.share-member-permission-btn');
    if (permBtn && canManage && !member.isMe && !member.isHost) {
      permBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showPermissionMenu(permBtn, member);
      });
    }

    listContainer.appendChild(item);
  });
}

// 권한 선택 팝업 메뉴
function showPermissionMenu(anchorEl, member) {
  // 기존 메뉴 제거
  const existing = document.querySelector('.permission-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'permission-menu';

  const options = [
    { value: 'full', label: '전체 허용' },
    { value: 'edit', label: '편집 허용' },
    { value: 'view', label: '읽기 허용' },
    { value: 'remove', label: '제거' }
  ];

  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'permission-menu-item' + (opt.value === 'remove' ? ' remove' : '');

    const isSelected = member.permission === opt.value;

    item.innerHTML = `
      <div class="permission-menu-content">
        <div class="permission-menu-label">${opt.label}</div>
      </div>
      ${isSelected ? '<svg class="permission-check" viewBox="0 0 24 24" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>' : ''}
    `;

    item.addEventListener('click', () => {
      menu.remove();
      if (opt.value === 'remove') {
        handleRemoveMember(member.id, member.name);
      } else {
        handlePermissionChange(member.id, opt.value);
        anchorEl.innerHTML = `${opt.label} <svg viewBox="0 0 24 24" width="12" height="12"><path d="M7 10l5 5 5-5z" fill="currentColor"/></svg>`;
      }
    });

    menu.appendChild(item);
  });

  // 위치 계산
  const rect = anchorEl.getBoundingClientRect();
  document.body.appendChild(menu);

  const menuHeight = menu.offsetHeight;
  const spaceBelow = window.innerHeight - rect.bottom;

  // 아래 공간이 부족하면 위로 표시
  if (spaceBelow < menuHeight + 10) {
    menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  } else {
    menu.style.top = `${rect.bottom + 4}px`;
  }
  menu.style.right = `${window.innerWidth - rect.right}px`;

  // 바깥 클릭 시 닫기
  const closeMenu = (e) => {
    if (!menu.contains(e.target) && e.target !== anchorEl) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

async function handleRemoveMember(memberId, memberName) {
  if (!confirm(`${memberName}님을 내보내시겠습니까?`)) {
    return;
  }

  if (!sharePopupSessionId) {
    console.error('[Share] No session ID for remove');
    return;
  }

  try {
    const token = await window.api.authGetToken();
    const syncServer = await window.api.getSyncServer();

    const res = await fetch(`${syncServer}/api/v2/collab/session/${sharePopupSessionId}/participant/${memberId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      console.log('[Share] Participant removed:', memberId);
      // 목록 새로고침
      await renderMembersTab();
    } else {
      const error = await res.json();
      console.error('[Share] Remove failed:', error);
      alert('제거 실패: ' + (error.error || '알 수 없는 오류'));
    }
  } catch (e) {
    console.error('[Share] Remove error:', e);
    alert('제거 중 오류가 발생했습니다');
  }
}

async function handlePermissionChange(memberId, permission) {
  console.log('[Share] Permission change:', memberId, permission);

  if (!sharePopupSessionId) {
    console.error('[Share] No session ID for permission change');
    return;
  }

  try {
    const token = await window.api.authGetToken();
    const syncServer = await window.api.getSyncServer();

    const res = await fetch(`${syncServer}/api/v2/collab/session/${sharePopupSessionId}/participant/${memberId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ permission })
    });

    if (res.ok) {
      console.log('[Share] Permission changed:', memberId, permission);
      // 로컬 상태도 업데이트
      const { collabState } = window.collabModule || {};
      if (collabState?.participants?.has(memberId)) {
        collabState.participants.get(memberId).permission = permission;
      }
    } else {
      const error = await res.json();
      console.error('[Share] Permission change failed:', error);
      alert('권한 변경 실패: ' + (error.error || '알 수 없는 오류'));
      // 실패 시 목록 새로고침
      await renderMembersTab();
    }
  } catch (e) {
    console.error('[Share] Permission change error:', e);
    alert('권한 변경 중 오류가 발생했습니다');
  }
}

// ===== 링크 공유 기능 =====

async function initLinkShareTab() {
  const createSection = document.getElementById('share-link-create');
  const resultSection = document.getElementById('share-link-result');
  const status = document.getElementById('share-status');

  // 상태 초기화
  status.classList.add('hidden');
  currentShareToken = null;

  // 현재 메모가 이미 공유되었는지 확인
  if (sharePopupMemo?.uuid) {
    try {
      const shares = await window.api.getMyShares();
      const existingShare = shares.find(s => s.memoUuid === sharePopupMemo.uuid && s.isActive);

      if (existingShare) {
        // 기존 공유가 있으면 결과 화면 표시
        currentShareToken = existingShare.token;
        createSection.classList.add('hidden');
        resultSection.classList.remove('hidden');
        document.getElementById('share-link-url').value = existingShare.shareUrl;
        return;
      }
    } catch (e) {
      console.error('[Sidebar] Failed to check existing share:', e);
    }
  }

  // 기존 공유가 없으면 생성 화면 표시
  createSection.classList.remove('hidden');
  resultSection.classList.add('hidden');
}

async function createShareLink() {
  if (!sharePopupMemo) return;

  const createBtn = document.getElementById('share-link-create-btn');
  const status = document.getElementById('share-status');

  createBtn.disabled = true;
  createBtn.textContent = '게시 중...';

  try {
    const result = await window.api.createShareLink({
      content: sharePopupMemo.content,
      memoUuid: sharePopupMemo.uuid,
      expiresIn: null,
      password: null
    });

    if (result.success) {
      currentShareToken = result.token;
      showShareLinkResult(result);
    } else {
      status.className = 'share-status error';
      status.classList.remove('hidden');
      if (result.error === 'share_limit_exceeded') {
        status.textContent = result.message || '공유 제한에 도달했습니다';
      } else {
        status.textContent = result.message || '게시 실패';
      }
    }
  } catch (e) {
    status.className = 'share-status error';
    status.classList.remove('hidden');
    status.textContent = '게시 중 오류 발생';
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = '게시';
  }
}

function showShareLinkResult(result) {
  const createSection = document.getElementById('share-link-create');
  const resultSection = document.getElementById('share-link-result');
  const urlInput = document.getElementById('share-link-url');

  createSection.classList.add('hidden');
  resultSection.classList.remove('hidden');

  urlInput.value = result.shareUrl;
}

async function copyShareLink() {
  const urlInput = document.getElementById('share-link-url');
  const copyBtn = document.getElementById('share-link-copy-btn');
  const status = document.getElementById('share-status');

  try {
    await window.api.copyToClipboard(urlInput.value);
    copyBtn.textContent = '복사됨';
    status.className = 'share-status success';
    status.textContent = '링크가 클립보드에 복사되었습니다';

    setTimeout(() => {
      copyBtn.textContent = '복사';
    }, 2000);
  } catch (e) {
    status.className = 'share-status error';
    status.textContent = '복사 실패';
  }
}

async function updateShareLink() {
  if (!currentShareToken || !sharePopupMemo) return;

  const updateBtn = document.getElementById('share-link-update-btn');
  const status = document.getElementById('share-status');

  updateBtn.disabled = true;
  updateBtn.textContent = '업데이트 중...';

  try {
    // 에디터에서 최신 콘텐츠 가져오기
    const currentContent = getEditorContent();

    const result = await window.api.updateShareLink({
      token: currentShareToken,
      content: currentContent
    });

    if (result.success) {
      status.className = 'share-status success';
      status.classList.remove('hidden');
      status.textContent = '공유 링크가 업데이트되었습니다';
      setTimeout(() => {
        status.classList.add('hidden');
      }, 3000);
    } else {
      status.className = 'share-status error';
      status.classList.remove('hidden');
      status.textContent = result.message || '업데이트 실패';
    }
  } catch (e) {
    status.className = 'share-status error';
    status.classList.remove('hidden');
    status.textContent = '업데이트 중 오류 발생';
  } finally {
    updateBtn.disabled = false;
    updateBtn.textContent = '업데이트';
  }
}

async function deleteShareLink() {
  if (!currentShareToken) return;

  const deleteBtn = document.getElementById('share-link-delete-btn');
  const status = document.getElementById('share-status');

  deleteBtn.disabled = true;
  deleteBtn.textContent = '취소 중...';

  try {
    const result = await window.api.deleteShareLink(currentShareToken);

    if (result.success) {
      currentShareToken = null;

      // 생성 화면으로 복귀
      const createSection = document.getElementById('share-link-create');
      const resultSection = document.getElementById('share-link-result');
      createSection.classList.remove('hidden');
      resultSection.classList.add('hidden');
    } else {
      status.className = 'share-status error';
      status.classList.remove('hidden');
      status.textContent = result.message || '게시 취소 실패';
    }
  } catch (e) {
    status.className = 'share-status error';
    status.classList.remove('hidden');
    status.textContent = '게시 취소 중 오류 발생';
  } finally {
    deleteBtn.disabled = false;
    deleteBtn.textContent = '게시 취소';
  }
}

async function loadMyShares() {
  const listSection = document.getElementById('share-link-list');
  const itemsContainer = document.getElementById('share-link-items');

  try {
    mySharesCache = await window.api.getMyShares();

    if (!mySharesCache || mySharesCache.length === 0) {
      listSection.classList.add('hidden');
      return;
    }

    listSection.classList.remove('hidden');
    itemsContainer.textContent = '';

    // 활성 공유만 표시
    const activeShares = mySharesCache.filter(s => s.isActive);

    if (activeShares.length === 0) {
      listSection.classList.add('hidden');
      return;
    }

    activeShares.forEach(share => {
      const item = document.createElement('div');
      item.className = 'share-link-item';

      const info = document.createElement('div');
      info.className = 'share-link-item-info';

      const title = document.createElement('div');
      title.className = 'share-link-item-title';
      title.textContent = share.title || '제목 없음';

      const meta = document.createElement('div');
      meta.className = 'share-link-item-meta';
      meta.textContent = `조회 ${share.viewCount}`;
      if (share.hasPassword) {
        meta.textContent += ' • 비밀번호';
      }
      if (share.expiresAt) {
        const exp = new Date(share.expiresAt);
        if (exp < new Date()) {
          meta.textContent += ' • 만료됨';
        }
      }

      info.appendChild(title);
      info.appendChild(meta);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'share-link-item-copy';
      copyBtn.textContent = '복사';
      copyBtn.addEventListener('click', async () => {
        await window.api.copyToClipboard(share.shareUrl);
        copyBtn.textContent = '복사됨';
        setTimeout(() => { copyBtn.textContent = '복사'; }, 1500);
      });

      item.appendChild(info);
      item.appendChild(copyBtn);
      itemsContainer.appendChild(item);
    });
  } catch (e) {
    console.error('[Sidebar] Failed to load shares:', e);
    listSection.classList.add('hidden');
  }
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ===== 받은 메모 관리 =====

export function setReceivedMemoIds(ids) {
  receivedMemoIds = ids || [];
}

export function isReceivedMemo(memoId) {
  return receivedMemoIds.includes(memoId);
}

// ===== 그룹 관리 =====

async function loadGroups() {
  try {
    groupsCache = await window.api.getGroups();
  } catch (e) {
    console.error('[Groups] Failed to load groups:', e);
    groupsCache = [];
  }
}

function renderGroupTabs() {
  const tabsContainer = document.getElementById('share-group-tabs');
  if (!tabsContainer) return;

  // 기존 탭 제거 (전체, + 버튼 제외)
  const existingTabs = tabsContainer.querySelectorAll('.share-group-tab:not([data-group="all"]):not(.add-group)');
  existingTabs.forEach(tab => tab.remove());

  const addBtn = tabsContainer.querySelector('.add-group');
  const allTab = tabsContainer.querySelector('[data-group="all"]');

  // 전체 탭 active 상태 업데이트
  if (allTab) {
    allTab.classList.toggle('active', currentGroupFilter === 'all');
  }

  // 그룹 탭 추가
  groupsCache.forEach(group => {
    const tab = document.createElement('button');
    tab.className = 'share-group-tab' + (currentGroupFilter === group.id ? ' active' : '');
    tab.dataset.group = group.id;
    tab.textContent = group.name;
    tab.style.borderColor = group.color;
    if (currentGroupFilter === group.id) {
      tab.style.background = group.color;
      tab.style.borderColor = group.color;
    }

    // 클릭: 필터링
    tab.addEventListener('click', (e) => {
      if (e.shiftKey || e.metaKey) {
        // Shift/Cmd + 클릭: 편집
        openGroupDialog(group);
      } else {
        currentGroupFilter = group.id;
        renderGroupTabs();
        renderContacts(contactsCache);
      }
    });

    tabsContainer.insertBefore(tab, addBtn);
  });
}

function openGroupDialog(group = null) {
  editingGroup = group;
  const dialog = document.getElementById('group-dialog');
  const titleEl = document.getElementById('group-dialog-title');
  const nameInput = document.getElementById('group-name-input');
  const deleteBtn = document.getElementById('group-delete-btn');
  const colorBtns = document.querySelectorAll('.group-color-btn');

  titleEl.textContent = group ? '그룹 편집' : '새 그룹';
  nameInput.value = group ? group.name : '';
  deleteBtn.classList.toggle('hidden', !group);

  // 색상 선택 초기화
  const selectedColor = group ? group.color : '#007AFF';
  colorBtns.forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.color === selectedColor);
  });

  dialog.classList.remove('hidden');
  nameInput.focus();
}

function closeGroupDialog() {
  const dialog = document.getElementById('group-dialog');
  dialog.classList.add('hidden');
  editingGroup = null;
}

async function saveGroup() {
  const nameInput = document.getElementById('group-name-input');
  const selectedColorBtn = document.querySelector('.group-color-btn.selected');

  const name = nameInput.value.trim();
  if (!name) return;

  const color = selectedColorBtn?.dataset.color || '#007AFF';

  try {
    if (editingGroup) {
      // 편집 (서버 API 필요 시 추가)
      const idx = groupsCache.findIndex(g => g.id === editingGroup.id);
      if (idx >= 0) {
        groupsCache[idx].name = name;
        groupsCache[idx].color = color;
      }
    } else {
      // 새 그룹 생성
      const newGroup = await window.api.createGroup({ name, color });
      if (newGroup) {
        groupsCache.push(newGroup);
      }
    }

    renderGroupTabs();
    closeGroupDialog();
  } catch (e) {
    console.error('[Groups] Failed to save group:', e);
  }
}

async function deleteGroup() {
  if (!editingGroup) return;

  try {
    await window.api.deleteGroup(editingGroup.id);
    groupsCache = groupsCache.filter(g => g.id !== editingGroup.id);

    if (currentGroupFilter === editingGroup.id) {
      currentGroupFilter = 'all';
    }

    renderGroupTabs();
    renderContacts(contactsCache);
    closeGroupDialog();
  } catch (e) {
    console.error('[Groups] Failed to delete group:', e);
  }
}

async function addContactToGroup(email, groupId) {
  try {
    await window.api.addGroupMember(groupId, email);
    // 로컬 캐시 업데이트
    const contact = contactsCache?.find(c => c.email === email);
    if (contact) {
      if (!contact.groups) contact.groups = [];
      if (!contact.groups.includes(groupId)) {
        contact.groups.push(groupId);
      }
    }
    renderContacts(contactsCache);
  } catch (e) {
    console.error('[Groups] Failed to add contact to group:', e);
  }
}

async function removeContactFromGroup(email, groupId) {
  try {
    await window.api.removeGroupMember(groupId, email);
    // 로컬 캐시 업데이트
    const contact = contactsCache?.find(c => c.email === email);
    if (contact && contact.groups) {
      contact.groups = contact.groups.filter(g => g !== groupId);
    }
    renderContacts(contactsCache);
  } catch (e) {
    console.error('[Groups] Failed to remove contact from group:', e);
  }
}

// ===== 그룹 이벤트 초기화 =====

export function initGroupEvents() {
  // 전체 탭 클릭
  const allTab = document.querySelector('[data-group="all"]');
  if (allTab) {
    allTab.addEventListener('click', () => {
      currentGroupFilter = 'all';
      renderGroupTabs();
      renderContacts(contactsCache);
    });
  }

  // 그룹 추가 버튼
  const addBtn = document.querySelector('.share-group-tab.add-group');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      openGroupDialog();
    });
  }

  // 다이얼로그 닫기
  const closeBtn = document.getElementById('group-dialog-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeGroupDialog);
  }

  // 다이얼로그 배경 클릭 시 닫기
  const dialog = document.getElementById('group-dialog');
  if (dialog) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeGroupDialog();
    });
  }

  // 그룹 저장
  const saveBtn = document.getElementById('group-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveGroup);
  }

  // 그룹 삭제
  const deleteBtn = document.getElementById('group-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', deleteGroup);
  }

  // 색상 선택
  const colorBtns = document.querySelectorAll('.group-color-btn');
  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colorBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // 이름 입력 엔터키
  const nameInput = document.getElementById('group-name-input');
  if (nameInput) {
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveGroup();
      } else if (e.key === 'Escape') {
        closeGroupDialog();
      }
    });
  }
}
