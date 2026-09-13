# 방송 연습(Training) 모듈

BACKSEAT의 **연습 모드**는 스트리머가 실시간 방송에서 자주 마주치는 상황을
안전하게 미리 연습할 수 있는 로컬 시뮬레이션입니다. 실제 방송을 켜거나 AI를
호출하지 않고, 미리 준비된 **가상 시청자 반응**만으로 진행됩니다.

- 서버 로직: `server/training.js` (`TrainingRun` 클래스)
- 패널 UI: `src/Training.tsx` (`TrainingPanel`)
- 테스트: `test/training.test.js`

---

## 범위 (Scope)

연습 모듈은 다음을 제공합니다.

- **최소 12종의 시나리오** — 한국어 방송 상황 연습용. 오프닝/뉴비 맞이, 조용한
  채팅, 반복 실패, 원치 않는 훈수, 의견 충돌, 시청자 급증, 스포일러 경계,
  사적 질문·파라소셜 경계, (가상) 후원 압박, 비판/악플, 기술 문제(시뮬레이션),
  방송 마무리 등. (현재 14종)
- 각 시나리오는 **2~4개의 사전 작성된 가상 채팅 프롬프트**와, 스스로 돌아볼 수
  있는 **점검 질문(reflection)** 을 가집니다.
- `tick()` 은 경과 시간에 따라 프롬프트를 **한 번에 하나씩** 내보냅니다. 절전/지연
  이후에도 밀린 채팅을 몰아서 쏟아내지 않습니다.
- `stop()` 은 **관찰 가능한 행동 횟수와 진행 시간**, 돌아보기 질문만 담은
  리포트를 만듭니다.

시나리오의 가상 채팅은 실제 인물이나 실제 시청자 데이터를 나타내지 않습니다.
연습 진행 시 등장하는 발화자는 **start 시점에 전달된 활성 상태의 비(非)매니저
관객**으로 한정됩니다.

---

## 서버 API — `TrainingRun`

```js
import { TrainingRun } from './server/training.js';
const run = new TrainingRun({ now = Date.now } = {});
```

주입식 시계(`now`)를 사용하므로 테스트에서 시간 경과를 결정적으로 제어할 수
있습니다.

| 메서드 | 설명 |
| --- | --- |
| `snapshot()` | 아래 구조의 상태 객체를 반환합니다. 카탈로그는 공개 필드만 노출하며 내부 프롬프트/점검 질문은 포함하지 않습니다. |
| `start(id, personas)` | 연습을 시작합니다. 이미 진행 중이면 거부합니다. 존재하지 않는 시나리오 `id`도 거부합니다. `personas` 중 `enabled === true` 이면서 `role !== 'manager'` 인 관객만 발화자로 사용합니다. |
| `tick()` | 경과 시간에 따라 준비된 채팅을 최대 1건 반환합니다: `[{ personaId, text, kind: 'chat' }]`. 낼 것이 없으면 `[]`. |
| `action(actionName, text = '')` | 운영자의 응답/중재/체크리스트 행동을 기록합니다. `text`는 운영자 본인 복기용이며 채점되지 않습니다. 진행 중이 아니면 오류. |
| `stop()` | 연습을 종료하고 리포트를 만들어 반환하며 `snapshot().report` 로도 노출합니다. 진행 중이 아니면 오류. |

### `snapshot()` 구조

```ts
{
  active: boolean,
  scenario: { id, title, description, objective } | null, // 진행 중일 때만
  catalog: [{ id, title, description, objective }],        // 전체 시나리오 목록
  startedAt: number | null,
  eventsSent: number,                                      // 내보낸 가상 채팅 수
  actions: [{ action, text, at }],
  report: {
    scenarioId, scenarioTitle, startedAt, endedAt, durationMs,
    eventsSent, participants, totalActions,
    actionCounts: { [action]: number },
    responses, moderations, checklist,
    reflection: string[],
    disclaimer: string
  } | null
}
```

