# 개발 안내

## 코드 흐름

1. `src/App.tsx`는 방송실과 각 화면을 조합한다. 사용자 동작은 `src/api.ts`로 로컬 서버에 전달한다.
2. `server/index.js`는 인증된 루프백 HTTP 요청, 저장소, 외부 연결의 수명을 관리한다.
3. `server/studio.js`는 방송 상태, 요청 취소, 관객 반응과 메시지 전달을 조정한다.
4. `Studio.publish()`가 상태를 내보내면 `server/state-stream.js`가 SSE로 전달하고, `src/useStudioState.ts`가 화면에 반영한다.
5. `desktop/main.cjs`는 Electron 창·계정 연결·앱 종료를 관리한다. 음성 워커는 사용자가 마이크를 준비할 때 시작한다.

`index.js`는 `studio.attachRuntime()` 한 곳에서 외부 연결의 상태와 종료 작업을 연결한다. `state()`나 `stop()`을 감싸서 다시 대입하지 않는다. 방송 종료는 먼저 실행 중 요청과 큐를 취소하며, 연결 하나의 해제 실패가 나머지 정리를 막지 않는다.

## 작업과 검사

### 반응 처리 책임

`Studio.reactInput()`은 호출 순서·실행 중 상태·취소·오류와 최종 정리를 관리한다. 세부 처리는 다음 메서드에서 확인한다.

- `prepareReactionViewing()`: 프레임 시간·목격자·소리·채팅 변화와 동일 입력의 재호출 여부.
- `reactRehearsal()`: 계정 호출 없는 기본 리허설 응답.
- `prepareLiveReaction()`: 관객별 목격 범위·관련 기억·훈수 정책과 모델 요청 컨텍스트.
- `acceptLiveReaction()`: 방송 세대·취소·화면 유효 시간·전사 교정 확인 후 응답 수용. 조기 종료 결과와 진단 결과를 호출자에게 함께 반환한다.
- `recordReactionExperience()`: 수용된 반응의 가상 후원·관객 변화·클립·지식 저장. 조용한 동행이나 거절된 반응은 이 단계로 진입하지 않는다.

요청 준비와 응답 수용 사이에는 모델 호출을 기다리는 구간이 있다. 관객 방문 시각과 요청 당시의 기억·외부 채팅 ID를 보존하고, 응답 시점의 방송 상태를 다시 검사한다. 관련 회귀 검사는 `temporal-viewing`, `viewing-continuity`, `reaction-diagnostics`, `community-lore`, `speech-flow`에 있다.

### 명령

작업별 worktree에서 `npm ci`로 의존성을 설치한다. 저장 프로필·포트·빌드 결과·로그는 다른 작업과 공유하지 않는다. 상세 통합·원격 게시 규칙은 [병렬 개발](PARALLEL-DEVELOPMENT.md)을 따른다.

```powershell
npm run format
npm run check
```

`check`는 주요 진입점의 서식 검사, 서버 회귀 검사, TypeScript 검사와 Vite 빌드를 수행한다. 서식 대상은 현재 `App.tsx`, `style.css`, `types.ts`, `studio.js`, `index.js`다. 새 모듈도 고정된 Prettier 설정으로 정리하며, 기존 모듈은 관련 수정 때 점진적으로 편입한다. 포매터는 개발 의존성으로만 설치한다.

실제 UI 검사는 `scripts/verify-nagneon.cjs`를 격리 Electron에서 실행한다. 이 검사는 합성 프로필을 사용하며 실제 계정·마이크·OBS 검증을 대신하지 않는다. 결과와 캡처는 작업 worktree의 `artifacts/nagneon/`에 저장된다.

### 개발 저장량 수명 관리

