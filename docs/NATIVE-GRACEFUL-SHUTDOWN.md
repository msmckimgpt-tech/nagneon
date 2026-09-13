# AI 요청 중 앱 종료와 임시 화면 정리

2026-09-14. 기준 `b360859d45fd9d52ed66a8d36ea5882ec4a4fff3`, 작업 경로 `G:/dev/ai/00_game_backseat-worktrees/native-graceful-shutdown`, 브랜치 `codex/native-graceful-shutdown`. 사용자 테스트 종료에 따른 Computer Use·Claude Code 재허용은 [재개 기록](NATIVE-VALIDATION-RESUME.md)을 따른다. 사용자 원본 데이터는 읽거나 바꾸지 않았다.

## 재현과 변경

기존 Electron `will-quit`은 `void service.close()`만 호출했다. 서버의 close도 모델 요청 자체가 끝나는 시점은 기다리지 않았다. CodexProvider는 자식 종료 후 `finally`에서 임시 프롬프트·화면 폴더를 비동기로 삭제하므로, 프로세스를 kill했더라도 Electron이 먼저 끝나면 파일이 남았다.

`scripts/verify-native-shutdown.mjs --legacy`로 실제 Electron 창 종료 이벤트, 실제 CodexProvider 파일 작성·삭제, 실제 느린 하위 프로세스를 사용해 이를 재현했다. CLI만 합성 대역이며 계정 요청·물리 장치 캡처는 하지 않았다. 닫기 직전 `checking`, 실행 중 PID, 임시 프레임 존재를 확인했고, 종료 뒤 자식은 사라졌지만 임시 폴더는 남았다. 시험에서 만든 정확한 폴더만 시험 종료 후 정리했다. 원본: `artifacts/native-shutdown-8MsdGK/result.json`.

- Electron은 종료 이벤트를 막고 서버 정리를 기다린 뒤 한 번만 최종 종료한다. 반복 종료 요청은 대기를 우회하지 않는다. 시작 중 서버를 기다리는 동안 종료되면 새 창을 만들지 않고 해당 서버를 정리한다.
- 서버별 RequestLifetime은 관객 생성과 전사 요청을 취소하고, 실제 요청의 `finally`까지 기다린다. 종료 후 새 요청과 늦은 성공 결과는 거부한다. 호출자의 기존 취소 동작과 생성 시작 순서를 유지하며, 재사용한 provider 객체에 이전 서버의 종료 상태를 남기지 않는다.
- 서버 close는 같은 완료 Promise를 돌려준다. 한 정리 작업이 실패해도 나머지 정리를 모두 시작하고 기다린다. 정리 실패가 보고되면 Electron은 성공 종료로 기록하지 않는다.
- 계정 인증 방식, Astra 모델·low 추론, 로컬 모델과 사용자 방송 설정은 변경하지 않았다. 기존 CodexProvider의 파일 삭제 실패 로그 및 프로세스 종료 기한 자체는 이번 변경 범위가 아니다. 강제 종료·전원 손실까지 이 정상 종료 경로로 해결한다고 주장하지 않는다.

## 검증

첫 전체 검사에서 새 래퍼의 호출 지연과 재사용 provider에 남은 종료 상태 때문에 기존 회귀가 실패했다. `artifacts/shutdown-check.log`를 보존하고, 동기 시작과 서버별 Proxy로 수정했다. 이후 `artifacts/shutdown-check-2.log`에서 **550개 통과, 실패/취소/건너뜀 0개**, TypeScript·Vite 빌드를 확인했다. 추가 검사는 늦은 결과, 파일 정리 대기, 다른 정리 실패, 반복 종료와 비정상 종료 코드를 다룬다.

새 배포본은 `release/2026-09-13T17-51-39-193Z/app/BACKSEAT-win32-x64`이며 ASAR SHA-256은 `7c52466e3f49b0a72362002a0b436f61c484fea098ed09e1c1cbca5cc9a5b299`다. 새 ASAR에서 추출한 정확한 모듈로 실제 Electron 종료 재현을 다시 실행했다. 현재 빌드 소스 76개 일치, 자식 close → 임시 폴더 삭제 → Electron quit 순서와 파일 잔류 없음이 확인됐다. 닫기 요청부터 quit까지 22ms였다. 이는 합성 CLI를 사용한 한 번의 관측값이며 실제 모델 응답 성능 수치가 아니다. 원본: `artifacts/native-shutdown-buzZEF/result.json`, `artifacts/shutdown-delivered.log`.

