# Windows 설치 프로그램 검토 상태

2026-09-13. 현재 설치 소스는 **작은 패키지의 실제 업데이트·중단 복구와 전체 1.6 GB 앱의 TEST 설치·실행·제거까지 검증한 개발 빌드**다. 기본 빌드는 `.onInit`와 `un.onInit`에서 종료 코드 10으로 중단한다. 개발 시험에서만 `--mode=test --enable-test-install`로 별도 TEST 식별자를 활성화할 수 있다. 본제품 식별자로는 활성화를 거부한다. 일반 배포·Steam 판매 수용과는 구분하며 앱은 `artifacts/latest-package.json`의 전체 폴더 배포본을 사용한다.

## 전체 제품의 실제 TEST 설치 · 2026-09-13

`artifacts/installer-full-ownership-20260913/BACKSEAT-Setup.exe`는 전체 앱 1,599,409,614바이트/2,444파일을 담은 724,234,962바이트 TEST 설치 파일이다. 압축 프로세스의 실제 종료 코드0과 `build-result.json`/`makensis-output.log`를 확보했다. 설치 파일 SHA256은 `88815525d128067dc4d5eafc917b7fe3de957407c6cc1fb6134d20c278f02211`이다. 현재 C# 원본14개의 해시도 컴파일 기록과 일치했다.

`scripts/verify-full-installer.mjs`로 HKCU·시작 메뉴의 TEST 식별자 미사용을 확인하고 `artifacts/full-mtz4kkjv`에 실제 설치했다. 전체 파일 크기/SHA256, 상태, 등록, 안정 실행기 바로가기가 일치했다. 별도 빈 프로필 `artifacts/full-native-mtz4kkjv`로 설치된 실행기를 열어 원래 ASAR 앱의 첫 실행/안내 건너뛰기/방송실/소리·화면 선택 대화상자/Escape/Alt-F4 정상 종료를 확인했다. 설치 경로의 프로세스가 0개인 상태에서 기본 임시 복사 방식으로 제거했다. 이번 제거 보고서 성공, 전체 소유 파일/TEST 등록/시작 메뉴 제거, `my-recording.txt` 보존을 확인했다. `artifacts/latest-full-installer-test.json`과 `installer-full-test-2026-09-13T01-18-12-233Z`가 원본이다.

설치된 Python·YAMNet·Whisper·Codex도 개발 PATH 없이 실행했다. 검사 도구는 설치된 `app.asar`를 별도 증거 폴더에 풀어 **그 안의 앱 모듈**을 실행하며, 원래 ASAR를 여는 native 앱 검증과 구분한다. 마이크 준비2.106초/9.4초 합성 한국어 전사2.741초, 소리 준비2.524초/8초 음향 분류와 별도 대사 전사5.665초, 실제 Astra low 일반 대화10.925초/소리 문맥 반응10.655초. 소리 문맥은 합성 음원 인식 결과를 가상 캡처 시계로 전달했으며 이 native 창에서 실제 loopback을 다시 켠 시험은 아니다. `runtime-result.json`, `runtime.log`에 실제 두 모델 응답이 있다. 원본 오디오는 Astra에 보내지 않았다.

native 소리 선택창의 체크 옵션 여백과 오른쪽 미리보기 잘림(1426×973), 일부 Windows 창 썸네일의 5초 WGC 시간 초과를 발견했다. `native-sound-dialog.jpg`, `.txt`, `native-error.log`에 보존했고 출시 UI 합격으로 간주하지 않는다. fs.Stats deprecation 경고도 남겼다. 검사 도구 자체의 초기 ASAR 로딩 실패, 상태 필드명 오기 및 PowerShell 빈 배열의 문자열 비교 오류는 수정했으며 원본 실패 로그/보고서를 같은 폴더에 보존했다. 이 세 오류는 설치 앱의 런타임 실패나 제거 성공 근거가 아니다.

기존 사용자 앱 PID26576/생성시각/실행 경로가 소리 단계와 동일함을 재확인했다(`installer-ownership-user-app-process.json`). 사용자 프로필과 Steam 세이브는 이 설치 시험에 사용하지 않았다.

## 실제 트랜잭션 수용 · 2026-09-13

