# 모델과 제공처 설정

Preview 2의 신규 기능이다. 설정 → 디버그에서 **디버그 모드 사용**, **신규 기능 사용해보기**를 모두 켠 뒤 연결·사용량 → **AI 제공처 선택**을 연다. 방송과 진행 중인 모델 요청을 마친 뒤 변경한다.

| 제공처 | 설정 | 인증 |
|---|---|---|
| ChatGPT 구독 · Codex | 모델 ID, 추론 수준. 기본 `gpt-6-astra / low` | 번들 공식 CLI의 ChatGPT 로그인 |
| OpenAI API | 모델 ID, 추론 수준 | 선택 후 API 키 입력 |
| 이 PC의 Ollama | 설치된 로컬 모델명, 127.0.0.1 주소, 문맥 크기 | 별도 키 없음 |
| Claude 구독 · 공식 CLI | 모델 ID, 필요 시 공식 실행 파일 절대 경로 | 공식 `claude auth login` |
| Gemini Google 계정 · 공식 CLI | 모델 ID, 필요 시 공식 JS 실행 파일 절대 경로 | 공식 `gemini`에서 Google 로그인 |
| Claude API | 사용 계정에서 허용된 정확한 모델 ID | 선택 후 Anthropic API 키 입력 |
| Gemini API | 사용 계정에서 허용된 정확한 모델 ID | 선택 후 Gemini API 키 입력 |

모델명을 자동으로 바꾸거나 실패 시 다른 제공처로 우회하지 않는다. 모델별 지원 입력·JSON 출력·추론 수준·접근 권한은 다르므로 **선택한 제공처 적용** 후 **모델 응답 확인**으로 시험한다. Claude/Gemini의 추론은 해당 API/모델의 기본값을 사용한다. 다른 모델의 API 키는 Codex 구독 로그인과 별개다. Claude·Gemini는 구독/Google 계정을 사용하는 공식 CLI 방식을 우선 제공하며, API 키 방식은 선택 사항이다.

제공처·모델·추론 수준 등 비밀이 아닌 선택값만 `provider-choice.json`에 저장한다. UI에서 입력한 API 키는 실행 중 메모리에만 존재하며 다시 실행하면 입력해야 한다. 개발 실행은 `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` 환경 변수를 사용할 수 있다. 키를 채팅·스크린샷·이슈에 올리지 않는다. Claude는 `api.anthropic.com`, Gemini는 `generativelanguage.googleapis.com`으로만 보내며 리디렉션을 따라가지 않는다.

화면·텍스트는 기존 관객 프롬프트/기억 구성 경로에서 각 제공처의 메시지 형식으로 변환한다. 음성 인식은 기존 로컬 인식을 유지한다. Claude/Gemini/Ollama의 웹 검색은 지원하지 않으므로 해당 제공처에서 훈수 요청 시 웹 검색 설정을 꺼야 한다. 잘못된 JSON·불완전한 응답은 표시하지 않으며 API 사용료는 별도로 발생할 수 있다.

한 실험 옵션을 끄면 기본 Codex(기존 OpenAI 환경 설정이 있으면 그 기본값)로 돌아간다. 저장된 모델 선택은 보존되지만 꺼진 상태에서는 Ollama나 다른 실험 제공처를 확인/실행하지 않는다.

공식 인터페이스 참고: [Claude 구조화 출력](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Claude Messages](https://platform.claude.com/docs/en/api/http/messages/create), [Gemini 구조화 출력](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en). Claude의 전송 스키마는 지원하지 않는 길이·숫자 제약을 제외하되, 받은 결과는 앱의 원래 Observation 스키마로 다시 검사한다.

## 구독 계정 연결

1. 공식 [Claude Code 설치 안내](https://code.claude.com/docs/en/setup) 또는 [Gemini CLI](https://geminicli.com/docs/get-started/installation/)에 따라 Windows CLI를 설치한다. 검증한 최소 버전은 Claude Code 2.1.270, Gemini CLI 0.59.0이다. Gemini npm 설치에는 Node.js가 필요하다.
2. 설정에서 **Claude 구독 · 공식 CLI** 또는 **Gemini Google 계정 · 공식 CLI**를 선택하고 모델 ID를 입력한 뒤 적용한다. 설치/로그인 준비가 안 되어도 선택값은 저장할 수 있어 로그인 안내로 이어진다. 선택 저장은 모델 응답 성공 판정이 아니다.
3. **공식 CLI 로그인 창 열기**를 누른다. Claude는 공식 `auth login`, Gemini는 공식 CLI의 Google 로그인 선택을 사용한다. 새 공식 터미널과 브라우저에서 사용자가 직접 인증한다. 앱은 로그인 토큰 파일을 읽거나 복사하지 않는다.
4. 인증 후 공식 터미널을 닫고 앱의 **연결 상태 새로고침**, **모델 응답 확인**을 실행한다. Gemini의 설치 확인은 인증 확인과 다르며 응답 시험으로 확인한다. Claude의 로컬 로그인 상태도 세션 만료로 실제 요청이 실패할 수 있다.

자동 탐색이 실패하면 신뢰하는 공식 설치 파일만 지정한다. Claude는 `.exe`, Gemini npm 패키지는 `@google/gemini-cli/bundle/gemini.js` 경로를 지정할 수 있다. 입력은 셸 명령으로 실행하지 않는다. 개발 환경의 `CLAUDE_BIN`, `GEMINI_BIN`, JS 실행용 `NAGNEON_NODE_BIN`도 지원한다. 사용자 설치 CLI와 Node는 배포 ZIP에 추가로 동봉하지 않는다.

관객 호출은 임시 폴더에서 도구/후크/MCP/확장 없이 실행한다. Claude는 safe/restricted 모드, Gemini는 자식 프로세스에만 적용하는 제한 설정과 OAuth 로그인 유형을 사용한다. API/Vertex 인증 환경 변수를 넘기지 않아 API 과금 방식으로 자동 우회하지 않는다. 모델 선택은 앱에서 고정하지만 CLI 자체의 서비스 정책과 계정 허용 모델은 공식 CLI의 동작을 따른다.

현재 PC의 실제 검사: Claude Code 2.1.270은 Max 계정의 로컬 로그인 상태를 반환했으나 실제 요청은 OAuth 세션 만료로 실패했다. Gemini CLI 0.59.0은 비대화형 요청에서 수동 Google 인증 필요를 반환했다. 사용자 재로그인 이후의 실응답은 미검증이며 이를 완료로 표시하지 않는다. 테스트에서는 공식 실행 옵션·이미지/텍스트 전달·취소·출력 검증·한글 청크 처리를 검사했다.

공식 CLI 참고: [Claude CLI](https://code.claude.com/docs/en/cli-reference), [Gemini headless](https://geminicli.com/docs/cli/headless/), [Gemini 설정](https://geminicli.com/docs/reference/configuration/).
