# BACKSEAT 작업 인계

2026-09-13 · 작업 폴더 `G:\dev\ai\00_game_backseat`

## 목표와 현재 상태

### 진행 중 확장 · 2026-09-13

**현재 최신: 관객 자율성 전환과 설정 6개 탭 구현·새 전체 배포본 검증 완료. 판매 목표는 계속 활성.** 이 절이 아래 화면 선택창 단계의 ‘미구현/다음 구현’ 기록보다 우선한다. 상세 기준은 `docs/AUDIENCE-AUTONOMY.md`, 원본과 실패 증거를 포함한 보존 목록은 `artifacts/audience-autonomy-evidence.json`이다. 사용자 실행 중 앱과 실제 `data/`를 재시작·초기화하지 않았다.

`server/world.js`가 settings/audience/economy/autonomy를 단일 저장 단위로 관리한다. 신규 관객 후보 없음, 기존 만난 ID/기록 보존·미만남 후보 보관, API/SSE/export 비공개 투영, 유입 hold/commit/refund/재시작 영수증과 영구 해금이 구현됐다. `audience-autonomy.js`는 실제 유입 시 Astra 생성, 시간·클립·50P 유입, 대화 근거 진화·닉네임/별명 이력·개인 메모·제거를 담당한다. 메모는 모델 입력에서 제외한다. 저장 실패에도 방송을 중단하고, 실패한 첫 시작과 생성/해금 중 제거된 관객의 늦은 응답을 취소·환불한다.

`ambient.js`와 `NaturalExperiences.tsx`로 일반 방송 중 축하·라디오·취향·도전·회상 등을 대화에 연결했다. 기존 기획/시즌 새 시작·단계 전환/수동 클립 API를 닫고 옛 기록·선택적 대응 연습을 보존한다. `clips.js`의 개인적 클립 선택은 후원 임계값과 독립적이며 실제 목격자만 가능하다. `useClipBuffer.ts`/`useMedia.ts`는 당시 버퍼가 남은 관객 클립에만 허용된 영상·출력 소리·마이크를 붙인다. `SettingsDialog.tsx`/CSS는 6탭·초안/오류·키보드·좁은 창/200% 확대, `AudiencePanel.tsx`는 해금/메모/별명/제거 UI를 제공한다.

전체 **234 Node + TypeScript/Vite 통과**(`autonomy-release-final-check.log`), 신규 자율성15개에는 별도 자식 프로세스 강제 종료 후 동일 디스크의 hold/commit 복구가 포함된다. Electron7흐름/24레이아웃(`audience-autonomy-ui.json`, 최종 폴더 `autonomy-ui-1789266516126`), 기존 dialog13(`autonomy-dialog-regression-retry.log`) 통과. 실제 Astra low가 연필옆여백을15.534초에 생성하고11.332초에 취향을 유지한 잡담에 응답했다(`audience-autonomy-astra.json`, 합성 스트리머 발언, 실제2호출). 실제 Windows loopback5흐름과 관객 선택 영상의 단일 트랙440/880Hz검출(`sound-ui-1789266669343`, `autonomy-loopback-retry.log`, `autonomy-loopback-mix.log`) 통과. 최초 loopback은 합성 관객 난수0 때문에 전원 이탈한 시험 조건을 고쳤다. 확대38px 패널은 실제 스크린샷에서 발견해120px이상으로 고쳤다. 실패 원본과 WGC/DXGI 경고를 보존한다.

최종 전체 폴더 **`release/2026-09-13T02-40-02-757Z/app/BACKSEAT-win32-x64`**, 1,599,426,489바이트/2444파일/미서명. `autonomy-package-final.log` 실제 종료0. 전체 파일hash/핵심36원본/fuses일치(`autonomy-package-integrity.json`), 새 배포 ASAR에서 추출한 모듈과 전달된Python·Whisper·YAMNet·Codex를 개발PATH 없이 실행한 실제한국어/STT/소리/Astra2호출(`autonomy-packaged-runtime.json/.log`) 통과, session14700도 실제 종료0 수집. 초기 중간02-35 패키지는 최신이 아니다. 이번 세대 NSIS 재압축/설치 시험은 하지 않았으며 이전 TEST 설치 수용과 구분한다.

새 원본 ASAR의 native 첫 실행/안내 건너뛰기/0관객/설정6탭·분위기 전환/Escape/관객 화면을 확인하고 Alt+F4로 정상 종료했다. 격리 프로필 `autonomy-native-20260913-114345`, PID29744, 창4721096, 정확한 최종 패키지 exe만 대상이었다. `autonomy-native-result.json`, `autonomy-native-{studio,settings,audience}.jpg/.txt`, `autonomy-native-mood.txt`, `autonomy-native-processes-after.json`(0개), stderr Stats경고를 보존한다. 원래 개발 앱 창9767352는 건드리지 않았다. native UI에서는 화면/마이크/소리/실제 모델 호출을 켜지 않았고, 이 증거와 위 별도 실제 모델·loopback 시험을 구분한다.

WSL Claude는 설정 두 파일만 구현 후 실제 종료0(session `0692ec77-37e7-4ab2-82be-4a05791e7274`, 16턴, permission_denials 없음), `claude-settings-tabs-*`와 실행 스크립트에 원본을 보존했다. 부모가 연결·레이아웃·복구·문구를 수정하고 검증했다. 추가 Claude/테스트/모델/패키징 프로세스는 모두 종료했다. 개인 메모리 수정 없음.

**다음 행동:** 자연 유입/장기 관계·닉네임·클립 공유·포인트 균형을 실제 방송에서 평가하고, 화면·게임 소리·물리 한국어 음성의 혼합 상황과 Steam 게임의 실제 플레이 수용을 이어간다. 일반 대화의 단서 기반 자연 진행은 구현됐지만 장기 사건·관계 시뮬레이션 전체가 완성된 것은 아니다. 설치의 최초 저널 전 중단/늦은 제거 실패·새 Windows·서명·상용 연동 조건·Steam 판매 심사도 남는다. 목표 완료/차단으로 표시하지 않는다. 아래는 이전 단계의 시점별 기록이다.

**최신: 화면 선택창 개선 완료, 관객 자율성 전환 요청 수용. 판매 목표 계속 활성.** `docs/CAPTURE-PICKER.md`가 새 배포/검증, `docs/AUDIENCE-AUTONOMY.md`가 이번 사용자 요청과 다음 구현 기준이다. 새 요구는 직접 관객 추가/성향 편집과 수동 클립을 없애고 시간·핫클립·포인트 유입 시 새 관객 생성, 대화 기반 성향/닉네임 변화와 메모, 포인트 기반 성향 해금, 일반 방송 중 자연스러운 상황, 설정 탭이다. 기존 데이터를 보존한다. 아직 자율성 전환 코드는 구현되지 않았으므로 완료로 표현하지 않는다.

`src/CapturePicker.tsx`, `capture-picker.css`, App 연결, `desktop/capture.cjs`/preload/types: 목록부터 열고 thumbnailSize0 이름 조회, 화면/창별 비동기 미리보기, 진행 중 native 요청 병합, 지연된 이전 응답과 이름이 바뀐 ID 무시. 4초 뒤 이름 선택 안내, 검색/새로고침/오류 복구, 공유 설명 카드/구성 요약, minmax 격자/긴 제목/작은 창/확대. 오디오 동의/메인 프레임/단일 선택 경로는 유지한다. WGC 자체의 5초 경고를 제거한 것은 아니며 UI를 먼저 사용하도록 했다.

전체219 Node/TS/Vite, capture 정책6, 새 Electron8흐름/여섯 viewport(200% 포함), 기존 dialog13 통과. `capture-picker-check.log`, `capture-picker-test.json`, `capture-picker-renderer-final.log`, `capture-picker-dialog-current.log`. 실제 Windows 메타데이터711ms/미리보기 중 재조회670ms, 화면636ms/창1111ms(`capture-native-test.json`). 실제 loopback5흐름 + 녹화의 단일 트랙 440/880Hz 확인(`capture-picker-loopback.log`, `capture-picker-loopback-mix.log`, `sound-ui-1789263905810`). 실패 원본과 검사 도구 수정은 CAPTURE-PICKER 문서 참조.

