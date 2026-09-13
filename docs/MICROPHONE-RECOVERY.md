# 방송을 유지하는 마이크 인식 복구

기준 main `7284655066284b293645704072f1200cec9e796a`, 개발 worktree `G:/dev/ai/00_game_backseat-worktrees/microphone-recovery`, 브랜치 `codex/microphone-recovery`. 이전 연속 장면·부재/복귀 개선은 main 통합과 실제 모델 검증을 마친 진전으로 분류하고, 이번에는 출시 기준 중 방송 중 오류 복구를 개선한다. 설치 프로그램·전체 진단 지원·실제 장기 사용의 완료를 선언하지 않는다.

## 확인한 원인

기존 `LocalSpeech.start()`에는 중복 실행 방지가 없었다. 종료 후 다시 시작하면 이전 프로세스의 늦은 close/error/ready 이벤트가 새 인식기의 준비 상태와 요청을 바꿀 수 있었다. close()는 OS 종료 이벤트를 기다리는 동안 ready와 pending을 즉시 정리하지 않았고, 전사 시간 초과는 요청만 취소해 멈춘 Python이 계속 남을 수 있었다. 시작 중 준비 완료가 오지 않는 경우에도 자체 기한이 없었다. 클라이언트에는 인식기를 다시 준비하는 경로가 없어 오류 뒤 앱 전체 재시작을 안내했다.

`artifacts/recovery-before.log`의 첫 9개 검사는 모두 실패했다. 실제 중복 실행(2개 프로세스), 이전 종료 이벤트의 새 요청 거부, 종료 직후 남은 ready, 취소 후 물리 작업 기한 소실과 동기 spawn 예외를 구분해 확인했다. 아직 없던 prepare 기능을 요구하는 실패도 포함한다. 시간 초과 재현은 구버전의 실제 60초를 기다렸고, 그 출력은 단순 취소 오류였다. 이 9개를 모두 독립적인 사용자 사고라고 해석하지 않는다.

## 변경

- 마이크를 켜기 전에 `/api/audio/prepare`에서 로컬 인식기를 준비한다. 이미 준비됐으면 같은 프로세스를 사용한다. 준비 중에는 버튼으로 취소할 수 있고, 취소 후 늦은 성공·장치 허가 결과가 녹음을 다시 시작하지 않는다.
- 설정의 계정·모델 연결 화면에서 **음성 인식 다시 준비**를 선택할 수 있다. 방송을 종료하거나 계정을 다시 연결할 필요가 없다. 로컬 음성 모델·medium 기본값·CPU 설정·GPT 모델은 변경하지 않는다.
- 인식기 종료·연결 실패·준비 45초 초과·인식 60초 초과에는 해당 인식기만 종료 요청한다. 그 프로세스의 실제 close가 확인되기 전에는 새 인식기를 중복 실행하지 않는다. 무한 자동 재시작은 하지 않고 사용자가 다시 켤 때 복구한다.
- 실패한 인식기와 이전 실행에서 온 출력은 새 요청에 적용하지 않는다. 정상 요청의 개별 디코딩 오류는 인식기를 종료하지 않으며 다음 구간을 처리한다.
- HTTP 요청 취소는 현재 청취 요청을 끝내지만 Python이 처리 중일 수 있다. 그 작업의 기한은 실제 완료나 프로세스 종료까지 유지한다. 취소된 작업이 응답하면 새 발언을 건드리지 않고 자신의 기한만 정리한다. 미완료 작업은 최대 8개로 제한하고 프로토콜 대기는 1,000,000문자로 제한한다.
- 복구가 필요한 오류이면 클라이언트는 마이크와 아직 전사하지 못한 대기 구간을 멈추고 마지막 말을 다시 들려달라고 안내한다. 이미 전사되어 전송 대기 중인 발언은 보존한다. 화면·시스템 소리·방송 세션·관객·포인트는 이 동작의 초기화 대상이 아니다.
- 앱 서비스 종료는 자신이 시작한 마이크 인식기의 종료를 최대 5초 확인한다. 확인 실패는 성공으로 숨기지 않고 반환한다. 다른 Python·사용자 앱 프로세스를 조회하거나 종료하는 처리는 없다.

## 검증과 증거

