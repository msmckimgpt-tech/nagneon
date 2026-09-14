# Git 병렬 개발 규칙

아래 블록은 프로젝트와 Windows/WSL의 Codex·Claude 전역 지침에 동일하게 설치한다. 실행 중인 작업자는 새 지침을 아직 읽지 않았을 수 있으므로 실제 Git 상태 확인을 생략하지 않는다. 규칙 파일은 행동 지침이며 Git 자체의 강제 접근 제어는 아니다.

<!-- BEGIN GIT-PARALLEL-WORKTREE -->
## Git 병렬 작업 격리와 병합

- Git 저장소에서 다른 AI/사람과 병렬로 개발하거나 동시 작업 가능성이 있으면 작업자·작업마다 별도 브랜치와 `git worktree`를 사용한다. 공유 main 작업 폴더에서 제품을 직접 수정하지 않는다. 단순 읽기 작업에는 worktree를 강제하지 않으며, 이 규칙이 새 에이전트 실행 권한을 추가하지는 않는다.
- 시작할 때 프로젝트 지침, `git status --short --branch`, `git worktree list --porcelain`, 원격과 기준 커밋을 확인한다. 작업 경로·브랜치·수정 범위를 기록하고 명시적 `workdir` 또는 `git -C`를 사용한다. 이미 사용 중인 브랜치를 강제로 체크아웃하지 않는다.
- 다른 작업자의 미커밋 변경, 인덱스, stash, 프로필·모델·빌드 결과를 보존한다. 일괄 add/commit, reset --hard, clean, 자동 stash/pop, checkout --force로 정리하지 않는다. 자기 변경 파일만 명시하여 커밋한다.
- 의존성, 빌드 출력, 테스트 데이터, 포트, 실행 프로필과 증거 폴더도 worktree별로 격리한다. 쓰기 가능한 node_modules/data/dist를 다른 작업자와 공유하지 않는다. 테스트 프로세스 종료는 소유한 PID·생성 시각·정확한 실행 경로를 확인한 대상에만 적용한다.
- 통합은 한 작업자만 수행한다. `git rev-parse --path-format=absolute --git-common-dir` 아래 `ai-integration.lock` 디렉터리를 원자적으로 생성해 소유권을 획득하고 작업·PID·시각·기준 HEAD를 기록한다. 잠금이 이미 있으면 진행 중 상태를 확인하며 자동 삭제하거나 우회하지 않는다. 기존 작업자가 규칙을 모를 수 있으므로 잠금만 믿지 않는다.
- 병합 직전에 원격과 대상 HEAD·인덱스·미커밋 파일을 다시 확인한다. 자신의 커밋에 다른 작업이 섞이지 않았는지 검토한다. 우선 깨끗한 통합 worktree에서 병합/회귀 검증을 수행한다. 대상이 dirty이면 겹치는 경로가 없는지, 인덱스가 비어 있는지, 다른 변경의 전후 해시가 같은지 확인한 뒤에만 fast-forward를 적용한다. 겹침·변경 감지 시 공유 폴더의 병합은 멈추고 격리 worktree에서 해결한다.
- 충돌은 양쪽 의도를 읽고 격리된 통합 worktree에서 해결한다. ours/theirs 일괄 선택, 다른 작업 덮어쓰기, 강제 푸시로 통과시키지 않는다. 실제 통합된 코드에 필수 검사와 관련 회귀 검증을 실행한다. 병합이 다른 작업의 테스트를 무효화했으면 이를 분명히 알린다.
- 변경사항은 필요한 검증을 통과한 작업 단위마다 자기 파일만 명시하여 커밋한 뒤, 항상 해당 작업 브랜치를 원격 저장소에 일반 push한다. 이 사용자 지침이 지속적인 push 권한이며 매번 허락을 다시 묻지 않는다. 다른 작업자가 사용할 수 있도록 원격 브랜치와 커밋 일치를 확인하고, 통합이 완료되면 통합 대상 브랜치도 push한다. 커밋을 로컬에만 남겨 두고 완료 처리하지 않는다.
- push 직전에 원격 변경을 확인한다. non-fast-forward는 fetch 후 격리 worktree에서 통합·검증하여 해결하며 force push로 우회하지 않는다. 원격이 없거나 인증·권한·네트워크·보호 규칙으로 push할 수 없으면 로컬 커밋을 보존하고 정확한 실패 원인과 미게시 상태를 보고한다. 원격 생성, 비밀·개인 데이터 게시, 타인 변경의 임의 커밋은 이 권한에 포함되지 않는다. 사용자가 해당 작업에 명시적으로 push 금지를 요청하면 그 예외를 따른다.
- 완료 보고에 브랜치/커밋, 병합·원격 게시 및 검증 상태, 미해결 항목을 남긴다. 자기 통합 잠금만 해제하며, worktree/브랜치는 미커밋·미게시 작업이 없고 삭제가 필요한 경우에만 정리한다.
- 앞으로 완료한 작업은 격리 통합 worktree에서 `git merge --squash <작업 SHA>`로 작업 단위 한 커밋에 통합하고 검증한 뒤 대상 브랜치를 fast-forward 및 일반 push한다. 이미 게시된 main/태그 이력은 소급 squash하거나 force push하지 않는다. 원본 작업 SHA와 통합 SHA를 함께 기록한다.
- 통합·원격 게시 후 전역 작업 공간의 사용 종료 worktree와 병합된 로컬/원격 작업 브랜치를 정리한다. 기본 checkout, 진행 중 작업/프로세스, 잠금, 미커밋·미게시 변경, 보존할 ignored 파일(프로필·모델·실행본·증거)이 있는 worktree는 남기고 사유를 기록한다. 사용 중 여부가 불명확하면 삭제하지 않는다.
- 삭제 전 정확한 절대 경로·저장소 소속·최신 원격/대상 SHA·통합 여부·현재 상태를 다시 확인하고 `git worktree remove`로 개별 정리한다. `--force`, 자동 clean, 일괄 재귀 삭제는 사용하지 않는다. squash 통합은 ancestor 검사만으로 판단하지 않고 원본 SHA와 통합 커밋 및 변경 반영 근거를 확인한다. 보존 파일 이전이 필요하면 목적지·해시·문서 참조를 검증한다.
- 사용 종료와 통합을 검증한 로컬/원격 작업 브랜치 삭제는 사용자에게 승인받은 전역 정리 범위다. 기본/보호/미통합/진행 중 브랜치와 릴리즈 태그는 보존한다. 원격 삭제 직전 SHA가 바뀌면 중단한다. 로컬 삭제는 안전한 `git branch -d`를 우선하며 거절을 강제 삭제로 우회하지 않는다. 완료 보고에 삭제와 보존 사유를 남긴다.
<!-- END GIT-PARALLEL-WORKTREE -->

