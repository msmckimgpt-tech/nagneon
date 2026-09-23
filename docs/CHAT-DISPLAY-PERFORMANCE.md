# 내 발언 표시 전환 성능

## 2026-09-23 발언 수신의 중복 상태 생성 제거

새 발언을 받을 때 메시지를 기록하면서 한 번, 발언 접수와 이전 반응 취소를 끝낸 뒤 다시 한 번 상태를 발행하던 경로를 정리했다. 이제 `receiveSpeech`는 접수 기록과 취소 처리를 끝낸 상태를 동기적으로 한 번 발행한다. `publishMessage`의 기본 즉시 발행은 유지해 일반 관객 메시지와 큐 전달은 바뀌지 않는다. 타이머나 추가 표시 대기는 도입하지 않았다.

- 회귀 검사 4개: 접수·이전 반응 취소·유료 반응 보존, 재시도 중복 방지와 직접 메시지 발행, 입력 대기열 초과 거절, 기억 저장 실패 시 메시지와 오류 안내 보존.
- 실제 로컬 HTTP/SSE 합성 검사: 초기 상태 1개와 발언 처리 후 상태 1개를 수신했다. 후속 상태의 이전 반응 대기 수는 0이며 메시지 ID가 HTTP 접수 결과와 일치한다. 모델 호출과 물리 장치 사용은 0회다.
- `npm run check`: 포매팅, 712개 검사, TypeScript/Vite 빌드 통과. `npm audit --audit-level=high`: 취약점 0건.
- 증거는 `review-speech-publish-20260923/artifacts/`의 `speech-publication-focused.log`, `check-resumed.log`, `audit-resumed.log`, `speech-publication-http-result.json`이다. 설치본 적용, 실제 사용자 방송 지연 또는 전체 상태 발행 빈도 개선을 검증한 결과는 아니다.

## 기존 표시 전환 개선

2026-09-13 사용자 보고: 오버레이에서 내 발언 표시를 누를 때마다 성능이 저하된다.

- 작업: `fix/overlay-display-performance`, `G:/dev/ai/00_game_backseat-worktrees/overlay-display-performance`
- 기준: `acf8ca439d86c7481df892b7b2b54c3dcf3536c6`
- 확인된 불필요한 작업: boolean 설정 변경에도 전체 Studio 상태 생성과 모든 SSE 클라이언트에 전체 JSON 전송, 모든 채팅 객체 교체, 표시 전환마다 smooth scroll 시작, 시간이 표시되지 않는 오버레이의 1초 타이머 렌더링.
- 변경: 저장 성공 뒤 `chat-display` SSE 이벤트로 boolean만 보낸다. 클라이언트는 settings 필드만 교체하고 기존 메시지 참조를 보존한다. ChatLine memo로 그대로 남은 오버레이 줄의 재렌더링을 피한다. 오버레이 시계 타이머를 끄고 채팅 스크롤은 즉시 이동한다. 마지막 메시지 ID를 사용해 500개 상한에서도 새 메시지 스크롤이 동작한다.
- 동일 값 재요청은 저장/전송하지 않는다. 실제 변경은 기존 저장 경로를 유지한다. 전체 world 파일의 동기 저장 비용은 남아 있으며 이번 변경에서 저장 구조를 바꾸지 않았다.
- HTTP/SSE 합성 검증: 메시지 500개, 클라이언트 2개, 전환 20회. 전체 상태 384,299바이트/창, 전환 이벤트는 20회 합계 1,150바이트/창. 전환 중 전체 상태 생성 0회. 재접속 최신값, 구독 해제, 저장 실패, 같은 값 재요청도 검증했다. 이 수치는 합성 데이터의 전송량이며 실제 FPS/클릭 지연 측정은 아니다.
- 기존 `live-conversation` 9개 검사 통과(영구 저장/재시작 복원/원문 보존 포함). `npm run check` Node 277개 및 TypeScript/Vite 빌드 결과는 `artifacts/display-performance-check.log`에 보존한다. 설치 로그는 `artifacts/install.log`, 기존 회귀 로그는 `artifacts/display-focused.log`.
- 사용자 테스트 보호 지침으로 앱/화면/장치를 조작하거나 사용자 앱을 재시작하지 않았다. 실제 Windows 오버레이의 반복 클릭 수용 검증은 미완료다. 사용자 앱 재시작 후 적용하고, 별도 허용 후 실제 지연이 남는지 확인한다. 원격 푸시는 하지 않는다.
