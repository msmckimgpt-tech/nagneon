# 관객별 목격 기반 게임 지식 (Per-viewer witnessed game knowledge)

이 문서는 "관객별로 실제 목격한 게임 지식을 명시적으로 저장·전달한다"는 개선의 설계, 한계, 검증 근거를 정리한다.
목표는 공통 프롬프트 지침(`단골은 실제 기억이 있을 때만 이전 일을 언급한다`)에만 의존하던 부분을,
서버가 보관하는 **실제 목격 데이터**로 뒷받침하는 것이다. (HANDOFF 우선순위 2)

## 문제

기존 `server/knowledge.js` 의 게임 지식은 게임 단위 전역 데이터였다. 모든 페르소나가 같은
`observations`(목격 장면)와 `seconds`(시청 시간)를 공유했고, "누가 실제로 그 장면을 봤는지"는
데이터에 남지 않았다. 신규 관객이 입장 전 사건을 자기 기억처럼 말하지 않도록 하는 것은 오직
프롬프트 지침의 문제였다.

## 설계

### 1. 목격자 스냅샷 (provenance)

`Knowledge.observe(name, scene, at, popularity, witnesses)` 가 관찰마다 **캡처 시점 목격자 ID 스냅샷**을
`observation.witnesses` 에 저장한다. 목격자 집합은 `Studio.presentWitnesses()` 가 만든다:

- `active` 또는 `lurking` 상태이고 (lurker 도 화면을 보므로 목격자에 포함, 단 발언 자격 `eligible` 과는 별개),
- 이번 세션에 실제 입장한(`joinedAt >= startedAt`) 관객만.

이 스냅샷은 **요청(프레임 캡처) 시점**에 찍는다. 모델 응답이 지연되어 그 사이 누군가 입장/이탈해도,
목격 판정은 스냅샷 기준이다. 늦게 온 관객은 그 프레임의 목격자가 아니고, 응답 중 떠난 관객은 목격자로 남는다.
세션이 바뀌면(`epoch` 변경 또는 정지) `react()` 가 조기 반환하므로 관찰 자체가 기록되지 않는다.

### 2. 관객별 개인 시청 시간

`observe` 는 직전/현재 관찰에 모두 있었던 목격자에게만 간격(최대 60초)을 `watched[viewerId]`로 누적한다. 새 입장자의 첫 장면에는 직전 간격을 부여하지 않는다. 시각은 모델 응답 완료 시각이 아닌 서버의 입력 수신 시각이다.
`watched` 는 게임 엔트리에 저장되어 재시작 후에도 유지된다. `Studio.stop()` 이 `knowledge.lastSeen` 을 비우므로,
정지 중 오프라인 시간은 재시작 첫 관찰에서 간격 0 으로 처리되어 시청 시간에 합산되지 않는다.

### 3. 제외 규칙 (지식을 부여하지 않는 경우)

`Studio.react()` 는 다음 경우 `observe` 를 호출하지 않는다(기존 게이트에 목격자 스냅샷만 추가):

- 오프스크린(`image` 없음), 저신뢰(`confidence < 0.7`),
- Just Chatting(`category==='just-chatting'`),
- 가상 기획 방송(directed fantasy, `directed` 활성).

즉 허구/무근거 프레임은 개인 목격 지식이 되지 않는다.

### 4. 관객별 지식 패킷 (`server/viewer-context.js`)

`viewerKnowledgeByPersona(entry, personas, {popularity})` 가 이번 호출에 참여하는 각 관객의 패킷을 만든다:

