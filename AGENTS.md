# BACKSEAT 개발 지침

- **사용자 직접 테스트 · 2026-09-13 12:45:16 ~ 2026-09-14 00:45:16 KST:** Computer Use/화면·창 조회/입력 조작/게임 실행/직접 장치 캡처/사용자 앱 재시작을 중단한다. 사용자가 직접 켠 서비스의 기존 데이터 수집은 허용했고 백그라운드 개발을 요청했다. 별도 worktree의 코드·파일 기반 검사만 진행한다. 시간이 지나도 화면 조작을 자동 재개하지 않는다. 수집·중단·증거 범위는 [사용자 테스트 수집](docs/USER-TEST-COLLECTION.md)을 따른다.

- 병렬 개발은 작업별 브랜치와 별도 worktree에서 수행한다. 전체 절차는 [Git 병렬 개발 규칙](docs/PARALLEL-DEVELOPMENT.md)을 따르며 다른 작업자의 미커밋 변경을 보존한다.
- `main`은 통합 대상이다. 의존성은 각 worktree에서 `npm ci`, 필수 검증은 `npm run check`로 수행한다. 인증 변경은 `node scripts/verify-account-device.mjs`와 `node_modules/electron/dist/electron.exe scripts/verify-account-runtime.cjs`를 추가 실행한다.
- 계정 검사는 공식 CLI를 사용하며 auth.json/토큰을 직접 읽거나 기록하지 않는다. 기기 로그인 테스트는 빈 CODEX_HOME에서 발급·취소까지만 수행한다. 기존 계정 확인은 `verify-account-runtime.cjs --existing-account`로 별도 앱 프로필을 사용한다.
- 테스트·앱 실행·로그는 작업별 `artifacts/` 및 `--backseat-profile=<절대 경로>`로 격리한다. 사용자 앱이나 다른 작업자의 서버·시험 프로세스를 재시작/종료하지 않는다. 사용자 앱에 수정본 적용이 필요한 경우 실제 방송 상태와 작업 소유권을 확인한 후 해당 앱만 정상 종료·재실행한다.
- 작업 결과와 증거는 관련 기능 문서에 기록한다. 공유 HANDOFF.md를 다른 작업자가 수정 중이면 병합 경쟁을 만들지 말고 별도 기능 문서에서 연결한다.
