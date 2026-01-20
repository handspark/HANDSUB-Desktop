/**
 * notification.js - 알림 표시 모듈
 * 채팅 스타일로 상단에 알림 메시지 표시
 */

const notificationArea = document.getElementById('notification-area');

// 시간 포맷 (몇 분 전, 몇 시간 전)
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  if (hours < 24) return `${hours}시간 전`;

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// 알림 아이콘 (타입별)
function getNotificationIcon(type) {
  switch (type) {
    case 'reminder':
      return '🔔';
    case 'share':
      return '📩';
    default:
      return '💬';
  }
}

// 알림 항목 렌더링
function renderNotificationItem(notification) {
  const item = document.createElement('div');
  item.className = 'notification-item';
  item.dataset.id = notification.id;

  item.innerHTML = `
    <span class="notification-icon">${getNotificationIcon(notification.type)}</span>
    <div class="notification-content">
      <div class="notification-text">${notification.text}</div>
      <div class="notification-time">${formatTimeAgo(notification.created_at)}</div>
    </div>
    <button class="notification-close">&times;</button>
  `;

  // 클릭 시 읽음 처리 및 닫기
  item.addEventListener('click', async (e) => {
    if (e.target.classList.contains('notification-close')) {
      // X 버튼 클릭 시 삭제
      await window.api.deleteNotification(notification.id);
    } else {
      // 항목 클릭 시 읽음 처리
      await window.api.markNotificationRead(notification.id);
    }
    item.style.animation = 'slideIn 0.2s ease reverse';
    setTimeout(() => {
      item.remove();
      updateNotificationAreaVisibility();
    }, 200);
  });

  return item;
}

// 알림 영역 표시/숨김
function updateNotificationAreaVisibility() {
  if (notificationArea.children.length > 0) {
    notificationArea.classList.add('has-notifications');
  } else {
    notificationArea.classList.remove('has-notifications');
  }
}

// 읽지 않은 알림 로드
export async function loadUnreadNotifications() {
  try {
    const notifications = await window.api.getUnreadNotifications();

    // 기존 알림 초기화
    notificationArea.innerHTML = '';

    // 알림 렌더링
    notifications.forEach(notification => {
      const item = renderNotificationItem(notification);
      notificationArea.appendChild(item);
    });

    updateNotificationAreaVisibility();
  } catch (e) {
    console.error('[Notification] Load error:', e);
  }
}

// 새 알림 추가 (실시간)
export function addNotification(notification) {
  const item = renderNotificationItem(notification);
  notificationArea.insertBefore(item, notificationArea.firstChild);
  updateNotificationAreaVisibility();
}

// 모든 알림 읽음 처리
export async function markAllRead() {
  await window.api.markAllNotificationsRead();
  notificationArea.innerHTML = '';
  updateNotificationAreaVisibility();
}