| 필드 | 의미 | 출처 |
| --- | --- | --- |
| `generalFamiliarity` | 일반 배경 지식 | 게임 인지도(popularity) + 페르소나 숙련도(expertise) |
| `personalFamiliarity` | 개인 숙지도 | **본인** 시청 시간(`watched[viewerId]`)만 |
| `familiarity` | 종합 | `general + personal*(1-general)` |
| `witnessed` | 본인이 실제 목격한 장면 | `observation.witnesses` 에 본인 ID 포함 |
| `taughtNotes` | 스트리머가 알려준 공용 지식 | `notes` (teach) |
| `priorScenes` | 본인이 목격했다고 볼 수 없는 공용 맥락 | provenance 없는(레거시) 관찰만 |

공식:
```
generalFamiliarity  = clamp(popularity*0.4 + expertise*0.4)
personalFamiliarity = clamp(log2(1 + watchedSeconds/3600) * 0.3)
familiarity         = clamp(general + personal*(1-general))
```

- **신규 관객**: `witnessed=[]`, `watchedSeconds=0`, `personalFamiliarity=0`. 다른 관객이 목격한 장면은
  본인 `witnessed` 에도, 공용 `priorScenes` 에도 들어가지 않는다(다른 관객의 개인 기억이 새지 않음).
- **레거시 마이그레이션 정직성**: provenance 없는 관찰은 누구의 개인 목격으로도 승격되지 않고,
  `priorScenes`(공용·무귀속 배경)로만 노출된다. 새 관찰이 레거시 장면을 소급 귀속시키지 않는다.
- **teach 구분 유지**: 스트리머가 알려준 노트는 `taughtNotes` 로 별도 전달되어 관찰(개인 목격)과 섞이지 않는다.

### 5. 지속 성장 제한

- `observations` 는 게임당 최근 30개, `notes` 는 50개로 슬라이스(기존 유지).
- `observation.witnesses` 는 최대 40개(관객 수 상한과 동일)로 슬라이스, 스키마도 `.max(40)`.
- `watched` 맵은 키가 80개를 넘으면 시청 시간 상위 80개만 유지(`capWatched`). 스키마 키는 `actor` 규칙으로 제한.

## 저장 스키마

`server/data-schema.js` 의 `KnowledgeData` 를 확장했다. 두 필드 모두 선택(optional)이므로 **기존 데이터 파일과 호환**된다:

- `observations[].witnesses?: actor[] (max 40)`
- `watched?: Record<actor, number>`

`actor` 규칙(`/^[A-Za-z0-9_-]{1,80}$/` + `__proto__/constructor/prototype` 거부)으로 영속 파일의
프로토타입 오염을 막는다. `observe` 도 같은 규칙으로 목격자 ID 를 걸러 in-memory 오염을 방지한다.

## 한계 (정직한 서술)

- **호출 격리 아님**: 기존 다중 페르소나 1회 호출 방식을 유지한다. 관객별 패킷은 한 입력에 함께 담기므로
  모델이 물리적으로 모든 관객의 패킷을 본다. 각 관객이 자기 항목만 자기 지식으로 쓰도록 프롬프트로 지시할 뿐,
  **암호적/실행적 기밀 격리가 아니다.** 엄격한 격리가 필요하면 관객별 별도 호출이 필요하다(범위 밖, 지연·비용 증가).
- **개인 대화 맥락**: 일반 라이브 호출은 공통 `chatHistory`/`previous`를 제거하고 `viewerContext[personaId]`에 최신 입장 시각 이후의 대화/장면과 본인 기억만 둔다. 공개 audience.members에서는 개인 memories를 뺀다. 다른 관객 패킷은 같은 호출에 포함되므로 모델 수준 기밀 격리는 아니다. 방송 후기/특수 기능은 각자의 별도 경로를 유지한다.
- **시청 시간 귀속 근사**: 직전/현재 두 관찰에 모두 있는 관객에게만 최대 60초를 누적한다. 두 관찰 사이 이탈 후 재입장 등 연속 시청 여부까지 입증하는 방식은 아니다.
- **auto 게임명 지연**: `auto` 게임의 첫 프레임에서 패킷은 요청 시점 추정 게임명으로 만들어지고, 기록은
  모델이 판정한 게임명에 저장된다(기존 동작과 동일한 알려진 한계).

