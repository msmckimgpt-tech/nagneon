# 최근 개선을 포함한 배포 런타임 검증

기준 main `cbbb7eda8c9779ec4f585e9104a9827617b07760`, worktree `G:/dev/ai/00_game_backseat-worktrees/release-runtime-verification`, 브랜치 `codex/release-runtime-verification`. 이전 단계는 마이크 복구 코드를 실제 별도 프로세스·HTTP·제어된 클라이언트 핸들러로 검증한 진전이다. 이번 단계는 그 코드와 연속 장면·관객 기억·한국어 medium 모델 개선이 실제 배포 폴더에서도 동작하는지를 확인한다.

## 배포 검사와 실제 빌드 결함

기존 무결성 검사는 배포 파일 전체 해시를 확인하면서도 현재 개발 소스와의 비교는 수동 목록에 의존했다. 새로 추가된 모듈과 화면 빌드의 누락·오래된 파일을 그 목록이 항상 포괄하지 않았다. `scripts/lib/package-sources.mjs`를 추가해 desktop/server/shared/dist의 모든 배포 대상, 변환된 package.json, 음성·소리·클립 Python 작업자를 기록하고 실제 ASAR/리소스와 대조한다. 원본 package.json·lockfile·TypeScript 선언은 빌드 입력으로 별도 기록한다. 소스 추가·변경·누락·오래된 화면 chunk·변조된 worker는 실패로 처리한다.

첫 양성 시험에서는 Windows ASAR의 중첩 경로 조회가 실패했다. `dist/assets/app.js`가 실제 헤더에 있는데도 forward slash 경로의 조회가 실패함을 확인했고, 조회에 플랫폼 경로 구분자를 사용했다. 이 중간 도구 실패는 `artifacts/package-sources-first.log`, 수정 후 5개 통과는 `artifacts/package-sources-verified.log`에 보존한다.

실제 빌드에서는 `shared/temporal-policy.d.ts`가 기존 패키저의 허용 확장자에 없어 중단됐다(`artifacts/package-current.log`). 선언 파일은 빌드 전용 입력으로 해시를 기록하고 런타임 복사에서 제외한다. 임의 파일이나 링크까지 허용하도록 넓히지 않았다. 선언을 포함한 실제 ASAR fixture 검사는 `artifacts/package-sources-declarations.log`에 있으며, 전체 **494개 Node 테스트와 TypeScript/Vite 빌드**는 `artifacts/check-verified.log`에서 통과했다. 첫 전체 결과 `artifacts/check-first.log`도 보존한다.

다음 실제 패키징에서는 Electron Packager 20.3.0이 lockfile을 제외하고 package.json에서 개발용 필드를 제거한다는 사실을 검사 도구가 반영하지 않아 실패했다(`artifacts/package-verified.log`, `build-current-result.json`). 설치된 패키저의 `copy-filter.js`와 `sanitize-package-json.js`에서 변환을 확인했다. 공식 기본 sanitizer와 마지막 개행을 동일하게 적용하고 lockfile은 빌드 입력으로 추적한다. 원본 개발 설정·lockfile의 변경도 매니페스트 비교에서 실패하도록 검사했다. 보존된 중단 배포 폴더의 실제 ASAR에 대해 소스 **67개**가 일치했으며(`package-metadata-diagnosis.json`), 이것만으로 중단된 배포를 합격 처리하지 않았다.

최종 집중 검사는 **6개** 통과(`package-sources-metadata.log`), 필수 검사는 **495개 Node 테스트와 TypeScript/Vite 빌드** 통과(`check-final.log`)다. 수정 후에는 별도 새 배포 폴더를 생성한다.

## 입력과 검증 범위

- main의 검증된 medium 모델을 자체 worktree에 해시 확인 후 복사했다. YAMNet 입력도 자체 폴더에 복사하며 패키저가 고정 파일의 크기·해시를 다시 확인한다. 기존 small/Python 빌더 폴더는 읽어서 새 패키지 리소스에 복사한다. 원본 모델·사용자 환경은 수정하지 않는다.
- 기존 `korean-fixture.wav`, `sound-dialogue-fixture.wav`는 문서화된 합성 개발 시험 파일이다. 별도로 Windows의 Microsoft Heami Desktop으로 네/아니요/안 돼요/그렇습니다 4개를 파일에만 합성했다. 실제 오디오 출력·마이크 캡처는 사용하지 않는다. 입력별 SHA-256과 정답은 `artifacts/recovery-corpus/corpus.json`에 있다. 첫 helper의 UTF-8 BOM 누락으로 PowerShell 5.1 파싱이 실패했으며, 원본을 `create-recovery-corpus-utf8-no-bom.ps1`로 남긴 뒤 BOM을 넣어 실행했다.
- `scripts/verify-packaged-microphone-recovery.mjs`는 전달한 ASAR를 새 증거 폴더에 풀어 **그 안의** LocalSpeech/LocalSound/HTTP 서버와 번들 Python/medium/small/YAMNet을 사용한다. 개발 PATH와 Python 경로를 제외하고 캐시는 작업 폴더로 한정한다. 실제 네이티브 Electron이 ASAR를 여는 시험과 구분한다.
- 마이크 전사 중 자신이 만든 실제 Whisper 프로세스를 종료하고, HTTP 재준비와 다음 발언을 검증한다. 세션 ID·관객 설정·포인트·기존 발언을 확인하며, 별도의 소리 인식기가 동시에 완료되는지도 확인한다. 손상 오디오 한 구간이 정상 인식기를 재시작시키지 않아야 한다. 모든 시험 소유 프로세스의 실행 경로·PID·종료 시각을 보존하고 종료를 확인한다.
- 기존 배포 런타임 검증은 실제 로컬 음성·소리 결과를 사용하는 Astra low 대화와 소리 문맥 반응을 확인한다. 공식 번들 CLI만 계정 상태를 확인하며 인증 파일을 직접 읽지 않는다. 서비스 종료 시 새 LocalSpeech의 비동기 종료 확인도 기다리도록 검증 도구를 보완했다.

