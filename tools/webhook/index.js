/**
 * Webhook Tool
 * Slack, Discord 등 웹훅 URL로 메시지 전송
 */
const BaseTool = require('../BaseTool');
const https = require('https');
const http = require('http');

class WebhookTool extends BaseTool {
  static get meta() {
    return {
      id: 'webhook',
      name: 'Webhook',
      description: '웹훅 URL로 메시지를 전송합니다',
      icon: '🔗',
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
        placeholder: 'https://hooks.slack.com/...',
        required: true
      },
      {
        name: 'body',
        type: 'textarea',
        label: 'Body 템플릿',
        placeholder: '{"text": "{{내용}}"}',
        required: false,
        hint: '{{필드명}} 형식으로 동적 값 지정'
      }
    ];
  }

  static get defaults() {
    return {
      url: '',
      body: ''  // 빈 값 - placeholder로 예시 표시, execute에서 fallback 처리
    };
  }

  static validate(config) {
    const errors = [];

    if (!config.url) {
      errors.push('URL is required');
    } else {
      try {
        new URL(config.url);
      } catch {
        errors.push('Invalid URL format');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static async execute(config, context = {}) {
    try {
      const url = new URL(config.url);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      let body;
      if (config.body) {
        // Body 템플릿이 있으면 폼 입력값 사용
        const variables = this.parseContext(context);
        body = this.replaceVariables(config.body, variables);
      } else {
        // Body 템플릿이 비어있으면 메모장 전체 내용 사용
        const memoContent = context.editorContent || context.content || '';
        body = JSON.stringify({ text: memoContent });
      }

      const headers = {
        'Content-Type': 'application/json'
      };

      return new Promise((resolve) => {
        const req = httpModule.request(url, {
          method: 'POST',
          headers,
          timeout: 10000
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              success: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              data
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

        req.write(body);
        req.end();
      });
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

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

    if (!variables.content && content) {
      variables.content = content;
    }

    return variables;
  }
}

module.exports = WebhookTool;
