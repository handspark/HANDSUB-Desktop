/**
 * auth.js - 로그인 기반 인증 관리
 * license.js를 대체하는 새로운 인증 모듈
 */

const SYNC_SERVER_URL = 'https://api.handsub.com';

// 인증 상태
export const authState = {
  user: null,
  isLoggedIn: false,
  isPro: false,
  lastRefreshTime: 0  // 마지막 서버 갱신 시간
};

// 프로필 갱신 쓰로틀 시간 (5분)
const PROFILE_REFRESH_THROTTLE = 5 * 60 * 1000;

// 토큰 자동 갱신 주기 (50분 - access token 만료 전 여유)
const TOKEN_REFRESH_INTERVAL = 50 * 60 * 1000;

// 앱 활성화 시 갱신 최소 간격 (10분)
const FOCUS_REFRESH_MIN_INTERVAL = 10 * 60 * 1000;

class AuthManager {
  constructor() {
    this.user = null;
    this.refreshInterval = null;
    this._initPromise = null;
    this._refreshPromise = null;  // 중복 호출 방지
    this.lastRefreshTime = 0;
    this._setupVisibilityHandler();
  }

  // 앱이 활성화될 때 토큰 갱신 체크
  _setupVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.user) {
        this._refreshOnFocus();
      }
    });

    // 윈도우 포커스 이벤트도 처리
    window.addEventListener('focus', () => {
      if (this.user) {
        this._refreshOnFocus();
      }
    });
  }

  async _refreshOnFocus() {
    const now = Date.now();
    const timeSinceLastRefresh = now - this.lastRefreshTime;

    // 마지막 갱신 후 10분 이상 지났으면 갱신
    if (timeSinceLastRefresh >= FOCUS_REFRESH_MIN_INTERVAL) {
      console.log('[Auth] App activated, refreshing token...');
      await this.refresh();
    }
  }

  async init() {
    // 이미 초기화 중이면 기존 Promise 반환 (중복 호출 방지)
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = this._doInit();
    return this._initPromise;
  }

  async _doInit() {
    const startTime = performance.now();

    // 저장된 사용자 정보 로드 (IPC 호출 - 캐시된 데이터)
    this.user = await window.api.authGetUser?.() || await window.api.getUser?.();

    if (!this.user) {
      console.log('[Auth] No user found, please login');
      console.log(`[Auth] Init completed in ${(performance.now() - startTime).toFixed(1)}ms`);
      return { success: false };
    }

    // 전역 상태 업데이트
    authState.user = this.user;
    authState.isLoggedIn = true;
    authState.isPro = this.user.tier === 'pro' || this.user.tier === 'lifetime';

    // 전역 프로필 설정 (메모 리스트에서 사용)
    window.userProfile = {
      email: this.user.email,
      name: this.user.name,
      avatarUrl: this.user.avatarUrl,
      tier: this.user.tier
    };

    console.log(`[Auth] User loaded: ${this.user.email} (${this.user.tier}) in ${(performance.now() - startTime).toFixed(1)}ms`);

    // 인증 완료 이벤트 발생
    window.dispatchEvent(new CustomEvent('auth-verified'));

    // 마지막 갱신 시간 초기화
    this.lastRefreshTime = Date.now();

    // 백그라운드에서 토큰 갱신 (50분마다)
    this.startRefreshInterval();

    // 백그라운드에서 서버에서 최신 프로필 가져오기 (구매 후 티어 반영)
    this.refreshProfileOnInit();

    // Pro 사용자이고 클라우드 동기화가 활성화되어 있으면 서버에서 메모 가져오기
    if (authState.isPro) {
      this.syncCloudMemosOnLogin();
    }

    return { success: true, user: this.user };
  }

  // 로그인 시 클라우드 메모 동기화
  async syncCloudMemosOnLogin() {
    try {
      const syncEnabled = await window.api.cloudSyncEnabled?.();
      if (!syncEnabled) {
        console.log('[Auth] Cloud sync disabled, skipping memo sync');
        return;
      }

      // 1. 먼저 로컬 메모를 서버에 업로드
      console.log('[Auth] Uploading local memos to cloud...');
      const uploadResult = await window.api.cloudUploadAllMemos?.();
      if (uploadResult?.success) {
        console.log(`[Auth] Local memos uploaded: ${uploadResult.uploadedCount || 0} memos`);
      }

      // 2. 서버 메모를 로컬에 병합 (merge 모드)
      console.log('[Auth] Importing cloud memos (merge)...');
      const result = await window.api.cloudImportMemos?.('merge');

      if (result?.success) {
        console.log(`[Auth] Cloud memos imported: ${result.importedCount || 0} memos`);
        // 메모 목록 갱신 이벤트 발생
        window.dispatchEvent(new CustomEvent('memos-updated'));
      } else {
        console.log('[Auth] Cloud memo import failed:', result?.error);
      }
    } catch (e) {
      console.error('[Auth] Cloud memo sync error:', e);
    }
  }

  startRefreshInterval() {
    // 기존 인터벌 정리
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    // 50분마다 토큰 갱신 (access token 만료 전 여유있게)
    this.refreshInterval = setInterval(async () => {
      await this.refresh();
    }, TOKEN_REFRESH_INTERVAL);
  }

  async refresh() {
    // 이미 갱신 중이면 기존 Promise 반환 (중복 호출 방지)
    if (this._refreshPromise) {
      console.log('[Auth] Refresh already in progress, waiting...');
      return this._refreshPromise;
    }

    this._refreshPromise = this._doRefresh();
    return this._refreshPromise;
  }

  async _doRefresh() {
    try {
      const result = await window.api.authRefresh?.();
      if (result?.success && result.user) {
        const oldTier = this.user?.tier;
        this.user = result.user;
        authState.user = this.user;
        authState.isPro = this.user.tier === 'pro' || this.user.tier === 'lifetime';
        this.lastRefreshTime = Date.now();

        window.userProfile = {
          email: this.user.email,
          name: this.user.name,
          avatarUrl: this.user.avatarUrl,
          tier: this.user.tier
        };

        console.log('[Auth] Token refreshed');

        // 티어가 변경되면 이벤트 발생
        if (oldTier && oldTier !== this.user.tier) {
          console.log(`[Auth] Tier changed: ${oldTier} → ${this.user.tier}`);
          window.dispatchEvent(new CustomEvent('auth-tier-changed', {
            detail: { oldTier, newTier: this.user.tier }
          }));
        }

        return true;
      }
    } catch (e) {
      console.error('[Auth] Refresh error:', e);
    } finally {
      this._refreshPromise = null;  // Promise 초기화
    }
    return false;
  }

  // 초기화 후 백그라운드에서 최신 프로필 확인 (구매 후 티어 반영)
  // 쓰로틀링: 마지막 갱신 후 5분 이내면 스킵
  async refreshProfileOnInit() {
    const now = Date.now();
    const timeSinceLastRefresh = now - authState.lastRefreshTime;

    if (timeSinceLastRefresh < PROFILE_REFRESH_THROTTLE) {
      console.log(`[Auth] Profile refresh skipped (${Math.round(timeSinceLastRefresh / 1000)}s ago)`);
      return;
    }

    try {
      const refreshed = await this.refresh();
      if (refreshed) {
        authState.lastRefreshTime = now;
        console.log('[Auth] Profile synced with server');
      }
    } catch (e) {
      console.log('[Auth] Profile sync failed (using cached):', e.message);
    }
  }

  // 강제 프로필 갱신 (수동 새로고침 버튼용)
  async forceRefresh() {
    authState.lastRefreshTime = 0;  // 쓰로틀 초기화
    return await this.refresh();
  }

  async logout(options = {}) {
    // options: { keepLocal: boolean } - 클라우드 메모를 로컬에 남길지
    try {
      await window.api.authLogout?.(options);
    } catch (e) {
      console.error('[Auth] Logout error:', e);
    }

    this.user = null;
    authState.user = null;
    authState.isLoggedIn = false;
    authState.isPro = false;
    window.userProfile = null;

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    window.dispatchEvent(new CustomEvent('auth-logout'));
  }

  // 클라우드 메모 개수 조회 (다이얼로그용)
  async getCloudMemoCount() {
    try {
      const result = await window.api.cloudGetCount?.();
      return result?.count || 0;
    } catch (e) {
      console.error('[Auth] Get cloud count error:', e);
      return 0;
    }
  }

  // 로컬 메모 개수 조회 (다이얼로그용)
  async getLocalMemoCount() {
    try {
      const result = await window.api.cloudGetLocalCount?.();
      return result || 0;
    } catch (e) {
      console.error('[Auth] Get local count error:', e);
      return 0;
    }
  }

  // 클라우드 메모 가져오기 (로그인 후)
  async importCloudMemos(mode) {
    // mode: 'merge' (모두 합치기) | 'replace' (클라우드만 사용)
    try {
      const result = await window.api.cloudImportMemos?.(mode);
      return result;
    } catch (e) {
      console.error('[Auth] Import cloud memos error:', e);
      return { success: false, error: e.message };
    }
  }

  // 다이얼로그를 통한 로그아웃 (프로 사용자용)
  async logoutWithDialog() {
    // 프로 사용자가 아니면 바로 로그아웃
    if (!authState.isPro) {
      return await this.logout({ keepLocal: true });
    }

    // 동적 import로 다이얼로그 함수 가져오기
    try {
      const { showCloudLogoutDialog } = await import('./auth.js');
      const result = await showCloudLogoutDialog();

      if (result.action === 'cancel') {
        return false; // 취소됨
      }

      await this.logout({ keepLocal: result.keepLocal });
      return true;
    } catch (e) {
      console.error('[Auth] Logout with dialog error:', e);
      // 에러 시 기본 로그아웃
      await this.logout({ keepLocal: true });
      return true;
    }
  }

  cleanup() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