새 전체 폴더 `release/2026-09-13T01-45-11-001Z/app/BACKSEAT-win32-x64`, 1,599,419,543바이트/2444파일/미서명. package session31181 종료0. 전체 hash/핵심28원본/fuses(`capture-picker-package-integrity.json`), 새 번들의 실제 한국어 STT/소리 분석/Astra low 두 호출(`capture-picker-packaged-runtime.json`, session72374 종료0). 마이크 준비6.429초/전사2.506초, 소리 준비2.200초/분석5.923초, 모델14.834/10.840초. native 빈프로필 `picker-native-20260913-104803`, PID27028 정상종료/패키지 프로세스0개. 개선 선택창 실제 관찰 `capture-picker-native-dialog.jpg/.txt`, `native-result.json`의 전체 이름은 capture-picker 접두사. WGC/Stats 경고 보존. 이 패키지로 NSIS를 다시 압축/설치한 것은 아니며 앞 단계 installer 수용은 당시 앱에 대한 증거다.

사용자 앱은 작업 중 별도로 재실행된 것을 발견했다. 현재 관찰된 PID31080, 2026-09-13T10:44:09.925313+09:00, 정확한 node_modules/electron/dist/electron.exe . 이다. 이전 PID26576을 살아 있다고 가정하지 않는다. 이번 선택창 작업에서 사용자 프로필/앱을 종료하거나 재시작하지 않았다. 현재 추가 테스트/모델/컴파일 프로세스는 모두 종료했다.

WSL Claude 읽기 전용 검토 session4129 실제 종료0, 29턴/약358초, permission_denials 없음, 추가 Claude 작업 없음. 원본 `claude-audience-autonomy-output.json`, 추출 본문 `.md`(파일명 끝은 -review.md), 프롬프트/스크립트/exit/error 보존. 부모가 실제 source 핵심을 확인했으며 권고 전체를 채택하지 않는다: 두 파일 저장을 economy.change로 감싼다고 원자적이지 않음, point 유입 성향 사전 선택 금지, 보장 자동 첫관객 대신 첫 체험 포인트 유입 우선, positiveMoment만 클립 조건으로 쓰지 않음, 은퇴 관객의 역사 삭제 금지, 별도 모드를 자동으로 켜는 것만으로 자연스러움 대체 금지. 상세 `docs/AUDIENCE-AUTONOMY.md`.

**다음 행동:** 새 사용자 방향을 우선 구현한다. 서버 소유 관객/내적 성향의 공개 투영과 마이그레이션, 유입/포인트 정산의 단일 커밋을 먼저 설계·구현하고 API/SSE/export 누출과 실패/취소/재시작을 실제 검증한다. 그 다음 진화/별명/메모/해금, 관객 주도 클립, 자연 발생 상황, 설정 탭을 연결한다. 기존 설치의 최초 저널 전 중단/늦은 제거 실패, 실제 Steam/장기 물리 음성·관객 개성/새 Windows·서명·상용 연동·Steam 심사도 계속 남는다. 목표를 완료/차단으로 표시하지 않는다. 아래는 이전 단계 기록이다.

**최신: 저장 상태·소유권 보완 및 전체 1.6 GB 앱의 실제 TEST 설치/실행/제거까지 통과. 판매 목표 계속 활성.** 이 절이 아래 이전 단계의 최신 표기보다 우선한다. `docs/INSTALLER.md`, `installer/engine/README.md`를 갱신했다. production 활성화는 여전히 거부하며 일반 배포/Steam 판매 합격은 아니다.

현재 원본14개 C#에 `StoredValidation.cs` 추가: 고정 식별자/정규 경로/버전·파일 목록/트랜잭션 관계 검증, 공유 잠금 코드5, 알 수 없는 백업 선검사, 고유 메타데이터 임시 파일. 매니페스트 파일만 지우는 staging 정리로 재귀 삭제 제거/알 수 없는 메모 보존. 게시 전에 HKCU와 시작 메뉴의 앱/루트 소유권 확인/사용자 바로가기 인수 보존. 제거는 상태/백업 잠금과 읽기 전용도 payload 삭제 전에 확인. 실행기는 mutex 뒤 상태 읽기. `Models.cs`와 JS 생성기에 파일/디렉터리 별칭 거부, 버전/경로 구문 강화. 오래된 저장 버전에 최신 소리 필수 목록을 소급하지 않는다.

영구 단위 `test/installer/EngineTests.cs`/`scripts/test-installer-engine.mjs` 104개(실제 junction 포함, 건너뜀 없음), `verify-installer-guards.mjs` Windows 51개, 기존 engine18/NSIS4, 생성기16개 통과. `latest-installer-{unit,guards,transaction,nsis}-test.json`, `installer-ownership-*-current.log`, `installer-guards-current.log`, `installer-ownership-builder-final.log`. 거부 검사는 전체 대상 해시/외부 TEST 등록의 전후 동일성을 확인한다. 원본/실제 상태가 성공 기준이며 이전 Claude audit의 반증된 무결함 주장은 수용 근거가 아니다. 추가 Claude 작업 없음.

전체 컴파일 session88768 **실제 종료0**. `installer-full-ownership-20260913/BACKSEAT-Setup.exe` 724,234,962바이트, SHA256 `88815525d128067dc4d5eafc917b7fe3de957407c6cc1fb6134d20c278f02211`, payload1,599,409,614바이트/2,444파일. 생성물은 TEST만 실행 가능. `build-result.json`/`makensis-output.log`/현재14원본 일치. 설치 session56120 종료0, `artifacts/full-mtz4kkjv`에 전체 파일 크기/해시/HKCU/시작메뉴 확인. `scripts/verify-full-installer.mjs` install/uninstall 두 단계, `latest-full-installer-test.json` passed/installed/uninstalled 모두true. 제거 후 `my-recording.txt`만 남고 TEST 키 두뷰/그룹없음. 실패 시 사용자데이터나 전체 artifacts를 삭제하지 않는다.

설치된 ASAR의 모듈을 새 증거 폴더로 추출하여 개발 PATH 없이 번들 런타임 실행(session90167 종료0). `installer-full-test-2026-09-13T01-18-12-233Z/runtime-result.json`: 음성 준비2.106초/9.4초 합성 한국어 전사2.741초, 소리 준비2.524초/8초 음향 분류·별도 대사 전사5.665초, 실제 Astra low 일반대화10.925초/소리문맥10.655초. 후자는 설치된 Studio에서 청취자별문맥/가상캡처시계로 전달한 합성 음원이며 native 실제 loopback 재시험이 아니다. 원본오디오 Astra전송false. “신나는 일이…”가 끊겼다고 반응/화면봤다는주장없음. `verify-packaged-runtime.mjs`는 --folder/--report/--live/--sound-live 지원, workspace source가 아닌 설치 ASAR 코드실행. 초기 ASAR 직접import 실패와 제거검사 state.root 오기/빈배열 문자열비교 실패는 도구를 고치고 원본3건을 같은 evidencebase에 보존했다. 엔진/설치앱 실패로 둔갑시키지 않는다.

native 안정 실행기로 빈프로필 `artifacts/full-native-mtz4kkjv`를 열어 실제 원본ASAR 첫실행→안내건너뛰기→방송실/구독상태→소리·화면선택대화상자→Escape→AltF4를 확인. 실제 설치앱 PID12284 및 실행기 정상종료/설치경로프로세스0개. `native-result.json`, `native-sound-dialog.jpg/.txt`, `native-processes-after.json` 및 stderr보존. **새 발견: 화면 선택창의 옵션 여백 부족/미리보기 오른쪽잘림(1426×973), 일부 창 WGC썸네일5초시간초과**. fs.Stats deprecation도있음. 해당native시험에서캡처/마이크를실제로켜지는않았다. 시각품질합격으로간주하지않는다.

사용자 앱 PID26576/2026-09-13T08:43:10.383029+09:00/정확한electron.exe경로가이전소리단계와동일. `installer-ownership-user-app-process.json`. 앱/사용자프로필/Steam세이브변경없음. `.models`보존. 개인메모리수정없음. 현재설치/컴파일/모델/검증프로세스완료, TEST등록없음. 이전 `installer-stage-evidence.json`/source snapshot은변경하지않는다. 새증거목록은 `latest-installer-ownership-evidence.json` 및고유 `installer-ownership-source-*`에기록한다.

