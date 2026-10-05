# Nagneon 개발 작업 지침

> 적용 저장소: `G:\dev\ai\00_game_backseat`
> 제품: Nagneon / 나그네온
> 이 파일은 제품 개발 작업의 저장소 정본이다. M1 협의 기록 자체는 제품 저장소 정본이 아니며 `G:\dev\ai\00_game_backseat-coordination`에만 보존한다.

## 1. 대상·정본·우선순위

- 대상 Windows hostname은 `MCKIM`이다. 장치명·hostname으로 Windows 계정을 추정하지 않는다.
- 제품 루트는 `G:\dev\ai\00_game_backseat`, M1 루트는 `G:\dev\ai\00_game_backseat-coordination`이다.
- 제품 작업은 `AGENTS.md` → `CLAUDE.md` → `CONTRIBUTING.md` → `README.md` → `SECURITY.md`와 작업 관련 `docs/`를 읽는다.
- 병렬 개발은 `docs/PARALLEL-DEVELOPMENT.md`, 릴리즈는 `docs/SERVICE-RELEASE-POLICY.md`, 기능 승격은 `docs/FEATURE-PROMOTION.md`, 설치·복구는 `docs/STABLE-INSTALLATION.md`를 따른다.
- 일반 GPT Chat·Codex·Work용 개발 시스템 프롬프트는 `docs/AI-DEVELOPMENT-SYSTEM-PROMPT.md`다.
- 과거 문서의 SHA·버전·PID·테스트 개수·heartbeat를 현재 상태나 새 실행 승인으로 재사용하지 않는다.
- 현재 사용자 요청·상위 지시·이 파일이 과거 일반 정책과 충돌하면 현재 범위의 더 구체적인 계약을 우선하고, 충돌을 숨기지 않는다.

## 2. 실행 환경별 작업 수단과 effort

### 2.1 실행 환경별 작업 수단

- **Codex·Work 작업에서는 Personal Commander 플러그인 사용을 금지한다.** ChatGPT Work도 여기에 포함한다. 파일·명령·컴퓨터 조작은 해당 실행 환경의 기본 도구로 직접 수행한다. 상태 조회·workspace 확인 등 읽기 전용 호출과 작업 준비에도 Personal Commander를 사용하지 않는다.
- Codex·Work의 M1 조회·작업도 기본 파일·명령 도구로 승인된 로컬 경로에서 수행한다. Personal Commander 서버를 셸·다른 플러그인으로 간접 호출하지 않는다.
- **일반 GPT Chat의 Windows 실무에만 Personal Commander를 사용한다.** 이 경우 RDC·WSL·다른 서버·임의 셸로 대체하지 않는다. 아래 Personal Commander 절차는 일반 GPT Chat에만 적용한다.
- 도구 선택은 모델명이 아니라 실제 실행 환경으로 구분한다. 플러그인이 노출되어 있어도 Codex·Work에서 사용하지 않으며, 도구 선택이 권한·A/B 역할·게시 범위를 바꾸지 않는다. 모든 환경에서 기존 경로·권한·안전 제한을 지킨다.

일반 GPT Chat의 Personal Commander 절차:

- 새 작업·재개 시 `get_status`, `list_workspaces`, 실제 함수 schema를 확인한다. 과거 다른 대화의 도구 개수·성공을 현재 가용성으로 추정하지 않는다.
- 제품 루트·M1 루트·자기 worktree는 정확한 workspace binding과 권한을 확인한 뒤 사용한다. 일반 workspace의 `writable=true`를 다른 루트 권한으로 확대하지 않는다.
- 파일 API에는 workspace-relative path만 사용한다. `..`·junction·symlink·WSL·절대경로 우회로 등록 루트 밖을 접근하지 않는다.
- 신규 파일은 `write_file(expected_sha256="missing")`, 기존 교체는 최신 SHA, 국소 변경은 `edit_block`의 SHA+occurrence를 사용한다.
- 명령은 등록된 program alias만 사용하고 고유 request_id를 준다. `start_process`의 시작 응답/PID는 완료가 아니며 `read_process_output`의 terminal state·exit_code까지 확인한다.
- 실행 program은 OS 계정 권한을 가지며 workspace는 execution sandbox가 아니다. 현재 승인 범위를 코드·명령 안에서도 지킨다.
- 안전·권한 차단은 다른 도구·셸·사용자·AI로 우회하지 않는다. 일반 기술 오류는 반영 지점과 정확한 오류를 확인하고 정상 방법으로 수정한다.

### 2.2 effort 정책

effort는 작업 단계의 추론·검토 깊이이며 권한·게시 범위·A/B 역할을 바꾸지 않는다.

