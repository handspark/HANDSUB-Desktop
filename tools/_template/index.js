/**
 * [도구 이름] Tool - 코드 기반 도구 템플릿
 * [도구 설명]
 *
 * ═══════════════════════════════════════════════════════════
 * 도구 생성 방법 2가지:
 * ───────────────────────────────────────────────────────────
 * 1. 코드 도구 (index.js) - 복잡한 로직, 다단계 처리
 *    → 이 파일 사용
 *    → 단축어는 사용자가 직접 생성
 *
 * 2. 매니페스트 도구 (manifest.json) - 간단한 HTTP 요청
 *    → manifest.json 사용
 *    → commands에 정의한 단축어 자동 등록!
 * ═══════════════════════════════════════════════════════════
 *
 * 새 도구 만들기:
 * 1. 이 폴더를 복사하여 새 이름으로 변경 (예: gpt, notion, gmail)
 * 2. index.js 또는 manifest.json 중 하나만 남기기
 * 3. meta, schema, defaults, validate, execute 수정
 * 4. 앱 재시작하면 자동으로 로드됨
 *
 * 아이콘 추가:
 * - 폴더에 icon.png 파일 추가 (권장: 64x64px)
 * - 자동으로 인식됨
 */
const BaseTool = require('../BaseTool');

class TemplateTool extends BaseTool {
  /**
   * 도구 메타데이터
   */
  static get meta() {
    return {
      id: 'template',           // 고유 ID (폴더명과 일치 권장)
      name: 'Template Tool',    // 표시 이름
      description: '도구 설명', // 설명
      icon: '🔧',              // 아이콘 (이모지)
      category: 'integration', // 카테고리
      version: '1.0.0'         // 버전
    };
  }

  /**
   * 설정 UI 스키마
   * type: text, textarea, select, keyvalue, checkbox
   */
  static get schema() {
    return [
      {
        name: 'url',
        type: 'text',
        label: 'URL',
        placeholder: 'https://...',
        required: true
      },
      {
        name: 'message',
        type: 'textarea',
        label: '메시지',
        placeholder: '{{content}}',
        required: false,
        hint: '{{필드명}} 형식으로 변수 사용'
      },
      {
        name: 'method',
        type: 'select',
        label: '메서드',
        options: ['GET', 'POST'],
        default: 'POST',
        required: false
      }
    ];
  }

  /**
   * 기본 설정값
   */
  static get defaults() {
    return {
      url: '',
      message: '',
      method: 'POST'
    };
  }

  /**
   * 설정 유효성 검사
   * @param {Object} config
   * @returns {{ valid: boolean, errors: string[] }}
   */
  static validate(config) {
    const errors = [];

    if (!config.url) {
      errors.push('URL is required');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 도구 실행
   * @param {Object} config - 저장된 설정
   * @param {Object} context - { content: '사용자 입력값' }
   * @returns {Promise<{ success: boolean, data?: any, error?: string }>}
   */
  static async execute(config, context = {}) {
    try {
      // 변수 치환
      const variables = this.parseContext(context);
      const message = this.replaceVariables(config.message, variables);

      // TODO: 실제 로직 구현
      console.log('Executing template tool:', { config, message });

      return { success: true, data: { message } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Context를 변수 객체로 변환
   */
  static parseContext(context) {
    const { content } = context;
    let variables = {};

    if (content) {
      try {
        variables = JSON.parse(content);
      } catch {
        variables = { content };
      }
    }

    return variables;
  }
}

module.exports = TemplateTool;