**다음 우선순위:** 새로확인한캡처선택창UI/썸네일대기, 최초설치저널전전원중단, 제거중늦은게시실패, 손상control백업/긴경로/디스크부족/동시경로교체·다중Windows세션. unknownstaging보존후동일빌드재시도는현재거부하므로사용자복구흐름도남음. 실제Steam장르별소리/물리한국어마이크·20분몰입/관객개성장기검증, 새Windows/GPU/DPI/서명/상용구독연동조건/Steam심사유지. 목표완료나차단으로표시하지않는다. 아래는이전단계기록이다.

**최신: 설치 엔진·NSIS 연결의 작은 실제 Windows 수용 단계. 판매 목표 계속 활성.** `docs/INSTALLER.md`와 `installer/engine/README.md`가 현재 기준이다. 기본 NSIS는 코드10 차단, `--mode=test --enable-test-install`만 격리된 TEST 신원으로 실행 가능하며 production 활성화는 거부한다. 아직 전체 1.6 GB 앱 설치/일반 배포 합격이 아니다. 사용자 앱은 아래 소리 단계의 PID26576/생성시각/경로 그대로 유지했으며 앱·프로필을 수정하지 않았다.

부모가 `scripts/build-installer-engine.mjs`, JS 빌더/NSIS 템플릿, 실행 시험3종(추출/엔진/NSIS)을 연결했다. 원본 해시 전후 확인 후 `/target:winexe` 컴파일, 정확한 payload+engine 요청, Windows 경로 오류 수정, 필수 소리 worker/model 포함, 대소문자 별칭 거부, NSIS 컴파일 문자열과 실행 파일명 `$` 이스케이프 분리. 진단 보고서는 이번 NSIS 임시 폴더에서 확인한 후 외부로 복사한다. 15개 생성기 검사, 실제 한글·공백·$ 경로11파일 추출/hash, 기본 차단의 설치루트/HKCU/시작메뉴 무변경 통과. `installer-builder-current-tests.log`, `installer-extraction-final.log`, `latest-installer-extraction-test.json`, `installer-engine-ui-inert-test.json`.

**실제 엔진18개 + NSIS4흐름 통과.** `artifacts/latest-installer-transaction-test.json`/`installer-transactions-control-backup.log`는 `installer-txn-2026-09-13T00-27-09-153Z`의 작은 실제 PE+11파일 패키지다. 설치/전체hash/등록/동일빌드/안정실행기·직접실행·자료·제거프로그램 잠금/읽기전용/정확한 인수 전달/업데이트/5예외 롤백/3강제종료 복구/사용자파일 보존을 확인했다. `latest-installer-nsis-test.json`/`installer-nsis-first.log`는 `installer-nsis-2026-09-13T00-29-14-949Z`의 실제조용한 설치·갱신·busy코드5·기본 임시복사 제거다. `_?=` 없음. 신선한 보고서와 실제파일/두HKCU뷰/시작메뉴가 기준이며 첫프로세스 exit0만으로 완료하지 않았다. 테스트 등록/메뉴는 모두 없어졌고 각 마지막루트에는 의도한 `my-recording.txt`만 남았다. 큰 제품/보이는NSISUI/새Windows 시험은 아니다.

**발견·수정:** 제거프로그램 파일잠금 누락으로 나머지파일을 삭제하고 성공한 결함(`installer-transactions-third.log`)을 실제로 재현했다. 잠금 선검사 목록에 제거프로그램을 추가했다. 부모 스냅샷 시험(`installer-transactions-parent-lock-fix.log`)은 롤백 이후 제거프로그램 해시가 새것으로 남는 결함도 재현했다. `ControlBackups.cs`의 durable SHA256백업, 교체 전 `controls-backed-up` 저널, 복구 시 전체백업검증/파일별원자복원/성공후정리로 수정했다. 삭제disposition실패는 핸들을 닫기전에 취소하며 남은소유파일은 상태보존+실패처리한다. Program은 설치된실행기 이름에서 임의앱인수를 전달한다. 현재소스로 C#101개 재통과(`installer-engine-current-unit/test.log`, junction1개는도구skip).

WSL Claude 감사 **session23220 exit0 완료**, 추가Claude없음. 원본 `claude-engine-audit-output.txt`, `claude-engine-audit-20260913/audit-result.json`/101개단위/수정없는실행기록. 하지만 감사의 "제어바이너리복구/부분제거 결함없음" 판단은 위실제로반증했으므로 채택하지 않는다. 기존README `installer-engine-readme-before-parent-acceptance.md`를 보존하고 현재README를 다시 작성했다. `installer-parent-lock-fix`는 부모의 중간소스실험이며 현재제품소스가 아니다.

첫두부모시험은 도구오류: PowerShell자식에서 Get-FileHash 모듈없음(`installer-transactions-first.log`), 배타잠금중같은파일을hash하려함(`installer-transactions-second.log`). nativeSHA256과잠금해제후전체대조로고쳤고 정확한해당TEST루트만 제거했다(각폴더 cleanup보고서). 세번째실패루트 `installer-txn-2026-09-13T00-19-40-908Z`에는 당시삭제하지못한 합성제거프로그램 하나를 증거로 남겼다; state/HKCU/메뉴없음. 다른실패루트정리보고서도보존. 최초NSIS $$원본경로/UTF8/D인용실패로그보존. `installer-transactions-parent-lock-fix.log`의 마지막 checks문구는 이후해시단언실패전에추가된 문구라 통과근거아님; `passed:false`/오류우선, 현재스크립트는순서를수정했다.

**다음 우선순위:** 저장state/journal의모든식별자·경로검증(현재root/AppId일부검사만), 미소유기존 `.pending-*` 삭제거부·중단staging내알수없는파일보존(현재재귀삭제남음), registry/shortcut게시전외부소유권확인, 최초설치저널이전중단, metadata잠금·게시실패/동시Windows세션·긴경로·디스크부족·복구도중중단, 실제전체제품NSIS설치/실행검증. 이항목해결전production기본차단유지. 기존필수Steam/상용조건/서명/새Windows/실제게임·한국어장기몰입기준도유지. 개인메모리수정없음. 최종 단계 증거는 `artifacts/installer-stage-evidence.json`에 해시와 소스일치/프로세스상태를 기록한다.

아래는 이미 배포된 소리 단계의 기록이다.

**최신: Windows 시스템 소리 청취 구현·검증·배포. 판매 목표 계속 활성.** 사용자 최신 요청(배경음악/효과음/화면 밖 소리)을 `docs/SYSTEM-SOUND.md`에 기획·구현·검증·한계로 기록했다. `desktop/capture.cjs`의 명시적 전체 출력 loopback, `useSystemSound.ts` 4초 녹음/최대2구간 대기/취소, `server/local-sound.js` + `sound_worker.py`의 실제 YAMNet/별도 Whisper, `SoundScene`의 관객별 청취자·최근30초 단서를 Astra/low에 제공한다. 원시 오디오는 Astra 입력 미지원이므로 로컬 결과를 전달하며 게임 대사는 스트리머 발언/훈수 요청과 분리한다. 소리 전용 잡담/중지/클립 단일 혼합 오디오와 이전 버퍼 폐기를 구현했다. 모델은 고정 HF 제3자 ONNX 변환본이며 SHA256/원문 라이선스/NOTICE를 포함한다.

**213개 Node 검사+TS/Vite+새 패키지 통과.** `artifacts/sound-package-final.log`, `sound-final-tests.log`. 후자는 테스트의 개발 모델 파일 의존 제거 후 재실행이며 앱 원본은 동일하다. 실제 worker 무음/비프/화음/한국어/손상 입력 `sound-worker-test.json`; 합성 화음의 전화 신호 오분류와 일반 게임 의미의 한계를 기록했다. Electron5흐름 `sound-desktop-test.json`, 별도 프로세스 소리를 실제 Windows loopback으로 받은5흐름 `sound-loopback-test.json`. 실제 물리 마이크가 아니라440Hz합성 입력이다. 두 녹화 모두 단일 오디오에440/880Hz 검출 (`sound-mix-test.log`, `sound-loopback-mix-test.log`, 각 sound-ui 폴더 mixed-audio-test.json). 초기 시험은 시작UI전환 전 마이크 클릭 때문에 한쪽만 들어온 것을 스펙트럼으로 발견했고 연결 상태를 기다려 수정했다. clone 오류/미리보기 캡처 오류의 초기시험파일도 남겼다.