패키징과 실행 구성 생성은 같은 입력을 반복 실행했을 때 새 타임스탬프 사본을 계속 만들지 않아야 한다. `package-windows.mjs`는 소스·lockfile·Electron/Codex·layout/runtime뿐 아니라 패키징 recipe 코드, 아이콘, Codex 실행 파일·관련 라이선스 자산까지 입력 지문에 포함한다. 이 전체 지문이 같고 파일 목록·크기·SHA-256이 다시 검증된 패키지만 재사용한다. 새 패키징은 `artifacts/package-scratch/`에서 트랜잭션으로 조립한 뒤 최종 `release/<run>/app`만 게시한다. 성공한 stage/runtime scratch는 게시 직후 제거하며 실패 scratch는 보존하고 다음 대형 패키징을 차단한다. 검증된 서로 다른 package 후보는 2개까지만 자동 생성하며 그 이후에는 명시적인 저장량 검토가 필요하다.

`build-runtime-packs.mjs`는 `artifacts/runtime-packs/`의 content-addressed pack/cache와 입력 catalog를 재사용한다. 같은 catalog 재실행은 새 디렉터리를 만들지 않으며 서로 다른 검증 catalog는 2개를 넘겨 자동 생성하지 않는다. 실행 전후 여유 공간과 store 크기를 출력하고, 실패 scratch가 남으면 다음 생성은 중단된다. `prepare-speech-runtime.ps1`이 새로 만드는 speech runtime도 소유권 표식을 남기며 완료 후보를 2개로 제한한다. 소유권 표식이 없거나 형식이 다른 기존 산출물은 자동 정리 대상으로 승격하지 않는다.

저장 정리는 기본적으로 조회만 한다.

```powershell
npm run storage:preview
node scripts/storage-maintenance.mjs --reserve-package-slot --reserve-runtime-slot --reserve-speech-slot --plan=artifacts/storage-cleanup-plan.json
node scripts/storage-maintenance.mjs --apply --plan=artifacts/storage-cleanup-plan.json --plan-sha256=<preview가 출력한 SHA-256>
```

`--apply`는 정확한 plan SHA, 현재 HEAD/origin-main 기준, 소유권 표식, 경로·링크, 실행 중 프로세스를 다시 확인한 뒤에만 계획에 적힌 항목을 제거한다. 계획 이후 상태가 바뀌거나 확인이 불완전하면 중단한다. 설치본·사용자 프로필·원본 `.models`·일반 `artifacts` 증거는 일반 정리 후보가 아니다. 통합 완료 worktree의 재생성 가능한 `node_modules`·`dist` 등은 [병렬 개발](PARALLEL-DEVELOPMENT.md)의 종료 절차에서 별도로 preview한 뒤에만 정리한다.

패키지 manifest의 `storage`와 CLI snapshot은 최종 배포 크기와 transient stage/runtime 크기를 분리해 기록한다. 전후 비교에서는 상위/하위 폴더를 중복 합산하지 않고, 합성 fixture 크기를 실제 디스크 절감량으로 보고하지 않는다.

## 코드와 설명 규칙

- 사용자 화면과 오류 안내는 한국어로 작성한다. 코드 식별자와 외부 API 이름은 영어를 사용한다.
- 새 주석은 필요한 이유·불변 조건·실패 처리를 설명한다. 프로젝트 동작 설명은 한국어를 우선하되, 외부 API 용어나 기존 모듈의 영어 설명을 무리하게 번역하지 않는다.
- 저장 형식을 바꿀 때 기존 기록·설정 읽기, 실패 시 원본 보존, 이전 버전 복귀 영향을 확인한다. 자동 초기화로 오류를 숨기지 않는다.
- 테스트에는 검증하는 실패·경계 동작을 담는다. 문자열 서식이나 구현 자체를 그대로 재현하는 검사는 피한다.
- 큰 모듈에서는 요청 준비·호출·결과 적용·취소를 구분한다. 서버가 조립한 관객별 목격 범위와 개인정보 제한을 모듈 분리 중에도 유지한다.

배포는 [안정성·유지보수 정책](SERVICE-RELEASE-POLICY.md)에 따라 실제 패키지 실행·업데이트·데이터 보존을 확인한다. 내부 정리만으로 새 패키지 배포를 강제하지 않는다.
