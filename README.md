# Handsub

빠르고 가벼운 메모 앱. 단축키로 언제든지 메모를 작성하고, 단축어로 외부 서비스와 연동할 수 있습니다.

## 주요 기능

### 메모
- **글로벌 단축키**: 어떤 앱을 사용 중이든 단축키로 즉시 메모창 열기
  - 열기: `Cmd+Shift+Space` (변경 가능)
  - 새 메모: `Cmd+Shift+N` (변경 가능)
- **자동 저장**: 입력과 동시에 자동 저장 (300ms 디바운스)
- **메모 고정(Pin)**: 중요한 메모를 목록 상단에 고정
- **UUID 기반**: 각 메모에 고유 UUID 부여 (협업 동기화 대비)

### 사이드바
- **메모 목록**: 최신순 정렬, 고정 메모 상단 표시
- **실시간 검색**: 메모 내용 검색
- **리사이즈**: 사이드바 너비 조절 (100px ~ 400px)
- **메모 탐색**: 방향키로 메모 간 이동
  - 사이드바 열림: `↑` / `↓`
  - 사이드바 닫힘: `Cmd+↑` / `Cmd+↓`

### 미디어 지원
- **이미지**: 복사/붙여넣기 또는 드래그&드롭으로 삽입
  - 지원 포맷: PNG, JPEG, GIF, WebP
  - 최대 크기: 10MB
- **동영상**: 복사/붙여넣기 또는 드래그&드롭으로 삽입
  - 지원 포맷: MP4, WebM, MOV, M4V, OGV
  - 최대 크기: 50MB
- **미디어 선택/삭제**: 클릭으로 선택, Backspace/Delete로 삭제

### 링크 미리보기
- **자동 감지**: URL 입력 시 자동으로 링크 감지
- **OG 메타데이터**: Open Graph 태그 파싱하여 미리보기 생성
- **YouTube 특별 지원**: YouTube 영상 썸네일 자동 추출
- **캐시**: 24시간 캐시로 빠른 로딩
- **외부 브라우저**: 클릭 시 기본 브라우저에서 열기

### 체크박스 & 리스트
자동 변환 기능으로 빠르게 리스트 작성:

| 입력 | 변환 결과 |
|------|----------|
| `[ ]` | ☐ (체크박스) |
| `[x]` | ☑ (체크됨) |
| `- ` | • (불릿 리스트) |
| `* ` | • (불릿 리스트) |

- **체크박스 토글**: 클릭으로 ☐ ↔ ☑ 전환
- **리스트 자동 완성**: Enter 시 다음 줄에 자동으로 리스트 마커 추가
- **리스트 종료**: 빈 리스트 항목에서 Enter 시 리스트 종료

### 단축어 (Snippets)
외부 서비스와 연동하여 빠르게 작업을 실행할 수 있습니다.

#### 기본 도구
- **Webhook**: 지정된 URL로 POST 요청 전송
- **HTTP**: GET, POST, PUT, DELETE 등 다양한 HTTP 메서드 지원

#### 매니페스트 도구
`tools/` 폴더에 `manifest.json`을 추가하여 커스텀 도구 생성 가능:

```json
{
  "name": "도구 이름",
  "icon": "🔔",
  "settings": {
    "url": { "label": "Webhook URL", "required": true }
  },
  "commands": [
    {
      "shortcut": "알림",
      "fields": ["내용"],
      "body": "{\"text\": \"{{내용}}\"}"
    }
  ]
}
```

#### 사용법
1. 설정 → 단축어에서 새 단축어 추가
2. 메모 작성 중 호출키(기본: `/`) + 단축어명 입력
3. 텍스트가 반전 처리되면 `Enter` 입력
4. 필드가 있으면 순차적으로 입력 (터미널 스타일)
5. 단축어가 실행되고 트리거 텍스트 삭제

#### 예시
```
/슬랙 → Enter → 내용 입력 → Enter → Slack Webhook 실행
/깃헙이슈 → Enter → GitHub API 호출
```