Computer Use로 위 배포 exe를 별도 `artifacts/native-profile`에서 실행했다. 이전 검증에서 만든 합성 프로필의 world/onboarding 두 파일만 복사해 Just Chatting 방송실과 설정 복원을 확인했다. 공식 CLI의 Astra 응답 확인을 시작하고 자식 PID를 확인한 뒤 Alt+F4로 닫았다. 해당 앱·Python·Codex PID와 해당 요청의 임시 폴더는 모두 사라졌다. 다만 프로세스 확인과 닫기 사이 약 19초 간격이 있어, 실제 모델이 닫는 순간까지 생성 중이었다는 판정은 하지 않는다. 생성 중 종료의 엄밀한 재현은 위의 제어된 Electron 시험이 담당한다. `native-launch.json`, `native-before-close.json`, `native-after-close.json`, `native.stdout.log`, `native.stderr.log`와 Computer Use 도구 관측을 남겼다. stderr에는 기존 DEP0180 경고만 있었다.

이전 배포본의 음성 검사 결과를 재사용하려던 무결성 검사는 런타임/어댑터 바이트 차이로 거부됐다(`shutdown-integrity.log`). 첫 재검사 시 잘못 고른 구형 corpus의 형식 검증도 실패했다(`shutdown-runtime.log`). 이를 통과로 취급하지 않았다. 검증된 합성 corpus로 새 배포본의 실제 Whisper medium·YAMNet·small 대사 인식과 인식 중 장애 복구를 다시 실행해 통과했다. 세션·설정·포인트·이미 받은 발언 유지, 짧은 한국어 응답 4개 정확 전사와 모든 소유 인식기 종료를 확인했다. 원본: `artifacts/shutdown-runtime-verified/result.json`. 물리 마이크/출력 장치 검증은 아니다.

새 런타임 결과로 다시 실행한 전체 패키지 무결성 검사는 2,452개 파일·3,130,218,201바이트, 소스 76개와 ASAR 보호 설정을 확인하고 실패 0개로 통과했다(`artifacts/shutdown-integrity-verified.log`, `artifacts/package-integrity-test.json`). 서명되지 않은 개발 배포본이며 판매 준비 완료를 뜻하지 않는다.

WSL Claude Code의 이전 읽기 전용 검토가 완료된 것도 확인했다. 검토자는 테스트를 실행하지 않았고, 종료 대기 누락을 네이티브 검증 필요 사항으로 제시했다. 이번 임시 파일 잔류 결론은 그 의견만으로 확정하지 않고 위 실제 재현으로 확인했다. 원본은 이전 작업 경로 `native-validation-resume/artifacts/claude-native-review.json`이다.

## 통합과 다음 검증

2026-09-14 후속 검증에서, 정리가 즉시 끝나는 경우 최종 종료 요청이 Electron의 첫 종료 이벤트 처리 중 무시되는 경로를 발견했다. [빠른 정리 완료 후 종료 수정과 실제 배포본 재실행 검증](DESKTOP-EXIT-DRAIN.md)을 함께 확인한다.

작업 브랜치 게시 후 별도 `native-graceful-shutdown-integration` worktree에서 `npm ci`와 필수 검사로 통합 상태를 검증한다. 통합 잠금·main 상태·원격 커밋 일치를 확인한 결과는 `artifacts/shutdown-integration-result.json`에 남긴다. 생성한 검증 앱은 모두 종료했다. 사용자 원본 실행본을 교체했다고 보고하지 않는다.

이 변경은 정상 종료의 확인된 결함 한 건을 해결한다. Steam 판매 목표는 계속 진행 중이다. 실제 게임·장치·오버레이의 장시간 소통 품질, 동시에 가동되는 로컬 모델의 메모리 부하, 강제 종료 복구, 설치와 서명 및 판매 조건은 [판매 준비 기준](RELEASE-GATES.md)의 후속 검증으로 유지한다.
