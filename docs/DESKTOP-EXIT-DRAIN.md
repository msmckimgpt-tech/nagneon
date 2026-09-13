# 빠른 정리 완료 후 데스크톱 종료

2026-09-14. 작업 브랜치 `codex/desktop-exit-drain`, 기준 `84ed4e6305b467a11383ac427de237d36ecb507d`.

[잠수 관객 검증](QUIET-VIEWING-COMPANY.md)에서 소스 앱의 창이 닫힌 뒤 Electron 프로세스가 남았다. 이전의 [모델 요청 정리 대기](NATIVE-GRACEFUL-SHUTDOWN.md)는 유지하되, 이미 정리가 끝난 앱이 실제로 종료되는 경로를 수정했다.

## 원인과 변경

실제 데스크톱 진입점과 렌더러·SSE를 실행하고 정리 단계별 완료 시각을 기록했다. 모델 요청, 음성·소리 인식기, 클립, 커뮤니티, HTTP 서버가 모두 정리된 뒤에도 종료되지 않았다. 최종 `app.quit()` 호출은 기록됐지만 두 번째 `before-quit`·`will-quit`이 발생하지 않았다. 두 차례의 추적 실행은 18초 감시 기한에 실패로 종료했다.

Electron 44.3.0의 `Quit()`는 내부 `is_quitting_`가 참이면 새 호출을 무시한다. `will-quit`에서 취소한 상태는 C++ observer가 돌아온 뒤 해제된다. 기존 코드의 Promise가 빠르게 완료되면 그 이벤트의 마이크로태스크 처리 중 최종 종료를 다시 요청할 수 있었다. 실제 추적의 호출 순서와 [사용 중인 버전의 Electron 소스](https://github.com/electron/electron/blob/v44.3.0/shell/browser/browser.cc#L112), [공식 종료 이벤트 설명](https://www.electronjs.org/docs/latest/api/app#event-will-quit)을 대조했다.

`desktop/graceful-quit.cjs`는 모든 정리 완료 후 `setImmediate`로 한 번 다음 이벤트 루프에 양보한 뒤 정상 `app.quit()`를 호출한다. 파일 삭제·하위 프로세스 종료를 기다리는 장벽, 반복 종료 요청의 차단, 실패 시 비정상 종료 처리는 그대로다. 정리 기한을 짧게 만들어 진행 중인 작업을 끊거나 성공 코드로 강제 종료하는 변경이 아니다.

수정 후 추적에서는 정리 완료 → 첫 종료 이벤트 복귀 → 다음 종료 요청 → 두 번째 종료 이벤트 → 종료 코드 0 순서를 확인했다.

## 검증

- `npm run check`: 591개 테스트, 실패·취소·건너뜀 0, TypeScript/Vite 빌드 통과. 추가 회귀는 네이티브 종료 상태가 해제되기 전 빠른 정리 완료가 발생하는 경우를 다룬다.
- `node scripts/verify-desktop-exit.mjs`: 실제 소스 진입점, 실제 렌더러의 SSE 연결, 새 프로필 종료·같은 프로필 재실행. 두 번 모두 코드 0, 저장 설정 유지. 창 닫기 요청에서 앱 quit 이벤트까지 26ms와 22ms였다. 성능 보장이나 대규모 표본 측정은 아니다.
- `node scripts/verify-native-shutdown.mjs`: 실제 Electron + 실제 CodexProvider 임시 파일 + 느린 합성 CLI. 자식 종료, 임시 파일 제거, 요청 완료 후 quit 순서 통과. 실제 계정 생성 요청과 장치 캡처는 하지 않는다.
- 같은 느린 요청 검증을 새 배포 ASAR의 정확한 소스로도 실행해 통과했다.

새 종료 검증기의 첫 실행은 새 프로필에 메인 화면의 ‘로컬 연결됨’ 문구가 없어서 실패했다. 처음에는 온보딩 화면이 나오며, 이 화면도 실제 EventSource가 상태를 받은 뒤에만 렌더링된다. 검사기는 해당 실제 연결 완료 상태도 확인하도록 수정했다. `desktop-exit-CkJeRG`의 실패를 보존하고 `desktop-exit-iTFAGw`의 최종 두 번 실행만 통과 근거로 사용했다.

첫 조사 런처는 PowerShell의 GUI 실행 명령이 살아 있는 자식보다 먼저 코드 0을 반환했고, 추적도 페이지 요청 이후 진행되지 않았다. 종료 요청까지 도달하지 않은 이 불완전한 실행은 종료 원인 증거에서 제외했다. 이후 Node가 파일 출력을 소유하고 자식 종료까지 기다리는 런처로 두 차례 재현하고 수정본을 검증했다.

## 배포 실행 파일 확인

패키지: `release/2026-09-13T22-50-45-180Z/app/BACKSEAT-win32-x64`.

ASAR SHA-256: `1c642c8c2deea4444ed19017042b01566dc71b63eeef034ed76f334be76aa972`.

Computer Use로 실제 `BACKSEAT.exe`를 열어 기존 AI 검증용 프로필을 복사한 방송실을 확인하고 Alt+F4로 닫았다. 같은 프로필로 다시 실행해 설정과 관객 복원을 확인한 뒤 다시 닫았다. 두 실행 모두 종료 코드 0, 해당 경로의 앱 프로세스 잔류 없음, 설정·관객·포인트 데이터 유지가 확인됐다. 이 두 실행은 방송 대기 상태였고 마이크·화면·출력 소리는 연결하지 않았다. 사용자 원본 프로필과 다른 앱은 변경하지 않았다.

새 ASAR에서 추출한 정확한 런타임으로 번들 Python·Whisper 한국어 전사·YAMNet·별도 출력 대사 전사·공식 CLI 계정 확인·실제 Astra low 응답 두 건을 통과했다. 음성은 이전에 생성한 합성 WAV이며 물리 마이크 검증이 아니다. 전체 무결성은 2,452개 파일, 3,130,244,241바이트, 소스 77개 일치와 ASAR 보호 설정, 실패 0개다. 패키지는 서명되지 않은 개발 배포본이다.

## 증거와 후속 작업

`G:/dev/ai/00_game_backseat-worktrees/desktop-exit-drain/artifacts/`에 원본을 보존했다.

- `trace-baseline-result.json`, `trace-baseline-repeat-result.json`, `trace-baseline-repeat-electron.log`, `trace-*/events.json`: 수정 전 재현과 정리 단계·최종 종료 요청 순서.
- `trace-fixed.log`, `trace-runner-result.json`: 동일 추적의 수정 후 정상 종료.
- `shutdown-tests.log`, `check.log`, `desktop-exit-iTFAGw/result.json`, `slow-native-shutdown.log`, `packaged-slow-shutdown.log`: 단위·전체·실제 Electron의 빠른/느린 종료 검증.
- `latest-package.json`, `packaged-runtime-test.json`, `package-integrity-test.json`: 정확한 배포본 위치와 실제 런타임·파일 무결성.
- `native-package-{first,reopen}.json`, `native-package-*-ui.txt`, `native-package-result.json`: 실제 배포 실행 파일의 UI·종료 코드·프로필 보존.
- `integration-result.json`, `phase-result.json`: 별도 통합 worktree의 필수 검사와 원격 커밋·CI 대조 결과.

Steam 출시 목표는 계속 진행 중이다. 이번 변경은 재현된 정상 종료 결함을 해결한다. 장시간 실게임에서의 대화, 물리 마이크의 말투·오인식·감정 단서, 설치·서명과 나머지 [판매 준비 기준](RELEASE-GATES.md)은 별도의 수용 항목으로 남는다.
