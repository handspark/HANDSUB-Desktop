/**
 * HTTP Request Tool
 * 다양한 HTTP 메서드, 헤더, 바디 타입 지원
 */
const BaseTool = require('../BaseTool');
const { validateUrl, safeJsonParse, sanitizeObject } = require('../security');
const https = require('https');
const http = require('http');

class HttpTool extends BaseTool {
  static get meta() {
    return {
      id: 'http',
      name: 'HTTP Request',
      description: 'HTTP 요청을 전송합니다 (GET, POST, PUT, DELETE, PATCH)',
      icon: '🌐',
      category: 'integration',
      version: '1.0.0'
    };
  }

  static get schema() {
    return [
      {
        name: 'url',
        type: 'text',
        label: 'URL',
        placeholder: 'https://api.example.com/endpoint',
        required: true
      },
      {
        name: 'method',
        type: 'select',
        label: 'Method',
        options: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        default: 'POST',
        required: true
      },
      {
        name: 'headers',
        type: 'keyvalue',
        label: 'Headers',
        required: false
      },
      {
        name: 'queryParams',
        type: 'keyvalue',
        label: 'Query Parameters',
        required: false
      },
      {
        name: 'bodyType',
        type: 'select',
        label: 'Body Type',
        options: ['json', 'form', 'raw', 'none'],
        default: 'json',
        required: false
      },
      {
        name: 'body',
        type: 'textarea',
        label: 'Body 템플릿',
        placeholder: '{"text": "{{내용}}"}',
        required: false,
        hint: '{{필드명}} 형식으로 동적 값 지정',
        showWhen: { field: 'bodyType', notEquals: 'none' }
      },
      {
        name: 'resultPath',
        type: 'result',
        label: '결과',
        placeholder: '테스트 후 선택 (비워두면 삽입 안 함)',
        required: false
      }
    ];
  }

  static get defaults() {
    return {
      url: '',
      method: 'POST',
      headers: {},
      queryParams: {},
      bodyType: 'json',
      body: '',
      resultPath: ''
    };
  }

  static validate(config) {
    const errors = [];

    if (!config.url) {
      errors.push('URL is required');
    } else {
      // SSRF 방지 검증 포함
      const urlValidation = validateUrl(config.url);
      if (!urlValidation.valid) {
        errors.push(urlValidation.error);
      }
    }

    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    if (config.method && !validMethods.includes(config.method)) {
      errors.push('Invalid HTTP method');
    }

    return { valid: errors.length === 0, errors };
  }

