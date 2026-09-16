# 고정 실행 위치와 저장 프로필

메인의 `Start-Nagneon.cmd`와 `Start-Backseat.cmd`는 로컬 설치 등록을 읽어 배포 앱을 실행한다. 개발 빌드는 `npm run desktop`을 사용한다. 개발 실행도 기본적으로 Windows 사용자 프로필을 쓰므로 검증은 반드시 `--backseat-profile=<격리 경로>`를 지정한다.

이 PC의 고정 진입점은 `G:\dev\ai\Nagneon\Start-Nagneon.cmd`다. 바탕 화면 Nagneon 바로가기도 이 진입점을 사용한다. 버전별 실행 파일은 `versions/`에 두고 `current.json`만 원자적으로 바꾼다. 최신 폴더를 자동 추측하거나 worktree 실행본을 연결하지 않는다.

## 데이터

- 시스템 기본 프로필: `%APPDATA%\backseat-studio`. 기록은 그 아래 `data`에 저장한다.
- 사용자 선택: **방송 설정 → 미디어·기록 → 저장 위치**. 빈 폴더 선택 후 확인하면 서버 저장을 마치고 데이터를 복사·해시 검증한 뒤 재시작한다. 원본은 지우지 않는다.
- 선택한 위치는 `%APPDATA%\Nagneon\storage.json`에 버전과 독립적으로 저장한다. 실행 스크립트와 앱 모두 이를 사용한다. 저장 장치가 없거나 설정이 손상되면 새 빈 프로필로 넘어가지 않고 오류를 표시한다.
- 명시적인 검증용 프로필은 전역 설정보다 우선하며 전역 저장 위치 변경을 막는다.
- 기존 위치와 다른 데이터가 있는 폴더는 자동 병합하거나 덮어쓰지 않는다. 시스템 기본 위치에도 이미 기록이 있으면 빈 폴더가 필요하다는 안내를 표시한다.

## 릴리즈 적용 필수 단계

