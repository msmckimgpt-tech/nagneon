# 첫 방송 안내와 계정 연결

신규 프로필에서는 이름/제목 → 게임·Just Chatting → 분위기/훈수 → 계정과 시작 안내를 제공한다. 기존 settings.json이 있는 프로필은 자동으로 기존 사용자로 취급하며 처음 화면을 강제로 띄우지 않는다. 방송 설정에서 안내를 다시 열 수 있다. 완료와 건너뛰기는 onboarding.json에 백업 가능한 JsonStore로 저장한다. 이름·제목·카테고리·분위기·훈수·모드만 갱신하므로 기존 관객, 매니저, 포인트, 게임 기억을 초기화하지 않는다.

완료 시 방송실에 입장하며 방송/마이크/화면을 자동으로 시작하지 않는다. 리허설은 준비된 채팅이고 실제 모델 호출은 없다. AI 방송은 사용자가 방송을 시작한 뒤 화면 또는 대화를 제공할 때 모델을 호출한다.

## 공식 로그인 연결

`desktop/account-login.cjs`는 공식 Codex CLI의 `login` 또는 `login --device-auth` 프로세스 하나만 소유한다. 기본은 브라우저 로그인이다. 기기 코드 방식은 OpenAI 문서상 베타이며 계정/조직에서 허용되어 있어야 한다. 실제 인증·자격 증명 저장/갱신은 CLI가 처리한다. 앱은 auth.json이나 로그인 토큰을 읽지 않는다. [공식 인증 설명](https://learn.chatgpt.com/docs/auth)

CLI 0.154.0의 출력은 16KB로 제한하고, ANSI 표시를 제거한 후 공식 `https://auth.openai.com/oauth/authorize` (로컬 callback) 또는 정확한 `https://auth.openai.com/codex/device`만 처리한다. 앱의 링크 열기 IPC는 사용자가 임의 URL을 넘길 수 없다. 코드/URL은 메인 창 전용 임시 상태이며 Studio.state, HTTP/SSE, export, 저장 데이터, 모델 입력에 포함하지 않는다. 원시 CLI 출력도 앱 로그나 채팅으로 전달하지 않는다. CLI 자체의 로그인 진단 로그는 공식 CLI가 관리한다.

중복 시작은 같은 작업을 반환한다. 취소/15분 만료는 소유한 자식만 종료하고 close 전까지 새 프로세스를 만들지 않는다. 완료는 종료 코드만 믿지 않고 `login status`의 ChatGPT 로그인을 재확인한다. 취소 후 늦게 끝난 확인은 로그인 성공 상태로 되돌리지 않는다. 앱 종료 시 진행 중 연결을 정리한다. 이미 ChatGPT 연결이 확인된 계정은 교체 로그인하지 않는다. 오버레이는 계정 관련 IPC에 접근할 수 없다.

## 계정 상태와 모델 응답은 별도 확인

개발 실행에서는 `CODEX_BIN` 명시값을 우선하고, 없으면 프로젝트에 설치한 공식 `@openai/codex` 플랫폼 패키지의 네이티브 실행 파일을 자동 선택한다. Windows npm의 `codex.cmd`를 `spawn('codex')`로 실행하던 경로는 사용하지 않는다. 패키지 경로도 없을 때만 PATH의 `codex`를 사용한다. 배포본은 계속 `resources/codex/bin/codex.exe`를 명시하며, 상태 확인·로그인·모델 호출은 동일한 실행 파일과 환경을 공유한다. [수정 원인과 검증](ACCOUNT-CONNECTION-FIX.md)

계정 상태 확인은 로그인 유무이며 특정 모델 접근/남은 한도의 보장이 아니다. **Astra 응답 확인 · 1회 사용**은 사용자 선택 시 gpt-6-astra / low에 합성 인사 요청 하나를 전송한다. 실제 화면, 음성, 방송 제목, 스트리머 이름, 관객 개인 기억은 포함하지 않는다. 방송 채팅·이벤트·포인트에 합류하지 않고 별도 응답/시간/사용량을 표시한다. 방송과 연습 중에는 실행할 수 없고, 중복 실행·동시 쓰기는 거부한다. 취소해도 이미 전송한 요청은 구독 사용량에 반영될 수 있다.

응답 실패는 원시 오류를 공개하지 않고 사용량/모델 권한/인증/네트워크/기타 범주별 고정 안내를 제공한다. 성공은 해당 시각 요청의 성공이며 이후 사용 가능성의 보장이 아니다. 모델을 임의로 다른 것으로 바꾸지 않는다.

## 검증과 한계

- Node 검사: 신규/기존 프로필 호환, 잘못된 입력, 저장 실패 재시도, 동시 요청/취소, 합성 입력 격리, 공식 로그인 출력 파싱/URL 제한/만료/늦은 완료. `test/onboarding.test.js`, `account-login.test.js`.
- 실제 공식 CLI 기기 코드 **발급과 취소**: `artifacts/account-device-test.json`. 빈 별도 CODEX_HOME에서 실행해 기존 계정 변경 없음. 실제 신규 계정의 인증 완료는 수행하지 않았다.
- Electron 신규 안내 흐름 6개: `artifacts/onboarding-desktop-test.json`. 인증/모델은 테스트 대역이다. 저장 SSE가 HTTP 응답보다 먼저 도착해도 안내를 조기에 닫지 않는 회귀 검증 포함.
- 실제 desktop 진입점의 오버레이/계정 IPC 경계와 종료: `artifacts/desktop-lifecycle-test.json`. 허용되지 않은 오버레이 요청 거부 로그는 의도된 검사다.
- 확장 기능 7개 회귀: `artifacts/expansion-desktop-test.json` (합성 미디어/모델).
- 네이티브 화면 및 실제 Astra 응답 결과는 후속 `onboarding-native-test.json`에 구분 기록한다. 새 Windows의 신규 계정 로그인/기업 정책·브라우저 callback 전체 조합은 아직 미검증이다.

UI 검증 중 두 문제가 구분되었다. 첫 테스트의 hidden 창 이미지 캡처는 `UnknownVizError`로 실패해 기능 검증과 네이티브 시각 확인을 분리했다. 실제 앱에서는 완료 SSE가 POST 응답보다 먼저 도착해 사용자의 탭 선택을 덮는 전환 경쟁을 발견하여 초기 안내 표시 상태를 명시적으로 유지하도록 수정했다. 수정 전 로그를 보존하며, 저장 응답을 일부러 지연시킨 회귀 검증과 기존 전체 흐름의 재실행이 통과했다.

저장 실패 후 재시작 회귀도 검증했다. 모든 기존 저장소가 유효한지 확인한 뒤 초기 onboarding.json을 먼저 저장하므로, 설정만 저장된 상태에서 완료 기록이 실패해도 재시작 시 신규 안내가 유지된다. 기존 데이터가 손상되어 시작이 거부되는 경우 새 파일을 쓰지 않는 검증도 유지했다. `test/onboarding.test.js`, `storage-integration.test.js`, `artifacts/onboarding-restart-tests.log`, 최종 전체 126개 검사는 `onboarding-final-package-retry.log`.
