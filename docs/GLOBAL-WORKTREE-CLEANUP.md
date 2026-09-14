# 전역 병합 작업 정리 · 2026-09-15

사용자 지시에 따라 앞으로 작업 단위 squash 통합, 기능별 정식 편입 조건 충족 시 릴리즈, 완료된 worktree 및 로컬/원격 작업 브랜치 정리를 적용했다. 이미 게시된 main 이력을 재작성하거나 릴리즈 태그를 삭제하지 않았다.

## 적용과 검증

- `docs/FEATURE-PROMOTION.md`와 프로젝트 AGENTS.md에 능동적 편입/릴리즈 조건을 명시했다. 이 작업의 매일 오전 10시 heartbeat `nagneon`도 같은 조건과 전역 정리 후속 작업으로 갱신했다.
- 전역 병렬 작업 정책을 Windows/WSL의 Codex AGENTS.md 및 Claude CLAUDE.md 네 곳에 적용했다. 재적용 결과 모두 `changed: false`; 기존 블록 밖 지침은 보존했다.
- 정책 원본 커밋 `efb4be2`는 `0344f4b`로 squash 통합했다. 두 커밋의 전체 tree가 같고 main/원격 main SHA가 일치했다.
- `npm ci` 후 전체 검사 첫 실행에서 기존 후원 HTTP 테스트 한 건의 `fetch failed`가 발생했다. 해당 파일 단독 검사와 전체 재검사에서 **672개 테스트 및 TypeScript/Vite 빌드 통과**. 생산 코드/테스트는 수정하지 않았다.

## 실제 정리 결과

| 저장소 | 제거한 worktree | 삭제한 로컬 브랜치 | 삭제한 원격 브랜치 |
|---|---:|---:|---:|
| BACKSEAT/Nagneon | 48 | 48 | 22 |
| WSL 00_game_dev | 0 | 15 | 17 |
| WSL _template | 0 | 0 | 2 |
| 합계 | 48 | 63 | 41 |

BACKSEAT의 오래된 통합 worktree 25개와 작업 worktree 23개를 제거했다. 해당 source HEAD가 원격 main의 조상이고 작업 폴더가 깨끗하며 해당 경로의 실행 프로세스가 없음을 확인했다. 원격 브랜치는 삭제 직전 SHA와 통합 여부를 확인했으며 이미 없는 브랜치를 신규 삭제 수에 포함하지 않았다.

각 `artifacts/`를 임시 보존한 뒤 `git worktree remove`로 코드/의존성을 정리하고, 원래 경로에 artifacts를 돌려놓았다. 총 **26,920개 증거 파일**의 SHA-256이 전후 일치한다. 따라서 예전 문서의 artifacts 경로는 그대로 유효하며 남아 있는 증거 폴더는 Git worktree가 아니다. Git 강제 삭제/clean을 사용하지 않았다.

## 보존한 항목

- 기본 checkout, 현재 작업, 미통합 `codex/preview-0.1.0-2` 및 프리뷰 실행 파일.
- BACKSEAT의 `login-integration` 미커밋 변경, 배포 실행본·모델·기타 보존 파일이 포함된 worktree, 최근 작업/사용 종료가 불명확한 worktree.
- WSL main의 원격 미게시 8개 커밋과 네 개 dirty worktree, 보존할 ignored 자료가 있는 작업 경로. 별도 게시 권한을 이 정리 작업의 임의 커밋/공유로 확대하지 않았다.
- 미통합/보호/릴리즈 브랜치와 모든 릴리즈 태그. 템플릿 main은 fetch로 원격 상태만 갱신했으며 checkout을 자동 업데이트하지 않았다.

Windows 등록 프로젝트와 G:/dev의 프로젝트 경로, WSL /root/ai의 실제 저장소를 점검했다. 01_attend는 .git 항목이 있으나 유효한 Git 저장소가 아니므로 변경하지 않았다. 미연결 호스트나 이 범위 밖 저장소까지 정리했다고 주장하지 않는다.

## 증거 위치

`G:/dev/ai/00_game_backseat-worktrees/promotion-worktree-policy/artifacts/`:

- `check.log`, `donation-focused.log`, `check-retry.log`: 최초 실패와 재검사 원본.
- `parallel-policy-253c9987-33a1-4d0a-8bef-44fee94789b0/report.json`, `policy-reapply.json`: 전역 설치/재적용.
- `worktree-audit.json`, `worktree-after.json`: BACKSEAT 정리 전후 목록.
- `retired-integrations.json`, `retired-sources.json`: worktree별 원본 SHA, 자료 개수/경로, 정리 결과.
- `remote-cleanup.log`, `remote-cleanup-sources.json`: BACKSEAT 원격 삭제/이미 없음 판정.
- `wsl-audit.json`, `wsl-branch-cleanup.json`, `template-branch-cleanup.json`: WSL 보존/삭제 근거.

이번 변경은 개발 운영 정책이다. 실제 프리뷰 기능은 사용 근거 부족/계정·플랫폼 미검증 항목을 정식으로 승격하지 않았다. 이후 heartbeat가 증거를 보강하고 기능별 조건을 충족하면 통합·새 정식 릴리즈까지 진행한다.
