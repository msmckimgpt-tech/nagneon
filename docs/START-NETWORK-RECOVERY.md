# 시작 중 네트워크 서비스 종료 복구

2026-09-13 사용자 제보: `Start-Backseat.cmd` 실행 중 `Network service crashed or was terminated, restarting service.` 출력.

## 확인한 범위

실행 경로는 `npm run build && electron .`, 설치 Electron은 44.3.0이다. 기존 `main.loadURL()`의 단 한 번 실패가 시작 오류 처리와 앱 종료로 이어진다. 따라서 Chromium이 네트워크 서비스를 재시작해도 초기 탐색 실패로 앱이 종료될 수 있었다. 기존 desktop 로그에서 제보 시점의 상세 원인을 찾지 못했으며 해당 시간 범위 Windows Application 이벤트 조회에서도 일치하는 기록을 확보하지 못했다. 원래 네트워크 프로세스의 종료 원인은 미확정이다.

## 변경

- 최초 메인 화면 탐색의 일시적 네트워크 오류에 0.5/1/1.5초 간격으로 최대 3회 재시도한다. 계속 실패하면 기존 시작 오류를 표시한다.
- 인증서 오류와 일반 탐색 취소는 재시도하지 않는다. 네트워크 서비스 종료가 해당 탐색 도중 관측된 취소만 재시도한다.
- 종료 중이거나 창이 닫혔으면 탐색을 중단한다. 시작 후 방송 화면을 자동으로 새로고침하지 않는다.
- Electron `child-process-gone`에서 Network Service의 사유/종료 코드/버전을 `<userData>/logs/network-recovery.jsonl`에 기록한다. 약 1MiB마다 이전 파일 한 개로 회전한다. URL, 토큰, 대화, 설정은 기록하지 않는다. 사용자 지정 `--backseat-profile` 경로도 따른다.
- 샌드박스, GPU, 캐시, 사용자 데이터와 실행 중 앱은 변경하지 않는다. Chromium 원문 메시지를 숨기지 않는다.

API 근거: https://www.electronjs.org/docs/latest/api/app#event-child-process-gone

## 검증과 적용

작업: `codex/start-network-recovery`, 기준 `697afcd8402c3d9e0d3647554759fa144ccc5bb4`, 별도 worktree `G:/dev/ai/00_game_backseat-worktrees/start-network-recovery`.

`npm ci` 성공. `node --test test/network-recovery.test.js` 6개 통과. `npm run check` 전체 431개 검사, TypeScript 및 Vite 빌드 통과. 원본 로그는 해당 worktree의 `npm-ci.log`, `check-network-recovery.log`에 있다. 검사에서는 Electron/화면/장치를 실행하지 않고 이벤트와 탐색 실패를 모의했다.

원본 main이 동일 기준이며 깨끗한 상태임을 확인하고 통합 잠금 아래 검증된 커밋을 fast-forward 적용한다. 푸시는 요청 범위에 포함되지 않는다. 실행 중인 앱에는 재시작을 적용하지 않는다.

남은 확인: 사용자가 다음에 실행할 때 초기 로딩 복구 여부와 메시지 재발 여부를 확인해야 한다. 재발하면 위 진단 파일의 종료 사유와 종료 코드로 원인 조사를 이어간다. 이번 변경은 초기 로딩 복구 보강이며 네트워크 프로세스 충돌 자체의 해결이나 실제 실행 합격을 주장하지 않는다.
