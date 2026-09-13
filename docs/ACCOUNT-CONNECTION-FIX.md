# ChatGPT 계정 연결 실행 경로 수정 · 2026-09-13

## 원인과 수정

Windows `Start-Backseat.cmd`의 개발 실행은 `CodexProvider`가 기본값 `codex`를 직접 spawn했다. npm이 제공하는 `node_modules/.bin/codex.cmd`는 네이티브 실행 파일이 아니므로 전역 codex.exe가 없는 PATH에서는 ENOENT가 발생했다. 공식 CLI가 프로젝트에 설치되어 있고 기존 ChatGPT 인증이 정상이어도 UI가 “로그인 구성 요소를 실행할 수 없습니다”를 표시했다.

`server/codex-provider.js`에서 명시한 CODEX_BIN → 현재 OS/CPU의 공식 npm 네이티브 바이너리 → PATH 순서로 선택한다. 사용자가 명시한 실행 경로와 배포본 runtime 경로는 우선하며 실패를 다른 바이너리로 숨기지 않는다. shell 실행을 추가하지 않는다. `desktop/main.cjs`는 상태 검사·로그인에 동일한 provider.bin과 provider.env를 전달한다. 모델/추론은 기존 설정을 유지한다.

## 검증

- 수정 전 제한 PATH로 ENOENT/missing-cli를 재현했다. 같은 환경에서 프로젝트의 네이티브 CLI를 명시하면 connected였다. 원본은 기본 작업 폴더 `artifacts/account-path-reproduction.json`이다.
- 회귀 테스트는 수정 전 실제 실패(`missing-cli`, 기대 `signed-out`), 수정 후 통과했다. 빈 별도 CODEX_HOME과 npm .bin만 있는 PATH로 검사하므로 개발 도구가 추가한 전역 PATH가 결함을 가리지 않는다.
- `npm run check`: Node 221개 통과, 실패/건너뜀 0, TypeScript/Vite 빌드 통과.
- `node scripts/verify-account-device.mjs`: 자동 선택한 실제 공식 CLI로 기기 코드 발급 → waiting → 취소 → cancelled. 코드와 원시 출력은 증거에 기록하지 않는다. 실제 인증 완료는 수행하지 않았다.
- `node_modules/electron/dist/electron.exe scripts/verify-account-runtime.cjs`: 실제 desktop/main.cjs, IPC, 렌더러에서 빈 별도 계정의 기기 코드 표시와 취소/코드 제거 확인.
- 같은 스크립트의 `--existing-account`: 별도 앱 프로필에서 기존 계정이 “ChatGPT 구독 연결됨”으로 표시되고 연결 새로고침/이미 연결된 계정의 중복 로그인 방지가 동작했다. 공식 login status만 사용하며 auth.json/토큰은 읽지 않았다. 방송·모델 호출 0.

원본 로그/JSON/스크린샷은 수정 worktree `artifacts/account-fix-check.log`, `login-path-before.log`, `account-device-test.json`, `account-runtime-*/result.json`, `account-runtime-*/account-panel.png`에 보존한다. 테스트는 사용자 앱의 저장 데이터와 다른 작업자의 실행 프로세스를 사용하지 않는다. 새 계정의 브라우저 인증 완료, 모든 조직 정책과 다른 OS 조합은 검증 범위 밖이다.

## 병렬 작업

`fix/gpt-account-login` 브랜치와 별도 worktree에서 수정했다. 공유 main의 다른 작업자 수정 파일은 이 커밋에 포함하지 않는다. 충돌 방지 절차는 [병렬 개발 규칙](PARALLEL-DEVELOPMENT.md)에 기록했고 Windows와 WSL의 Codex/Claude 전역 지침 4곳에 설치·재적용(내용 변경 0)을 확인했다. 기존 지침 백업과 SHA-256은 `artifacts/parallel-policy-*/report.json`에 보존한다.
