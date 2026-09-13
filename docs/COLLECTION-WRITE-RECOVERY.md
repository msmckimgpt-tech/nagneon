# 테스트 수집 출력의 Windows 잠금 복구

2026-09-13. 사용자 테스트 기록을 점검하던 중, 수집 보조 프로세스 PID27800이 실제로 종료됐음을 두 번 확인했다. `status.json.tmp`를 `status.json`으로 교체하는 `rename`에서 `EPERM`이 발생했고, 실패 상태를 쓰는 예외 처리도 같은 잠금에 막혀 프로세스가 종료됐다. 마지막 상태 갱신은14:54:56 KST, 마지막 임시 상태/최신 내용의 갱신은14:55:12였다. 어떤 프로그램이 그 잠금을 보유했는지는 확인하지 않았다.

## 변경

`collector-output.mjs`는 고유 이름으로 배타 생성한 임시 파일을 flush한 뒤 교체한다. Windows의 `EPERM`/`EBUSY`/`EACCES` 교체 오류에만 25/50/100/200/400/800ms를 기다려 재시도한다. 기존 대상 파일을 삭제하는 우회는 없다. 실패하면 이번 호출이 만든 임시 파일만 정리하며, 기존 고정 이름 `.tmp`와 다른 파일은 보존한다. 파일 이름은 수집 메타데이터 3종으로 제한하고 출력 경로의 링크·디렉터리 교체도 거부한다.

짧은 재시도를 소진한 `OUTPUT_BUSY`는 `collector-runner.mjs`가 다음15초 poll에서 다시 시도한다. 정상 poll 이후 연속 실패 수는 초기화한다. 네 번 연속 실패하거나 공간 부족 등 다른 오류면 코드1로 종료하고 한정된 오류 코드만 남긴다. 실패 상태 파일까지 쓸 수 없어도 그 실패를 stderr로 보고하며 같은 예외를 다시 던져 진단을 잃지 않는다. 실패 상태에는 재개에 필요한 poll/변경/지표 바이트 수를 보존한다.

원래 종료 시각과 `STOP`은 재시도 중에도 적용된다. 마지막 상태 파일이 잠긴 상태로 끝나면 stderr에 `statusWritten:false`와 실제 종료 사유를 남긴다. 중단된 상태 파일의 `collecting` 문자열만으로 프로세스가 살아 있다고 판단하지 않는다.

원본 서비스 데이터의 읽기 범위, 삭제 반영, 대화의 최신 사본 하나와 내용 없는 지표 기록 정책은 그대로다. 사용자 앱의 저장 코드나 음성 인식 코드는 바꾸지 않았다. 프로세스 강제 종료/전원 차단이 임시 파일 쓰기 중 발생하면 임시 파일이 남을 가능성은 있으며, 이 변경을 전원 장애까지 보장하는 저장소로 주장하지 않는다.

## 검증과 실제 재개

개발 worktree는 `G:/dev/ai/00_game_backseat-worktrees/collection-write-recovery`, 브랜치는 `codex/collection-write-recovery`, 시작 커밋은 `acf8ca439d86c7481df892b7b2b54c3dcf3536c6`다. 다음 경로는 이 worktree 기준이다.

- `artifacts/collector-write-focused-final.log`: 기존 수집 검사8개와 새 출력/실행 제어 검사9개, **17개 통과**. 기존 파일 바이트 보존, 임시 파일 제거, 링크/경로 거부, 반복 잠금, 영구 오류, 종료 시각/STOP, 실패 상태의 카운터 보존을 확인했다.
- `artifacts/collector-write-check.log`: 카운터 보존 시험 추가 전 **284개 + TypeScript/Vite 통과**. 최종 커밋의 전체 검사는 별도 통합 worktree에서 수행한다.
- `scripts/verify-collector-output-lock.mjs`: 별도의 숨김 PowerShell 자식이 **합성 artifact 파일 하나**를 `.NET FileShare.Read`로 잠갔다. 실제 `EPERM`을 관찰하고 기존 내용이 보존됨을 확인한 뒤 잠금을 해제했다. 새 JSON 교체 성공과 자식의 정상 종료 코드0을 확인했다. `artifacts/latest-collector-output-lock.json`, `artifacts/collector-lock-2026-09-13T06-03-29-534Z/`가 근거다. GUI·HKCU·시작 메뉴·장치·사용자 원본에 쓰지 않았다.

수집을15:06:54 KST에 숨김 Node **PID29916**, 생성 시각 `2026-09-13T06:06:54.7563270Z`로 재개했다. 코드는 이 worktree의 `scripts/collect-user-test.mjs`이며 출력은 기존 `live-capture-lifecycle/artifacts/user-test-20260913-034516`을 계속 사용한다. 이 출력은 이전부터 이 작업이 소유한 수집 폴더이며 다른 작업자의 시험/프로필과 공유하지 않는다. 기존 PID27800의 종료와 STOP 부재, 원래 기간 안임을 확인하고 `--resume`을 사용했다. 원본은 `G:/dev/ai/00_game_backseat/data` 하나, 종료 시각은 **2026-09-13T15:45:16Z**다.

새 실행 정보는 기존 수집 worktree의 `artifacts/user-test-collector-write-recovery-launch.json`, 로그는 `user-test-collector-write-recovery.stdout.log` / `.stderr.log`다. 이전 `user-test-collector-resumed.stderr.log`도 실패 원본으로 보존한다. 이후 실제 프로세스와 증가하는 poll/최신 스냅샷을 재확인하며, 수집 재개가 곧 실제 음성 지연이나 관객 자연스러움의 개선을 증명하지는 않는다. 해당 분석을 다음에 이어간다.