// 싱글톤 인스턴스
export const authManager = new AuthManager();

// IPC 이벤트 리스너 등록 (설정 창에서 로그인 시 메인 창 동기화)
if (window.api?.onAuthSuccess) {
  window.api.onAuthSuccess(async (data) => {
    if (data?.user) {
      authManager.user = data.user;
      authState.user = data.user;
      authState.isLoggedIn = true;
      authState.isPro = data.user.tier === 'pro' || data.user.tier === 'lifetime';

      window.userProfile = {
        email: data.user.email,
        name: data.user.name,
        avatarUrl: data.user.avatarUrl,
        tier: data.user.tier
      };

      window.dispatchEvent(new CustomEvent('auth-verified'));

      // 프로 사용자면 자동으로 클라우드 메모 동기화
      if (authState.isPro) {
        try {
          const syncEnabled = await window.api.cloudSyncEnabled?.();
          if (syncEnabled) {
            console.log('[Auth] Auto-importing cloud memos...');
            await authManager.importCloudMemos('merge');
          }
        } catch (e) {
          console.error('[Auth] Cloud auto-sync error:', e);
        }
      }
    }
  });
}

if (window.api?.onAuthLogout) {
  window.api.onAuthLogout(() => {
    authManager.user = null;
    authState.user = null;
    authState.isLoggedIn = false;
    authState.isPro = false;
    window.userProfile = null;

    window.dispatchEvent(new CustomEvent('auth-logout'));
  });
}