## 보존한 기존 동작

사적 인터뷰(`privateInterviews`), 특수 기능(속마음/프로필/관계/협상), 핫클립, 기획 방송은 그대로다.
`special-features.js`/`director.js` 는 `knowledge`/`viewerKnowledge` 를 넘기지 않으며, 새 payload 필드는
선택값이라 이들 경로에 영향이 없다(테스트로 확인).

## 검증 근거

원본 로그: `artifacts/claude-viewer-knowledge-test.log`.

신규 테스트 `test/viewer-knowledge.test.js` (8개, 전부 통과):

1. 신규 관객: 목격 장면·시청 시간 0, 다른 관객의 개인 기억 미유입.
2. 재방문 + 재시작: 개인 시청 시간·목격 provenance 가 영속 스키마 왕복 후에도 유지, 오프라인 시간 미집계.
3. 시청 간격 60초 상한.
4. 레거시 마이그레이션: provenance 없는 기록은 개인 목격으로 승격되지 않고 공용 배경으로만, teach 노트는 구분 유지.
5. 일반 배경(인지도+숙련도) vs 개인 숙지도(본인 시청 시간) 분리, 공식 검증.
6. studio: 캡처 시점 목격자 기록 + 오프스크린/저신뢰/Just Chatting 제외, 영속 스키마 유효성.
7. studio: 지연 응답이 캡처 시점 스냅샷으로 귀속(입장/이탈 중에도).
8. studio: 가상 기획 방송 프레임은 개인 목격 지식이 되지 않음.

기존 스위트 회귀 없음: 전체 `node --test test/*.test.js` → **121 pass / 0 fail**
(빌드는 루트 통합 시점에 `npm run check` 로 수행; 본 작업에서는 실행하지 않음).

## 변경 파일

- `server/knowledge.js` — 목격자 스냅샷, 관객별 `watched`, ID 검증, `watched` 키 상한.
- `server/viewer-context.js` (신규) — 관객별 지식 패킷 빌더 + familiarity 공식.
- `server/provider.js` — payload 에 `viewerKnowledge` 수용, 개인별 지식/공유 한계 지침으로 교체.
- `server/studio.js` — `presentWitnesses()`, 캡처 시점 스냅샷, 관객별 패킷 전달, `observe` 에 목격자 전달.
- `server/data-schema.js` — `KnowledgeData` 에 `witnesses`/`watched` (선택, 제한) 추가.
- `test/viewer-knowledge.test.js` (신규) — 위 8개 테스트.
- `docs/VIEWER-KNOWLEDGE.md` (신규) — 본 문서.

## 부모 통합 검토와 보완

초기 Claude 구현과 로그는 보존했다. 검토 후 새 입장자의 직전 시간 귀속, 모델 지연에 따른 시각 오류, 같은 장면을 나중에 본 관객의 목격 누락을 보완했다. 동일한 장면도 목격자 집합이 바뀌면 새 시각의 기록을 남겨 과거 기록을 소급 수정하지 않는다. 일반 라이브 대화는 관객별 입장 이후의 chatHistory/previous와 자기 memories로 구성하고, 공통 필드에서 개인 기억과 전체 채팅을 제외했다. 전달 구조는 `liveViewerContext`와 `viewerKnowledge` 두 맵이며 동일 personaId끼리 대응한다.

신규 테스트 11개와 전체 125개 Node 검사/빌드가 Windows에서 통과했다(`artifacts/onboarding-knowledge-check.log`). 추가 사례는 늦은 입장/동일 장면 재관찰, 실제 payload의 공통 과거 제거, Just Chatting 및 정지 후 지연 응답 제외다. 이 검증은 데이터 귀속/전달의 정확성이며 생성된 채팅의 장기 자연스러움 합격을 뜻하지 않는다.
