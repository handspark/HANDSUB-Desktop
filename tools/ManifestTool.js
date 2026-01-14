/**
 * ManifestTool - 심플한 manifest.json 기반 도구
 *
 * manifest.json 구조:
 * {
 *   "name": "도구 이름",
 *   "icon": "🔧",
 *   "settings": { "url": { "label": "URL" } },
 *   "commands": [
 *     { "shortcut": "알림", "fields": ["내용"], "body": "..." }
 *   ]
 * }
 */
const https = require('https');
const http = require('http');

class ManifestTool {
  constructor(manifest, folderName) {
    this.manifest = manifest;
    this.id = folderName;
    this.name = manifest.name || folderName;
    this.icon = manifest.icon || '🔧';
    this.settings = manifest.settings || {};
    this.commands = manifest.commands || [];
  }

  /**
   * 설정 스키마 (설정 화면용)
   */
  getSettingsSchema() {
    return Object.entries(this.settings).map(([key, val]) => ({
      name: key,
      label: val.label || key,
      type: val.type || 'text',
      placeholder: val.placeholder || '',
      required: val.required || false
    }));
  }

  /**
   * 명령어 목록 (단축어 자동 등록용)
   */
  getCommands() {
    return this.commands.map(cmd => ({
      toolId: this.id,
      shortcut: cmd.shortcut,
      fields: cmd.fields || [],
      body: cmd.body || ''
    }));
  }

  /**
   * 명령어 실행
   */
  async execute(commandShortcut, fieldValues, toolSettings) {
    const cmd = this.commands.find(c => c.shortcut === commandShortcut);
    if (!cmd) {
      return { success: false, error: '명령어를 찾을 수 없습니다' };
    }

    // URL 가져오기
    const url = toolSettings.url;
    if (!url) {
      return { success: false, error: 'URL이 설정되지 않았습니다' };
    }

    // body 템플릿에 값 치환 (빈 문자열도 fallback 적용)
    let body = cmd.body || '{"text": "{{content}}"}';

    // fieldValues 치환 ({"내용": "테스트"} 형태)
    for (const [key, value] of Object.entries(fieldValues)) {
      body = body.split(`{{${key}}}`).join(value || '');
    }

    // 기본 content 치환
    if (body.includes('{{content}}') && fieldValues['내용']) {
      body = body.split('{{content}}').join(fieldValues['내용']);
    }

    // HTTP 요청 실행
    return this.sendRequest(url, body);
  }

  /**
   * HTTP POST 요청
   */
  sendRequest(urlStr, body) {
    return new Promise((resolve) => {
      try {
        const url = new URL(urlStr);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const req = httpModule.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

        req.on('error', (e) => resolve({ success: false, error: e.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: '요청 시간 초과' });
        });

        req.write(body);
        req.end();
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  }
}

module.exports = ManifestTool;
