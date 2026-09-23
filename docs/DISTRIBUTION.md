# Windows 독립 배포 검증

## 현재 배포와 빌드

현재 공개 버전은 [0.1.8](RELEASE-0.1.8.md)입니다. 기본 앱과 선택형 런타임의 크기·빌드 방법은 [배포 용량](DISTRIBUTION-SIZE.md)을 따릅니다. `npm run package:windows`는 경량 앱을 기본으로 만들며 로컬 음성 모델 준비가 필요 없습니다. 전체 동봉이 필요할 때만 `-- --bundled --speech=<검증된 런타임 폴더>`를 지정합니다.

아래 날짜별 기록과 예전 명령은 과거 배포의 검증 이력입니다.

> **Nagneon 전환:** 현재 이름, 세로 화면 대응과 새 독립 배포본의 검증은 [Nagneon 전환 기록](NAGNEON.md)을 참고하세요. 아래 BACKSEAT 경로와 수치는 과거 증거를 보존한 것입니다.

2026-09-14. 현재 산출물은 서명하지 않은 개발 배포본이다. 설치 프로그램·Steam 제출 완료본은 아니다.

## 갤러리·핫클립 분리 음성·2차 대화 개선 배포 · 2026-09-14

`G:/dev/ai/00_game_backseat-worktrees/second-user-test-review/release/2026-09-13T15-45-57-714Z/app/BACKSEAT-win32-x64`에 최신 변경을 포함했다. **2,451파일 / 3,130,175,630바이트 / 미서명**이다. [갤러리와 핫클립](GALLERY-AND-CLIP-VOICE.md)의 게시·댓글·추천·마이크 재생 선택과 [2차 대화 개선](SECOND-TEST-REVIEW.md)의 교정 보호·잡담·말투·기억을 포함한다.

519개 자동 검사와 TS/Vite, 해당 배포 ASAR의 실제 Whisper/YAMNet 복구·공식 Astra low 5회·분리 WebM 저장/복원, 전체 해시와 소스69개/fuses 검증이 통과했다. 사용자 앱 재시작·실제 게임 캡처·네이티브 재생·설치 수용은 수행하지 않았다. 개발 작업 폴더의 `artifacts/second-review-final-build-v2.json`이 전체 증거를 연결한다. 프로젝트의 `Start-Backseat.cmd`는 다음 실행 때 최신 소스로 빌드하며, 새 독립 배포는 폴더 전체가 필요하다. 기존에 섞여 저장된 클립의 마이크는 분리할 수 없다.

## 긴 음성 입력 최적화 배포 · 2026-09-13

`G:/dev/ai/00_game_backseat-worktrees/speech-window-adaptation/release/2026-09-13T14-46-24-910Z/app/BACKSEAT-win32-x64`는 아래 최근 배포에 입력 길이별8/12/16초 음성 연산을 추가한 **2,451파일 / 3,130,142,882바이트 / 미서명** 폴더다. 495개 Node 검사, Python9개 회귀, 실제 medium 합성 입력56쌍, 배포본의 실제 인식기 복구, 전체 해시와 소스67개/fuses 검증이 통과했다. [합성 전사 속도·정확도와 한계](SPEECH-WINDOW-ADAPTATION.md)를 확인한다. 새 네이티브 창·장치·사용자 앱 교체·설치 수용을 수행한 것으로 해석하지 않는다.

## 최근 통합 소스 배포 · 2026-09-13

`G:/dev/ai/00_game_backseat-worktrees/release-runtime-verification/release/2026-09-13T14-07-38-998Z/app/BACKSEAT-win32-x64`에 연속 장면 인식·관객 기억/개성·한국어 medium 모델·마이크 복구를 포함한 새 전체 폴더를 만들었다. **2,451개 파일 / 3,130,142,563바이트 / 미서명**이다. 사용자 실행본을 교체하거나 시작하지 않았다. 아래 기존 배포 이력의 경로는 이 새 산출물과 구분한다.