현재 엔진으로 **18개 실제 Windows 검사**를 통과했다(`artifacts/latest-installer-transaction-test.json`, `installer-transactions-control-backup.log`). 작은 실제 PE 실행 파일과 11개 합성 패키지 파일을 설치하여 전체 해시·HKCU 두 뷰·시작 메뉴를 확인했다. 실행기/직접 실행/자료 파일/제거 프로그램 잠금 및 읽기 전용 파일은 제거 전에 실패하고 기존 파일을 보존했다. 공백·한글·따옴표·빈 문자열·끝의 역슬래시가 포함된 앱 인수도 실행기를 거쳐 그대로 전달됐다.

업데이트와 5개 예외 지점, 3개 강제 종료 지점에서 현재/이전 버전뿐 아니라 실행기·제거 프로그램의 실제 바이트도 확인했다. `ControlBackups.cs`는 교체 전에 두 파일의 SHA256 백업을 만들고 저널에 `controls-backed-up` 단계를 기록한다. 커밋 전 복구는 검증된 백업을 파일별 원자 교체로 복원하고, 커밋 뒤 복구는 새 버전을 유지한다. 삭제 disposition 실패는 열린 핸들을 유지한 채 취소하며, 삭제 후 소유 파일이 남으면 성공 처리하지 않고 상태를 남긴다.

**NSIS 실제 4개 흐름도 통과**했다(`artifacts/latest-installer-nsis-test.json`, `installer-nsis-first.log`). 한글·공백·`$0` 설치 경로의 설치/동일 빌드 갱신, 실행 중 코드5 거부, 제거 프로그램의 기본 임시 복사 동작을 통한 제거다. 초기 프로세스 종료 코드만 보지 않고 이번 실행의 보고서·설치 파일·HKCU·시작 메뉴를 확인했다. 제거 후 사용자 파일 역할의 `my-recording.txt`만 남았고 TEST 등록은 없어졌다. `_?=` 재실행은 사용하지 않았다. 이는 작은 합성 앱의 조용한 실행 시험이며 실제 제품/보이는 설치 화면의 검증은 아니다.

WSL Claude 검토는 session23220 코드0으로 종료했다. 원본 `claude-engine-audit-output.txt`, `claude-engine-audit-20260913/audit-result.json`, 단위101개/실행 경로 시험을 보존했다. 그러나 검토의 **제거 프로그램 변경 시 복구와 부분 제거에 결함이 없다는 판단은 실제 시험으로 반증**됐다. 해당 판단을 수용 근거로 사용하지 않는다. 수정된 현재 엔진으로 단위101개도 재실행했다(`installer-engine-current-unit/test.log`; junction 1개는 시험 도구가 건너뜀).

실패와 보존: 첫 설치 후 상태 확인 도구의 PowerShell 모듈 의존 오류(`installer-transactions-first.log`), 잠근 파일을 시험 도구도 읽으려 한 오류(`installer-transactions-second.log`)는 도구를 수정하고 정확한 TEST 설치만 제거한 뒤 재시험했다. 실제 결함은 `installer-transactions-third.log`(제거 프로그램 잠금에도 부분 제거·성공 반환), `installer-transactions-parent-lock-fix.log`(롤백 후 제거 프로그램 해시 불일치)다. 후자의 checks 마지막 문장은 해시 단언 전에 추가된 이전 시험 문구이므로 성공 근거가 아니며 `passed:false`와 오류가 우선한다. 실패 루트/원본 보고서와 의도적으로 남은 파일은 artifacts에 보존한다.

## 저장 상태·소유권 보완 · 2026-09-13

`StoredValidation.cs`에서 저장 상태와 저널의 고정 식별자, 정규 경로, 버전/빌드/파일 목록, 트랜잭션 단계와 이전 상태의 관계를 확인한다. 과거 버전은 당시 실행 파일을 요구하며 최신 소리 파일 요구 조건을 소급하지 않는다. 요청과 저장 파일 목록 모두 대소문자 및 파일/디렉터리 별칭을 거부한다. 상태 읽기 크기를 제한하고 공유 잠금은 사용 중(코드5)으로 처리한다. 출처가 다른 백업은 변경 전에 거부하고 고유 임시 파일을 사용하여 알 수 없는 기존 `.tmp`를 덮어쓰지 않는다.