// 티어 실시간 업데이트 (WebSocket으로 구매 완료 시 즉시 반영)
if (window.api?.onTierUpdated) {
  window.api.onTierUpdated((data) => {
    console.log('[Auth] Tier updated via WebSocket:', data.tier);

    if (authManager.user) {
      const oldTier = authManager.user.tier;
      authManager.user.tier = data.tier;
      authManager.user.tierExpiresAt = data.expiresAt;

      authState.user = authManager.user;
      authState.isPro = data.tier === 'pro' || data.tier === 'lifetime';

      if (window.userProfile) {
        window.userProfile.tier = data.tier;
      }

      // 티어 변경 이벤트 발생
      window.dispatchEvent(new CustomEvent('auth-tier-changed', {
        detail: { oldTier, newTier: data.tier }
      }));

      console.log(`[Auth] Tier changed: ${oldTier} → ${data.tier}`);
    }
  });
}

// Helper 함수들
export function isLoggedIn() {
  return authState.isLoggedIn;
}

export function isPro() {
  return authState.isPro;
}

export function getUser() {
  return authState.user;
}

export function getTier() {
  return authState.user?.tier || 'free';
}

// Pro 기능 체크 (사용자 피드백 포함)
export function requirePro(featureName = 'Pro 기능') {
  if (isPro()) {
    return true;
  }

  // 업그레이드 안내 표시
  const message = `${featureName}은(는) Pro 플랜에서 사용할 수 있습니다.\n\n업그레이드하시겠습니까?`;
  if (confirm(message)) {
    window.api.openExternal?.('https://handsub.com/pricing');
  }

  return false;
}