앱을 정상 종료하고 검증된 **새 패키지**에 대해 실행한다. 최초 설치에는 보존할 프로필을 지정한다. 이후에는 생략하여 앱 설정값을 유지한다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Install-NagneonRelease.ps1 -PackageFolder "<패키지 폴더>" -Version "<새 버전>" -InstallRoot "G:\dev\ai\Nagneon" -Profile "<기존 프로필 절대 경로>" -Register
```

업데이트마다 현재 data를 `backups/update-*/data`에 복사하고 해시를 대조한다. 패키지를 고유 버전 폴더에 복사한 뒤 모든 파일의 해시를 대조한다. 실패하면 현재 실행 포인터를 바꾸지 않는다. 기존 실행 파일과 백업은 자동 삭제하지 않는다. 바탕 화면 바로가기와 메인의 CMD는 그대로 유지된다. 앱 설정에서 저장 위치를 변경한 경우 업데이트 인자에 예전 Profile을 다시 지정하지 않는다.

호환되는 버전으로 복귀할 때만 해당 백업의 `current.json`을 설치 루트에 복원한다. 데이터는 자동으로 과거 버전으로 되돌리지 않는다. 0.1.4 기록은 0.1.3 스키마와 호환되지 않는다. 복구가 필요하면 업데이트 전 `data` 백업을 **별도 프로필 폴더**에 복사하고, 구버전 실행 파일에 `--backseat-profile="<별도 프로필 절대 경로>"`를 지정한다. 현재 기록은 덮어쓰지 않는다.

새 설치·실행 도구는 `Profile-Compatibility.ps1`을 함께 배포한다. 실행 파일의 실제 버전과 저장 형식을 읽어 알려진 0.1.4→구버전 비호환을 설치·실행 전에 거절한다. 버전 표시 문자열만 변경해도 통과하지 않는다. 과거 실행 파일을 직접 여는 경로에는 이 검사가 없으므로 업데이트된 프로필을 구버전 EXE에 직접 연결하지 않는다. 이는 모든 미래 버전의 역호환을 보장하는 검사는 아니다. JSON은 Windows PowerShell 5.1에서도 UTF-8로 읽는다.

현재 설치 경로 확인: `powershell -File scripts/Start-InstalledNagneon.ps1 -Inspect`.

## 기존 기록 보존 범위

### 2026-09-16 탐색기 더블클릭 실패 복구

Codex 패키지에서 실행한 자식 프로세스의 AppData 접근이 패키지 `LocalCache`로 리디렉션되어, 이전 셸 검증에서는 기록이 보였지만 Windows 탐색기에서 실행한 앱에는 `data`가 없었다. 이전의 셸 기반 native 결과는 탐색기 더블클릭 검증을 대신하지 못했다. 패키지 식별 API는 이 자식 프로세스에서도 NO_PACKAGE를 반환했으므로 식별자만으로 판정하지 않는다.

- 설치·가져오기·실행 도구는 임시 파일의 실제 Windows 핸들 경로를 요청 경로와 비교한다. 리디렉션이면 기존 기록을 변경하지 않고 중단한다. 임시 파일은 닫을 때 제거한다. 사용자 지정 저장소라도 등록용 Roaming/Local 폴더는 별도로 검사한다.
- 실제 탐색기로 기본 프로필에 `data`가 없음을 확인한 뒤, 패키지 LocalCache의 기존 `backseat-studio/data`를 복사했다. 원본과 프로젝트의 과거 기록은 보존했다. 설치 등록 파일도 실제 Local 폴더에 복구한다. 기존 데이터가 있는 대상에 자동 덮어쓰기하거나 서로 다른 기록을 병합하지 않는다.
- 고정 폴더에서 실제 마우스 더블클릭으로 설치된 0.1.5가 열렸고 관객 6명, 103포인트, OFFLINE 상태를 확인했다. 설정의 미디어·기록 화면에서 시스템 기본 저장 경로를 확인하고 제목 표시줄로 정상 종료했다. 클릭 후 9,017ms 관측 시 창이 있었으며 이는 정밀 시작 시간 측정이 아닌 관측 상한이다.
- 실행기 두 파일은 설치 루트에 적용했고 이전 사본은 `backups/launcher-native-storage-20260916`에 보존했다. 앱 바이너리와 공개된 0.1.5 배포 파일은 변경하지 않았다.
- 작업 증거는 `profile-virtualization-fix` worktree의 `artifacts/actual-click-error.json`, `packaged-view-rejection.log`, `storage-guard-tests.log`, `check-native-final.log` 및 이 작업의 Computer Use 화면에 있다. 개인 프로필과 원본 진단은 공개 저장소에 올리지 않는다.

앞으로 패키지 에이전트에서 실행한 셸의 성공만으로 설치 적용을 판정하지 않는다. 일반 Windows 탐색기에서 실행·정상 종료·재시작을 확인하고, 설정의 저장 위치와 기존 기록을 확인한다. 리디렉션 오류를 우회하여 새 빈 프로필을 만드는 방식은 사용하지 않는다.

최초 CMD의 프로젝트 `data`, 기존 `nagneon-preview/data`, EXE 직접 실행의 `backseat-studio/data`는 서로 다른 기록이다. 모두 별도로 보존하며 자동으로 world와 대화 인덱스를 섞지 않는다.

2026-09-15 사용자의 명시적인 요청으로 최초 CMD의 프로젝트 `data` 337개 파일을 시스템 기본 프로필 `backseat-studio/data`로 가져왔다. 원본과 복사본을 SHA-256으로 대조했다. 프로젝트 원본과 `nagneon-preview`는 그대로 남겼으며, 이전 기본 프로필 데이터도 별도 보존했다. 개인 데이터와 파일별 목록은 공개 저장소에 포함하지 않는다.

## 0.1.2 검증

- `npm run check`: 679개 테스트와 TypeScript/Vite 빌드 통과.
- `scripts/verify-storage-desktop.cjs`: 실제 Electron 설정 화면, IPC, 서버 종료 후 복사, 원본 보존, 재실행 예약 확인. 격리 프로필이며 폴더 선택/확인 응답과 실제 재실행은 테스트에서 대체했다. 물리 장치를 사용하지 않았다.
- 설치 도구 fixture: 최초 설치와 두 번째 버전 교체 후 같은 프로필/기록 유지. Windows PowerShell 5.1의 File.Replace 백업 인자 문제를 수정하고 실제 재검증했다.
- 원본 증거: 작업 worktree `artifacts/storage-native-1789480629932`, `check-final.log`, `installer-update-fixed.log`, `import.log`, `install.log`. 모델·실행 패키지·개인 데이터 증거가 있어 이 worktree는 보존한다.

### 최종 로컬 적용 확인

- 고정 설치 CMD와 메인의 CMD를 각각 실제 실행하여 동일한 0.1.2 실행 파일과 시스템 기본 프로필을 사용하는 것을 확인하고 정상 종료했다. 증거는 `artifacts/fixed-entry-native.json`, `artifacts/main-entry-native.json`이다.
- CMD에서 상속한 PowerShell 모듈 경로 때문에 Get-FileHash를 찾지 못하는 문제가 실제 실행에서 발견됐다. 실행기는 .NET SHA-256으로 변경하여 모듈 탐색 의존성을 제거했다. `artifacts/cmd-entry.log`에 실패, 위 두 native 결과에 수정 후 성공을 남겼다.
- `artifacts/package-integrity-test.json`: 패키지 2,476개 파일, 소스 99개 일치. 이전 검증본의 음성·모델 런타임과 비교한 변경은 없다. 새 버전에서 물리 장치 검증을 새로 수행했다는 뜻은 아니다.
- 기존 CMD 데이터의 격리 복사본으로 패키지 시작/정상 종료를 확인했다(`artifacts/native-main-import.json`). 실제 기본 프로필에서도 관객·포인트는 원본과 같고 기존 설정값은 보존됐다. 신규 설정인 communityActivityEnabled와 speechDevice만 스키마 기본값으로 추가됐다.
- `artifacts/final-data-preservation.json`: 프로젝트 원본 337개 파일 해시 유지, 이전 기본 프로필과 프리뷰 데이터 보존.
- 원본 작업 `f1e1f2c` → squash 통합 `83efaf0`, 실행기 수정 `ed5707b` → squash 통합 `3527fe6`. 통합 코드의 679개 테스트/빌드와 PowerShell 실행기 검증을 통과했다. 작업 브랜치는 내용 일치를 확인한 뒤 로컬/원격에서 정리했다. 실행본·모델·검증 자료가 있는 worktree는 보존한다.