495개 Node 검사와 TypeScript/Vite 빌드, 실제 ASAR와 소스67개 비교, 전체 파일 SHA-256/fuses, 포함된 Whisper/YAMNet과 Astra low 2회가 통과했다. 소유 Whisper를 인식 중 종료한 뒤 같은 방송에서 재준비하고 짧은 한국어 4개를 다시 전사/전달했다. 이번 검증은 합성 파일과 배포본에서 추출한 Node 모듈이며 새 네이티브 창·물리 장치·설치 수용을 뜻하지 않는다. 원본·실패 이력·지연·범위는 [최근 배포 런타임 검증](RELEASE-RUNTIME-ACCEPTANCE.md)에 있다. 긴 전사와 모델 응답 지연도 남은 과제로 기록했다.

## 최신 시스템 소리 배포 · 2026-09-13

`release/2026-09-12T23-41-52-732Z/app/BACKSEAT-win32-x64/BACKSEAT.exe`: 전체 1,599,409,614바이트/2,444파일/미서명. Windows 출력 loopback, YAMNet 음향 분류, 별도 게임 대사 전사, 관객별 청취 문맥, 소리 전용 잡담과 마이크/시스템 소리 혼합 핫클립을 포함한다. [SYSTEM-SOUND.md](SYSTEM-SOUND.md).

213개 Node 검사와 TS/Vite/패키지, 전체 SHA256·핵심28원본·fuses 통과. `artifacts/sound-package-final.log`, `sound-final-tests.log`, `sound-package-integrity-test.json`. 새 번들의 개발 PATH 제외 음성 준비6.147초/전사2.769초, 소리 준비2.630초/8초 한국어 음향+전사5.571초, 실제 Astra10.310초 (`sound-packaged-runtime-test.json`).

생산 캡처 모듈의 실제 Windows 출력 시험과 두 입력 녹화는 `sound-loopback-test.json`/`sound-loopback-mix-test.log`, 인식 단서 재생에 대한 실제 Astra 반응은 `sound-live-test.json`이다. 서로 다른 시험의 범위를 합쳐 새 native 창에서 실제 게임을 했다고 주장하지 않는다. 새 native 프로필은 시작/안내/소리 제어 표시/정상 종료를 확인했다 (`sound-native-test.json`). 사용자 앱은 기존 설정을 보존해 갱신했다.

설치 엔진 C# 소스와 74개 검사도 별도로 확보했으나 NSIS 연결/실제 설치 수용 전이므로 설치 프로그램의 실행 차단을 유지한다. 현재 사용자용 배포는 위 전체 폴더다.

아래는 이전 배포 이력이다.

## 최신 대화 기억 배포 · 2026-09-13

`release/2026-09-12T22-53-02-151Z/app/BACKSEAT-win32-x64/BACKSEAT.exe`: 전체 폴더 1,583,258,060바이트, 2,437개 파일, 미서명. 함께 들은 공개 원문·관객별 검색·고정·관리 화면과 조각 저장/복구를 포함한다. [CONVERSATION-MEMORY.md](CONVERSATION-MEMORY.md).

203개 Node 검사와 TS/Vite 빌드, 기억 Electron 8개 흐름 통과. `artifacts/memory-package-final.log`, `memory-journal-desktop-test.json`. 새 번들의 개발 PATH 제외 검증은 음성 준비 5.626초, 9.4초 합성 한국어 전사 2.274초, 실제 Astra low 11.069초였다(`memory-packaged-runtime-test.json`). 전체 파일 SHA256·핵심 원본22개·fuses가 일치한다(`memory-package-integrity-test.json`).

설치 초안은 검토 중이며 실행을 차단했다. 현재 사용자용 실행 경로는 위 전체 폴더 배포본이다. [INSTALLER.md](INSTALLER.md)의 설치·제거·업데이트 결함을 해결한 다음 실제 설치 수용을 진행한다.

