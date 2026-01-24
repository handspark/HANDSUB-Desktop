/**
 * auth.js - 로그인 기반 인증 관리
 * license.js를 대체하는 새로운 인증 모듈
 */

const SYNC_SERVER_URL = 'https://api.handsub.com';

// 인증 상태
export const authState = {
  user: null,
  isLoggedIn: false,
  isPro: false
};

class AuthManager {
  constructor() {
    this.user = null;
    this.refreshInterval = null;
    this._initPromise = null;
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

    // 백그라운드에서 토큰 갱신 (24시간마다)
    this.startRefreshInterval();

    return { success: true, user: this.user };
  }

  startRefreshInterval() {
    // 기존 인터벌 정리
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    // 24시간마다 토큰 갱신
    this.refreshInterval = setInterval(async () => {
      await this.refresh();
    }, 24 * 60 * 60 * 1000);
  }

  async refresh() {
    try {
      const result = await window.api.authRefresh?.();
      if (result?.success && result.user) {
        this.user = result.user;
        authState.user = this.user;
        authState.isPro = this.user.tier === 'pro' || this.user.tier === 'lifetime';

        window.userProfile = {
          email: this.user.email,
          name: this.user.name,
          avatarUrl: this.user.avatarUrl,
          tier: this.user.tier
        };

        console.log('[Auth] Token refreshed');
      }
    } catch (e) {
      console.error('[Auth] Refresh error:', e);
    }
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
