# Knowledge 저장: mutate-before-save 실패 의미 수정 (atomic commit)

이 문서는 `server/knowledge.js` 의 `observe`/`teach`/`forget` 가 **저장에 성공한 뒤에만** in-memory
상태를 교체하도록 고친 변경의 설계·정확한 차이·검증 근거를 정리한다.

## 문제

기존 코드는 in-memory 상태를 **먼저 변형한 뒤 마지막에** `this.save(this.entries)` 를 호출했다.

```js
// observe (이전)
e.seconds+=gap;this.lastSeen={key,at,witnesses:ids};      // ① lastSeen 선(先) 변형
...Object.defineProperty(this.entries,key,{value:e,...});  // ② entries 선(先) 변형
this.save(this.entries);                                   // ③ 실패하면 ①②가 이미 오염됨

// teach (이전): entries 변형 후 save
// forget (이전): delete this.entries[key]; this.lastSeen=null; save  → 실패해도 삭제/clear 가 남음
```

`save` 가 던지면(디스크 꽉 참, 스키마 검증 실패 등) in-memory 상태는 이미 바뀐 뒤였다.
결과적으로 **디스크에 없는 변경이 메모리에만 커밋**되고, `observe` 의 경우 실패한 쓰기가 시청 시간을
집계하고 캡처 시각(`lastSeen`)을 전진시켰다. 또한 `this.save` 어댑터가 인자(맵)를 변형하면 그 변형이
`this.entries`(= 같은 객체)로 새어 커밋 상태를 오염시킬 수 있었다.

## 수정

**저장이 성공해야만 커밋한다.** 세 메서드 모두 새 엔트리 맵(`next`)을 만들고, 먼저 저장에 성공시킨
뒤에만 `this.entries`(그리고 `observe`/`forget` 의 `lastSeen`)를 교체한다.

```js
// save 가 성공해야만 in-memory 를 교체. 던지면 this.entries 는 그대로.
// save 어댑터가 인자를 변형할 수 있으므로 사본을 넘겨 커밋될 next 가 오염되지 않게 한다.
#commit(next){this.save(structuredClone(next));this.entries=next;}
```

- **observe**: 기존 시간/목격자/중복 로직을 그대로 계산하되, `this.lastSeen` 전진을 `#commit` **이후**로
  옮겼다. `#commit` 이 던지면 `lastSeen=...` 줄은 실행되지 않는다 → 실패한 쓰기는 시간을 세지 않고
  캡처 상태를 전진시키지 않는다. 다음 성공한 관찰은 **마지막으로 커밋된 캡처**부터 간격을 센다.
- **teach**: notes 갱신 후 `#commit`. 실패 시 notes 변화 없음. `lastSeen` 과 무관(기존과 동일).
- **forget**: 해당 키를 뺀 `next` 를 만들어 `#commit` 에 성공한 뒤에만 `this.lastSeen=null`. 실패 시
  엔트리도 `lastSeen` 도 그대로.

### 어댑터 변형 격리

`#commit(next)` 는 `this.save(structuredClone(next))` 로 **사본**을 넘기고 `this.entries=next`(원본)를
커밋한다. 어댑터가 인자를 어떻게 변형하든 사본만 바뀌고, 커밋되는 `next`(및 그 하위 객체)는 오염되지 않는다.
실제 `JsonStore.save` 도 내부에서 `structuredClone` 후 검증하므로, 이 경로는 임의 어댑터에 대해 이중으로 안전하다.

### 프로토타입 키 안전 유지

게임 키(`__proto__`/`constructor`/`prototype` 등)를 `Object.prototype` 오염 없이 own·enumerable 로 다루기
위해, `next` 를 만들 때 `Object.defineProperty` 기반 헬퍼를 쓴다.

```js
const setEntry=(map,key,value)=>Object.defineProperty(map,key,{value,writable:true,enumerable:true,configurable:true});
// 기존 키를 새 최상위 맵으로 얕게 복사(엔트리 객체는 공유). 변경 엔트리를 기존 맵에 in-place 로 쓰지 않는다.
const copyEntries=(entries,skip)=>{const out={};for(const k of Object.keys(entries))if(k!==skip)setEntry(out,k,entries[k]);return out;};
```

`next` 는 최상위 맵만 새로 만들고 바뀌지 않은 게임의 엔트리 객체는 공유(참조)한다. 변경되는 엔트리는
`get()` 이 돌려준 깊은 사본(`structuredClone`)이라 공유 객체를 in-place 로 건드리지 않는다.

## 정확한 변경 (server/knowledge.js)