- **Pro**: 계획, 요구 분석, 설계, 아키텍처·공통 계약, 대안 비교, 독립 리뷰, RFC/ADR, 최종 증거 검토.
- **xhigh**: 실제 구현, 파일/schema 수정, 테스트 작성·실행, 실패 분석·수정, build·수용 검증.
- 혼합 작업의 기본 흐름은 `Pro 계획/설계 → Pro 독립 검토 → xhigh 구현 → xhigh 테스트/수정 → Pro 최종 검토`다.
- effort 선택 기능이 현재 실행 표면에 실제 노출될 때만 사용한다. 없는 파라미터를 만들거나 모델·제공자를 자동 전환하지 않는다.
- 실행 환경별 도구 규칙을 특정 모델에 묶지 않는다. 사용자가 선택한 모델·기존 설정을 유지한다.

## 3. M1 다중 세션 협의

- 여러 Chat·실무 AI의 중복 설계, 공통 계약, 시간·취소·저장·가시성, 단계 의존성이 관련되면 M1을 사용한다.
- 작업 착수/재개, 설계 확정, 공유 계약 변경, 제품 commit 준비, 인계, B 통합 직전에 관련 task/topic/contract/decision/revision을 조회한다.
- 조회는 순수 조회다. 읽기 중 participant 등록·seen·ACK·cursor·heartbeat를 숨겨 기록하지 않는다.
- 사용자 확정 요구, 실제 코드 사실, 각 세션의 제안·가정, 구현·검증·통합·설치 상태를 분리한다.
- 제안은 목표·대안·영향·공통 계약·생산자/소비자·의존성·검증·실패 조건·질문을 담는다.
- 검토는 정확한 subject ID + revision + content hash + 기반 SHA + contract read set에 묶는다.
- `stored/published`는 로컬 저장, `seen`은 읽음, `acknowledged`는 영향 확인, `reviewed`는 검토 제출, `applied`는 구현·검증 근거가 있는 적용이다.
- ACK는 승인·찬성이 아니며 `accepted`는 설계 채택일 뿐 구현·merge·설치 완료가 아니다.
- participant ID·표시명·self-reported binding은 인증이 아니다. 무응답·다수결·모델명·동일 세션의 다역 리뷰를 독립 합의로 세지 않는다.
- 선택 기능 부재가 기본 경로를 막지 않게 하고, 순환 의존은 최소 계약·adapter·fixture·통합 순서 분리로 해소한다.
- 실제 M1 연산·CLI가 unavailable이면 empty/무쟁점으로 처리하지 말고 최소 협의 패킷으로 전환한다.

### 3.1 M1 로컬 전용

다음 자료는 `G:\dev\ai\00_game_backseat-coordination`에서만 보존한다.

- 의견·질문/답변·설계·반례·리뷰·RFC·ADR·계약 사본·결정
- participant/task/topic·dependency·claim·ACK
- 원장·objects·view·로그·backup·export·협의 인계문과 그 요약

이 자료를 제품 저장소·worktree·PR·이슈·commit 메시지·CI·릴리즈·클라우드 문서에 복사·게시하지 않는다.
파일명 변경·요약·압축·인코딩으로 제한을 피하지 않는다.
제품 문서에는 검증된 구현의 동작·사용법·검사 결과만 기록한다. 협의 원문·반론·작업자 신원·M1 인계 요약을 자동 승격하지 않는다.
계약 revision/hash와 제품 commit의 대응은 M1 로컬에 남긴다.
M1 도구 소스도 현재 M1 범위에서는 자동 원격 게시하지 않는다. 별도 명시적 범위 없이 제품 branch와 함께 push하지 않는다.

## 4. Git·worktree·A/B 실행 역할

- 제품 변경은 작업별 branch와 별도 worktree에서 수행한다. 공유 main에서 제품을 직접 수정하지 않는다.
- 시작 시 `git status --short --branch`, `git worktree list --porcelain`, 기준 전체 SHA·git-common-dir·소유권을 확인한다.
- 타인의 미커밋 변경·인덱스·stash·프로필·모델·빌드 결과를 보존한다. `reset --hard`, `clean`, 강제 checkout, 자동 stash/pop으로 정리하지 않는다.
- node_modules·data·dist·포트·프로필·artifacts도 worktree별로 격리한다.
- **A/B는 AI의 고정 신원이 아니라 현재 과제의 실행 역할이다.** 일반 GPT Chat/Personal Commander는 기본적으로 A에서 시작한다.
- 같은 Chat이라도 사용자가 현재 과제에 push·PR·merge/main 통합·릴리즈·설치·배포·실제 반영 중 해당 단계를 명시적으로 맡기면 그 범위에서 B를 직접 인수할 수 있다. 앞선 대화에서 이 단계들을 포함하는 end-to-end 완료 범위를 합의했고 사용자가 그 계약을 명시적으로 수용한 경우도 같다.
- 단순한 `계속`, `완수`, `가능한 만큼`만으로는 B로 전환하거나 게시·설치 범위를 확대하지 않는다. 사용자가 A-only/commit-only/비게시를 지정하면 그 제한을 우선한다.
- B 인수는 새 비용·공개 범위 확대·파괴적 데이터 변경·권한 상승·비밀 접근의 포괄 승인으로 해석하지 않는다. 기존 G4·보안·데이터·릴리즈 경계를 그대로 유지한다.
- 통합 잠금 `ai-integration.lock`은 실제 B 통합 단계에서만 사용한다. A는 선점하지 않는다.

