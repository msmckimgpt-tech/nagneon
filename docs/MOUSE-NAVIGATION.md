# 마우스 측면 버튼으로 화면 이동

Windows에서 마우스의 뒤로/앞으로 버튼으로 방문한 주 화면을 한 단계씩 이동합니다.
방송실, 나의 관객, 방송 밖 이야기, 핫클립, AI 대시보드와 속마음 화면이 같은 방문 이력을 사용합니다.
처음/끝에서는 화면을 유지하며, 같은 화면을 다시 선택해도 이력이 늘지 않습니다.
뒤로 간 다음 다른 화면을 열면 남아 있던 앞으로 이력을 버립니다.

이력은 창을 사용하는 동안 최대 100개를 보관하며 재실행/새로고침 시 방송실부터 시작합니다.
설정 대화상자와 커뮤니티 내부 섹션은 별도 이력 항목이 아닙니다.
오버레이 입력은 주 창을 이동시키지 않으며 외부 URL이나 Chromium 페이지 이력을 사용하지 않습니다.
저장 파일·기존 관객·잔액·프로필 형식은 변경하지 않습니다.

Electron의 `app-command`를 주 창에서만 구독하고 제한된 IPC 방향을 renderer에 전달합니다.
Windows 명령 없이 DOM의 측면 버튼 입력만 보내는 마우스도 지원합니다.
버튼 3/4의 mouseup에서 이동하고 mousedown/mouseup/auxclick의 기본 페이지 이동은 막습니다.
서로 다른 입력 경로에서 같은 방향이 250ms 안에 들어오면 한 입력으로 묶으며,
버튼을 누르고 있는 동안 도착한 Windows 명령도 놓을 때 중복 이동하지 않습니다.
같은 경로의 빠른 연속 클릭은 각각 처리합니다.
장치 프로그램이 버튼을 다른 동작으로 재매핑한 경우 Windows 뒤로/앞으로 명령을 보내도록 설정해야 합니다.

검증 명령:

```powershell
npm.cmd ci
node.exe --test test/navigation-input.test.js
npm.cmd run check
npm.cmd audit --audit-level=high
node.exe -e "const {spawnSync}=require('node:child_process');const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=spawnSync('node_modules/electron/dist/electron.exe',['scripts/verify-navigation-runtime.cjs'],{env,stdio:'inherit',windowsHide:true});process.exit(r.status??1)"
```

런타임 검사는 격리 프로필·합성 상태·숨겨진 Electron 창에 Windows `WM_APPCOMMAND`를 보내
네이티브 이벤트→preload→실제 React 화면까지 검사합니다. 결과는 `artifacts/navigation-runtime-*/result.json`에 남습니다.
물리 마우스 클릭과 설치본 검증을 대신하지 않습니다. 실제 장치에서는 방송실→나의 관객→방송 밖 이야기 후
뒤로 두 번/앞으로 두 번, 경계 입력, 뒤로→핫클립→앞으로, 오버레이 입력을 확인합니다.

코드 복귀 시 이 기능 커밋을 되돌릴 수 있으며 데이터 마이그레이션은 필요하지 않습니다.