실제 Astra/low 청취 반응 `sound-live-test.json`/`.log`: loopback 신경망 결과를 가상 시계로 재생하여10.455초, 전자음/전화 연결 느낌에 반응하고 보이지 않은 게임 단정 없음. 첫 `sound-live-invalid-witness-fixture.*`는 시험이 입장 시각을 방송 전으로 옮겨 청취자0명이 되어 소리 문맥이 없었고, 당시 passed:true는 구조검사만 뜻한다. 수정 시험은 청취자5명과 실제 반응을 확인했다. 원본 오디오를 Astra에 보냈다는 주장은 하지 않는다.

**현재 독립 배포:** `release/2026-09-12T23-41-52-732Z/app/BACKSEAT-win32-x64/BACKSEAT.exe`,1,599,409,614바이트/2,444파일/미서명. `sound-package-integrity-test.json`:전체SHA256/핵심28원본/fuses일치. `sound-packaged-runtime-test.json`/`.log`:개발PATH제외,마이크준비6.147초/전사2.769초,소리준비2.630초/8초합성한국어음향분류+전사5.571초,실제Astra10.310초. native별도프로필 `artifacts/sound-native-20260913-084509`,PID1276시작/안내건너뛰기/소리제어표시/정상종료,해당패키지프로세스0. `sound-native-test.json`, `sound-native-page.jpg/.txt`, stderr fs.Stats deprecation1개. native창의 loopback 재시험은 아니며 캡처코드일치와 별도실제Windows시험을 구분한다.

사용자 앱은 기존설정SHA256/11관객/오늘도같이한판/플레이어 보존,기존PID23944정상종료 뒤 **PID26576** 시작2026-09-13T08:43:10.3830292+09:00,정확한exe `node_modules/electron/dist/electron.exe .`. `sound-user-app-process.json`, `sound-delivered-state.txt`, `sound-delivered-page.jpg`, 출력/빈오류로그. 방송/마이크/화면/시스템소리OFF,호출0,구독연결. 개인프로필시험데이터없음.

**다음: 설치 엔진 검토·NSIS 연결과 격리된 실제 설치 수용.** WSLClaude는 `installer/engine/*.cs`+README 구현,74개검사,실제바이너리의 수정없는 오류경로 검증을 완료하고 **session22558 exit0 정상종료**했다. stdout `claude-engine-output.txt`, `claude-engine-tests.log`, `claude-engine-realrun.log`, compile `artifacts/claude-engine-build/InstallEngine.exe` SHA256 c460d93d22f07e779cef57bba69ff39d45031943a347be3c46d35112d251caff. 마지막응답뒤CLI가잠시남아 있었으나 자연종료했다. SIGINT사전소유권검사에서이미PID없음으로중단되어 실제신호전송없음. 현재 추가Claude작업없음. 원래루트거버넌스가레지스트리수정을금지한다는README오표현은 위임범위제한으로바로잡았다.

엔진의 실제설치/롤백/파일잠금/업데이트/제거/중단저널은 **부모 검토와 실제변경시험 미완료**다. NSIS .onInit/un.onInit 코드10차단 유지. `docs/INSTALLER.md`와엔진README를읽고, REQUIRED_RUNTIME_FILES에새소리worker/model2개추가,Windows CLI무조건winToWsl경로오류수정 후작은별도TEST신원으로확인한다. 컴파일/74단위검사로설치완료라고하지않는다. 장기실제한국어·Steam장르/혼합음원·장치/GPU/DPI·서명·상용연동조건·Steam심사 기준유지. 개인메모리수정없음. 소리 단계 최종증거목록 `artifacts/sound-evidence.json`.

아래는 이전 대화 기억 단계의 기록이다.

**최신: 공개 원문 기반 관객 대화 기억 구현·검증·배포. 판매 목표는 계속 활성이다.** `docs/CONVERSATION-MEMORY.md`가 원문/검색/삭제/저장·복구/실제 실패 및 수정 결과의 기준 문서다. `ConversationJournal`은 세션·시각·작성자·목격자·가상 구분을 기록하고 일반 라이브/시즌의 관객별 문맥에 관련 원문을 제공한다. 4,000개 보관/100개 고정, `방송 밖 이야기`의 검색·관객 필터·페이지·고정·두 단계 삭제 UI. 비공개 인터뷰/속마음은 섞지 않는다. 출처 없는 기존 문자열은 새 라이브/시즌 모델 기억에서 제외한다. 전체 프로필/핫클립/시즌/복구 백업까지 지우는 전역 삭제는 아니다.

`server/journal-store.js`는 불변 SHA256 조각과 원자 인덱스/3백업, 검증/손상 복구/레거시 이전/보수적 GC다. 긴 원문4,000개 단일JSON 약416ms/쓰기·306ms/검색 문제를 발견해 조각화와 불변문자열 복사로 평균39.62ms/쓰기·53.06ms/검색으로 줄였다. `journal-capacity-test.json`, `journal-capacity-final-test.json`; 합성 최대치 시험이며 메인 서버 비용은 남는다. 어휘 검색이므로 무제한 의미 기억·학습이나 장기 자연스러움 합격을 주장하지 않는다.

**203개 Node 검사+TS/Vite+새 패키지 통과** (`artifacts/memory-package-final.log`), 기억 전용19개 (`journal-final-tests.log`), Electron UI8흐름 (`memory-journal-desktop-test.json`, `memory-journal-ui-final-output.log`, `.png`). 실패 로그 `memory-package.log`: 기존 시즌 테스트가 확률적으로 선택되는 관객 중 모모만 검사했던 것이므로 실제 공개한 관객의 원문/fictional 출처를 검증하도록 수정했다. 저장 실패/손상/재시작/늦은 입장자/고정·삭제/900px도 확인했다. 합성 UI이며 물리적 장치 시험과 구분한다.

실제Astra8회(`conversation-memory-live.json`/`.log`)에서 약속 요일 정정·첫 방문자 격리·두 재시작과180개 합성 중간 발언 뒤의 취소를 확인했지만 마지막 개인 코너 회상은 실패했다. 보고서의 passed:true는 당시 자동단언만 뜻한다. 순위/선택 수정 뒤 **각 질문 시각 이전 원문만** 사용한 실제2재실행에서 모모 ‘이번 주 작은 행복’/각보는고양이 ‘한 판 돌아보기’와 취소를 확인했다 (`conversation-memory-retrieval-fix.json`/`.log`,10.455초/11.618초). 더 늦은 원문을 취소 재실행에 넣었던 이전 결과는 `*-later-cutoff.*`에 구분했다. 전체8회를 다시 반복하지 않았고 키보드/가상시계 시험이다. 실제20분음성/장기몰입 기준은 유지한다.

**현재 독립 배포:** `release/2026-09-12T22-53-02-151Z/app/BACKSEAT-win32-x64/BACKSEAT.exe`,1,583,258,060바이트/2,437파일/미서명. `memory-package-integrity-test.json`:전체SHA256/핵심22원본/fuses일치. 새번들로 개발PATH없이 음성준비5.626초/9.4초합성한국어전사2.274초/실제Astra11.069초 (`memory-packaged-runtime-test.json`, `.log`). native빈프로필 `artifacts/memory-native-20260913-075739`에서 안내건너뛰기/기억화면/정상종료확인,PID24188종료·해당경로0개. `memory-native-test.json`, `memory-native-page.jpg/.txt`. stderr fs.Stats deprecation1개 보존, 앱오류없음. 실제기억관리8흐름은 위 별도Electron합성프로필 시험이다.