아래는 이전 단계의 배포 이력이다.

## 최신 음성·대화·접근성 배포 · 2026-09-13

`release/2026-09-12T22-02-56-448Z/app/BACKSEAT-win32-x64/BACKSEAT.exe`: 전체 폴더 1,583,231,578바이트, 2,437개 파일, 미서명. 발화 구간 전사·직렬 대기·취소·발언 보존, 대화 우선순위, 불필요한 스킬 문맥 축소, 접근 가능한 설정/화면 선택 다이얼로그를 포함한다. [SPEECH-RESPONSE.md](SPEECH-RESPONSE.md), [DIALOG-ACCESSIBILITY.md](DIALOG-ACCESSIBILITY.md).

171개 Node 검사와 TS/Vite 빌드 통과. 합성 음성/실제 로컬 한국어 전사 Electron 경로, 시즌 7흐름, 확장 7흐름, 다이얼로그 13체크를 검증했다. 확장 테스트의 대댓글 판정이 입력 초안까지 읽던 것을 실제 게시된 대댓글로 한정했고, 저장된 parentId와 UI를 함께 확인했다. 제품 댓글 수정 없이 테스트의 조기 판정을 바로잡았다.

`artifacts/speech-package-integrity-test.json`: 전체 SHA256·핵심 원본 20개·fuses 일치. `speech-packaged-runtime-test.json`: 개발 PATH 제외, 새 번들의 음성 준비 5.117초, 9.4초 합성 한국어 전사 2.198초, 실제 Astra low 응답 9.850초. 최신 경로는 `artifacts/latest-package.json`.

아래 시즌/온보딩 배포는 이전 이력이다.

## 최신 시즌 배포 · 2026-09-13

현재 배포는 `release/2026-09-12T21-26-57-900Z/app/BACKSEAT-win32-x64/BACKSEAT.exe`다. 전체 폴더 1,583,225,054바이트, 2,437개 파일이며 미서명이다. 3종 분기 시즌·관객 초대장과 Knowledge 저장 원자성을 포함한다. 전체 155개 검사/빌드, 시즌 Electron 7개 흐름과 기존 확장 7개 흐름이 통과했다. 시즌 기획과 한계는 [SEASONS.md](SEASONS.md)에 있다.

`artifacts/seasons-package-integrity.log`는 파일 전체 SHA256와 핵심 원본 20개/fuses 일치다. 새 배포에서 직접 실행한 `seasons-packaged-runtime.log`는 개발 PATH 제외·음성 준비 5.219초·9.4초 합성 한국어 전사 2.204초·번들 공식 CLI 실제 Astra low 응답 9.533초를 기록한다. 이전 배포의 결과를 동일성 추론으로 대신한 수치가 아니다. `artifacts/latest-package.json`이 현재 경로를 가리킨다.

아래는 이전 온보딩 단계의 이력으로 보존한다.

## 만들어진 배포본

`release/2026-09-12T20-55-51-864Z/app/BACKSEAT-win32-x64/BACKSEAT.exe`를 실행한다. 폴더 전체가 필요하다. 크기는 1,583,169,165바이트(약 1.58GB), 파일은 2,437개다. 기본 저장 위치는 Electron 사용자 데이터 폴더 아래 `data`이며 개발 프로젝트의 `data/`를 가져오지 않는다. 검증은 `--backseat-profile=<별도 절대 경로>`로 만든 빈 프로필에서 진행했다.

포함한 구성: Electron 44.3.0, 공식 npm Codex 0.154.0 Windows x64 실행 파일, 공식 Python 3.13.15 embeddable, 고정된 24개 음성 패키지, 로컬 Whisper small 모델. 개발용 Node/Python/Codex 설치 경로와 `.venv`는 실행에 사용하지 않는다. 모델 파일도 동봉하므로 음성 인식을 위한 첫 실행 다운로드가 필요 없다. 사용자의 Codex 로그인은 공식 CLI가 직접 확인하며 배포본에 로그인 정보가 들어 있지 않다.

