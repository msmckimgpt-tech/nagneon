# Nagneon 프로젝트 구조 분석

기준 커밋 `1c61cf9` (2026-09-15). 이 문서는 저장소의 실제 코드를 읽고 정리한 구조 분석이며, 제품 홍보 문서나 출시 승인 문서가 아니다. 수치는 모두 이 커밋의 파일에서 직접 측정했다.

---

## 1. 한 줄 요약

**혼자 방송하는 사람에게 가짜 시청자를 붙여 주는 Windows 데스크톱 앱.** 화면·목소리·시스템 소리를 캡처해 LLM에 넘기고, 서로 다른 성격을 가진 AI 관객들이 한국어 채팅으로 반응한다. 관객은 방송을 거듭하며 기억·친밀도·취향이 누적되고, 스스로 유입되고 떠나며 닉네임까지 바꾼다.

실제 시청자를 모으거나 Twitch/치지직에 송출하는 도구가 **아니다.** 외부 플랫폼 채팅은 읽기 전용 입력으로만 쓰인다.

---

## 2. 제품이 풀려는 문제

README와 코드가 일관되게 겨냥하는 대상은 **시청자가 0명인 스트리머**다.

| 실제 방송의 결핍 | 이 앱의 대응 |
|---|---|
| 아무도 안 보는 채팅창 | 성격이 다른 AI 관객 다수가 화면을 보고 반응 |
| 반응이 없어 혼잣말이 됨 | 마이크 발화를 로컬 STT로 받아 관객이 답변 |
| 단골이 안 생김 | `sessions`/`seconds`/`affinity` 누적, 다음 방송에서 기억 |
| 후원·클립·커뮤니티 같은 "규모의 경험" 부재 | 가상 포인트 후원, 관객이 고르는 핫클립, 방송 밖 게시판 |
| 방송 사고 대응 연습 기회 없음 | 상황 연습(training) 모드 |

핵심 설계 의도는 **"수를 늘리는 시뮬레이터"가 아니라 "관계가 쌓이는 시뮬레이터"**다. 코드 전반에서 가장 많은 분량을 차지하는 것도 채팅 생성이 아니라 **"누가 무엇을 목격했는가"를 추적하는 로직**이다.

---

## 3. 시스템 구조

### 3.1 프로세스 토폴로지

```
┌─ Electron main (desktop/main.cjs)
│    · BrowserWindow 2개: 메인 창 + 투명 오버레이 창
│    · desktopCapturer 로 화면/창 선택
│    · globalShortcut: Ctrl+Shift+F10(클릭통과) / F9(긴급중지)
│    · 공식 Codex CLI 로그인 위임 (account-login.cjs)
│    · 저장 위치 이전/재시작 (storage.cjs)
│
├─ Node Express 서버 (server/index.js)  ── 127.0.0.1:랜덤포트
│    · 로컬 전용. Host/Origin 검증 + 실행별 토큰 + CSP
│    · Studio 오케스트레이터 + SSE 상태 스트림
│
├─ Python worker: speech_worker.py     ── faster-whisper (마이크 STT)
├─ Python worker: sound_worker.py      ── YAMNet ONNX (시스템 소리 분류)
├─ Python worker: clip_perception.py   ── 저장된 클립 영상 재인식
└─ 외부 프로세스: codex exec           ── 요청마다 새로 spawn
```

렌더러는 React 19 + Vite. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`이며 preload로 좁은 IPC 표면만 노출한다.

### 3.2 코드 규모 (커밋 `1c61cf9` 실측)

| 영역 | 파일 | 코드 라인 | 바이트 |
|---|---:|---:|---:|
| `server/` | 66 | 4,464 | 462 KB |
| `src/` (React) | 67 | 2,269 | 340 KB |
| `desktop/` (Electron) | 10 | 393 | 29 KB |
| `shared/` | 15 | 149 | 26 KB |
| `scripts/` | 143 | 7,432 | 756 KB |
| `test/` | 97 | 7,918 | 718 KB |
| `installer/` (C#/NSIS) | 21 | 3,154 | 179 KB |
| `docs/` | 91개 문서 | — | 750 KB |

**라인 수 대비 바이트가 비정상적으로 크다.** 한 줄에 여러 문장을 밀어 넣는 압축 스타일이기 때문이다. `src/App.tsx`는 104줄에 29KB이고 최장 줄은 **2,547자**다. `server/studio.js`의 최장 줄은 1,012자다. 즉 실질 코드량은 라인 수의 3~5배로 읽어야 한다.

---

## 4. 핵심 동작: 반응 루프

`Studio.reactInput()` ([server/studio.js:186](../server/studio.js#L186))이 제품의 심장이다. 250ms 타이머(`pump`)와 별개로, 프런트엔드가 캡처한 프레임을 `POST /api/react`로 올릴 때마다 실행된다.

```
프레임/발화 도착
  ↓
