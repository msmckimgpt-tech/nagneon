# 공개 저장소 보안 검토 · 2026-09-14

## 범위와 결과

검토 시작 시 GitHub 저장소는 이미 public이었다. 공개된 `main`은 `07421b3`이며 도달 가능한 이력은 3개 커밋, 최신 트리는 205개 파일이었다. 로컬에서 추가 개발된 미게시 66개 커밋은 이번 원격 보안 조치의 게시 범위에 포함하지 않는다. 보안 수정은 원격 기준의 별도 worktree에서 작성했다.

- 체크섬을 검증한 Gitleaks 8.30.1로 공개 이력 전체 약 1.49 MB를 검사했다. 알려진 자격 증명 패턴 검출 0건. 별도 합성 키는 실제로 검출되는지 확인했다. 원시 키나 임시 로그인 코드를 보고서에 노출하지 않는다.
- npm lockfile 감사는 개발·선택 의존성을 포함해 알려진 취약점 0건이었다. Python 고정 패키지 24개도 OSV 데이터베이스 조회에서 일치하는 권고가 없었다. 후자는 설치된 환경의 전이 의존성이나 네이티브 바이너리 자체에 대한 분석은 아니다.
- 공개 트리에는 실제 `.env`, 인증 파일, 개인 데이터 디렉터리, 녹음·영상, 실행 바이너리 또는 로그가 없었다. `.env.example`의 API 키는 빈 값이다. 당시 릴리스·첨부물, 이슈, Actions 보관 산출물, deploy key, webhook은 없었으며 협업자는 저장소 소유자 한 명이었다.
- 로컬 서버의 loopback 바인딩, 요청 Host/Origin 검사, 실행별 인증, 정적 파일 제공 범위를 확인했다. 저장소 공개가 앱 서버의 인터넷 노출을 의미하지는 않는다.
- `npm run check`: 221개 테스트, 실패·건너뜀 0, TypeScript/Vite 빌드 통과. 화면 조작·게임 실행·장치 캡처·사용자 앱 재시작은 수행하지 않았다.

현재 유출이나 고위험 취약점을 입증한 결과는 없다. 아래 조치는 확인된 보호 설정 공백과 실수 업로드 경로에 대한 예방적 보강이다.

## 반영한 조치

- GitHub secret scanning과 push protection, Dependabot 보안 경고·보안 업데이트, 비공개 취약점 제보를 활성화하고 API로 확인했다.
- `main` 규칙에서 non-fast-forward와 삭제를 차단한다. 일반 fast-forward 게시와 기존 worktree 개발은 유지한다. CODEOWNERS는 검토 담당자를 지정하며 자체적으로 승인을 강제하지 않는다.
- Actions 토큰의 읽기 기본 권한과 PR 승인 권한 없음 설정을 유지한다. Action 참조는 커밋 SHA 고정을 요구하고, 외부 기여자의 워크플로 실행은 승인을 요구한다.
- `.gitignore`에 `.env.*`, 자격 증명·서명 키 파일과 로컬 감사 보고서 제외를 추가했다. `.env.example`은 계속 추적한다. 제외 규칙은 이미 커밋된 파일을 지우지 않는다.
- GitHub security workflow는 전체 fetched Git 이력의 비밀정보 검사와 npm 취약점 감사를 push/PR/수동/주간 일정에 실행한다. Gitleaks 다운로드는 버전·SHA256을 고정하고 로그를 마스킹한다. `pull_request_target`, 프로젝트 설치 스크립트 실행, 쓰기 토큰, 자동 배포는 사용하지 않는다.

## 남는 범위

과거 커밋의 작성자 이메일과 문서의 로컬 경로 같은 메타데이터는 이력에 남아 있다. 자격 증명으로 판정하지 않았으며, 여러 worktree와 연결된 이력을 강제로 재작성하지 않았다. 향후 업로드·새 릴리스·미게시 커밋은 별도 점검해야 한다. 지원 정책과 비공개 제보 방법은 [SECURITY.md](../SECURITY.md)에 있다.

로컬 원본 증거는 보안 worktree의 `artifacts/gitleaks-remote-history.*`, `npm-audit.json`, `python-advisory-audit.json`, `security-check.log`, `ignore-audit-*` 및 `.gstack/security-reports/`에 보존한다. 보안 설정과 Actions 결과는 GitHub API로 별도 확인한다.

이 자동·코드 기반 검토는 전문 보안 감사나 침투 테스트를 대체하지 않는다.