사용자 앱은 기존11관객/오늘도같이한판/플레이어 설정을 보존해 정상종료 후 최신코드로 갱신했다. PID23944, 시작2026-09-13T08:00:26.470113+09:00, 정확한exe는 `node_modules/electron/dist/electron.exe .` (`memory-user-app-process.json`). Start-Process 직후 Path가 일시적으로 ntdll을 보고하여 최종 Win32_Process 경로로 재확인·기록했다. 방송/화면/마이크중지,호출0,구독연결. `memory-delivered-state.txt`, `memory-delivered-output.log`/`error.log`(빈오류). 검증용데이터는 사용자프로필에 넣지 않았다.

**다음 우선순위: 설치 트랜잭션 결함 수정과 격리된 실제 설치/업데이트/제거.** WSLClaude는 설치 생성기/NSIS스캐폴드를 만들고 정상종료했다. 현재 추가Claude작업없음. 원본 `claude-installer-output.txt`, `claude-installer-result.json`, `claude-installer-tests.log`. 부모 검토에서 실행중제거가 일부파일을 먼저 지움, 설치루트소유권없음, 게시단계실패복구없음, 동일버전exe하나만신뢰, 이전버전관리미구현을 확인했다. 따라서 **템플릿 .onInit/un.onInit은 종료코드10으로 실행차단**했다. `docs/INSTALLER.md`가 이전설계보다 우선한다. 큰실제패키지 압축은 종료기록없고 makensis프로세스도없어 성공인정하지 않았으며 기존결과2개를 `.exe.unreviewed-disabled`로 보존했다(삭제안함). 추출오류검사·링크된부모검증·컴파일요청시실패코드를 보완, Windows테스트13개통과. 새작은fixture만 컴파일했고 차단실행에서 코드10/설치폴더·시작메뉴·HKCU키무변경을 확인했다(`installer-reviewed-compile.log`, `installer-review-block-test.json`). 설치/제거완료는 아니다.

설치 작업 재개: 작은fixture와 별도 test신원으로 먼저 소유권/원자게시/잠금선검사/중단복구를 구현하고 검증한 뒤 차단을 제거한다. `artifacts/installer-tools/nsis-3.12/makensis.exe`(3.12),MAKENSIS환경변수로빌더지정. 공식호스트MD5/크기일치만독립확인,기록한SHA256은로컬측정. `scripts/verify-installer-review-block.ps1`은현재차단을검사하므로 해제단계에서 실제설치수용시험으로대체해야 한다. 개인메모리수정없음. Steam/상용연동조건/서명/새Windows/장기음성·관객개성 기준을 낮추지 않는다. 최종증거목록 `artifacts/memory-evidence.json`.

아래는 이전 음성 단계의 기록이다.

**최신: 발화 전달·대화 우선순위·접근성 단계 구현/배포 검증. 판매 목표는 계속 활성이다.** 상세 `docs/SPEECH-RESPONSE.md`, `docs/DIALOG-ACCESSIBILITY.md`.

`src/speech-flow.ts`와 `useMedia.ts`: 기존 6초 고정 녹음/인식 중 새 음성 버림을 발화 끝 구분(650ms 침묵/최대12초), 8개 대기 직렬 전사, 명시적 과부하 중지로 교체. 마이크 끄기→HTTP→STT 취소와 UUID 분리, 모델 호출 중 새 발언 보존/정확한 ID 승인, UTF-16 제한 내 이모지 보존. `server/local-speech.js`의 취소된 과거 요청 오류가 새 요청을 거절하던 문제도 수정. 취소는 이미 계산 중인 Python을 강제로 중단하지 않으며 늦은 결과만 격리한다.

실제 Astra low 12회 문맥 비교: 불필요한 개발 스킬 목록을 공식 요청별 `skills.max_context_tokens=1`로 제한. 평균 입력13,670.8→8,127.3(40.6% 감소), 시간11.921→11.737초로 사례별 엇갈림. 지연 개선이라고 주장하지 않는다. 원본 `artifacts/spectator-context-benchmark.json`/`.log`. 추가6회에서 장면 지침보다 스트리머의 선택/거절을 우선하는 문단을 시험해 항로/피날레 반복 질문이 진행 반응으로 바뀜. 휴식 요청은 양쪽 모두 존중. `conversation-priority-live.json`/`.log`의 정성3쌍이며 일반 자연스러움 인증이 아니다.

App Server stdio 실제1회 프로브는 첫 JSON조각3.583초/완료7.632초. 첫 조각은 주로 메타데이터라 실제 첫 채팅 지연과 다름. `--ignore-user-config` 미지원, MCP 설정 병합, 전역 AGENTS 경로 잔존을 확인했다. 호스트별 MCP만 비활성화한 실험이므로 출시용 교체를 하지 않았다. `codex-stream-probe.json`의 passed는 프로토콜 성공만 뜻한다. 실험 스키마/원본은 artifacts에 보존. 기존 공식 CLI/구독 로그인/gpt-6-astra/low 유지.

WSL Claude 작업은 정상 종료했다(session83928 종료). `src/AccessibleDialog.tsx`, App의 두 모달, Seasons 제목 공백/리허설 안내를 통합. 설정/화면 선택의 이름·초기 포커스·Tab/ShiftTab·Escape·복귀·배경 inert·저장 실패 초안 보존13체크 통과. 원본 `claude-dialog-output.txt`, `claude-dialog-tests.log`, `dialog-accessibility-test.json`. 추가 Claude 실행 없음.

**전체171개 Node 검사·TS/Vite·새 패키지 통과** (`speech-dialog-package.log`). 합성 Electron 음성3구간 첫 전사1.602초, 느린3초 인식 중 구간 보존·모델 전달·4번째 취소 확인 (`speech-flow-desktop-test.json`). 실제 로컬 한국어 모델로 합성2.8초 음원 첫 구절 ‘안녕하세요 여러분’: 전사요청2.204초, 완료4.190초, 관객요청4.195초 (`speech-flow-real-desktop-test.json`). 실제 물리 마이크/장기 음성 검증은 아니다. 초기 테스트 시작 대기/최상위await 실패를 실제 페이지로 좁혀 수정, 실패원본 보존. 시즌 Electron7흐름과 기존 확장7흐름 통과. 확장 초기실패는 댓글 입력 초안을 게시된 대댓글로 오인한 조기 assertion이었고, 디스크에 올바른 parentId가 저장됨을 확인했다. `.clip-replies article > p` 게시 결과로 오라클을 좁혀 재통과. `speech-expansion-initial-failure.json`, `speech-final-expansion-retry-output.log`.

**최신 독립 배포:** `release/2026-09-12T22-02-56-448Z/app/BACKSEAT-win32-x64/BACKSEAT.exe`. 전체1,583,231,578바이트/2,437파일/미서명. `speech-package-integrity-test.json` 전체SHA256·핵심20원본/fuses 일치. 새 번들로 개발PATH없이 음성준비5.117초/9.4초합성한국어전사2.198초/실제Astra9.850초 (`speech-packaged-runtime-test.json`, `.log`). 이전 결과를 동일성 추론으로 대신하지 않았다. 네이티브 빈 프로필 `artifacts/speech-native-20260913-070714`, PID29476 정상종료/동일경로0개. 첫실행 건너뛰기, 설정 대화상자 실제UIA, Tab 닫기버튼 시각포커스, Escape 원래설정버튼 복귀 확인. `speech-native-test.json`, `speech-native-settings.jpg/.txt`, `speech-native-escape.jpg/.txt`. UIA focused_element는 창만 보고하므로 시각포커스와 별도 렌더러 DOM 검사 근거를 구분한다. native stderr의 fs.Stats deprecation1개는 보존했고 앱 오류는 없었다.

사용자 앱은 기존11관객/오늘도같이한판/플레이어 설정을 유지해 재실행. PID26892, 시작2026-09-13T07:09:04.3952946+09:00. `speech-user-app-process.json`, `speech-delivered-state.txt`, `speech-delivered-output.log`/`error.log`(빈 오류). 방송/화면/마이크중지, 호출0, 계정연결됨. 새 배포 검증은 별도 프로필이라 사용자 기록에 테스트 시즌이나 댓글을 추가하지 않았다.