[1] 게이트 검사 — 종료된 화면? busy? 백오프 중? interval(기본 12초) 미달?
  ↓
[2] 목격자 스냅샷  presentWitnesses()
      이번 세션에 실제 입장(joinedAt >= startedAt)한 active/lurking 관객만
  ↓
[3] 시간순 화면 구성  temporalVideo()
      모델 대기 중 쌓인 프레임을 타임라인으로 묶음
  ↓
[4] 변화 없음 판정  viewing.unchanged()
      정지 화면 + 발화 없음 → 호출 생략 (또는 "조용한 동행" 잡담 기회)
  ↓
[5] 개인별 컨텍스트 조립  liveViewerContext()
      관객마다 자기가 본 것만: 채팅 기록, 기억, 들은 소리, 클립 감상, 사적 인터뷰
  ↓
[6] 모델 호출  provider.react()
  ↓
[7] 응답 필터링  Studio.accept()
      차단어 / 중복 / 스포일러 / 훈수 정책 / chatPace / 이탈한 관객 제거
  ↓
[8] 큐 적재 → 250ms pump 가 슬로우모드·발화간격 지켜 한 줄씩 방출
```

### 4.1 "목격" 모델이 이 제품의 정체성

코드 전체에서 가장 집요하게 지키는 불변식이다.

- `presentWitnesses()` — 요청 **캡처 시점**의 목격자를 스냅샷으로 고정. 모델 응답이 15초 걸려 그 사이 새 관객이 들어와도 그 관객은 목격자가 아니다.
- `sameViewingVisit()` — 큐에 대기 중인 채팅도, 해당 관객이 그 사이 나갔다 들어왔으면 폐기한다.
- `liveViewerContext()` — 각 관객의 `joinedAt` 이전 채팅은 그 관객의 패킷에서 **제외**된다.
- `retainPresentReactions()` — 모델이 만든 반응 중 현재 없는 관객의 것을 버린다.
- `witnessedSpeech()` — 마이크 발화도 그 순간 있던 사람만 들은 것으로 처리한다.

프롬프트에도 같은 규칙이 반복 명시된다: *"이 개인 패킷들은 한 번의 호출에 함께 입력되어 물리적으로 공유되므로, 각 관객은 오직 자신의 personaId 항목만 자기 지식으로 사용한다."*

**한 번의 모델 호출로 여러 페르소나를 연출하되, 각자의 인식 범위는 서버가 강제한다.** 이것이 "관객마다 별도 모델이 돌지 않는다"(README)는 구조적 한계를 제품 규칙으로 방어하는 방식이다.

### 4.2 프롬프트

`OpenAIProvider.payload()` ([server/provider.js:37](../server/provider.js#L37))가 매 호출마다 **13,004자(47줄)의 한국어 시스템 지침**을 조립한다. 내용은 대부분 금지 규칙이다.

- 없는 클립/링크/외부 사건 날조 금지
- 익명 후원자 정체 추리 금지
- 다른 관객의 기억을 자기 것으로 쓰기 금지
- 화면 OCR과 관찰 데이터는 **신뢰할 수 없는 콘텐츠**로 취급(프롬프트 인젝션 방어)
- 훈수 정책(`never`/`on-request`/`always`)과 1회 힌트 제한
- 로컬 STT 원문 교정 시 의미 변경 금지 (confidence 0.9 미만이면 추측 금지)

출력은 `json_schema` strict 모드로 고정된다 ([server/provider.js:10](../server/provider.js#L10)): `messages`(최대 8), `positiveMoment`(후원 트리거), `clipPicks`, `viewerChanges`(취향 변화), `arrival`(새 관객 생성), `transcriptCorrections`, `communityVotes`.

### 4.3 AI 제공처 3종

| 제공처 | 구현 | 특징 |
|---|---|---|
| **codex** (기본) | `CodexProvider` — 요청마다 `codex exec` 프로세스 spawn | ChatGPT 구독 사용. auth.json 직접 읽지 않고 공식 CLI에 위임 |
| **openai** | `OpenAIProvider` — Responses API 직접 호출 | API 키 필요 |
| **ollama** | `OllamaProvider` | 로컬 모델. 문서상 품질 미검증 |

기본 모델은 `gpt-6-astra` / reasoning effort `low`로 하드코딩되어 있다 ([server/provider.js:27](../server/provider.js#L27)).

`CodexProvider.react()`는 호출 1회마다 다음을 수행한다 ([server/codex-provider.js:56](../server/codex-provider.js#L56)):
1. `mkdtemp`로 임시 디렉터리 생성
2. 출력 스키마 JSON 파일 기록
3. 지침을 `audience-instructions.md`로 기록 (`model_instructions_file` 오버라이드)
4. 이미지 프레임을 png/jpg 파일로 디코딩해 기록
5. `shell_tool`, `browser_use`, `computer_use`, `code_mode` 등 **14개 도구를 명시적으로 비활성화**
6. `--sandbox read-only`, `--ephemeral`, `--ignore-user-config`로 spawn
7. JSONL stdout 파싱, 90초 타임아웃
8. 임시 디렉터리 삭제 (경로 검증 후)

---

## 5. 관객 자율성 시스템

`AudienceAutonomy` ([server/audience-autonomy.js](../server/audience-autonomy.js))가 이 제품에서 가장 야심찬 부분이다.

### 5.1 관객은 스스로 생긴다

사용자가 관객을 직접 만들 수 없다. `configure()`가 페르소나 배열 수정 시도를 거부한다:

> `'관객은 직접 추가하거나 성향·이름을 설정할 수 없습니다.'`

관객이 생기는 경로는 3가지뿐이다.

| 경로 | 비용 | 조건 |
|---|---|---|
| `points` | 50P | 실제 AI 방송 중, 포인트 보유 |
| `broadcast` | 0P | 누적 방송 10분 이상 → **분당 3% 확률**, 직전 유입 후 5분 경과 |
| `clip` | 0P | 1~7일 내 생성된 클립 존재 → 8% 확률로 그 클립을 읽고 유입 |

유입이 결정되면 `special.kind='audience-arrival'`로 모델을 호출해 이름·성격·가치관·사교성·숙련도를 **모델이 생성**한다. 서버는 이름 중복·차단어만 검사한다.

### 5.2 관객은 변한다

`evolve()`가 모델의 `viewerChanges`를 받아 실제 저장소에 반영한다. 다만 조건이 엄격하다:

- 그 관객이 이번 발화의 **목격자**여야 함
- 누적 시청 300초 이상
- 직전 변화 후 10분 경과
- `evidence` 필드가 스트리머의 실제 발화 원문에 **문자열로 포함**되어야 함 (`speech.includes(evidence)`)

통과하면 `preference`가 누적되고 `sociability`가 ±0.05 이내로 조정되며, 하루 1회 한도로 **닉네임까지 바뀐다**. 이전 이름은 `aliases`에 남는다.

### 5.3 원자적 저장

관객 명단 + 관계 + 포인트 정산이 `world.json` 단일 파일의 한 번의 커밋으로 묶인다 ([server/world.js](../server/world.js)). `WorldData` zod 스키마에 `superRefine` 교차 검증이 붙어 있어 **"클립 유입 기억"과 "관객 생성 영수증"이 불일치하면 저장 자체가 거부된다.**

앱 재시작 시 `World.recover()`가 pending 상태의 구매를 찾아 포인트를 자동 환불한다.

---

## 6. 가상 경제

`shared/economy.json`이 전체 수치를 보유한다.

```
welcomePoints          60   (시작 잔액)
walletCap             200   (관객 1인 지갑 상한)
initialWallet          80
refillSeconds          60   (관객 지갑 1P/분 회복)
donationCooldownSeconds 600 (같은 관객 재후원 대기)
momentCooldownSeconds   90
hourlyRewardCap       240   (시간당 후원 총량 상한)
minimumWatchSeconds    60
```

후원은 사용자가 요청할 수 없다. `Economy.reward()`가 모델의 `positiveMoment`를 받아 **모든 조건을 통과할 때만** 지급한다:

```js
m.positive && m.impact >= .8 && observation.confidence >= .75
  && observation.excitement >= .8 && m.signature && m.reason
  && hasInput && !paid
