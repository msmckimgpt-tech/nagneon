# 마우스 측면 버튼과 세부 화면 이동

뒤로/앞으로 버튼, 상단의 이전/다음 화면 버튼, `Alt+←` / `Alt+→`는 같은 방문 이력을 사용합니다. 주 화면뿐 아니라 방송 설정의 범주, 방송/바깥 커뮤니티, 게시글·검색·필터·페이지, 글쓰기, 핫클립 상세도 이동 대상입니다. 같은 경로를 다시 선택하면 이력을 늘리지 않으며, 뒤로 간 뒤 새로운 화면을 열면 이전 앞으로 이력을 버립니다.

현재 화면은 주소의 hash에 표시됩니다. 예를 들어 `#/community/outside?community=indie`, `#/community/broadcast?post=<게시글 ID>`, `#/clips?clip=<클립 ID>`, `#/manager?settings=games`입니다. 직접 열기와 새로고침은 해당 세부 화면을 다시 엽니다. 새 창을 기본 주소로 실행하면 방송실에서 시작합니다. 설정 초안·API 키·방송 입력은 주소와 방문 이력에 저장하지 않습니다.

게시글과 핫클립 상세에서는 목록을 숨기고 상세 화면을 표시합니다. 화면 제목·상단 경로·선택 표시도 함께 바뀝니다. 새 화면은 위에서 시작하고 제목에 포커스를 둡니다. 목록으로 돌아가면 방문 위치와 선택했던 항목의 포커스를 복원하며, 일반 상태 갱신은 사용자의 읽기 위치를 움직이지 않습니다. 복원 위치의 메모리 캐시는 최대 100개입니다. 목록을 비동기로 불러오는 동안에는 위치 복원을 기다리되, 사용자가 휠로 이동하면 자동 복원을 멈춥니다.

설정 탭 이동 및 뒤로/앞으로에서는 미저장 초안을 메모리에 유지합니다. 뒤로로 설정을 벗어나도 앞으로로 다시 열면 초안이 남아 있습니다. **취소·닫기, X, Escape는 저장하지 않고 초안을 버리며**, 설정 저장은 명시적으로 저장한 뒤 닫습니다. 새로고침은 메모리 초안을 보존하지 않습니다. 설정을 직접 연 주소에서 닫으면 배경 화면에 머뭅니다. 설정 범주별 스크롤도 창의 초안 세션 안에서 복원합니다.

화면 선택·후원 내역 같은 임시 대화상자는 뒤로를 닫기/취소로 처리하며, 앞으로로 배경 화면을 움직이지 않습니다. 오버레이는 주 창의 이력에 참여하지 않습니다. 이 변경은 방송 시작·중지·장치 연결이나 저장 파일·기존 관객·잔액·프로필 형식을 변경하지 않습니다.

Electron의 `app-command`는 주 창에서만 구독하여 방향을 renderer에 전달합니다. Windows 명령 없이 DOM 측면 버튼 입력만 보내는 마우스도 지원합니다. 버튼 3/4의 mouseup에서 이동하고 mousedown/mouseup/auxclick의 기본 이동은 막습니다. 서로 다른 입력 경로의 같은 방향이 250ms 안에 들어오면 한 입력으로 묶고, 같은 경로의 빠른 연속 클릭은 각각 처리합니다. 장치 프로그램에서 다른 동작으로 재매핑했다면 Windows 뒤로/앞으로 명령을 보내도록 설정해야 합니다.

검증 명령:

숨김 폴더(`.codex` 등)의 worktree에서는 `TEMP`/`TMP`를 worktree 내부 정규 경로로 유지하고, `NAGNEON_TEST_MEDIA_TMPDIR`에는 같은 디렉터리의 기존 Windows 짧은 경로를 지정할 수 있습니다. 이 변수는 내부 PNG 첨부의 HTTP 읽기 fixture에만 적용되어 Express의 기본 숨김 디렉터리 제한과 클립의 정규 경로 보호 검사를 함께 유지합니다. 필요하면 `NAGNEON_TEST_POWERSHELL`로 설치된 검증용 PowerShell 실행 파일을 명시합니다.

```powershell
npm.cmd ci
node.exe --test test/navigation-input.test.js test/page-route.test.js
npm.cmd run check
npm.cmd audit --audit-level=high
node.exe scripts/verify-page-navigation.cjs
node.exe -e "const {spawnSync}=require('node:child_process');const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=spawnSync('node_modules/electron/dist/electron.exe',['scripts/verify-community-scroll.cjs'],{env,stdio:'inherit',windowsHide:true});process.exit(r.status??1)"
node.exe -e "const {spawnSync}=require('node:child_process');const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=spawnSync('node_modules/electron/dist/electron.exe',['scripts/verify-navigation-runtime.cjs'],{env,stdio:'inherit',windowsHide:true});process.exit(r.status??1)"
```

세부 화면 검사는 격리 프로필·합성 게시글/오디오·숨겨진 Electron 창·별도 loopback 서버를 사용합니다. 실제 preload/React/서버를 통해 반복 뒤/앞, 직접 열기, 새로고침, 초안·취소·저장, 임시 모달, 1280×900/520×740 창, 키보드·포커스·스크롤, 데이터 갱신, 오버레이 격리를 검사합니다. 실계정이나 모델, 사용자 화면·음성·방송 기록은 사용하지 않습니다. 세부 경로 기능이 도입되기 전 커밋의 UI를 별도로 빌드해 전후 스크린샷을 남깁니다. 다른 기준은 `NAGNEON_NAVIGATION_BASELINE`으로 지정하며, 결과에 실제 기준 SHA를 기록합니다.

결과는 `artifacts/page-navigation-*/result.json`, `artifacts/community-scroll-*/result.json`, `artifacts/navigation-runtime-*/result.json`에 실행별로 남습니다. 물리 마우스 및 설치본 검증을 대신하지 않습니다. 설치 이후에는 실제 측면 버튼과 장치 드라이버, 현재 운영 기록의 세부 링크를 별도로 확인해야 합니다. 코드 복귀에 데이터 마이그레이션은 필요하지 않습니다.