### 타이밍

`STAGE_INTERVAL_MS`(기본 9초)마다 프롬프트가 하나씩 공개됩니다. 각 프롬프트를
내보낸 뒤 다음 공개 시점을 "지금"을 기준으로 다시 계산하므로, 오랜 절전 후에도
한 번에 하나만 나오고 채팅이 홍수처럼 밀려오지 않습니다. 상수와 시나리오 원본
배열(`SCENARIOS`)은 테스트를 위해 모듈에서 함께 export 됩니다.

---

## HTTP 라우트 (메인 에이전트가 연결)

패널은 아래 경로로 `onAction(path, body)` 를 호출합니다. 서버 배선(`server/index.js`
의 라우트, `state.training`, 일반 채팅/미디어 동작 연동)은 **메인 에이전트가**
담당합니다. 이 모듈 자체는 통합을 구현하지 않습니다.

| 경로 | 본문 | 동작 |
| --- | --- | --- |
| `POST /api/training/start` | `{ id }` | `run.start(id, personas)` |
| `POST /api/training/stop` | `{}` | `run.stop()` |
| `POST /api/training/action` | `{ action, text }` | `run.action(action, text)` |

`tick()` 은 서버 측 주기(예: 기존 `Studio.pump()` 와 유사한 인터벌)에서 호출하여,
반환된 이벤트를 일반 채팅 메시지로 흘려보내도록 배선하면 됩니다.

---

## UI — `TrainingPanel`

```tsx
import { TrainingPanel, TrainingState } from './Training';
<TrainingPanel training={state.training} onAction={onAction} />
```

- `training: TrainingState` — `snapshot()` 과 동일한 구조.
- `onAction(path: string, body?: unknown): Promise<unknown>` — 위 라우트를 호출.

패널은 시나리오 카탈로그, 진행 중인 연습 목표, 응답 입력창과 수동 체크리스트
버튼, 연습 종료 버튼, 그리고 측정 리포트를 보여 줍니다. 기존 다크 라임 스타일
클래스(`panel`, `panel-heading`, `primary`, `secondary`, `form-grid`,
`persona-grid`, `status-pill`, `tags`, `field-note` 등)만 사용하며 새 CSS 파일을
추가하지 않습니다. 모든 UI 문구는 한국어이며, 연습이 시뮬레이션이라는 점과
점수·포인트·영구 기억이 영향을 받지 않고 실제 후원이 발생하지 않는다는 점을
명시합니다.

---

## 한계와 원칙 (Limitations)

- **모델 호출 없음**: AI 제공처를 호출하지 않습니다. 모든 채팅은 사전 작성된
  고정 문구입니다.
- **경제/포인트 없음**: 후원·포인트·보상이 발생하지 않습니다. "후원 압박"
  시나리오도 **가상**이며 실제 후원을 유도하지 않습니다.
- **영구 관객 기억 없음, 파일 쓰기 없음**: 상태는 인스턴스 메모리에만 존재하며
  디스크에 아무것도 기록하지 않습니다.
- **의미 평가 없음**: 리포트는 **관찰 가능한 행동 횟수와 진행 시간**만 담습니다.
  공감·성공·실력을 의미적으로 채점하지 않습니다. 돌아보기 질문은 운영자 스스로
  점검하기 위한 것입니다.
- **기술 문제는 시뮬레이션**: "기술 문제" 시나리오는 대응 연습용일 뿐, 실제
  하드웨어(화면/마이크 등)를 멈추거나 건드리지 않습니다.
- **스포일러 시나리오에 실제 스포일러 없음**: 시청자가 스포일러를 흘리려는
  *상황*만 연출하며, 실제 작품 내용을 노출하지 않습니다.
- **주입식 시계**: `now` 를 주입하므로 시간 의존 동작을 결정적으로 테스트할 수
  있습니다.
