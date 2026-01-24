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
  }

  async init() {
    // 저장된 사용자 정보 로드
    this.user = await window.api.authGetUser?.() || await window.api.getUser?.();

    if (!this.user) {
      console.log('[Auth] No user found, checking legacy license...');
      // 레거시 라이센스 확인
      await this.checkLegacyLicense();
      return;
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

    console.log('[Auth] User loaded:', this.user.email, `(${this.user.tier})`);

    // 인증 완료 이벤트 발생
    window.dispatchEvent(new CustomEvent('auth-verified'));

    // 백그라운드에서 토큰 갱신 (24시간마다)
    this.startRefreshInterval();
  }

  async checkLegacyLicense() {
    try {
      const license = await window.api.getLicense?.();
      if (!license?.licenseKey) {
        console.log('[Auth] No license found');
        return;
      }

      // 캐시된 검증 정보가 있으면 사용
      if (license.cachedVerification) {
        const cached = license.cachedVerification;
        const cachedTime = new Date(cached.verifiedAt);
        const daysSinceVerification = (new Date() - cachedTime) / (1000 * 60 * 60 * 24);

        if (daysSinceVerification <= 7) {
          this.user = {
            email: cached.user?.email || cached.email || cached.customerEmail,
            name: cached.user?.name || null,
            avatarUrl: cached.user?.avatarUrl || null,
            tier: cached.type === 'lifetime' ? 'lifetime' : 'pro'
          };

          authState.user = this.user;
          authState.isLoggedIn = true;
          authState.isPro = true;

          window.userProfile = { ...this.user };

          console.log('[Auth] Using cached license profile');
          window.dispatchEvent(new CustomEvent('auth-verified'));
        }
      }
    } catch (e) {
      console.error('[Auth] Legacy license check error:', e);
    }
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

// 레거시 호환성: license.js의 licenseManager와 동일한 인터페이스
export const licenseManager = {
  init: () => authManager.init(),
  verify: () => authManager.refresh(),
  cleanup: () => authManager.cleanup()
};

export default authManager;