### 4.1 A — 기본 로컬 개발 역할

A는 조사 → M1 정합 확인 → 격리 worktree/branch → 수정 → 로컬 검증·빌드·문서 정합 → **로컬 commit** → 전체 SHA·Git 상태 확인까지 수행한다.

현재 사용자 범위에 B 단계가 명시되지 않았다면 A는 다음을 수행하지 않는다.

- push·PR 생성/수정·merge
- 통합 목적 main pull/최신화
- 릴리즈·배포 전송·실사용 앱 교체/재시작
- 운영 데이터 변경
- 시험 push·dry-run·hook·CI·다른 AI 기동으로 위 단계를 간접 실행

`docs/PARALLEL-DEVELOPMENT.md`의 “항상 작업 branch를 push” 일반 규칙은 A에는 적용하지 않는다. A에서 끝나는 과제는 검증된 로컬 commit 상태를 보존하고, 실제 후속 담당이 있을 때만 인계한다.

### 4.2 B — 명시적으로 위임된 통합·반영 역할

B는 별도 AI일 수도 있고, 사용자가 현재 과제의 통합·반영 단계까지 직접 맡긴 **같은 ChatGPT/Personal Commander**일 수도 있다. 같은 Chat이 B를 인수할 때 별도 AI 인계는 필수가 아니다.

B의 첫 게시·통합·반영 동작 전에는 다음을 다시 확인한다.

1. 현재 사용자 요청에 포함된 정확한 B 범위와 제외 항목, 관련 M1 task/topic/contract/decision의 최신 revision/hash·미해결 쟁점.
2. 실제 remote·기준/대상 branch·HEAD·worktree·dirty/index·소유권과 미게시 commit 이력.
3. `ai-integration.lock` 소유권, 보호 브랜치/허용된 PR 경로, required checks와 기존 CI·보안 게이트.
4. stage·diff·commit 메시지·미게시 이력·패키지에 M1 자료·비밀·개인 데이터가 섞이지 않았는지.
5. 릴리즈/설치가 실제 변경 성격상 필요한지와 `SERVICE-RELEASE-POLICY`·`STABLE-INSTALLATION`의 패키지·프로필·복구 조건.

승인된 B 흐름은 `보완/재검증 → 작업 branch 일반 push → 허용된 PR/작업 단위 통합 → 보호 규칙과 필수 검사 충족 → main 안전한 최신화 → 통합 SHA 재검증 → 필요한 경우에만 패키징·설치/릴리즈 → 실제 버전·기능·사용자 경로 검증` 순서다.

B도 직접 기준 브랜치 push·force-push·보호 우회·타인 dirty 삭제를 하지 않는다. M1 협의 기록·M1 도구 commit·로컬 export를 제품 게시 이력에 섞거나 원격으로 보내지 않는다.
문서·정책·테스트·M1 내부 변경만으로 새 앱 버전·패키지·설치·사용자 앱 재시작을 강제하지 않는다.
필수 검사 실패, 보호 규칙/권한 불충족, 최신 상태 불명, 통합 잠금 충돌, M1 혼입 의심이 있으면 해당 B 단계만 보류하고 안전하게 독립 가능한 작업과 증거 정리는 계속한다.
## 5. 제품 불변 조건

- UI·오류 안내는 한국어를 우선한다. 제품 표기는 Nagneon/나그네온이다.
- 내부 `backseat` 저장 키·프로토콜·프로필 경로는 호환성 계약일 수 있으므로 단순 치환하지 않는다.
- 새 프로필의 시작 200P와 기존 기록·잔액 보존을 구분한다.
- 정해진 시즌/director 시나리오를 다시 강제하지 않는다.
- `server/index.js`의 `studio.attachRuntime()` 단일 조립을 유지하고 state/stop을 여러 겹 재대입하는 구조를 재도입하지 않는다.
- 요청 준비·모델 호출·응답 수용·기록을 구분하고 방송 세대·취소·큐·관객별 목격 범위를 보존한다.
- 일반 방송 중지와 앱 전체 종료를 구분한다. 한 연결의 해제 실패가 전체 정리를 막지 않게 한다.
- AI 라우팅은 요청 단위다. 관객별 호출 분할이나 임의 대체 제공처를 자동 도입하지 않는다.
- 서버는 127.0.0.1과 프로세스별 인증 경계를 유지한다. 포트 포워딩·공개 reverse proxy로 노출하지 않는다.
- 공식 CLI 인증을 사용하고 `auth.json`·토큰·키·쿠키·전체 환경변수를 직접 읽거나 기록하지 않는다.
- 선택 화면·전사·대화가 제공처에 전달될 수 있으므로 완전 오프라인이라고 설명하지 않는다.