최종 패키지 생성 결과는 `artifacts/build-final-result.json`, 검증 흐름은 `artifacts/delivered-validation-result.json`, 생성 로그는 `artifacts/package-final.log`다. 위 중간 실패 로그도 보존한다. 아래 최종 결과에는 실제 판정과 한계를 기록한다.

## 최종 결과

새 배포 폴더는 이 개발 worktree의 `release/2026-09-13T14-07-38-998Z/app/BACKSEAT-win32-x64`다. **2,451개 파일, 3,130,142,563바이트**, 미서명이며 ASAR SHA-256은 `a93088066a4b94059a702328096c22a1b5f240c03015e602648811c25950b922`다. 연속 장면·부재/복귀 기억·개성·medium 모델·마이크 복구까지 통합한 소스다.

`artifacts/delivered-validation-eYo0Dt/microphone/result.json`의 실제 모델 복구 시험이 통과했다. 처음 준비 12.070초, 긴 합성 한국어 전사 10.039초, 인식 도중 소유 Whisper 종료 후 오류 응답 0.179초, 재준비 8.255초였다. 복구 후 네/아니요/안 돼요/그렇습니다는 각각 1.855/2.564/1.846/1.909초에 인식하고 동일 세션에 전달했다. 손상 오디오는 409를 반환하며 정상 작업자를 유지했고, 동시에 실행한 YAMNet/별도 small 전사는 같은 프로세스에서 음성과 한국어 대사를 반환했다. 처음 긴 전사 시간과 짧은 후속 전사 시간을 평균으로 합쳐 빠르다고 보고하지 않는다.

소유 작업자 3개는 실행 경로·시작/종료 시각·PID를 결과에 보존하고 실제 종료를 확인했다. 방송 ID·설정·포인트 잔액·이미 받아들인 발언을 보존했다. 이 시험은 합성 파일 HTTP 경로이며 물리 마이크·네이티브 UI·사용자의 억양에 대한 전사 정확도 합격이 아니다.

같은 ASAR의 `runtime.json`에서 실제 Astra low **2회**가 통과했다. 마이크 전사 기반 대화 9.778초에 “안녕하세요! 무슨 좋은 일 있었어요?”, 소리 문맥 기반 대화 10.839초에 “신나는 일이라니 뒷얘기 궁금한데”를 반환했다. 장면·공개 발언·긍정 사건·선택 결과를 직접 읽었으며, 화면이 없는 상황에서 보이는 장면을 만들거나 구체적인 사건 없이 후원·클립을 생성하지 않았다. 이 두 합성 사례가 장기 말투 품질의 합격값은 아니다.

같은 실행의 medium 준비는 6.527초, 9.4초 합성 한국어 전사는 10.004초, 소리 인식기 준비는 2.896초, 8초 시스템 음원 분석은 7.675초였다. 긴 발화와 전체 대화 지연은 여전히 개선 과제다. 앞 단계 연속 장면 인식 검증을 이번 대화 2회로 대체하지 않으며, 이번 검증은 이미지가 아니라 합성 음성 입력이다.

실제 실행 후 전체 **2,451개 파일의 SHA-256**, 현재 소스 **67개**, ASAR/fuses 검사가 통과했고 미등록 파일·캐시 추가가 없었다(`artifacts/package-integrity-test.json`, `delivered-validation-eYo0Dt/integrity.log`). 런타임 결과와 동일한 ASAR 해시를 요구했으며, 과거 다른 배포본의 실행 결과를 재사용하지 않았다. 오케스트레이터의 3단계 결과도 모두 0이며 `artifacts/delivered-validation-result.json`에 보존한다.

서명·설치 프로그램·새 Windows·물리 장치·여러 게임의 장기 방송·상용 연동 조건·Steam 심사 합격은 별도 남은 기준이다. 사용자 앱·화면·게임·장치를 조작하거나 재시작하지 않았다. 이번 폴더는 개발 검증 산출물이며 현재 켜 둔 앱을 교체한 것이 아니다.

## 통합 기록

제품/검증 도구 커밋 `20003b5a277571ffcf5f18fc7b5a8acd1923bf5d`를 별도 `release-runtime-integration` worktree에서 다시 확인했다. 자체 `npm ci` 후 **495개 테스트와 TypeScript/Vite 빌드**가 통과했고, 그 통합 소스/화면 빌드의 **67개 배포 대상**이 이번 실제 실행 ASAR/리소스와 일치했다. 원본은 두 worktree의 `artifacts/release-integration-check.log`, 흐름은 개발 worktree의 `artifacts/release-integration-result.json`이다. 이 기록만 추가한 뒤 main에 fast-forward하며 푸시·사용자 앱 교체·네이티브 실행은 하지 않는다.
