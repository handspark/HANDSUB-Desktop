/**
 * license.js - 라이센스 관리
 */

import { licenseState } from './state.js';

const SYNC_SERVER_URL = 'https://api.handsub.com';

class LicenseManager {
  constructor() {
    this.license = null;
    this.verificationInterval = null;
  }

  async init() {
    this.license = await window.api.getLicense();

    if (!this.license?.licenseKey) {
      console.log('[License] No license found');
      return;
    }

    // 캐시된 검증 정보가 있으면 먼저 즉시 연결 상태로 표시
    if (this.license?.cachedVerification) {
      const cached = this.license.cachedVerification;
      const cachedTime = new Date(cached.verifiedAt);
      const now = new Date();
      const daysSinceVerification = (now - cachedTime) / (1000 * 60 * 60 * 24);

      // 캐시가 7일 이내면 즉시 프로필 설정
      if (daysSinceVerification <= 7) {
        window.userProfile = cached.user || {
          email: cached.email || cached.customerEmail,
          name: null,
          avatarUrl: null
        };
        console.log('[License] Using cached profile (instant)');
        window.dispatchEvent(new CustomEvent('license-verified'));
      }
    }

    // 백그라운드에서 서버 검증 진행
    this.verify();

    // 24시간마다 주기적 검증
    this.verificationInterval = setInterval(() => {
      this.verify();
    }, 24 * 60 * 60 * 1000);
  }

  async verify() {
    if (!this.license?.licenseKey) return;

    try {
      const deviceFingerprint = await window.api.getMachineId();
      const deviceName = await window.api.getDeviceName?.() || null;
      const result = await this.verifyOnServer(this.license.licenseKey, deviceFingerprint, deviceName);

      if (result.valid) {
        await window.api.cacheLicenseVerification({
          ...result,
          // 필드명 호환성 (서버: licenseType/customerEmail, 클라이언트: type/email)
          type: result.licenseType || result.type,
          email: result.customerEmail || result.email,
          user: result.user || null,
          verifiedAt: new Date().toISOString()
        });

        // 전역 프로필 설정 (메모 리스트에서 사용)
        window.userProfile = result.user || {
          email: result.customerEmail || result.email,
          name: null,
          avatarUrl: null
        };

        console.log('[License] Verification successful');

        // 설정 동기화 (새 기기 로그인 시)
        window.api.syncSettingsPull().catch(() => {});

        // 라이센스 검증 완료 이벤트 발생
        window.dispatchEvent(new CustomEvent('license-verified'));
      } else if (result.error === 'expired') {
        console.warn('[License] License expired');
        this.handleInvalidLicense('expired');
      } else if (result.error === 'revoked') {
        console.warn('[License] License revoked');
        this.handleInvalidLicense('revoked');
      } else {
        await this.checkCacheValidity();
      }
    } catch (e) {
      console.error('[License] Verification error:', e);
      await this.checkCacheValidity();
    }
  }

  async verifyOnServer(licenseKey, deviceFingerprint, deviceName) {
    const res = await fetch(`${SYNC_SERVER_URL}/api/license/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, deviceFingerprint, deviceName })
    });
    return await res.json();
  }

  async checkCacheValidity() {
    if (!this.license?.cachedVerification) {
      this.handleInvalidLicense('no_cache');
      return;
    }

    const cachedTime = new Date(this.license.cachedVerification.verifiedAt);
    const now = new Date();
    const daysSinceVerification = (now - cachedTime) / (1000 * 60 * 60 * 24);

    if (daysSinceVerification > 7) {
      console.warn('[License] Cache expired (7 days grace period)');
      this.handleInvalidLicense('cache_expired');
    } else {
      console.log('[License] Using cached verification (offline mode)');
      // 캐시에서 프로필 설정
      const cached = this.license.cachedVerification;
      window.userProfile = cached.user || {
        email: cached.email || cached.customerEmail,
        name: null,
        avatarUrl: null
      };

      // 라이센스 검증 완료 이벤트 발생
      window.dispatchEvent(new CustomEvent('license-verified'));
    }
  }

  handleInvalidLicense(reason) {
    console.warn('[License] Invalid license:', reason);
    window.userProfile = null;
  }

  cleanup() {
    if (this.verificationInterval) {
      clearInterval(this.verificationInterval);
      this.verificationInterval = null;
    }
  }
}

export const licenseManager = new LicenseManager();