// 인증 상태 변경 이벤트 리스너 등록
export function onAuthChange(callback) {
  const handler = () => callback(authState);

  window.addEventListener('auth-verified', handler);
  window.addEventListener('auth-logout', handler);

  // cleanup 함수 반환
  return () => {
    window.removeEventListener('auth-verified', handler);
    window.removeEventListener('auth-logout', handler);
  };
}

export default authManager;

// ===== 클라우드 메모 다이얼로그 =====

// 구름 SVG 아이콘
const CLOUD_SVG = `<svg viewBox="0 0 512 512" width="48" height="48"><path fill="#007AFF" d="M421 406H91c-24.05 0-46.794-9.327-64.042-26.264C9.574 362.667 0 340.031 0 316s9.574-46.667 26.958-63.736c13.614-13.368 30.652-21.995 49.054-25.038-.008-.406-.012-.815-.012-1.226 0-66.168 53.832-120 120-120 24.538 0 48.119 7.387 68.194 21.363 14.132 9.838 25.865 22.443 34.587 37.043 14.079-8.733 30.318-13.406 47.219-13.406 44.886 0 82.202 33.026 88.921 76.056 18.811 2.88 36.244 11.581 50.122 25.208C502.426 269.333 512 291.969 512 316s-9.574 46.667-26.957 63.736C467.794 396.673 445.05 406 421 406z"/></svg>`;

