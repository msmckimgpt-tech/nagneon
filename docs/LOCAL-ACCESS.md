# 로컬 앱 연결 경계

2026-09-13. `server/local-access.js`, `desktop/session.cjs` 구현 기준.

서버는 `127.0.0.1`의 실행별 포트에서만 수신한다. `Host`는 실제 포트와 일치해야 하며 변경 요청에는 앱 식별 헤더가 추가로 필요하다. 모든 API와 정적 화면은 256비트 난수로 만든 실행별 인증 값을 요구한다. 단순히 포트나 주소를 아는 것만으로 상태·내보내기·클립·SSE를 읽거나 방송을 시작할 수 없다.

Electron 메인 프로세스가 비영구 전용 세션을 만들고, 정확한 로컬 서버 주소로 향하는 요청에만 Authorization을 붙인다. 메인 창과 오버레이가 이 세션을 공유한다. 쿠키·localStorage·페이지 전역 변수·사용자 설정·모델 컨텍스트·내보내기에는 인증 값을 저장하지 않는다. 앱이 재시작되면 기존 값은 무효다. 이 구성은 Electron의 [세션 API](https://www.electronjs.org/docs/latest/api/session)를 사용한다.

`npm start`의 개발 브라우저 연결만 별도 활성화한다. 터미널의 일회용 연결 주소는 URL fragment를 사용하며 브라우저 스크립트가 즉시 주소에서 제거한다. 연결 성공 후에는 HttpOnly/SameSite=Strict 세션 쿠키를 사용한다. 주소 재사용은 실패한다. 같은 브라우저 프로필의 다른 로컬 서비스와 같은 호스트를 공유하므로 배포 앱의 세션 격리와 동일한 보호를 주장하지 않는다. 배포 앱은 이 연결 경로를 제공하지 않는다.

확인한 항목: 인증 없는 상태·내보내기·미디어·SSE·화면 요청, 변경 처리 전 차단, 다른 인스턴스·잘못된 토큰, Host/Origin/변경 헤더 검증, 개발 로그인 1회 사용, 중복 쿠키 거부. `test/local-access.test.js`와 실제 Electron 흐름 `scripts/verify-expansion-desktop.cjs`에서 확인한다. 최신 원본은 `artifacts/session-access-tests.log`, `artifacts/session-desktop-output.log`.

이 경계는 같은 Windows 권한으로 프로세스 메모리를 읽거나 사용자 데이터 파일을 직접 여는 프로그램을 막지 않는다. 악성 코드 격리, 저장 데이터 암호화, 완성된 보안 감사의 대체물이 아니다.
