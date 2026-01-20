# HandSub

빠르고 가벼운 데스크톱 메모 앱. 단축키 한 번으로 언제든 메모하세요.

## 설치

### macOS

```bash
git clone https://github.com/handspark/HandSub-Desktop.git
cd HandSub-Desktop
npm install
npm run build:mac
```

```bash
open /Applications/HandSub.app
```
⚠️ 첫 실행 시: 우클릭 → 열기 (보안 경고 우회)

### Windows

#### 사전 요구사항

Windows에서 빌드하려면 **Visual Studio Build Tools**가 필요합니다 (네이티브 모듈 컴파일용).

**설치 방법 (택 1):**

1. **winget 사용** (PowerShell 관리자 권한):
```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

2. **직접 설치**:
   - https://aka.ms/vs/17/release/vs_BuildTools.exe 다운로드
   - 설치 시 **"C++를 사용한 데스크톱 개발"** 워크로드 선택

#### 빌드

```powershell
git clone https://github.com/handspark/HandSub-Desktop.git
cd HandSub-Desktop
npm install
npm run build:win
```

#### 실행

```powershell
.\dist\win-unpacked\HandSub.exe
```

> **참고**: 프로젝트 경로에 한글이나 공백이 있으면 빌드가 실패할 수 있습니다. `C:\Dev\HandSub-Desktop` 같은 경로를 권장합니다.

## 주요 기능

- **글로벌 단축키** - 어디서든 `Cmd+Shift+Space`로 즉시 메모
- **자동 저장** - 입력과 동시에 자동 저장
- **스니펫** - 단축어로 Webhook, HTTP 요청 실행
- **미디어 지원** - 이미지, 동영상 붙여넣기
- **링크 미리보기** - URL 입력 시 OG 메타데이터 표시
- **체크리스트** - `[ ]` 입력으로 체크박스 생성

## 단축키

| 동작 | Mac | Windows |
|------|-----|---------|
| 앱 열기 | `Cmd+Shift+Space` | `Ctrl+Shift+Space` |
| 새 메모 | `Cmd+Shift+N` | `Ctrl+Shift+N` |
| 창 닫기 | `ESC` | `ESC` |

## 커스텀 도구 만들기

`tools/` 폴더에 새 도구를 추가하여 스니펫 기능을 확장할 수 있습니다.

### 만드는 방법

1. `tools/` 폴더에 새 폴더 생성 (예: `tools/slack/`)

2. `manifest.json` 파일 작성:

```json
{
  "name": "Slack",
  "icon": "💬",
  "description": "Slack으로 메시지 보내기",
  "settings": {
    "webhookUrl": {
      "type": "text",
      "label": "Webhook URL",
      "placeholder": "https://hooks.slack.com/services/...",
      "required": true
    }
  },
  "commands": [
    {
      "shortcut": "슬랙",
      "name": "메시지 보내기",
      "fields": [
        {
          "name": "message",
          "label": "메시지",
          "type": "text"
        }
      ],
      "request": {
        "method": "POST",
        "url": "{{webhookUrl}}",
        "headers": {
          "Content-Type": "application/json"
        },
        "body": {
          "text": "{{message}}"
        }
      }
    }
  ]
}
```

3. 앱 재시작 → 설정에서 도구 연결 → 메모에서 `/슬랙` 입력

### manifest.json 스펙

| 필드 | 설명 |
|------|------|
| `name` | 도구 이름 |
| `icon` | 이모지 아이콘 |
| `description` | 도구 설명 |
| `settings` | 설정 창에서 입력받을 값 (API 키 등) |
| `commands` | 단축어 명령어 목록 |

### commands 스펙

| 필드 | 설명 |
|------|------|
| `shortcut` | 호출 키워드 (예: `/슬랙`) |
| `name` | 명령어 이름 |
| `fields` | 실행 시 입력받을 필드 |
| `request` | HTTP 요청 설정 |

### 템플릿 변수

`{{변수명}}` 형식으로 동적 값 삽입:

- `{{settings의 key}}` - 설정에서 입력한 값
- `{{field의 name}}` - 실행 시 입력한 값
- `{{content}}` - 선택한 텍스트
- `{{editorContent}}` - 메모 전체 내용

## 라이선스

MIT License