```

추가로 `signature`의 SHA-256 지문을 24시간 보관해 **같은 장면 재관찰 시 중복 지급을 막는다.** 관객별 지갑에서 실제로 차감되며 회당 약 12~32P, 한 순간 최대 2명이다.

포인트 사용처: 새 관객 만남(50P), 속마음 보기(15P), 프로필 해금(30P), 관계 해금(25P), 인터뷰(40P), 협상 행동(응원/토론/역할극/자유, 18~35P 기준가).

**협상 시스템**이 특이하다. `quote()`가 관객의 성향·친밀도로 원가(`floor`)를 계산하고 1.35배를 호가한다. 사용자가 `bid()`로 흥정하며 3라운드 안에 `floor` 이상을 부르지 못하면 거절된다.

---

## 7. 기억 저장소

| 파일 | 내용 | 보호 |
|---|---|---|
| `world.json` | 설정 + 관객 + 포인트 + 유입 영수증 | 단일 커밋, zod 교차검증, 3세대 백업 |
| `conversation-journal-*` | 공개 대화 원문 (4,000개 / 고정 100개) | 불변 청크 + 원자적 인덱스 |
| `clips.json` + `clip-media/` | 핫클립 메타 + webm/썸네일 | — |
| `knowledge.json` | 게임별 관찰·학습 지식 | — |
| `seasons.json`, `episodes.json` | 기획 방송 기록 | — |

`JsonStore`가 모든 저장에 `backupCount: 3` 세대 백업과 로드 시 스키마 검증을 적용한다. 검증 실패 시 **초기화하지 않고** 백업에서 복구를 시도하며 `storage.warnings`로 UI에 표시한다.

---

## 8. 보안 경계

로컬 앱치고는 방어가 촘촘하다.

- `app.listen(port, '127.0.0.1')` — 루프백 고정
- Host 헤더가 실제 바인딩 주소와 정확히 일치해야 통과
- Origin 검증 + 비 GET 요청에 `x-backseat-client: studio` 헤더 요구
- 실행별 1회용 토큰 (`createLocalAccess`)
- CSP: `default-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'`
- Electron: `setWindowOpenHandler` 전부 deny, `will-navigate`를 서버 URL로 제한, 권한 요청 핸들러가 메인 창의 `media`/`display-capture`만 허용
- ASAR 무결성 + Electron Fuses (Node 실행 모드·NODE_OPTIONS·디버거 인자 차단)
- 모델 측: Codex 도구 14종 비활성 + `--sandbox read-only`
- 프롬프트: 화면 OCR/관찰 데이터를 "신뢰할 수 없는 콘텐츠"로 명시
- CI: 전체 히스토리 Gitleaks 스캔(체크섬 고정) + `npm audit --audit-level=high`