// 다이얼로그 스타일 (처음 한 번만 추가)
function ensureDialogStyles() {
  if (document.getElementById('cloud-dialog-styles')) return;

  const style = document.createElement('style');
  style.id = 'cloud-dialog-styles';
  style.textContent = `
    .cloud-dialog-overlay {
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
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .cloud-dialog {
      background: var(--bg-color, #fff);
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      animation: slideUp 0.3s ease;
    }

    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .cloud-dialog-icon {
      text-align: center;
      margin-bottom: 16px;
    }

    .cloud-dialog-title {
      font-size: 18px;
      font-weight: 600;
      text-align: center;
      margin-bottom: 8px;
      color: var(--text-color, #333);
    }

    .cloud-dialog-subtitle {
      font-size: 13px;
      color: var(--text-secondary, #666);
      text-align: center;
      margin-bottom: 20px;
    }

    .cloud-dialog-counts {
      display: flex;
      justify-content: center;
      gap: 24px;
      margin-bottom: 20px;
      padding: 12px;
      background: var(--sidebar-bg, #f5f5f5);
      border-radius: 8px;
    }

    .cloud-dialog-count {
      text-align: center;
    }

    .cloud-dialog-count-number {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-color, #333);
    }

    .cloud-dialog-count-label {
      font-size: 11px;
      color: var(--text-secondary, #666);
    }

    .cloud-dialog-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 20px;
    }

    .cloud-dialog-option {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px;
      border: 2px solid var(--border-color, #e0e0e0);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .cloud-dialog-option:hover {
      border-color: #007AFF;
    }

    .cloud-dialog-option.selected {
      border-color: #007AFF;
      background: rgba(0, 122, 255, 0.05);
    }

    .cloud-dialog-option input[type="radio"] {
      margin-top: 2px;
      accent-color: #007AFF;
    }

    .cloud-dialog-option-content {
      flex: 1;
    }

    .cloud-dialog-option-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-color, #333);
    }

    .cloud-dialog-option-desc {
      font-size: 12px;
      color: var(--text-secondary, #666);
      margin-top: 2px;
    }

    .cloud-dialog-buttons {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .cloud-dialog-btn {
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .cloud-dialog-btn-secondary {
      background: var(--sidebar-bg, #f5f5f5);
      border: 1px solid var(--border-color, #e0e0e0);
      color: var(--text-color, #333);
    }

    .cloud-dialog-btn-secondary:hover {
      background: var(--border-color, #e0e0e0);
    }

    .cloud-dialog-btn-primary {
      background: #007AFF;
      border: none;
      color: white;
    }

    .cloud-dialog-btn-primary:hover {
      background: #0056b3;
    }
  `;
  document.head.appendChild(style);
}

// 로그인 후 클라우드 메모 다이얼로그
export async function showCloudImportDialog() {
  ensureDialogStyles();

  const localCount = await authManager.getLocalMemoCount();
  const cloudCount = await authManager.getCloudMemoCount();

  // 클라우드에 메모가 없으면 다이얼로그 스킵
  if (cloudCount === 0) {
    console.log('[Auth] No cloud memos, skipping import dialog');
    return { action: 'skip' };
  }

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'cloud-dialog-overlay';

    overlay.innerHTML = `
      <div class="cloud-dialog">
        <div class="cloud-dialog-icon">${CLOUD_SVG}</div>
        <div class="cloud-dialog-title">로그인 완료!</div>
        <div class="cloud-dialog-subtitle">클라우드에 저장된 메모가 있습니다</div>

        <div class="cloud-dialog-counts">
          <div class="cloud-dialog-count">
            <div class="cloud-dialog-count-number">${localCount}</div>
            <div class="cloud-dialog-count-label">📱 이 기기</div>
          </div>
          <div class="cloud-dialog-count">
            <div class="cloud-dialog-count-number">${cloudCount}</div>
            <div class="cloud-dialog-count-label">☁️ 클라우드</div>
          </div>
        </div>

        <div class="cloud-dialog-options">
          <label class="cloud-dialog-option selected" data-value="merge">
            <input type="radio" name="import-mode" value="merge" checked>
            <div class="cloud-dialog-option-content">
              <div class="cloud-dialog-option-title">모두 합치기 (권장)</div>
              <div class="cloud-dialog-option-desc">로컬 메모는 유지, 클라우드 메모 추가</div>
            </div>
          </label>
          <label class="cloud-dialog-option" data-value="replace">
            <input type="radio" name="import-mode" value="replace">
            <div class="cloud-dialog-option-content">
              <div class="cloud-dialog-option-title">클라우드만 사용</div>
              <div class="cloud-dialog-option-desc">이 기기의 메모를 클라우드로 교체</div>
            </div>
          </label>
        </div>

        <div class="cloud-dialog-buttons">
          <button class="cloud-dialog-btn cloud-dialog-btn-primary" id="cloud-dialog-confirm">확인</button>
        </div>
      </div>
    `;

    // 옵션 선택 이벤트
    overlay.querySelectorAll('.cloud-dialog-option').forEach(opt => {
      opt.addEventListener('click', () => {
        overlay.querySelectorAll('.cloud-dialog-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        opt.querySelector('input').checked = true;
      });
    });

    // 확인 버튼
    overlay.querySelector('#cloud-dialog-confirm').addEventListener('click', async () => {
      const mode = overlay.querySelector('input[name="import-mode"]:checked').value;
      const confirmBtn = overlay.querySelector('#cloud-dialog-confirm');

      // 로딩 상태
      confirmBtn.disabled = true;
      confirmBtn.textContent = '가져오는 중...';

      // 클라우드 메모 가져오기
      const result = await authManager.importCloudMemos(mode);
      // IPC 핸들러(events.js)에서 memos-updated 처리됨

      // import 완료 후 다이얼로그 닫기
      overlay.remove();
      resolve({ action: mode, result });
    });

    document.body.appendChild(overlay);
  });
}