### 협업 동기화 (Beta)
- **WebSocket 연결**: 실시간 동기화 서버 연결
- **Operations 저장**: 변경사항을 Op 단위로 저장
- **오프라인 지원**: 오프라인 시 로컬 저장, 온라인 시 동기화
- **인증**: 토큰 기반 인증 (암호화 저장)

### 설정
- **앱 열기 단축키**: 글로벌 단축키 변경
- **새 메모 단축키**: 새 메모 생성 단축키 변경
- **단축어 호출키**: 단축어 트리거 문자 변경 (기본: `/`)
- **시작 시 자동 실행**: 로그인 시 앱 자동 시작
- **동기화 서버**: 협업 동기화 서버 URL 설정

## 설치

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm start

# 빌드
npm run build
```

## 기술 스택

- **Electron**: 크로스 플랫폼 데스크톱 앱
- **SQLite (better-sqlite3)**: 로컬 데이터 저장
- **Vanilla JS**: 프레임워크 없이 순수 JavaScript
- **WebSocket**: 실시간 동기화

## 데이터 저장 위치

- **macOS**: `~/Library/Application Support/handsub/`
- **Windows**: `%APPDATA%/handsub/`
- **Linux**: `~/.config/handsub/`

### 파일 구조
```
handsub/
├── handsub.db    # SQLite 데이터베이스
├── config.json   # 설정 파일
├── auth.enc      # 인증 토큰 (암호화)
└── images/       # 이미지/동영상 저장 폴더
```

### 데이터베이스 테이블
- **memos**: 메모 저장 (id, content, pinned, uuid, created_at, updated_at)
- **snippets**: 단축어 저장 (id, type, shortcut, name, config)
- **operations**: 동기화용 변경사항 (memo_uuid, op_type, op_data, timestamp, synced)
- **link_cache**: 링크 미리보기 캐시 (url, title, description, image, favicon)

## 단축키

| 동작 | 단축키 |
|------|--------|
| 앱 열기 | `Cmd+Shift+Space` (변경 가능) |
| 새 메모 | `Cmd+Shift+N` (변경 가능) |
| 창 닫기 | `ESC` |
| 메모 탐색 (사이드바 열림) | `↑` / `↓` |
| 메모 탐색 (사이드바 닫힘) | `Cmd+↑` / `Cmd+↓` |
| 스니펫 취소 | `ESC` |
| 스니펫 실행 | `Enter` |

## 프로젝트 구조

```
handsub/
├── main.js              # Electron 메인 프로세스
├── renderer.js          # 렌더러 프로세스 (에디터 로직)
├── preload.js           # IPC 브릿지 (메인 창)
├── preload-settings.js  # IPC 브릿지 (설정 창)
├── index.html           # 메인 창 HTML
├── style.css            # 메인 창 스타일
├── settings.html        # 설정 창 HTML
├── settings.css         # 설정 창 스타일
├── settings-renderer.js # 설정 창 로직
└── tools/               # 단축어 도구
    ├── index.js         # 도구 레지스트리
    ├── BaseTool.js      # 기본 도구 클래스
    ├── ManifestTool.js  # 매니페스트 도구 클래스
    ├── webhook/         # Webhook 도구
    ├── http/            # HTTP 도구
    └── _template/       # 도구 템플릿
```

## 보안

- **Context Isolation**: 렌더러와 메인 프로세스 격리
- **Node Integration 비활성화**: 렌더러에서 Node.js API 접근 차단
- **외부 URL 네비게이션 차단**: file:// 프로토콜만 허용
- **새 창 열기 차단**: window.open 차단
- **SSRF 방지**: 내부 IP/localhost 차단 (링크 미리보기)
- **입력값 검증**: ID, URL, 콘텐츠 등 모든 입력 검증
- **XSS 방지**: HTML sanitizer로 위험한 태그/속성 제거
- **인라인 이벤트 핸들러 제거**: CSP 에러 방지
- **토큰 암호화**: safeStorage API로 인증 토큰 암호화 저장

## 트레이 아이콘

시스템 트레이에서 빠른 접근:
- 새 메모
- 열기
- 설정
- 종료

macOS에서는 Dock 아이콘 숨김 (트레이만 표시)

## 라이선스

MIT