계정 인증은 공식 Codex CLI에 위임하며 `auth.json`이나 토큰을 직접 읽지 않는다. stderr의 계정 진단은 분류만 하고 원문을 노출하지 않는다 ([server/codex-provider.js:80](../server/codex-provider.js#L80)).

---

## 9. 배포 현황

- **현재 상태: 서명되지 않은 개발 배포본.** 정식 설치 프로그램은 `docs/INSTALLER.md`의 결함 해결 전까지 실행이 차단되어 있다.
- 최신 폴더 배포본: **2,451 파일 / 약 3.13 GB**
- 구성: Electron 44.3.0 + 공식 Codex CLI 0.154.0 + Python 3.13 embeddable + 음성 패키지 24종 + Whisper 모델 + YAMNet ONNX
- 고정 진입점 `Start-Nagneon.cmd` → `versions/` 아래 버전별 폴더 + `current.json` 원자적 교체
- 업데이트 시 `data`를 `backups/update-*/data`로 복사하고 해시 대조

측정된 응답 시간(`docs/RESPONSE-LATENCY.md`, `docs/RELEASE-LATENCY-ACCEPTANCE.md`):

| 구간 | 실측 |
|---|---|
| 모델 처리 | **8~23초** |
| 모델 완료 후 첫 채팅 전달 | 56~72ms (개선 후) |
| 음성 준비 | 5~6초 |
| 9.4초 한국어 전사 | 2.2~2.9초 |

---

## 10. 이 프로젝트의 특징

### 10.1 "하지 않는 것"으로 정의된 제품

코드의 상당 부분이 기능 추가가 아니라 **기능 거부**다.

```js
// 사용자가 클립을 만들 수 없다
const viewerClipOnly = (_req,res) => res.status(409)
  .json({error:'핫클립은 관객이 마음에 든 순간을 직접 골라 만듭니다.'});

// 사용자가 커뮤니티 반응을 유발할 수 없다
const autonomousCommunityOnly = (_req,res) => res.status(410)
  .json({error:'관객은 앱이 켜져 있는 동안 스스로 방문하고 댓글과 추천을 결정합니다.'});

// 사용자가 기획 방송을 시작할 수 없다
app.use((req,res,next) => [...'/api/seasons', '/api/director/start'].includes(req.path)
  ? res.status(409).json({error:'새로운 방송 이야기는 일반 채팅에서 자연스럽게 이어집니다.'})
  : next());
```

관객의 자율성을 지키려고 사용자의 조작 권한을 의도적으로 제거했다. 설계 사상으로서는 일관되고, 제품으로서는 위험하다(→ 리뷰 문서 참조).

### 10.2 문서가 코드만큼 많다

`docs/` 91개 문서 750KB. 대부분 "무엇을 검증했고 **무엇을 검증하지 않았는지**"를 구분해 기록한다. `RELEASE-GATES.md`에는 **"완료라고 부르지 않을 조건"** 절이 따로 있다:

> 기능이 코드에만 존재하거나 합성 입력만 통과했을 때 실제 플레이 수용 기준이 충족됐다고 표시하지 않는다.

`scripts/`에는 **90개의 `verify-*` 스크립트**가 있다. 테스트 파일(89개)보다 많다.

### 10.3 개발 속도

**132 커밋 / 3일** (2026-09-13 ~ 09-15). 저자는 1명(`Solo Game Dev`)이지만 실제로는 AI 에이전트가 브랜치+worktree 병렬로 작업한 결과다. 현재 **40개의 worktree**가 활성 상태로 남아 있다.

### 10.4 브랜드 전환이 진행 중

`BACKSEAT` → `Nagneon`(나그네 + On-air) 리브랜딩 중이며 두 이름이 공존한다.

- 저장소 폴더: `00_game_backseat`, 패키지명: `nagneon`
- 런처: `Start-Nagneon.cmd` + `Start-Backseat.cmd`(래퍼)
- 내보내기 파일명: `backseat-${sessionId}.json`, `backseat-reaction-diagnostics.json`
- IPC 브릿지: `window.backseat`
- 환경변수 접두사: `BACKSEAT_*`
- 기본 저장 프로필: `%APPDATA%\backseat-studio`

---

## 11. 검증 실태 요약

| 검증됨 | 검증 안 됨 |
|---|---|
| 679개 자동 테스트 + TS/Vite 빌드 (격리 worktree 기준) | 여러 장르·장기 방송의 대화 품질 |
| 배포 ASAR의 실제 Whisper/YAMNet 복구 | 여러 GPU·DPI·독점 전체화면 캡처 |
| 합성 입력 기반 모델 호출 다수 | 물리 마이크의 한국어 인식 정확도 |
| 격리 프로필 설치/제거/업데이트 fixture | 새 Windows PC에서의 설치 수용 |
| 파일 전체 SHA-256 + fuses 일치 | 코드 서명, 게시자 메타데이터 |
| 루프백/Origin/토큰 경계 | 종합 보안 검토 |
| Steam 실시간 생성 AI 항목 조사 | Steam 상점/빌드 심사 |

**판매 준비 완료 상태가 아니며, 문서 스스로 그렇게 말하고 있다.**

---

## 부록: 주요 파일 지도

| 파일 | 역할 |
|---|---|
| [server/studio.js](../server/studio.js) | 반응 루프, 세션 상태, 메시지 큐 (325줄 / 40KB) |
| [server/index.js](../server/index.js) | Express 라우팅, 보안 미들웨어, 수명주기 (292줄 / 30KB) |
| [server/provider.js](../server/provider.js) | 13,004자 프롬프트 + 출력 스키마 |
| [server/codex-provider.js](../server/codex-provider.js) | Codex CLI spawn/파싱 |
| [server/audience-autonomy.js](../server/audience-autonomy.js) | 관객 유입·진화·제거 |
| [server/world.js](../server/world.js) | 단일 커밋 저장소 + 공개/비공개 분리 |
| [server/economy.js](../server/economy.js) | 포인트, 후원, 협상 |
| [server/viewer-context.js](../server/viewer-context.js) | 관객별 개인 컨텍스트 조립 |
| [server/ambient.js](../server/ambient.js) | 6종 주제 흐름 + 조용한 동행 |
| [src/App.tsx](../src/App.tsx) | 전체 UI 셸 (104줄 / 29KB, 최장 줄 2,547자) |
| [desktop/main.cjs](../desktop/main.cjs) | Electron 진입점 |