// 로그아웃 전 클라우드 메모 다이얼로그
export async function showCloudLogoutDialog() {
  ensureDialogStyles();

  // 클라우드 메모 개수 확인 (로컬에서)
  const memos = await window.api.getAll?.() || [];
  const cloudMemoCount = memos.filter(m => m.is_cloud).length;

  // 클라우드 메모가 없으면 다이얼로그 스킵
  if (cloudMemoCount === 0) {
    console.log('[Auth] No cloud memos locally, skipping logout dialog');
    return { action: 'keep', keepLocal: true };
  }

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'cloud-dialog-overlay';

    overlay.innerHTML = `
      <div class="cloud-dialog">
        <div class="cloud-dialog-icon">${CLOUD_SVG}</div>
        <div class="cloud-dialog-title">로그아웃</div>
        <div class="cloud-dialog-subtitle">이 기기에 클라우드 메모 ${cloudMemoCount}개가 있습니다</div>

        <div class="cloud-dialog-options">
          <label class="cloud-dialog-option selected" data-value="keep">
            <input type="radio" name="logout-mode" value="keep" checked>
            <div class="cloud-dialog-option-content">
              <div class="cloud-dialog-option-title">이 기기에 남기기</div>
              <div class="cloud-dialog-option-desc">다른 사람도 이 기기에서 볼 수 있음</div>
            </div>
          </label>
          <label class="cloud-dialog-option" data-value="delete">
            <input type="radio" name="logout-mode" value="delete">
            <div class="cloud-dialog-option-content">
              <div class="cloud-dialog-option-title">이 기기에서 삭제</div>
              <div class="cloud-dialog-option-desc">다음 로그인 시 클라우드에서 복원됨</div>
            </div>
          </label>
        </div>

        <div class="cloud-dialog-buttons">
          <button class="cloud-dialog-btn cloud-dialog-btn-secondary" id="cloud-dialog-cancel">취소</button>
          <button class="cloud-dialog-btn cloud-dialog-btn-primary" id="cloud-dialog-confirm">로그아웃</button>
        </div>
      </div>
    `;

    // 옵션 선택 이벤트
    overlay.querySelectorAll('.cloud-dialog-option').forEach(opt => {
      opt.addEventListener('click', () => {
        overlay.querySelectorAll('.cloud-dialog-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        opt.querySelector('input').checked = true;
      });
    });

    // 취소 버튼
    overlay.querySelector('#cloud-dialog-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve({ action: 'cancel' });
    });

    // 확인 버튼
    overlay.querySelector('#cloud-dialog-confirm').addEventListener('click', () => {
      const mode = overlay.querySelector('input[name="logout-mode"]:checked').value;
      overlay.remove();
      resolve({ action: mode, keepLocal: mode === 'keep' });
    });

    document.body.appendChild(overlay);
  });
}