`scripts/package-windows.mjs`는 앱 소스·빌드 화면을 허용 목록으로 복사하고, 별도 staging에서 프로덕션 의존성만 설치한다. `.env`, 사용자 데이터, 게임 저장, 개발 로그, 녹화 자료는 복사하지 않는다. pip의 개발 경로가 들어가는 콘솔 실행기와 Python 바이트코드 캐시는 제외한다. 음성 작업은 UTF-8 및 `-B`로 실행해 설치 폴더에 캐시를 쓰지 않는다.

앱 코드에는 ASAR 무결성 검사를 적용하고 ASAR에서만 앱을 읽게 했다. Electron의 Node 실행 모드·NODE_OPTIONS·디버거 실행 인자·추가 file 프로토콜 권한을 껐다. 서명 전 설정이며, 서명이나 OS 권한 격리를 대체하지 않는다. [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)

## 재현

```powershell
powershell -File scripts/prepare-speech-runtime.ps1
npm run package:windows -- --speech=artifacts/speech-runtime-<생성된 폴더>
node scripts/verify-package-integrity.mjs
node scripts/verify-packaged-runtime.mjs --live
```

마지막 명령만 실제 Astra 요청 1회를 소비한다. `artifacts/latest-package.json`이 최신 배포 폴더와 매니페스트를 가리킨다. 빌드는 새 디렉터리를 만들며 기존 배포본이나 사용자 데이터를 덮어쓰지 않는다. 음성 빌더·버전·해시 출처는 [SPEECH-RUNTIME.md](SPEECH-RUNTIME.md)에 있다. 위 경로는 개발 도구용이며 최종 사용자 온보딩을 대체하지 않는다.

## 현재 배포본의 추가 검증

현재 배포는 첫 실행 안내·공식 계정 연결·명시적 Astra 시험 요청·관객별 목격 기록을 포함한다. 전체 **126개 테스트와 빌드**가 통과했다(`artifacts/onboarding-final-package-retry.log`). 신규 안내 6개 흐름 및 기존 확장 7개 흐름, 메인/오버레이 인증 경계가 통과했다. 자세한 내용은 [ONBOARDING.md](ONBOARDING.md), [VIEWER-KNOWLEDGE.md](VIEWER-KNOWLEDGE.md).

현재 파일 2,437개, 핵심 원본 17개와 fuses가 일치한다(`artifacts/package-integrity-test.json`). 현재 번들에서 PATH 제한 상태로 음성 준비 5.9초, 9.4초 한국어 시험 음성 전사 2.9초를 확인했다(`artifacts/packaged-runtime-test.json`, `onboarding-packaged-runtime.log`). 이번 headless 런타임 검사는 모델 호출 없이 전사/공식 로그인만 실행했다. 배포 앱의 실제 모델 응답은 네이티브 UI 검증 `onboarding-native-test.json`에 따로 기록한다.

## 최초 독립 배포에서 확인한 결과