전역 설치 및 재적용:

```powershell
node scripts/install-parallel-work-policy.mjs --target C:\Users\newki\.codex\AGENTS.md --target C:\Users\newki\.claude\CLAUDE.md
node scripts/install-parallel-work-policy.mjs --target \\wsl.localhost\Ubuntu-24.04\root\.codex\AGENTS.md --target \\wsl.localhost\Ubuntu-24.04\root\.claude\CLAUDE.md
```

설치기는 기존 지침을 보존하고 해당 블록만 갱신한다. 변경 전 파일과 SHA-256 보고서는 실행한 worktree의 `artifacts/parallel-policy-*`에 보존한다. 반복 적용에서 내용이 같으면 쓰지 않는다.

2026-09-14 사용자 요청으로 커밋 후 push를 전역 기본 의무로 변경했다. Windows와 WSL의 Codex·Claude 네 곳에 적용하고 재적용 시 네 파일 모두 추가 변경이 없음을 확인했다. 기존 블록 밖 지침은 보존한다. 현재 실행 중인 작업자가 읽어 둔 지침까지 자동 갱신되는 것은 아니므로 작업 재개 시 원격과 규칙을 다시 확인한다. `autonomous-community/artifacts/parallel-policy-f2831da9-4dd3-49a4-9862-2d78b5c72b5c`에 변경 전 사본과 해시, `parallel-policy-f1808ba1-f66d-4084-ad8d-111f061d70b2`에 재적용 결과가 있다. `npm run check`는 519개 테스트와 빌드를 통과했으며, 원격 게시 전 미게시 이력의 Gitleaks 검사도 검출 0건이었다.