## 6. 로컬 검증·보안

- 자기 worktree에서 `npm ci` 후 `npm run check`를 수행한다. `check`의 `format:check → test → build`를 별도 테스트/빌드 통과로 대신하지 않는다.
- 관련 회귀를 추가하고 `npm audit --audit-level=high`, Windows/보안 CI 항목을 변경 영향에 맞게 확인한다.
- 인증 변경은 `node scripts/verify-account-device.mjs`와 Electron `scripts/verify-account-runtime.cjs` 절차를 따른다.
- 기기 코드는 빈 CODEX_HOME에서 발급·취소까지만, 기존 계정 검증은 `--existing-account`와 격리 프로필을 사용한다.
- 테스트·앱·로그는 `--backseat-profile=<자기 절대경로>`와 작업별 artifacts/포트/data로 격리한다.
- 합성 offscreen 검사와 실계정·물리 장치·설치 검증을 구분한다.
- 실제 M1 협의 데이터, 사용자 대화·녹화·화면·음성을 fixture로 사용하지 않는다.
- `--no-verify`, hook 해제, 테스트 skip, 단언 약화로 필수 검증을 우회하지 않는다.
- commit 전 `git diff --cached`로 비밀·M1 자료·무관한 파일 혼입을 확인한다.

## 7. 릴리즈·설치

- `docs/SERVICE-RELEASE-POLICY.md`를 일반 릴리즈 기준으로 사용한다.
- 문서·정책·테스트·M1 내부 변경만으로 새 Nagneon 버전·패키지·사용자 앱 재시작을 강제하지 않는다.
- 제품 변경은 최신 통합 SHA의 필수 검사와 관련 실제 회귀를 통과한 뒤 패키지 설치/업데이트·시작/중지/종료/재시작·데이터 보존·복귀를 확인한다.
- `docs/STABLE-INSTALLATION.md`, `scripts/package-windows.mjs`, `Install-NagneonRelease.ps1`, `Start-InstalledNagneon.ps1`, `Profile-Compatibility.ps1`의 현행 계약을 따른다.
- 게시된 태그·파일·현재 사용자 기록을 덮어쓰지 않는다.

## 8. 인계·보고

최종 답변은 완료 내용·검증 결과·실제로 남은 항목을 간결하게 보고한다.
다른 AI가 이어서 수행할 구체적인 작업을 실제로 인계할 때만 짧은 요약 뒤 **하나의 Markdown 코드 블록**에 복사·붙여넣기용 인계 전문을 제공한다. 현재 Chat이 B까지 직접 위임받아 남은 통합·반영을 완료한 경우에는 별도 AI 인계문을 만들지 않는다. A에서 종료하고 다른 B가 필요한 경우에만 로컬 commit과 정확한 재개 지점을 인계한다.
실제 인계할 작업이 없으면 완료 보고만 제공하며 인계문·빈 인계 양식·복사·붙여넣기용 문서를 덧붙이지 않는다. 참고용 미해결 항목이나 사용자 설정 안내가 있다는 이유만으로 인계문을 만들지 않는다.
사용자가 인계문이나 재사용 문서를 명시적으로 요청한 경우에는 요청한 형식으로 제공한다.
인계문이 필요한 경우에는 파일 링크·“위 대화 참고”로 전문을 대신하지 않는다.

실제 인계문에는 다음을 해당 작업의 실제 값으로 포함한다.

- 제품 작업 / M1 로컬 작업 구분
- 목표·수용 기준·유지 결정·금지·A/B 역할
- MCKIM, 실제 실행 환경·도구·작업 경로, 제품/M1 경로 (일반 GPT Chat에서 사용한 경우에만 Personal Commander workspace 포함)
- 관련 M1 task/topic·contract revision/hash·read set·미해결 쟁점
- 제품 branch/worktree·기반/최종 전체 SHA·commit 목록·Git 상태
- 변경 파일·심볼·데이터/설정 영향
- 검증 위치·명령·exit code·증거·실패/미실행
- A에서 미실행한 push/PR/merge/설치와 B의 선행 조건·성공 기준·복구
- M1 기록 원격 게시 금지

인계문 제공·B 수신/착수·제품 통합/적용·M1 운영 완료를 서로 다른 상태로 보고한다.
확인하지 않은 원격 최신·설치 상태·다른 세션의 동의·실행 결과를 만들지 않는다.
