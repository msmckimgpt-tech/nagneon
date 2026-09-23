# 브라우저에서 사용할 수 있는 로컬 연결 포트

## 문제와 구현

운영체제가 `listen(0)`으로 배정한 포트라도 Fetch와 Chromium에서는 접근을 거부할 수 있다. [Fetch의 차단 포트 규칙](https://fetch.spec.whatwg.org/#port-blocking)과 [Chromium 구현](https://raw.githubusercontent.com/chromium/chromium/main/net/base/port_util.cc)에 해당하는 포트에서는 서버가 정상 작동해도 페이지나 API 요청이 실패한다.

Windows의 실제 자동 배정에서 1719번 포트를 얻었고, 같은 서버가 Node HTTP 요청에는 200을 반환하지만 `fetch`에는 `fetch failed` / `bad port`가 발생함을 확인했다. 현재 데스크톱 진입점도 자동 포트를 사용하므로 테스트에만 국한된 문제가 아니다. 이전 기록에 남은 모든 `fetch failed`의 원인이 동일하다고 단정하지는 않는다.

`server/browser-loopback.js`는 실제 서버를 `127.0.0.1`에 바인딩한 뒤 포트를 검사한다. 자동 배정이 차단 포트이면 해당 리스너를 닫고 최대 32회까지 다시 배정받는다. 사용 가능한 URL만 호출자에게 반환한다. 명시적으로 지정한 차단 포트는 프로필·제공처 초기화 전에 거부하며, 사용 중인 고정 포트를 임의의 다른 포트로 바꾸지 않는다.

앱 서버와 치지직 임시 콜백에 적용한다. 치지직 기본 콜백 포트 4319와 인증 프로토콜은 유지한다. 취소된 인증은 포트 재배정 중에도 다시 열리지 않는다. 앱 서버 준비가 실패하면 이미 초기화한 작업자·타이머를 정상 종료 경로로 정리한다. 브라우저 차단 해제 플래그나 OS 네트워크 설정 변경은 사용하지 않는다.

## 검증

- `test/browser-loopback.test.js`: 실제 6000번 포트 배정을 주입하면 수정 전에는 앱 URL이 해당 포트를 그대로 사용하여 실패했다. 수정 후 대체 포트의 인증 요청은 200, 인증 없는 요청은 401을 반환한다. 고정 포트 거부·재시도 상한·바인딩 중/재시도 사이 취소·초기화 실패 정리·인증 콜백을 함께 검사한다.
- 관련 검사 12개 통과. 클립 및 Ollama의 독립 HTTP 테스트 서버에도 같은 포트 배정을 적용했다. 테스트의 요청·응답 단언을 완화하지 않았다.
- `npm run check`: 785개 테스트·형식 검사·TypeScript/Vite 빌드 통과. `npm audit --audit-level=high`: 취약점 0건.
- `scripts/verify-browser-loopback.cjs`: 별도 프로필의 실제 Electron에서 6000번은 `ERR_UNSAFE_PORT`로 차단되고, 대체 포트에서는 첫 실행 UI·인증된 renderer fetch가 정상 작동했다. 정상 종료 후 리스너 해제도 확인했다. 모델·실계정·장치는 사용하지 않았다. Windows CI에 같은 검사를 추가했다.

검증용 Electron 스크립트의 첫 실행은 거부된 포트 확인용 창을 닫는 순간 앱이 종료되어 다음 창 로딩이 실패했다. 검증 스크립트에서 마지막 창 닫기와 명시적 종료를 분리한 뒤 재실행했고, 결과 JSON·화면·종료 상태를 확인했다. 최초 실패를 제품 기능 통과 근거로 사용하지 않는다.

원본은 `browser-safe-loopback-20260923/artifacts/`의 `ephemeral-port-reproduction.json`, `loopback-before.log`, `loopback-regressions-final.log`, `check-final.log`, `audit.log`, `loopback-electron-runner.log`, `loopback-electron-final.log`에 보존한다. 최종 실제 화면과 결과는 `browser-loopback-deHT93/`에 있다. 이 기록은 소스 및 격리 실행 검증이며 사용자 설치본 교체나 패키지 배포 완료를 뜻하지 않는다.

## 유지보수

Electron/Node 갱신 시 차단 포트 집합과 네이티브 검사를 함께 확인한다. 브라우저 정책·연결 종료·인증 만료 등 다른 원인의 네트워크 오류는 이 처리로 자동 재시도하지 않는다. 이 변경은 데이터 저장 형식을 바꾸지 않는다.