| 검증 | 결과와 원본 |
|---|---|
| 자동 검사 | 전체 101개 테스트 + TypeScript/Vite 빌드 통과. 종료 수정 후 최신 빌드는 `artifacts/package-lifecycle-final.log`, 이전 검사는 `artifacts/distribution-final-check.log` |
| 인증 연결 후 화면 흐름 | 실제 Electron에서 기획 방송·포인트·댓글·녹화/재생 등 7개 통과. 합성 모델/미디어. `artifacts/session-desktop-output.log` |
| 독립 음성/모델 | PATH에서 개발 도구를 제외하고 번들 Python·오프라인 모델 전사, 번들 Codex 로그인, Astra low 실제 응답 통과. `artifacts/packaged-runtime-test.log` (이전 원본) |
| 실제 배포 앱 | 새 프로필로 실행, 구독·로컬 음성 준비 표시, UI에서 제목 저장, 오버레이, 종료·재실행 후 제목 복원. `artifacts/packaged-native-state.txt`, `packaged-app-process.json` |
| HTTP 경계 | 실행 중 배포 앱의 외부 로컬 조회에 401 반환. `artifacts/packaged-http-boundary.json` |
| 실행 후 파일 | 전체 2,437개 SHA256 일치, 핵심 소스 9개 일치, 예상 밖 파일 없음, fuse 값 확인. `artifacts/package-integrity-test.json` |
| 빌더 정리 범위 | 루트·다른 경로·관계없는 형제 폴더 거부, 지정한 생성 폴더만 정리. `artifacts/runtime-builder-tests.log` |
| 종료 순서 | 오버레이를 먼저 닫은 뒤 메인을 닫는 오류를 수정. 실제 진입점을 사용한 회귀 흐름 4개 및 최신 배포 앱의 같은 순서 정상 종료 통과. `artifacts/desktop-lifecycle-test.json`, `artifacts/packaged-lifecycle-native-test.json` |

종료 수정 전 배포본에서 실행한 음성·실제 모델 테스트를 무조건 재사용하지 않았다. 최신 배포본의 실행 코드·라이브러리·모델·연결 코드 2,366개 항목을 대조했다. 차이는 이미 제외한 pip 콘솔 실행기의 해시가 적힌 8개 RECORD 메타데이터뿐이며, 해당 행 외의 내용은 동일하고 그 실행기가 양쪽 배포본 모두에 없음을 확인했다. 빌드 시각 등을 담은 출처 매니페스트는 비교에서 분리했다. 원래 차이 보고서는 `artifacts/package-integrity-metadata-review.json`, 당시 판단은 `distribution-evidence.json` 및 배포 단계 기록에 보존했다. 최신 배포본에서도 이전 프로필 로드와 오버레이 종료 순서를 직접 확인한다.

이번 실제 모델 요청은 약 9.7초였다. 동시에 배포 앱을 처음 실행한 음성 테스트에서는 준비 약 6.1초, 9.4초 합성 음성 전사 약 9.2초가 걸렸다. 단독 음성 빌더의 전사는 약 2.6초였다. 서로 다른 부하 조건이며, 이 결과만으로 실시간 지연 목표를 충족했다고 판정하지 않는다.

## 남은 판매 준비

개발 도구 PATH를 제한한 개발 PC 검증은 새 Windows PC 검증과 같지 않다. MSVC 네이티브 의존성, 여러 GPU·DPI·모니터, 새 계정의 인증 완료 및 정책별 로그인·모델 접근 실패, 설치/제거/업데이트/데이터 이전, 서명과 게시자 정보가 남아 있다. 현재 게시자 메타데이터도 개발용 미설정 표시다.

Codex 및 Whisper의 라이선스·모델 카드와 패키지별 제공 라이선스 파일을 동봉했다. 네이티브 라이브러리를 포함한 전체 구성요소의 배포 조건 검토, OpenAI 계정 연결의 상용 제공 조건 확인, Steam 콘텐츠 설문·상점/빌드 심사도 별도 출시 기준이다. [RELEASE-GATES.md](RELEASE-GATES.md)에 기능·몰입·운영 기준을 함께 유지한다.

최종 20-55 배포는 초기 안내 기록의 저장/재시작 복구를 보완했다. 실제 전사와 네이티브 Astra 9.2초는 직전 20-45 배포에서 실행했으며, 최종 배포와 런타임/모델/연결 코드 2,368개 항목이 완전히 동일하다(`package-integrity-test.json`의 runtimeContinuity; metadataOnly도 비어 있음). 최종 배포의 빈 프로필 첫 화면 및 초기 안내 기록 저장은 별도로 확인한다(`onboarding-final-native-test.json`). 따라서 실제 모델을 다시 호출한 것으로 표시하지 않는다.