**다음 우선순위:** 장기 대화의 반복률/관객별 개성·관계 변화, 실제20분 한국어 음성/게임장르, 설치/업데이트/지원 운영과 새Windows·GPU/DPI. 평균 모델지연8~15초, 발화RMS 휴리스틱의 작은 목소리/배경소음, 단일모델 컨텍스트의 관객간 기억격리 한계는 유지한다. 설치/서명/라이선스/상용연동조건/Steam심사까지 수용 기준을 낮추지 않는다. 개인메모리 수정 없음. 현재 단계 검증 프로세스/모델/Claude/AppServer는 모두 완료됐고 사용자 앱만 남겼다.

아래는 이전 시즌 단계의 기록이다.


**최신: 분기 시즌과 관객 초대장 단계 구현·검증. 판매 목표는 계속 활성이다.** `docs/SEASONS.md`가 상세 기획/경계/증거다. `shared/seasons.js`의 세 v1 기획(우리 방, 별빛 원정, 크루 리그)은 각각 세 회차·9장면·두 갈림길·두 피날레이며 12개 완주 경로가 있다. 이름/세계관, 현재 관객 출연진, 진행 멘트/기존 마이크, 재시작 후 이어가기, 완료 회차 핫클립, 서가 기념품을 구현했다. `seasons.json`의 단일 검증/저장 성공 뒤에만 진행과 초대장 수락을 확정한다. 저장 실패·늦은 응답·관객 차단/이탈·중복 수락을 검증했다.

관객 초대장은 현재 관객의 공개 채팅/입장 이후 스트리머 발언에 원문·ID·시각·fictional 출처를 붙여 생성한다. 수락은 시즌 초안만 만든다. 보류 24시간/거절은 관계·포인트에 벌점을 주지 않는다. 자동 제안 기본 꺼짐: 방송 10분/공개 메시지 20개 이후 여유 시간, 방송당 최대1회·최소1시간, 세션 한도 내. 실패 시도도 디스크에 남기고 오프라인 누적 호출을 하지 않는다. 기획 선택은 현재 간단한 주제 규칙이며 외부 커뮤니티 자율 행사나 모델 생성 분기 그래프는 아니다.

**155개 Node 검사 + 빌드 + 독립 배포 통과** (`artifacts/seasons-package.log`). 시즌 전용 19개/12경로, 실제 서버 재시작·내보내기, 취소와 저장 실패, 포인트·게임 사실 격리 포함 (`seasons-unit-retry.log`). 시즌 Electron UI 7흐름 `seasons-desktop-test.json`; 기존 확장 7흐름 `seasons-expansion-output.log`. 두 UI 스크립트의 모델/미디어는 합성이며 실제 장치 증거가 아니다. 초기 테스트 실패 원본도 보존했다. WSL Claude 작업은 정상 종료했고 Knowledge save-before-commit 보완을 통합했다: `server/knowledge.js`, `test/knowledge-atomic.test.js` 11개, `docs/KNOWLEDGE-ATOMIC.md`, `artifacts/claude-knowledge-atomic-output.txt`, `claude-knowledge-atomic-tests.log`. 추가 Claude 실행은 없다.

실제 Astra low 시즌 9장면+초대장1회 (`seasons-live-result.json`, `seasons-live.log`). 모모의 휴식, 각보는고양이의 탐사/패턴, 팝콘도둑의 방송 역할이 회차를 이어 유지됐다. 키보드 한국어 멘트이고 실제 음성/게임은 아니다. 지연 10.524~15.354초, 포인트60유지·관찰null·게임지식비어있음. 한 번의 정성 샘플이며 장기 합격은 아니다. 이미 정한 항로를 장면 지침 때문에 다시 묻는 출력1회가 있어 다음 자연스러움 개선 대상으로 기록했다.

**최신 배포** `release/2026-09-12T21-26-57-900Z/app/BACKSEAT-win32-x64/BACKSEAT.exe`: 전체폴더1,583,225,054바이트/2,437파일/미서명. `seasons-package-integrity.log` 전체SHA256·원본20개·fuses 일치. 새 번들에서 개발PATH없이 직접 실제모델9.533초, 음성준비5.219초,9.4초합성한국어전사2.204초(`seasons-packaged-runtime.log`, 최신 `packaged-runtime-test.json`). 기존배포증거의 동일성추론이 아닌 새실행이다.

사용자 앱은 기존11관객/설정을 보존해 정상종료 후 최신소스로 다시 열었다. PID24964, 시작2026-09-13T06:29:00.8361113+09:00; `artifacts/seasons-user-app-process.json`, `seasons-delivered-state.txt`, `seasons-delivered-output.log`/`error.log`. 방송·마이크·화면중지, 호출0. native 패키지 검증 프로필 `artifacts/seasons-native-20260913-062943`은 사용자프로필과 별개다. 최종 정상종료/화면 결과는 아래 보완 기록을 확인한다.

다음: 실제 샘플의 반복 질문/장면 지침 우선 문제를 좁게 고치고 장기 대화·자연스러움 측정을 확장한다. 20분 실제 한국어 음성/게임장르·Windows/GPU/DPI·서명설치/업데이트·라이선스/Steam심사 기준은 유지한다. `server/knowledge.js`의 __proto__ 이름은 메모리에서 안전하나 Zod record에 의해 저장 시 빠지는 기존 한계도 Claude가 문서화했다. 시즌 데이터는 회차당120대화,공개미리보기12이며 무제한 전체로그가 아니다. 개인메모리를 자동 갱신하지 않는다.

네이티브 검증 완료: 새 배포의 빈 프로필에서 온보딩 건너뛰기 → 방송 놀이터/시즌 카탈로그 → 시즌 초안 저장을 실제 UI로 수행했다. seasons.json에 1개 초안(stage=-1, 자동제안false)을 확인하고 정상 종료했다. 해당 배포 프로세스0개, PID22780 종료 (`seasons-native-test.json`, `seasons-native-saved.jpg`/`.txt`). 사용자 앱 PID24964에는 새 시즌 페이지가 열려 있다(`seasons-delivered.jpg`, `seasons-delivered-page.txt`). 테스트 헬퍼4개와 WSLClaude, 모델/패키징 세션은 완료됐다. 최종 증거목록은 `artifacts/seasons-evidence.json`이다.

추가 UI 보완 후보: compact 제목의 줄바꿈을 숨길 때 ‘방송이다음’ 공백이 붙는 사소한 표시, 신규 프로필의 리허설 모드에서 AI 방송 시작이 비활성인 이유를 시즌 화면에 직접 안내하기. 현재 배포에서 관찰했고 다음 접근성/마찰 개선 단계로 남긴다.

아래 첫실행/인증 설명은 이전 단계의 기록이다.


**최신: 첫 실행/공식 계정 연결 + 관객별 목격 지식 단계 완료. 판매 목표는 계속 활성이다.** 신규 프로필 3단계 안내(이름·제목·게임/잡담, 분위기·훈수, 연결·입장), 기존 프로필 자동 건너뛰기, 설정에서 안내 다시 열기, 별도 onboarding.json 백업 저장을 추가했다. 공식 Codex 브라우저/기기 코드 로그인은 메인 창에서만 실행한다. 임시 코드/URL은 공개 상태·모델·내보내기에 들어가지 않는다. 계정 상태와 명시적 1회 Astra 응답 확인을 분리했다. `docs/ONBOARDING.md`에 경계·오류·근거가 있다.

WSL Claude의 개인 게임 지식 구현을 통합하고 보완했다. 관찰별 목격자 ID와 게임별 개인 시청 시간을 저장한다. 부모는 새 입장자에게 직전 시간을 부여하지 않도록 고치고, 모델 지연 대신 입력 수신 시각을 기록하며, 같은 장면을 나중에 본 관객에게 새 시각의 목격 기록을 남기도록 수정했다. 일반 라이브 호출은 관객별 입장 이후 chatHistory/previous와 본인 memories를 제공한다. 공통 전체 채팅/이전 장면과 audience.members의 개인 기억은 제거했다. 단일 호출에 여러 관객 패킷이 함께 들어가는 한계는 유지한다. `docs/VIEWER-KNOWLEDGE.md`; Claude 원본 `artifacts/claude-audience-knowledge-output.txt`, `claude-viewer-knowledge-test.log`. Claude 프로세스는 정상 완료했다.