staging의 재귀 삭제를 없애고 매니페스트에 있는 파일과 비어 있는 디렉터리만 정리한다. 알 수 없는 단계 폴더는 설치 전에 거부하며 중단된 폴더의 사용자 메모는 남긴다. HKCU와 시작 메뉴는 해당 앱/설치 경로 소유인지 게시 전에도 검사하고, 기존 바로가기의 사용자 지정 인수를 보존한다. 제거는 상태/백업 메타데이터의 잠금과 읽기 전용도 실제 파일 삭제 전에 검사한다. 실행기는 루트 mutex를 확보한 뒤 현재 상태를 읽는다.

현재 원본으로 영구 단위 **104개**(실제 junction 포함, 건너뜀 없음), 별도 Windows 거부/보존 **51개**, 트랜잭션 **18개**, 실제 NSIS **4개**, 생성기 **16개**가 통과했다. `latest-installer-unit-test.json`, `latest-installer-guards-test.json`, `latest-installer-transaction-test.json`, `latest-installer-nsis-test.json`과 `installer-ownership-*-current.log`, `installer-guards-current.log`, `installer-ownership-builder-final.log`가 최신 근거다. 거부 시험은 대상 전체 해시와 외부 TEST 등록의 전후 상태를 비교한다. 실제 전체 앱 설치는 별도 수용하며 이 작은 시험 결과로 대체하지 않는다.

**후속 수정:** [최초 설치의 빈 제어 폴더 복구](INSTALLER-BOOTSTRAP-RECOVERY.md)에서 저널 직전 프로세스 중단을 실제 재현하고 빈 `.backseat`만 남은 경우의 재시도를 허용했다. 최신 파일 기반 엔진 단위 검사는 **140개 통과**이며 위 외부 게시/전체 설치 시험은 이 변경 전 소스의 근거다. 이번에는 화면·앱 조작 중단을 유지하며 실제 NSIS/전체 설치를 재실행하지 않았다.

**남은 우선순위:** 최초 저널의 부분 쓰기/전원 중단, 제거 도중 늦은 게시/메타데이터 실패, 경로 동시 교체·다중 Windows 세션, 긴 경로·디스크 부족·손상 백업·보이는 설치 UI다. 알 수 없는 staging 파일을 보존한 뒤 같은 빌드를 다시 설치할 때는 현재 명시적으로 거부한다. 앱 화면 선택창의 시각 문제, 새 Windows/서명/상용 연동/Steam 검토도 남아 기본 배포 차단을 유지한다. `installer/engine/README.md`에 한계를 기록했다.

## NSIS 연결 검증 · 2026-09-13

`scripts/build-installer-engine.mjs`는 C# 원본 해시를 컴파일 전후 비교하고 실제 컴파일 결과·로그를 남긴다. 같은 엔진을 창이 깜빡이지 않는 Windows 실행 파일로 빌드하여 안정 실행기와 설치 도구로 사용한다. `scripts/build-installer.mjs`는 전체 매니페스트·엔진 SHA256을 요청 JSON에 묶고, 소리 worker/model도 필수 파일에 포함한다. Windows의 비fixture 입력 경로를 WSL 경로로 변환하던 오류와 Windows 대소문자 별칭도 수정했다.

NSIS는 각 파일을 전용 임시 폴더에 추출하고 C# 엔진을 호출한다. 설치 루트 삭제, HKCU 게시, 바로가기 변경은 NSIS 자체에서 수행하지 않는다. 결과는 이번 실행의 임시 폴더에서만 확인한 후 진단 경로로 복사하므로 이전 보고서가 성공 근거로 재사용되지 않는다. 엔진 종료 실패와 보고서 저장 실패를 구분한다.

파일 원본 경로는 컴파일 시 문자열, 추출 이름은 실행 시 문자열이다. 두 경로에 같은 `$` 이스케이프를 적용하면 컴파일 또는 추출이 깨지는 것을 실제로 발견했다. `File /oname=`의 이름과 `SetOutPath`만 실행 변수로 해석되지 않도록 처리한다. NSIS 전처리기 구문이 포함된 경로는 빌드 시 거부한다.

