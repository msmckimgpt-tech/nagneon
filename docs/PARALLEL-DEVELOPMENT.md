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
- 푸시가 요청된 범위라면 일반 push로 게시하고 원격 커밋 일치를 확인한다. non-fast-forward는 원격을 다시 가져와 통합·검증한다. 완료 보고에 브랜치/커밋, 병합·푸시 상태, 테스트와 미해결 항목을 남긴다. 자기 통합 잠금만 해제하며, worktree/브랜치는 미커밋·미게시 작업이 없고 삭제가 필요한 경우에만 정리한다.
<!-- END GIT-PARALLEL-WORKTREE -->

전역 설치 및 재적용:

```powershell
node scripts/install-parallel-work-policy.mjs --target C:\Users\newki\.codex\AGENTS.md --target C:\Users\newki\.claude\CLAUDE.md
node scripts/install-parallel-work-policy.mjs --target \\wsl.localhost\Ubuntu-24.04\root\.codex\AGENTS.md --target \\wsl.localhost\Ubuntu-24.04\root\.claude\CLAUDE.md
```

설치기는 기존 지침을 보존하고 해당 블록만 갱신한다. 변경 전 파일과 SHA-256 보고서는 실행한 worktree의 `artifacts/parallel-policy-*`에 보존한다. 반복 적용에서 내용이 같으면 쓰지 않는다.