- **추가** 모듈 헬퍼 `setEntry`, `copyEntries` (프로토타입 안전 own-key 설정 / 새 맵 복사).
- **추가** private 메서드 `#commit(next)` — `save(사본)` 성공 후에만 `this.entries=next`.
- **observe**: `this.lastSeen={...}` 를 save 호출 **뒤**로 이동. `Object.defineProperty(this.entries,...)` +
  `this.save(this.entries)` → `const next=copyEntries(this.entries);setEntry(next,key,e);this.#commit(next);` 로 교체.
  시간/`watched`/중복/30개 슬라이스/목격자 40개 상한/`capWatched` 80키 상한 로직은 **그대로**.
- **teach**: 동일 패턴으로 교체. 50개 슬라이스 유지.
- **forget**: `delete this.entries[key];this.lastSeen=null;this.save(...)` →
  `const next=copyEntries(this.entries,this.key(name));this.#commit(next);this.lastSeen=null;`.

보존: `safeId`, `capWatched`, `key()` 정규화(NFKC/trim/lower), `get()` familiarity 공식, witness/time 로직,
scene 중복 제거, `observation.witnesses`/`watched` optional 스키마(역호환).

## 스코프 (건드리지 않은 것)

- 편집: `server/knowledge.js` 만. 신규: `test/knowledge-atomic.test.js`, `docs/KNOWLEDGE-ATOMIC.md`.
- `data-schema.js`/`studio.js`/`index.js`/`storage.js` 등 다른 제품 파일, 기존 테스트, HANDOFF, package,
  전역/개인 메모리, 사용자 데이터·인증·기존 아티팩트는 **변경 없음**. 위임 없음.
- 공개 API 시그니처(`observe/teach/forget/get/key`)와 생성자 계약은 그대로. 호출부(`server/index.js`,
  `server/studio.js`)는 수정 불필요 — 실패 시 이제 예외가 전파되지만, 기존 호출 경로의 기대(성공 시
  동작)는 동일하다.

## 검증 근거

원본 로그: `artifacts/claude-knowledge-atomic-tests.log` (raw `node --test` 출력).

실행(요청대로 신규 + 지정 기존 2개만):
```
node --test test/knowledge-atomic.test.js test/viewer-knowledge.test.js test/studio.test.js
→ tests 31 · pass 31 · fail 0   (신규 11 + viewer-knowledge 12 + studio 8)
```
(nvm `v24.15.0` node 사용. 전체 스위트/빌드는 루트 통합 시점 `npm run check` 담당, 본 작업 범위 밖.)

신규 테스트 `test/knowledge-atomic.test.js` (11개):

1. observe 저장 실패 → 엔트리·시간·캡처 상태 전부 미커밋, `lastSeen` null 유지.
2. teach 저장 실패 → notes 불변, 커밋 맵 동일.
3. forget 저장 실패 → 엔트리·`lastSeen` 유지, 성공 시에만 삭제/clear.
4. 변형 어댑터 → 커밋된 seconds/observations/watched 오염 없음, 주입 키 미유입(observe·teach).
5. `__proto__`/`constructor`/`prototype` 게임명 → own 데이터 키로 격리, `Object.prototype` 오염 없음(실패 경로 포함).
6. 풀와이드/공백 유니코드 키 → NFKC+trim+lower 정규화, 저장 맵에 정규화 키 반영.
7. 재시도 → 실패 후 성공한 저장이 상태를 스키마-유효하게 커밋.
8. 시계/시청 상태 → 실패한 observe 는 시간 미집계·장면 미기록·`lastSeen` 미전진, 재시도는 마지막 커밋된 캡처부터 집계.
9. `watched` 80키 상한 유지(변경 후에도 `capWatched` 동작).
10. save 에 넘긴 값이 역호환 `KnowledgeData` 스키마를 만족(witnesses/watched optional 포함).

기존 회귀 없음: `test/viewer-knowledge.test.js`(12), `test/studio.test.js`(8) 모두 통과 —
프로토타입 키 격리, 재시작 provenance, 60초 간격 상한, Just Chatting/정지 세션 제외 등 기존 불변식 유지.

## 한계 (정직한 서술)

- 이 검증은 **실패-원자성과 데이터 무결성**의 정확성이다. 생성 채팅 품질이나 전체 스위트/빌드 합격을 뜻하지 않는다.
- zod `z.record` 는 `__proto__` own 키를 파싱 시 드롭한다(실측). 따라서 `__proto__` 이름의 게임은 in-memory
  에서는 안전히 보존되지만, 실제 영속 어댑터(`KnowledgeData.parse`)를 거치면 디스크 저장에서 사라질 수 있다 —
  이는 기존 영속 계층의 성질이며 본 변경의 대상(및 편집 범위)이 아니다. 커밋되는 in-memory 상태는 pristine `next`
  이므로 본 변경으로 인한 추가 손실은 없다.