현재 **126개 Node 검사 + TS/Vite 빌드**, 신규 안내 Electron 흐름 6개, 기존 확장 흐름 7개, 실제 desktop 진입점 종료 4개+오버레이 계정 IPC 거부, 공식 Codex 0.154.0의 실제 기기 코드 발급/취소가 통과했다. 새 계정의 인증 완료는 하지 않았고 기존 사용자 계정을 변경하지 않았다. UI 테스트에서 완료 SSE가 저장 POST 응답보다 먼저 도착해 탭 선택이 덮이는 실제 경쟁을 고쳤다. 저장 응답을 지연시키는 회귀 검증으로 확인했다. 수정 전 로그와 hidden 캡처 실패 UnknownVizError도 보존했다. 최신 전체 원본은 `artifacts/onboarding-final-package-retry.log`; UI 결과는 `onboarding-desktop-test.json`, `expansion-desktop-test.json`, `desktop-lifecycle-test.json`.

**현재 독립 배포본:** `release/2026-09-12T20-55-51-864Z/app/BACKSEAT-win32-x64/BACKSEAT.exe` (1,583,169,165바이트, 2,437개 파일, 미서명). `artifacts/latest-package.json` 참고. 핵심 원본 17개/전체 파일 SHA256/fuses 일치(`package-integrity-test.json`). 번들만 사용하는 PATH 제한 한국어 전사는 준비 5.9초, 9.4초 합성 음성 전사 2.9초(`packaged-runtime-test.json`; 이번 headless 실행은 모델 호출 없음). 별도 네이티브 배포 앱에서 실제 Astra low 인사 1회가 **9.2초**에 표시됐다(`onboarding-native-test.json`, `onboarding-packaged-probe.jpg`, `onboarding-packaged-model-process.json`). 이전 실제 모델/동시 부하 음성 원본은 `artifacts/packaged-runtime-test.log`에 보존되어 있다. 보고 JSON은 최신 실행을 가리키므로 이전 수치와 혼동하지 않는다.

네이티브 첫 실행 검증 프로필은 `artifacts/onboarding-native-20260913-054021`이다. 이름/제목/Just Chatting/티키타카/5명 설정을 UI로 저장하고 독립 배포본에서 복원했다. 모델 응답 확인 후 정상 종료하여 해당 배포 경로의 프로세스가 0개임을 확인했다. 사용자 앱은 기존 관객 **11명**, 제목/유입 설정을 보존하고 최신 코드로 다시 실행했다. 현재 PID **30208**, 시작 시각 `2026-09-13T05:56:22.8454279+09:00`, `artifacts/onboarding-user-app-process.json` (다음 단계에서 재확인). 방송·마이크·화면은 중지 상태로 전달한다. 기존 settings가 있는 사용자 프로필은 onboarding.status='existing'으로 표시된다.

최종 보완: 모든 기존 저장소를 검증한 뒤 초기 onboarding.json을 먼저 저장한다. 설정 저장 뒤 완료 기록이 실패해도 재시작 시 신규 안내를 유지하며, 손상된 기존 데이터 때문에 시작이 거부되면 새 파일을 쓰지 않는다. 관련 회귀를 추가해 126개가 통과했다. 새 배포의 모델/음성/연결 항목 2,368개는 직전 실제 호출 배포와 모두 동일하다. `onboarding-final-native-test.json`은 새 패키지 빈 프로필 시작/종료 검증이며, 실제 Astra 9.2초 증거는 직전 패키지의 `onboarding-native-test.json`이다. 사용자 앱 전달 로그는 `onboarding-delivered-app-output.log`, `onboarding-delivered-app-error.log`.

다음 유용한 단계: 장기 방송 욕구를 위한 분기/시즌/관객 주도 행사와 실제 생성 대화의 기억·자연스러움 평가. 관객 개인 지식은 데이터 전달 검증까지 완료했고 장기 모델 반응 합격은 아직 아니다. 첫 실행은 새 Windows/새 계정 인증 완료·관리형 정책 조합 검증이 남았다. 서명·설치/제거/업데이트·상용 조건·Steam 심사 목표도 유지한다. 별도 검토 사항으로 Knowledge의 저장 실패 시 메모리와 디스크 일관성(기존 mutate-before-save 패턴) 및 settings 모달의 키보드/레이블 접근성 전체 점검이 남는다. 개인 메모리를 자동 갱신하지 않는다.

최신 배포 단계 완료(판매 목표는 계속 진행): 실행별 256비트 로컬 인증을 모든 HTTP 경로에 추가했다. Electron은 비영구 전용 세션의 요청 헤더로 인증하며 토큰을 렌더러에 넘기지 않는다. 개발 브라우저의 1회 연결만 별도 허용한다. 현재 **101개 테스트 + 빌드**, 인증 적용 Electron 흐름 7개, 독립 배포 음성/실제 Astra 요청, 네이티브 배포 앱 시작·설정 저장/복원·오버레이, 파일 2,437개 SHA256 검사 통과. `docs/DISTRIBUTION.md`, `docs/LOCAL-ACCESS.md` 참조.

현재 독립 배포본: `release/2026-09-12T20-05-58-470Z/app/BACKSEAT-win32-x64/BACKSEAT.exe` (1.58GB, 미서명). 공식 npm Codex 0.154.0, Python 3.13.15 embeddable, 고정 음성 패키지 24개·Whisper small 포함. `artifacts/latest-package.json`이 위치를 가리킨다. WSL Claude의 음성 빌더는 완료되어 `scripts/prepare-speech-runtime.ps1`, `speech-requirements.txt`, `docs/SPEECH-RUNTIME.md`에 있다. 부모가 정리 경로 검사·UTF-8/-B를 보완했다. 최신 빌드는 Claude 최종 원본 `artifacts/speech-runtime-20260913-044949`를 사용했다. 앞선 실제 음성/모델 검증과 최신 빌드 간 코드·바이너리·모델 동일성은 `package-integrity-test.json`으로 확인하며, 제외된 pip 실행기의 해시만 다른 RECORD 8개 및 생성 시각 매니페스트의 차이를 구분했다. 활성 Claude 작업은 끝났다.

네이티브 종료 점검에서 개별 종료한 overlay의 파괴된 참조를 main 종료 때 다시 닫는 오류를 발견했다. `closeOverlay()`와 `closed` 정리를 추가했고 실제 desktop 진입점을 불러오는 `scripts/verify-desktop-lifecycle.cjs`의 4개 흐름이 통과했다. 수정 후 전체 101개 검사/빌드 및 새 배포는 `artifacts/package-lifecycle-final.log`. 사용자 앱에 나타난 이전 버전 오류 대화상자는 확인 후 정상 종료됐으며 강제 프로세스 종료는 실행되지 않았다.

최신 배포본에서 같은 종료 순서를 네이티브 UI로 재현해 정상 종료·관련 프로세스 0개를 확인했다(`packaged-lifecycle-native-test.json`). 배포 검증 프로필은 `artifacts/packaged-profile-20260913-045417`에 보존한다. 사용자 개발 앱은 최신 소스로 다시 실행되어 11개 관객·기존 설정을 유지하고 있으며 방송/마이크/화면은 중지 상태다. 프로세스 기록은 `artifacts/distribution-app-process.json` (PID 26680, 다음 작업에서 재확인). 사용자를 위한 앱 외의 테스트 헬퍼는 모두 종료됐다.

새 Windows 검증·최초 로그인 온보딩·설치/서명/업데이트·라이선스/Steam 조건·장기 대화/관객별 지식 분리는 미완료다. 다음 단계에서는 이 출시 기준을 그대로 유지한다. 현재 `packaged-runtime-test.json`의 모델 9.7초 및 동시에 앱 시작을 수행한 전사 9.2초는 부하가 다른 단독 빌더 전사 2.6초와 구분한다. 실시간 목표 충족을 주장하지 않는다.

현재 목표는 Steam 판매를 검토할 수 있는 배포 품질까지 발전시키는 것이다. 최신 요청은 현실적인 방송 연습을 넘어, 기념일·팬 행사·극적인 복귀 등 방송적 욕구를 충족하는 가상 경험을 포함한다. 이 목표는 아직 완료되지 않았다.