화면·창 조회, Computer Use, 실제 마이크·출력 장치, 게임 실행, 사용자 앱 재시작은 하지 않았다. 이 작업의 테스트 프로필과 로그는 별도 worktree에만 만든다.

- `test/microphone-recovery.test.js`: 소유 프로세스와 가상 시계로 중복 시작, 이전 이벤트, 즉시 pending 정리, 공유 준비/개별 취소, 준비·처리 기한, 취소 후 기한, oversized 응답과 시작 실패를 검증한다. 기존 `test/local-speech.test.js`의 오프라인 모델 선택·잘못된 구간·응답 ID·전사 시간 자료 검사도 유지한다.
- `test/microphone-recovery-http.test.js`: 실제 Node 하위 프로세스와 자체 HTTP 서버를 사용한다. 합성 프로세스를 종료 코드 17로 끝내거나 응답 없이 기다리게 한 뒤 준비 요청과 다음 발언이 성공함을 확인한다. 세션 ID·설정·포인트·기존 발언·호출 횟수, 개별 구간 오류 뒤 계속 처리, 동시에 들어온 준비 요청, HTTP 취소와 인증 없는 요청 거부를 확인한다. 하위 프로세스의 PID·실행 파일·시험 진입점·종료 시각은 `artifacts/microphone-process-*/result.json`에 남긴다. 사용자 계정 토큰은 기록하지 않는다.
- `test/microphone-preparation.test.js`: 실제 `useMedia.ts`를 TypeScript로 변환해 제어된 전송·장치 대역에서 호출한다. 준비 전 장치 미사용, 실패 후 재시도, 준비 취소 후 늦은 응답, 장치 허가 중 방송 종료, 치명 오류 때 대기 음성 취소/이미 전사된 말 보존, 개별 오류 뒤 다음 발언을 검증한다. React 렌더링·네이티브 장치 수용 시험은 아니다.
- 첫 수정의 집중 15개는 `artifacts/recovery-first.log`, 실제 HTTP를 더한 18개는 `artifacts/recovery-http-first.log`, 최종 집중 24개는 `artifacts/recovery-verified.log`에서 통과했다. 준비 핸들러 4개까지 포함한 전체 487개와 TypeScript/Vite 빌드는 `artifacts/check-first.log`에 있다. 이후 제품 코드는 변경하지 않고 치명 오류/개별 구간 오류의 핸들러 검증 2개를 추가했다. 최종 통합 상태에서는 489개 전체 검사를 실행한다.

실제 Node 프로세스 복구를 실제 Whisper 모델·물리 음성 정확도나 장치 재연결의 합격으로 대체하지 않는다. 이번에 별도 AI 호출이나 모델 다운로드를 하지 않았다. 새 배포 패키지·설치 프로그램·사용자 실행본 반영과 실제 게임 중 복구는 후속 수용 대상이다. 다른 Windows 세션과 여러 장치 조합, 장기 부하도 남는다.

## 통합

자체 통합 worktree에서 필수 검사 후 main 상태·인덱스·원격·통합 잠금을 다시 확인하여 통합한다. 실제 결과는 `artifacts/microphone-integration-result.json`, 최종 소스와 Git 상태·증거 목록은 `artifacts/microphone-final-state.json` 및 `artifacts/microphone-evidence-manifest.json`에 기록한다. 푸시와 사용자 앱 재시작은 수행하지 않는다.

제품 커밋 `c4583aeb60f63c1e5bbb314fedcab6308e03696d`은 전용 통합 worktree `G:/dev/ai/00_game_backseat-worktrees/microphone-recovery-integration`의 독립적인 `npm ci` 후 **489개 Node 검사와 TypeScript/Vite 빌드**를 통과했다. 실제 하위 프로세스·HTTP 복구와 클라이언트 핸들러 검증도 이 코드에서 함께 실행했다. 원본은 양 worktree의 `artifacts/microphone-integration-check.log`이며, 통합 실행의 프로세스 보고서도 개발 worktree의 `artifacts/integration-process-evidence/`에 복사했다. 이 코드와 본 기록만 main fast-forward 대상으로 확정했다. 실제 HEAD 및 잠금 해제 결과는 별도 통합 결과 JSON에 남긴다.