- `artifacts/installer-builder-path-tests.log`: 생성기 15개 검사 통과.
- `artifacts/installer-engine-ui-diagnostics.log`: 작은 합성 NSIS 프로젝트 실제 컴파일 통과.
- `artifacts/installer-engine-ui-inert-test.json`: 새 기본 빌드 실제 실행 코드10, 설치 대상/기본 TEST 폴더/시작 메뉴/HKCU TEST 키 생성 없음.
- `artifacts/latest-installer-extraction-test.json`: 별도 추출 전용 NSIS 실행으로 한글·공백·`$0`/`$INSTDIR` 경로의 11개 파일명·해시 일치. 설치 엔진·레지스트리·바로가기는 실행하지 않은 시험이다.

실패 원본도 남겼다: `installer-engine-ui-smoke-initial-makensis-failure.log`의 잘못된 `$$` 원본 파일 경로, `installer-extraction-initial-encoding-failure.log`의 UTF8 입력 인코딩, `installer-extraction-test-retry.log`의 시험 실행 `/D=` 인수 인용 오류. 마지막은 NSIS의 마지막 `/D=` 인수를 따옴표로 묶지 않는 규약에 맞춰 시험 실행기를 고쳤다. 최종 실제 추출 원본은 `installer-extraction-final.log`다.

`scripts/verify-installer-transactions.mjs`와 `scripts/verify-installer-nsis.mjs`는 TEST 식별자 선점 여부를 확인하고 별도 artifacts 루트에서 실행한다. 실패하면 해당 루트와 보고서를 보존하며 다음 시험은 남은 TEST 등록을 임의로 덮어쓰지 않는다.

## C# 엔진 진행 · 2026-09-13

추가로 [제거 실패 후 재시도 파일 보존](UNINSTALL-RETRY-CONTROLS.md)을 적용했다. 기존에는 게시 정리 실패 시 제거 프로그램이 이미 사라졌다. 이제 상태·백업·launcher·uninstaller를 마지막까지 함께 잠가 보존한다. 파일 기반 엔진231개 검사와 앱301개/빌드를 통과했으나, 이 변경의 실제 NSIS·HKCU·Start Menu 수용은 아직 검증하지 않았으므로 일반 배포 차단은 유지한다.

첫 WSL Claude 작업은 정상 종료했고 `artifacts/claude-engine-output.txt`, `claude-engine-tests.log`(74개), `claude-engine-realrun.log`를 남겼다. 그 이후의 실제 수용 결과와 현재 한계는 위 최신 절이 우선한다.

다음에는 부모 검토 후 테스트 식별자의 실제 설치/업데이트/실행 중 제거/중단·복구/외부 파일 보존과 실패 지점 전부를 검증한다. 엔진 README의 제외 범위는 위임 작업에만 적용되며 전역 승인 제한이 아니다.

## 이번에 확보한 것

NSIS 템플릿, 한국어/영어 문자열, 패키지 SHA256 검사, 파일별 추출/제거 목록 생성기, 테스트/본제품의 서로 다른 설치 식별자를 만들었다. `scripts/build-installer.mjs`는 명시적으로 컴파일을 요청했는데 컴파일러가 없으면 실패하며, SHA256 검사를 생략한 컴파일도 거부한다. 파일뿐 아니라 상위 디렉터리의 링크·junction도 거부한다.

Windows에서는 파일 symlink 생성 권한을 요구하던 테스트를 실제 디렉터리 junction으로 바꿔 링크된 부모를 검증했다. 전체 검사 중 설치 생성기 13개가 통과했다. 이는 설치·제거 동작 합격이 아니다. 새 차단 템플릿의 작은 합성 패키지는 NSIS 3.12로 컴파일했다(`artifacts/installer-reviewed-compile.log`).

차단된 새 합성 결과만 `/S`와 별도의 빈 테스트 경로로 실행해 종료 코드10을 확인했다. 실행 전후 대상 폴더·기본 테스트 설치 폴더·시작 메뉴·HKCU 테스트 제거 키가 모두 없었다(`installer-review-block-test.json`, `scripts/verify-installer-review-block.ps1`). 이는 설치 전에 중단한다는 확인이며 실제 설치/제거 수용이 아니다.

