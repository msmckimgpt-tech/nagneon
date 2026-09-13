# 최초 설치의 빈 제어 폴더 복구

2026-09-13. 최초 설치가 저널을 만들기 직전에 중단되면 설치 경로에 빈 `.backseat`만 남고, 재시도는 이를 소유권 없는 비어 있지 않은 경로로 거부했다. 실제 파일 기반 하위 프로세스 중단으로 재현하고 설치 엔진의 소유권 검사에서 수정했다.

## 변경과 보존 범위

`Engine.EnsureOwnedOrClaimable`은 설치 경로의 유일한 항목이 **일반 디렉터리인 `.backseat`이고 그 안이 완전히 비어 있을 때만** 다시 사용한다. 다른 자료를 삭제하거나 기존 파일을 소유한 것으로 추정하지 않는다. 루트와 제어 폴더의 조상 경로도 junction/reparse 여부를 확인한다. 기존 설치는 여전히 저장 상태의 식별자와 설치 경로를 검증한다.

제어 폴더 생성은 `StateStore.WriteJournal`에서 실제 최초 저널을 쓸 때까지 미뤘다. 저널 전에 수행하는 읽기 검증이 실패하는 경우 불필요한 제어 폴더를 먼저 만들지 않는다. 저널이 기록된 뒤에만 payload staging을 시작하는 순서는 유지한다.

다음 상태는 계속 거부하며 내용을 보존한다.

- `.backseat` 안의 메모, 부분 쓰기 임시 파일, 손상된 저널/상태/백업, 빈 하위 디렉터리
- 설치 경로의 다른 파일, `.backseat`라는 이름의 일반 파일
- 제어 폴더 또는 조상 경로의 junction
- 다른 제품 식별자의 저장 상태

## 검증

작업 브랜치 `codex/installer-bootstrap-recovery`, 시작 커밋 `2a5085f6b0588ff765c85c97e00e4507668cd9c0`. 개발 경로는 `G:/dev/ai/00_game_backseat-worktrees/installer-bootstrap-recovery`이며 아래 증거 경로는 이 폴더 기준이다. 의존성은 이 worktree에서 `npm ci`로 설치했다. 별도의 기존 통합 worktree `live-capture-integration`에서 통합 후 필수 검사를 수행한다.

| 검사 | 결과와 증거 |
| --- | --- |
| 수정 전 재현 | 실제 하위 프로세스가 코드79로 종료하고 빈 제어 폴더만 남음. 재시도 시 소유권 오류. `artifacts/installer-bootstrap-before-fix.log`의 107 통과/1 실패 및 해당 실행 폴더의 원본 `test.log` |
| 수정 후 엔진 단위 검사 | **140 통과/0 실패**, 건너뜀 없음. `artifacts/installer-unit-2026-09-13T05-38-56-578Z/result.json`과 `test.log`, `artifacts/installer-bootstrap-final-unit.log` |
| 재시도 결과 | 동일 경로에서 유효한 최초 저널을 읽어 확인. 반복된 빈 폴더 상태도 재사용. payload 생성 전 저널 기록 확인 |
| 보존 검사 | 거부한 각 파일의 전후 SHA256 일치, 추가 메타데이터 없음, 빈 사용자 폴더와 junction 및 대상 보존 |
| 배포 엔진 컴파일 | Windows x64/GUI subsystem 컴파일 코드0. 실행하지 않음. `artifacts/installer-bootstrap-engine/result.json`, `compiler-result.json`, `compiler.log` |
| 앱 필수 검사 | `npm run check`: **276 통과/0 실패**, TypeScript/Vite 빌드 성공. `artifacts/installer-bootstrap-check-final.log` |

엔진과 단위 검사 컴파일은 C# 원본 해시를 실행 전후 비교한다. 새 단위 검사는 실제 `Engine.EnsureOwnedOrClaimable`과 `StateStore`를 호출한다. 하위 프로세스는 자체 시험 바이너리 옆의 고정 fixture 경로에만 쓰며 `Engine.Install/Recover` 전체 흐름은 호출하지 않는다. HKCU·시작 메뉴·사용자 프로필·실제 장치는 변경하지 않았다.

전체 검사의 첫 실행에서는 기존 `speech-flow.test.js`의 HTTP 취소 시험이 `fetch failed`를 처리하지 않은 채 인식 시작 신호를 기다렸다. 단독 실행 12개는 통과했다. 중단된 검사는 시험 프로세스 PID·생성 시각·Node 경로·부모를 재확인한 뒤 그 하위 프로세스 하나만 종료했고, 원본 실패 로그 `installer-bootstrap-check.log`와 `stalled-check-process.json`을 남겼다. 최초 localhost 통신 실패의 원인까지 확정한 것은 아니다.

해당 시험은 HTTP 조기 응답/통신 실패를 즉시 관찰하고, 단계별 제한 시간과 실패 시 정리를 갖추도록 보완했다. 합성 통신 오류를 주입한 실행은 약 1.6초 안에 코드1과 정확한 `SYNTHETIC_LOCAL_AUDIO_TRANSPORT_FAILURE`로 종료했다(`speech-transport-failure-injection.log`). 실패를 재시도하거나 통과 처리하지 않는다. 이후 전체 검사가 통과했으며 음성 제품 코드 변경은 없다.

첫 통합 검사에서는 별개의 대화 문맥 시험이 대상 관객의 무작위 이탈로 실패했다. `Studio.random`만 고정되고 `Audience.random`은 고정되지 않은 시험 구성의 문제였다. 전역 난수를 0으로 강제한 별도 시험 프로세스에서 동일 실패를 재현하고, 해당 문맥 시험에만 난수가 고정된 `Audience`를 주입했다. 제품의 참여/이탈 확률이나 검증 단언은 변경하지 않았다. `conversation-random-before-fix.log`와 `conversation-random-after-fix.log`, 통합 worktree의 `installer-bootstrap-integration-check.log`에 근거를 보존한다.

## 남은 수용 기준

이 결과는 **프로세스 중단으로 남은 빈 제어 폴더의 재시도**에 대한 것이다. 전원 차단이나 파일시스템의 디렉터리 항목 내구성을 검증한 결과가 아니다. 첫 원자적 저널 쓰기 도중 부분 임시 파일이 남은 경우는 자동 복구하지 않는다. 소유 근거 없는 파일을 이름만 보고 지우지 않는다.

이 엔진 변경 후 실제 NSIS 설치/업데이트/제거, HKCU·바로가기 게시와 전체 1.6 GB 패키지의 실행 시험은 다시 수행하지 않았다. 사용자 요청에 따른 화면/앱 조작 중단을 유지한다. 이전 설치 시험은 해당 당시 소스의 역사적 근거로 남으며 이번 변경의 전체 수용을 대신하지 않는다.

다음 작업은 부분적인 최초 저널 쓰기의 복구 설계, 최초 설치의 나머지 실패 지점, 제거 도중 늦은 실패와 실제 설치 회귀다. 보이는 설치 UI·새 Windows·서명·Steam 검토도 남아 있으므로 일반 배포 차단을 유지한다.
