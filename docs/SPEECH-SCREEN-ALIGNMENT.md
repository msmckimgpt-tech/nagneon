# STT와 발화 화면 정합

2026-09-23. 기준 코드 `05bae01c7595481269b6fc3a693a52555384bede`에서 지연된 마이크 STT와 모델에 전달되는 화면의 시간 순서를 보강했다.

## 동작

마이크 발화는 STT 처리 전에 기존 `speechWindow()`로 발화 구간 화면을 최대 3장 고정한다. 모델 요청에서는 이 발화 시점 화면을 최신 라이브 화면보다 먼저 첨부하고, 이후 최신 화면을 이어 붙인다.

화면 메타데이터의 `speechScreen.frames[].index`와 `screenTimeline.frames[].index`는 최종 첨부 순서를 가리킨다. 과거 발화 화면이 3장이고 현재 화면이 1장이면 각각 1~3번과 4번을 사용한다.

현재 라이브 화면은 제거하지 않는다. 기존 viewing cursor·현재 장면 연속성·클라이언트 acknowledge 경로를 보존하면서, "이거/여기/방금"처럼 발화 당시 대상을 참조할 때 시간상 먼저 발생한 화면 근거가 모델 입력에서도 먼저 나타나게 한다.

현재 화면이 없고 발화 당시 화면만 있는 요청도 실제 이미지 입력이므로 `hasImage=true`로 전달한다.

## 변경하지 않은 계약

- 화면 캡처 주기, 발화 화면 최대 3장, STT 큐와 SpeechInbox wire schema를 변경하지 않았다.
- 게임 화면과 스트리머의 로컬 미리보기에 고정 지연을 추가하지 않았다.
- 요청 단위 provider routing, 관객별 목격 범위, 방송 취소·세션·source expiry 규칙을 변경하지 않았다.
- 지연 STT에 맞춰 모든 대화·기억·소리 문맥을 과거 시점으로 되감는 기능은 이번 변경에 포함하지 않았다. 이 단계는 별도의 공통 시간/가시성 계약 검토가 필요하다.

## 검증

작업 worktree에서 다음을 확인했다.

- `node --test test/speech-screen.test.js test/contextual-media-instructions.test.js test/provider-routing.test.js`: 21/21 통과.
- `npm run check`: format:check → 전체 692/692 테스트 → TypeScript/Vite build 통과.
- Vite build: 1,648 modules, 6.54s.
- `npm audit --audit-level=high`: 취약점 0건.
- `git diff --check`: 종료 코드 0.

통합 후보 `3c644d08077f229aabd7c9655a993f6a6e3674db` 기반에서 재검증했다. 여러 발화의 서로 다른 이미지와 최신 화면 2장의 인덱스, 재시도 시 원본 메타데이터 보존 회귀를 추가했다. 관련 회귀 22/22, `npm run check`의 전체 693/693 테스트와 TypeScript/Vite 빌드, `npm audit --audit-level=high`가 통과했다. 원본 로그는 격리 통합 worktree의 `artifacts/stt-b-{ci,regression,check,audit}.log`에 보존한다.

물리 마이크·실게임·OBS·실사용 계정 호출은 이번 로컬 검증에 사용하지 않았다. 실제 체감 정합성은 통합 후 격리된 실제 장치/게임 검증에서 별도로 확인해야 한다.