## 실행을 막은 이유와 다음 구현

| 확인한 결함 | 해제 전 필요한 구현/검증 |
|---|---|
| 파일 추출 오류 뒤 일부 필수 파일만 검사하던 문제 | 오류 플래그 검사를 추가했다. 전체 설치 결과의 크기/해시·중단·디스크 부족 시험 필요 |
| 동일 버전 폴더에 실행 파일만 있으면 재사용 | 소유권·완전한 매니페스트 무결성 검사, 부분 설치 재사용 금지 |
| 바로가기·레지스트리·상태·제거 프로그램 게시 실패를 처리하지 않음 | 단계별 실패 감지, 기존 게시 상태 보존, 중단 후 재시작 복구 |
| 실행 중 제거에서 파일 삭제 후 실행 파일 잠금을 검사 | 어떤 삭제보다 먼저 해당 설치의 실행/잠금 검사, 실행 중이면 변경 없이 중단 |
| 선택한 설치 루트의 실제 소유권 검사가 없음 | 외부 상태 파일/폴더 거부, 재분석·경로 탈출·junction 검사, 정확한 앱 식별 |
| 이전 버전 목록과 제거·되돌리기 미구현 | 직전 버전 보존과 버전별 소유 목록, 업데이트/제거/중단 후 상태 시험 |

소유 파일만 삭제하는 목록이나 같은 볼륨 rename 하나만으로 전체 설치 트랜잭션의 안전성을 주장하지 않는다. 제거 프로그램의 자체 삭제 방식도 실제 NSIS 동작과 공식 문서를 기준으로 별도 검증한다. 초기 설계에서 `_?=` 재실행이 반드시 필요하다고 쓴 부분은 검증되지 않은 주장이라 채택하지 않았다.

이 결함을 고치고 격리한 테스트 설치의 설치·업데이트·실행 중 제거·중단 복구·사용자 자료 보존을 확인한 뒤에만 초기 차단을 제거한다. 이후 새 Windows, 서명과 게시자, 다중 GPU/DPI, 상용 연동 조건, Steam 검토는 별도 출시 기준이다.

## 컴파일 재현

```powershell
$env:MAKENSIS = 'G:\dev\ai\00_game_backseat\artifacts\installer-tools\nsis-3.12\makensis.exe'
node scripts/build-installer.mjs --fixture --mode=test --compile --out=artifacts/installer-reviewed-fixture
```

위 결과도 시작 단계에서 차단된다. 큰 실제 패키지를 다시 압축하기 전에 작은 fixture로 오류와 중단 처리를 검증한다. 검토되지 않은 예전 생성물을 실행하거나 배포하지 않는다.

## 원본 증거와 도구 출처

WSL Claude의 원본은 `artifacts/claude-installer-output.txt`, `claude-installer-result.json`, `claude-installer-tests.log`다. 초기 설계 문서는 `artifacts/installer-design-before-root-review.md`에 보존했다. 이 자료의 성공/안전 설계 설명보다 현재 문서의 검토 결론이 우선한다.

이전 1.58GB 패키지의 전체 압축은 완전한 종료 기록 없이 끝났고 현재 makensis 프로세스가 없다. 710,239,440바이트 결과를 성공한 설치 파일로 인정하지 않았다. 기존 결과 두 개는 `.exe.unreviewed-disabled`로 보존했다. 결과 실행·실제 설치·제거는 하지 않았다.

NSIS 3.12는 [공식 다운로드](https://nsis.sourceforge.io/Download)에서 연결되는 SourceForge ZIP을 사용했다. 공식 호스트 RSS의 크기 2,362,938바이트/MD5 `757c22153dd8b90f5e297310d9966997`과 다운로드가 일치했다. 로컬에서 기록한 SHA256은 `56581f90db321581c5381193d796fffcf2d24b2f8fed2160a6c6a3baa67f2c4f`이며 공식 SHA256으로 독립 확인한 값이라고 주장하지 않는다. 도구와 COPYING은 `artifacts/installer-tools`에 보존했다. API·설치 문법은 [공식 NSIS 문서](https://nsis.sourceforge.io/Docs/)를 기준으로 재검토한다.
