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

    return { success: true, user: this.user };
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

  async logout() {
    try {
      await window.api.authLogout?.();
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
  window.api.onAuthSuccess((data) => {
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
