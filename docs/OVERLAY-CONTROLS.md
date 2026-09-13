# 오버레이 통과 중 조작과 투명도

2026-09-13 사용자 요청: 클릭 통과 중에도 토글을 클릭하고 오버레이 안에서 투명도를 변경한다.

- 작업: `fix/overlay-controls`, `G:/dev/ai/00_game_backseat-worktrees/overlay-controls`
- 기준: `443439ace75a8cca8f5bdfc5531f4516b53f884a`
- 선택한 통과 모드와 실제 마우스 무시 상태를 분리했다. Electron의 전달된 mousemove로 상단 버튼/투명도 영역을 감지해 해당 영역에서는 입력을 받는다. 채팅 영역에서는 통과를 복구한다.
- 슬라이더를 누른 채 영역 밖으로 이동해도 입력을 유지하며 release/cancel/blur 시 해제한다. IPC는 현재 오버레이의 메인 프레임에서 보낸 boolean만 처리한다.
- 투명도 0~90%, 5% 단위로 채팅·배경·하단·알림에 즉시 적용한다. 조작 영역은 계속 보인다. 오버레이를 새로 열면 0%로 시작한다. 운영체제 전체 창 opacity를 낮추지는 않는다.
- 창 종료/재개방 시 통과 표시를 갱신하고 Ctrl+Shift+F10을 유지한다.
- `npm ci`, `node --check desktop/main.cjs`, `node --check desktop/preload.cjs`, `npm run check` 통과. Node 검사 267/267, TypeScript/Vite 빌드 성공.
- 증거: 이 worktree의 `artifacts/install.log`, `artifacts/overlay-controls-check.log`. 추가 테스트 `test/overlay-input.test.js`는 실제 컨트롤러와 preload를 모의 창/DOM 이벤트로 실행한다.
- 사용자 테스트 보호 지침에 따라 화면/창 조회, 사용자 입력, GUI 실행, 앱 재시작은 하지 않았다. Windows 네이티브 클릭 전달 및 시각적 슬라이더 수용 검증은 미완료다. 사용자 앱 재시작 후 반영되며, 별도 허용 뒤 실제 클릭 검증이 다음 단계다. 원격 푸시는 하지 않는다.
