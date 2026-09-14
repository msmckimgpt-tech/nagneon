# BACKSEAT 개발 지침

- 신규 기능은 [능동적 정식 편입 정책](docs/FEATURE-PROMOTION.md)에 따라 실사용/검증 조건 충족 시 별도 사용자 요청 없이 정식 통합 및 릴리즈한다. 과거의 별도 승인 대기 문구는 이 정책으로 대체한다. squash 통합과 사용 종료 worktree/로컬·원격 브랜치 정리는 [Git 병렬 개발 규칙](docs/PARALLEL-DEVELOPMENT.md)을 따른다.

- **사용자 직접 테스트 종료 · 2026-09-14 재허용:** 사용자가 개인 테스트 완료와 Computer Use·Claude Code 사용 허용을 명시했다. 이전 화면·입력·게임·장치 검증 중단은 해제됐으며 실제 앱 검증을 재개할 수 있다. 앱/방송 상태와 작업 소유권을 먼저 확인하고 검증 프로필·프로세스·로그를 격리한다. 사용자 원본 기록과 다른 작업자의 앱은 보존하며, WSL Claude Code도 작업별 worktree 또는 읽기 전용 검토로 이용한다. 이전 수집 기간을 자동 연장하거나 다른 개인 데이터를 수집하는 권한으로 확대하지 않는다. 수집·중단·재개 이력은 [사용자 테스트 수집](docs/USER-TEST-COLLECTION.md)을 따른다.

- 병렬 개발은 작업별 브랜치와 별도 worktree에서 수행한다. 전체 절차는 [Git 병렬 개발 규칙](docs/PARALLEL-DEVELOPMENT.md)을 따르며 다른 작업자의 미커밋 변경을 보존한다.
- 검증을 마친 변경은 작업 단위마다 커밋하고 항상 원격 작업 브랜치까지 push한다. 통합 후에는 대상 브랜치도 push하고 원격 커밋 일치를 확인한다. 이는 사용자의 지속적인 권한이며 별도 확인을 반복하지 않는다. 실패하면 로컬 커밋과 미게시 상태를 명시한다.
- `main`은 통합 대상이다. 의존성은 각 worktree에서 `npm ci`, 필수 검증은 `npm run check`로 수행한다. 인증 변경은 `node scripts/verify-account-device.mjs`와 `node_modules/electron/dist/electron.exe scripts/verify-account-runtime.cjs`를 추가 실행한다.
- 계정 검사는 공식 CLI를 사용하며 auth.json/토큰을 직접 읽거나 기록하지 않는다. 기기 로그인 테스트는 빈 CODEX_HOME에서 발급·취소까지만 수행한다. 기존 계정 확인은 `verify-account-runtime.cjs --existing-account`로 별도 앱 프로필을 사용한다.
- 테스트·앱 실행·로그는 작업별 `artifacts/` 및 `--backseat-profile=<절대 경로>`로 격리한다. 사용자 앱이나 다른 작업자의 서버·시험 프로세스를 재시작/종료하지 않는다. 사용자 앱에 수정본 적용이 필요한 경우 실제 방송 상태와 작업 소유권을 확인한 후 해당 앱만 정상 종료·재실행한다.
- 작업 결과와 증거는 관련 기능 문서에 기록한다. 공유 HANDOFF.md를 다른 작업자가 수정 중이면 병합 경쟁을 만들지 말고 별도 기능 문서에서 연결한다.