현재 작업 트리에는 유한 지갑·실시간 충전·가상 후원, 속마음/프로필/관계/취향 탐색, 협상과 환불, 핫클립·댓글·대댓글·선택적 영상 버퍼, 10종 기획 방송·14종 상황 연습이 연결되었다. `artifacts/expansion-check-final.log`의 74개 테스트 및 빌드, `expansion-desktop-test.json`의 Electron 흐름 7개, `expansion-live-result.json`의 실제 Astra 7회가 통과했다. `experiences-native.png`는 개발 앱을 업데이트한 실제 화면이다. 이후 추가한 저장 복구·인터뷰 연속성·요청 토큰 최적화는 후속 최종 검증 대상이다. 기존 `final-runtime.json` 등은 확장 이전 상태다.

저장 복구 연결 완료: WSL Claude의 `server/storage.js`를 검토해 부분 쓰기 처리를 보완하고 `server/index.js`·`data-schema.js`에 연결했다. 관객의 개인 취향 인터뷰도 다음 인터뷰와 수첩에서 이어진다. 현재 전체 **98개 테스트 + 빌드**, 저장 손상/복구 앱 통합 2개, 최신 Electron 흐름 7개가 통과했다(`retail-foundation-check.log`, `storage-integration.log`, `expansion-desktop-test.json`). `server/codex-provider.js`에 공식 `model_instructions_file` 요청별 지정 적용: 2사례 입력 토큰 약 24% 감소, 지연 개선은 입증되지 않음(`instructions-benchmark.json`). 최신 소스로 앱을 정상 종료/재실행했다. 배포·인증·장기 자연스러움·Steam 조건은 `docs/RELEASE-GATES.md` 기준으로 계속 진행한다.

사용자는 한국어 실시간 AI 관객, Windows 앱·오버레이, 화면+마이크 인식, 일반 게임과 Just Chatting, 기억을 가진 페르소나·매니저·가상 외부 커뮤니티, 한국 커뮤니티 기반 관객 유입을 요청했다. GPT-6 Astra / low를 기존 ChatGPT 구독으로 사용하고 로컬 음성 인식을 설치하도록 결정했다. Steam 라이브러리 게임 선택·테스트 및 필요 시 WSL Claude Code 사용도 위임했다.

로컬 MVP 구현과 설치, 실제 계정·Steam 화면·합성 음성 연결 검증을 마쳤다. **모든 장르와 실제 방송 수준의 자연스러움을 검증한 완성형 서비스는 아니다.** 테스트에서 입증한 범위와 미검증 범위는 `docs/VALIDATION.md`가 기준이다.

## 구현 구조

- `desktop/`: Electron 격리된 preload, 화면 선택, 투명 오버레이·클릭 통과, 긴급 중지.
- `src/`: React 방송실, 페르소나·게임 지식·매니저·게시판·유입 설정. `useMedia.ts`가 선택한 화면과 로컬 녹음 구간을 제공한다.
- `server/studio.js`: 세션·취소 epoch·호출 한도·속도 제어·채팅 큐·모더레이션·후기.
- `server/codex-provider.js`: 공식 CLI의 ChatGPT 로그인 사용, Astra low, 일회성 이미지·JSON 응답. 인증 토큰을 직접 읽지 않는다.
- `server/audience.js`, `shared/discovery.json`: 잠수/활동/이탈/입장 대기, 첫 유입 동기, 재방문, 관계·기억. 입장 타이머는 모델을 호출하지 않는다.
- `server/knowledge.js`: 게임별 장면·메모·시청 시간. 모델 가중치 재학습은 아니다.
- `server/local-speech.js`, `scripts/speech_worker.py`: faster-whisper small, 한국어 CPU/int8, 음량·음높이·속도 단서. 확정 감정 분류 없음.
- `docs/AUDIENCE-RESEARCH.md`: 연구 근거, 한국 공개 커뮤니티 사례, 구현 해석·범위·유입 가설. 최신 유행/전체 이용자 성격의 전수 조사로 오해하지 않는다.

## 실행과 검증

이 PC에서는 `Start-Backseat.cmd`. 개발은 `npm run check`, 이어 필요 시 Electron 렌더러 스크립트. `scripts/verify-live.js`, `verify-conversation.js`, `verify-discovery.js`는 실제 구독 사용량을 소비한다. 통과한 검사는 코드 변경이나 새 문제가 있을 때 다시 실행한다.

기존 설정 호환을 위해 유입 기능 기본값은 꺼짐이다. 설정에서 켜고 후보를 추가하면 순차 유입을 이용할 수 있다. 최대 40개 후보, 최초 동기는 5종 비중으로 선택, 기존 기억은 유지한다. 실제 커뮤니티 트래픽이나 멤버 프로필을 수집하지 않는다. 최신 유행을 상시 갱신하는 수집기도 없다.

이 PC의 최종 전달 설정은 UI에서 유입을 켜고 새 후보 6명을 추가해 저장했다. 총 11명(매니저 포함), 입장 간격 45초, 비중 클립 30/공략 25/팬 활동 20/토론 10/탐색 15다. 방송은 중지, 호출 0, 화면·마이크 미연결이며 실제 모델 로그인과 로컬 음성 준비 상태를 재확인했다. `artifacts/final-runtime.json`과 `artifacts/discovery-settings.jpg` 참고.

현재 주요 증거: `check.log`(16개), `artifacts/desktop-test.json`(8개), `artifacts/vision-result.json`, `artifacts/just-chatting-result.json`, `artifacts/discovery-live-result.json`, `artifacts/spire-*-state.json`, `artifacts/overlay-native.txt`. Claude 검토는 `docs/CLAUDE-REVIEW-RESOLUTION.md` 참고.

## 보존해야 할 환경

`data/`에는 사용자 설정과 테스트 중 형성된 관객/게임 기억이 있다. `.venv/`, `.models/`는 설치된 로컬 음성 환경이다. `artifacts/`의 게임 저장 백업을 삭제하지 않는다. Slay the Spire 2 새 테스트 런은 첫 전투에서 저장 후 종료했으며 원본 백업은 `artifacts/spire-save-before`다. Baba 저장 백업은 `artifacts/baba-save-before`다. 사용자 게임 데이터를 자동 복원하거나 초기화하지 않는다.

관련 없는 Steam·브라우저·Discord·VirtualBox를 종료하지 않는다. 개발 헬퍼 프로세스를 정리할 때 이 프로젝트의 정확한 실행 경로와 명령행을 확인한다. 앱은 방송을 중지하고 마이크·화면 연결을 해제한 상태로 전달한다.

## 다음 구현·평가의 우선순위

1. 사용자의 실제 한국어 음성으로 20분 이상 플레이/Just Chatting 평가. STT 오류·반응 지연·반복·훈수 의미 오류를 구분해 수집한다. 현재 9~14초대 단일 요청 지연이 실시간 몰입의 중요한 한계다.
2. 신규 관객의 입장 이전 기억을 더 강하게 분리하고, 게임별 지식을 관객 개인의 관찰 이력·숙련도에 맞춰 제공한다. 현재 공통 모델 컨텍스트와 프롬프트 지침에 의존하는 부분이 있다.
3. 가상 클립·방송 주제 적합도에 따른 유입, 잔류/이탈 동기, 재방문 시간표와 추천 연결망. 현재는 고정 후보의 순차 입장과 간단한 확률 모델이다.
4. 여러 공개 커뮤니티의 날짜가 있는 운영 규칙과 활동을 추가 검증한다. FM코리아 접근 실패를 조사 완료로 취급하지 않는다. 새 자료는 개인·정치·인구통계 고정관념 대신 활동별 혼합 프리셋으로 적용한다.
5. 배포용 서명 설치 프로그램, 설정 UI 분할, GPU STT 선택, 다중 모니터·DPI·전체화면 오버레이 검증, 사용자 선택에 따른 관객 음성/가상 후원 연출.

공개 송출·실제 후원 결제·외부 메시지 게시·자율적인 외부 커뮤니티 운영은 구현 범위에 포함되지 않았다. 추가 기능이라고 표시하기 전에 별도 구현과 실제 검증을 수행한다.
