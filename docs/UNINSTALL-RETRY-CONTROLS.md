# 제거 실패 후 재시도 파일 보존

2026-09-13. `codex/uninstall-retry-controls`, 기준 `446ca22d7ed00a9bf08e66c90e14605dfc697e90`. 이전 [설치 시작 복구](INSTALLER-BOOTSTRAP-RECOVERY.md)에 남긴 제거 도중 늦은 실패를 조사했다. Computer Use·장치 캡처·사용자 앱 재시작 중단을 유지하고 별도 worktree의 합성 파일만 사용했다.

## 확인한 결함

기존 `Engine.UninstallPayload`는 앱 파일과 함께 launcher/uninstaller도 삭제한 뒤 Start Menu·HKCU·상태 파일을 정리했다. 이후 정리가 실패하면 유효한 상태 파일은 남아도 제거 프로그램은 사라졌다. 제어 메타데이터를 마지막에 삭제하는 것만으로는 사용자에게 재시도할 실행 파일을 보존하지 못했다.

파일 기반 실제 `Engine.Uninstall` 시험에서 세 가지 늦은 실패를 주입했다. 수정 전 결과는 **173통과/9실패**였다. 바로가기 삭제, 등록 정보 삭제, 마지막 상태 파일 삭제 모두에서 launcher/uninstaller 보존 검사가 실패했다. `artifacts/uninstall-controls-before-fix.log`, `installer-unit-2026-09-13T06-59-50-117Z/test.log`와 `uninstall-before-source/`에 실패 기록과 당시 소스를 보존했다.

## 변경

`state.json`, 유효한 이전 상태 백업, launcher, uninstaller를 하나의 최종 제어 파일 그룹으로 먼저 잠근다. 읽기 전용 또는 공유 잠금이 있으면 앱 파일을 지우기 전에 중단한다. 앱 payload만 별도 그룹에서 지우고, 게시 자원 정리가 성공한 뒤에만 마지막 제어 그룹의 삭제를 예약·확정한다. 실패하면 아직 삭제하지 않은 제어 파일의 핸들을 닫아 재시도 자료를 남긴다.

Windows 게시 호출은 `WindowsUninstallHost`로 옮겼다. 기본 `Engine()`은 기존의 실제 HKCU/Start Menu 소유권 검사·삭제·프로세스 확인을 사용한다. 내부 생성자의 `IUninstallHost` 주입은 같은 제거 흐름을 파일만으로 검증하기 위한 경계다. 출시 CLI에 시험 실패 옵션이나 소유권 검사 생략 옵션을 추가하지 않았다. 다른 제품·루트의 자료를 새로 소유했다고 해석하지 않는다.

## 검증 범위

| 검사 | 확인한 결과 |
| --- | --- |
| 바로가기/등록 정보 정리 중 합성 예외 | 실제 payload는 삭제됨. 제어 파일4개의 SHA256은 그대로이며 Engine을 같은 루트로 다시 호출하면 제거 완료 |
| 최종 상태 파일을 읽기 전용으로 변경 | 실제 Win32 삭제 실패를 보고하고 제어 파일 보존, 속성 복구 후 재시도 완료 |
| 마지막 uninstaller를 읽기 전용으로 변경 | 앞선 상태/백업/launcher에 예약한 삭제까지 취소하고4개 모두 보존. 실제 `SetFileInformationByHandle` 경로 검사 |
| 실제 하위 시험 프로세스 종료79 | payload 삭제 후 게시 경계에서 종료. 운영체제가 핸들을 닫은 뒤에도 제어 파일4개 동일. 다른 프로세스에서 같은 루트 재시도 완료 |
| 제어 파일4개 각각의 공유 잠금·읽기 전용 | 총8개 사전 실패에서 게시 호출0회, 모든 파일의 전후 목록·해시 동일 |
| 사용자 메모 | 알려진 payload와 같은 폴더의 미소유 메모 내용 보존 |

최종 엔진 검사 **231통과/0실패/건너뜀 없음**: `artifacts/uninstall-controls-final-batch-unit.log`, `installer-unit-2026-09-13T07-02-55-053Z/result.json`과 `test.log`. 컴파일러 종료0, 시험 종료0과 소스 해시의 실행 전후 일치도 확인했다. 중간182/217개 검사 결과는 덮어쓰지 않았다.

앱 필수 `npm run check`는 **301개 Node 검사 + TypeScript/Vite 통과**(`uninstall-controls-check.log`). 배포 엔진15개 C# 소스의 Windows x64/GUI subsystem 컴파일도 성공했다(`uninstall-controls-engine/result.json`, `compiler-result.json`); 생성한 엔진 실행 파일은 실행하지 않았다.

제품 커밋 `d2023fd919a0f166ee0f3d2de94b8b0023c8f683`을 별도 `live-capture-integration` worktree에서 **앱301개/빌드 + 엔진231개**로 다시 검증하고, 통합 잠금·HEAD·인덱스·원격 확인 후 main에 fast-forward했다. 해당 worktree의 `artifacts/uninstall-controls-integration-check.log`, `uninstall-controls-integration-unit.log`와 이 작업의 `artifacts/uninstall-controls-integration-result.json`이 원본이다. 외부 push는 하지 않았다.

작업 폴더 `G:/dev/ai/00_game_backseat-worktrees/uninstall-retry-controls`의 `artifacts/uninstall-controls-evidence/manifest.json`에 변경 전후 소스·컴파일 결과·시험 성공/실패 원본·통합 결과의 파일별 SHA256을 보존한다. 실패한 첫 검사를 통과 기록으로 대체하지 않았다.

HKCU·Start Menu와 프로세스 목록은 이 시험에서 메모리 안의 대역을 사용했다. 실제 Windows 게시 API의 실패를 유도한 시험은 아니다. `.exe`라는 이름의 fixture는 합성 파일이며 NSIS 제거 프로그램을 실제 실행한 것이 아니다. 반면 상태 검증, 루트 mutex, Windows 파일 잠금·삭제 예약·취소, 파일 내용, 시험 프로세스 중단은 실제 구현을 실행했다. 사용자 프로필, 대화, 녹음, Steam 저장 자료는 시험 데이터가 아니다.

## 남은 기준

실제 NSIS 제거·다시 실행·ARP 항목과 Start Menu 결과는 화면/앱 조작 중단 이후 별도 검증해야 한다. 게시가 일부 지워졌을 때의 UX, 여러 자원에 걸친 전원 차단, 삭제 취소 자체의 실패, 최종 핸들 종료 사이의 파일시스템 손상까지 원자적으로 복구한다고 주장하지 않는다. 이미 앱 payload가 삭제된 실패를 앱 실행이 가능한 설치 상태로 롤백하는 변경도 아니다.

최초 저널의 부분 쓰기, 세션 간 mutex, 경로 별칭·경합, 디스크 부족, 새 Windows, 서명·Steam 수용 기준은 계속 남아 있다. 일반 NSIS 배포 차단을 유지하고 기존 사용자 앱이나 설치본에 수정 엔진을 덮어쓰지 않았다. 후속 검증은 새 시험 식별자의 설치본에서 진행하며 과거 전체 설치 성공 기록을 이번 소스의 수용 근거로 재사용하지 않는다.