  static async execute(config, context = {}) {
    try {
      // SSRF 방지: URL 보안 검증
      const urlValidation = validateUrl(config.url);
      if (!urlValidation.valid) {
        return { success: false, error: urlValidation.error };
      }

      const url = urlValidation.url;

      if (config.queryParams && typeof config.queryParams === 'object') {
        for (const [key, value] of Object.entries(config.queryParams)) {
          if (key && value !== undefined) {
            url.searchParams.append(key, value);
          }
        }
      }

      // 쿼리 파라미터 추가 후 다시 SSRF 검증 (리다이렉트 공격 방지)
      const finalValidation = validateUrl(url.toString());
      if (!finalValidation.valid) {
        return { success: false, error: finalValidation.error };
      }

      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const method = config.method || 'POST';
      const bodyType = config.bodyType || 'json';

      const headers = { ...config.headers };
      if (!headers['Content-Type'] && bodyType !== 'none') {
        headers['Content-Type'] = this.getContentType(bodyType);
      }

      let body = this.processBody(config, context, bodyType);

      // 디버그: 전송되는 body 확인
      console.log('[HTTP Tool] Body before send (JSON):', JSON.stringify(body));
      console.log('[HTTP Tool] Context meta:', context.meta);

      const resultPath = config.resultPath || '';

      return new Promise((resolve) => {
        const req = httpModule.request(url, {
          method,
          headers,
          timeout: 10000
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            const parsedData = this.parseResponse(data, res.headers['content-type']);
            const insertText = resultPath ? this.getValueByPath(parsedData, resultPath) : null;

            resolve({
              success: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              data: parsedData,
              insertText: insertText !== undefined ? String(insertText) : null
            });
          });
        });

        req.on('error', (e) => {
          resolve({ success: false, error: e.message });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Request timeout' });
        });

        if (body && method !== 'GET') {
          req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
      });
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static getContentType(bodyType) {
    const types = {
      json: 'application/json',
      form: 'application/x-www-form-urlencoded',
      raw: 'text/plain'
    };
    return types[bodyType] || 'application/json';
  }

  /**
   * JSON 문자열 escape (따옴표, 줄바꿈 등 처리)
   */
  static escapeForJson(str) {
    if (typeof str !== 'string') return str;
    // JSON.stringify로 escape 후 앞뒤 따옴표 제거
    const escaped = JSON.stringify(str).slice(1, -1);
    console.log('[HTTP Tool] escapeForJson input length:', str.length, 'output length:', escaped.length);
    return escaped;
  }

  /**
   * 템플릿 변수 치환 (JSON escape 적용)
   * @override
   */
  static replaceVariables(template, variables = {}) {
    if (!template || typeof template !== 'string') return template;

    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      // JSON body에서 사용되므로 escape 적용
      result = result.split(placeholder).join(this.escapeForJson(value || ''));
    }
    return result;
  }

  static processBody(config, context, bodyType) {
    if (bodyType === 'none') return '';

    let body = config.body || '';
    const { content, meta } = context || {};

    console.log('[HTTP Tool] processBody input:', { body, meta, content });

    // 메타 변수 치환 ({{top}}, {{all}}) - JSON escape 적용
    if (body) {
      if (body.includes('{{top}}')) {
        const topValue = (meta && meta.top) || '';
        console.log('[HTTP Tool] Replacing {{top}} with:', topValue);
        body = body.split('{{top}}').join(this.escapeForJson(topValue));
      }
      if (body.includes('{{all}}')) {
        const allValue = (meta && meta.all) || '';
        console.log('[HTTP Tool] Replacing {{all}} with:', allValue);
        body = body.split('{{all}}').join(this.escapeForJson(allValue));
      }
    }

    console.log('[HTTP Tool] Body after meta replacement (JSON):', JSON.stringify(body));

    if (content) {
      // Prototype Pollution 방지
      let variables = safeJsonParse(content);
      if (!variables) {
        variables = { content };
      }

      if (body && typeof variables === 'object') {
        body = this.replaceVariables(body, variables);

        if (body.includes('{{content}}') && variables.content) {
          body = body.split('{{content}}').join(this.escapeForJson(variables.content));
        }
      } else if (!body) {
        body = JSON.stringify({ text: content });
      }
    }

    return body;
  }

  static parseResponse(data, contentType) {
    if (contentType && contentType.includes('application/json')) {
      try {
        return JSON.parse(data);
      } catch {
        return data;
      }
    }
    return data;
  }

  /**
   * 점 표기법으로 객체에서 값 추출 (배열 인덱스 지원)
   * @param {Object} obj - 대상 객체
   * @param {string} path - 경로 (예: "data.result.text" 또는 "output[0].content[0].text")
   * @returns {any} 추출된 값 또는 undefined
   */
  static getValueByPath(obj, path) {
    if (!obj || !path) return undefined;

    // 배열 인덱스를 점 표기법으로 변환: output[0].content[0] → output.0.content.0
    const normalizedPath = path.replace(/\[(\d+)\]/g, '.$1');
    const keys = normalizedPath.split('.');

    let value = obj;
    for (const key of keys) {
      if (value === null || value === undefined) return undefined;
      if (key === '') continue; // 빈 키 스킵
      value = value[key];
    }
    return value;
  }
}

module.exports = HttpTool;
