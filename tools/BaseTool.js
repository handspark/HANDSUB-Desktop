/**
 * BaseTool - 모든 도구의 기본 클래스
 * n8n 스타일의 확장 가능한 도구 시스템
 */
class BaseTool {
  constructor() {
    if (new.target === BaseTool) {
      throw new Error('BaseTool cannot be instantiated directly');
    }
  }

  /**
   * 도구 메타데이터
   * @returns {Object} 도구 정보
   */
  static get meta() {
    return {
      id: 'base',
      name: 'Base Tool',
      description: 'Base tool class',
      icon: '🔧',
      category: 'core',
      version: '1.0.0'
    };
  }

  /**
   * 인증 설정 (OAuth, API Key 등이 필요한 도구용)
   * @returns {Object|null} 인증 설정 또는 null (인증 불필요)
   */
  static get auth() {
    return null; // 기본: 인증 불필요
    // 예시:
    // return {
    //   type: 'oauth2', // 'oauth2', 'apiKey', 'basic'
    //   provider: 'google',
    //   scopes: ['gmail.send'],
    //   fields: [{ name: 'apiKey', label: 'API Key', type: 'password' }]
    // };
  }

  /**
   * 인증 필요 여부
   * @returns {boolean}
   */
  static get requiresAuth() {
    return this.auth !== null;
  }

  /**
   * 도구 설정 스키마 (설정 UI 생성에 사용)
   * @returns {Array} 필드 정의 배열
   */
  static get schema() {
    return [];
  }

  /**
   * 기본 설정값
   * @returns {Object} 기본 config 객체
   */
  static get defaults() {
    return {};
  }

  /**
   * 설정 유효성 검사
   * @param {Object} config - 도구 설정
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  static validate(config) {
    const errors = [];

    for (const field of this.schema) {
      if (field.required && !config[field.name]) {
        errors.push(`${field.label || field.name} is required`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 도구 실행
   * @param {Object} config - 도구 설정 (DB에서 로드)
   * @param {Object} context - 실행 컨텍스트 { content, variables }
   * @returns {Promise<Object>} { success: boolean, data?: any, error?: string }
   */
  static async execute(config, context = {}) {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * 템플릿 변수 치환
   * @param {string} template - 템플릿 문자열
   * @param {Object} variables - 변수 객체
   * @returns {string} 치환된 문자열
   */
  static replaceVariables(template, variables = {}) {
    if (!template || typeof template !== 'string') return template;

    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      result = result.split(placeholder).join(value || '');
    }
    return result;
  }
}

module.exports = BaseTool;
