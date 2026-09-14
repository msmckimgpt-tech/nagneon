# 유사 서비스 벤치마킹과 구현

## 목표와 결정

2026-09-14 사용자 요청: 조사한 서비스들의 장점을 제품과 코드 구조에 적극 반영한다. 기능 이름만 추가하거나 비교표 작성만으로 완료하지 않는다. 관객은 **텍스트만** 유지한다. 개인 방송실이 기본이며 OBS와 실제 채팅 연동은 선택 기능이다. 외부 채팅 대상은 사용자 선택에 따라 **치지직·유튜브**다. 기존 계정/모델 선택과 사용자 기록을 보존한다.

작업: `codex/service-benchmark`, `G:/dev/ai/00_game_backseat-worktrees/service-benchmark`, 기준 main `a10682910ddaad302a1e00c432e54734b0bf46f4`. 별도 의존성·프로필·증거를 사용한다. 현재 목표는 진행 중이며 아래 표 전체의 구현/실제 검증을 추적한다.

## 비교와 수용 기준

공개 페이지는 제공자의 설명이며 실행 품질의 증거가 아니다. 경쟁 제품의 예정 기능과 검증되지 않은 속도·비용 광고를 성능 사실로 사용하지 않는다. 비공개 소스 제품은 경험을 벤치마킹한다.

| 출처 | 가져올 장점 | 현재 기반 및 필요한 작업 | 완료 증거 |
|---|---|---|---|
| [ChatSim](https://chatsim.chat/) | 간단한 분위기/속도 조절, 화면·음성 반응, 로컬 실행 선택, 오버레이 | crowdStyle/chatPace/오버레이가 존재. 간편 프리셋과 로컬 모델 경로를 검토·반영 | 설정 보존, 실제 반응/오버레이/선택 제공처 검증 |
| [Not Real Live](https://notreallive.com/) | OBS 장면 입력, 사용량을 이해하기 쉬운 운영 | 선택 연결·해제·재연결·기존 캡처와 소유권 격리, 세션 사용량 안내 | OBS 장면과 실제 제품 입력 대조, 연결 실패/해제 시험 |
| [SimulChat](https://github.com/Ty0x7/SimulChat) | 다중 관객, 대기열/화면 변화 최적화, 이모트 | 기존 관객 자율성과 시간 맥락 유지. 소스 비교 후 정확성을 보존하는 개선 | 신선도·발언 우선·세션 취소·반복·표시 성능 회귀 |
| [Twick](https://twick.dev/) | 빠른 시작, 분위기·속도, Just Chatting, 연습 | 기존 안내/연습을 재사용하고 프리셋 접근성 개선 | 실제 설정 UI/키보드/좁은 창/저장 확인 |
| [Questie](https://www.questie.ai/) | 함께 본 게임과 취향 기억, 직접 호명, 동반자 성격 | 기존 목격 지식·관계·호명 개선점 조사. 음성 출력 제외 | 다음 세션 기억, 못 본 정보 구분, 호명 응답 실검증 |
| [HakkoAI](https://www.hakko.ai/) | 상황에 맞는 짧은 개입, 플레이 스타일 기억 | 기존 훈수 정책·조용한 시청·지식에 반영 | 요청/거절/침묵/게임 전환 회귀와 실검증 |
| [Sidekick](https://sidekick.modax.ai/ai-streaming-companion) | 실제 채팅과 방송 흐름에 함께 반응, 진행 보조 | 선택적인 외부 채팅 입력, 출처 구분, 읽기 전용 연결 | 연결/해제/세션 경계/외부 입력 신뢰 경계 검증 |
| [Razer AVA](https://www.razer.com/razer-ava/beta-program) | 맥락에 맞는 동반자, 쉬운 연결 경험 | 하드웨어 복제 대신 연결·상태·게임 동반 경험 개선 | 첫 사용·연결 오류 복구·게임 전환 검증 |
| [WATTSON](https://www.wattson.co.kr/) | 놓친 채팅을 주기적으로 짧게 확인 | 근거 채팅으로 돌아갈 수 있는 매니저 브리핑 추가 | 시간 창·삭제 반영·무음·가상/실제 구분·렌더러 검증 |

## 코드 조사

외부 저장소는 `artifacts/reference-*`에 읽기 전용 참고로 복제했다. 외부 실행 스크립트를 실행하지 않는다. 소스·에셋을 제품으로 복사하지 않으며 패턴을 검토하여 기존 구조에 독립적으로 구현한다.

- ChatSim 기준: `f1c618614f2cbde55de8d1de464e130ae657cd37`.
- SimulChat 기준: `3874c237d2edf5320a500562050ced63f3658bdf`.
- 비교 중점: 백그라운드 처리/취소, 캐시 문맥 경계, 프레임 신선도, 표시 대기열, 모델 제공처, 입력 출처, 제한된 데이터 흐름.

### 실제 소스에서 확인한 판단

- [SimulChat Chat.jsx](https://github.com/Ty0x7/SimulChat/blob/3874c237d2edf5320a500562050ced63f3658bdf/frontend/src/components/chat/Chat.jsx)의 스크롤 처리(약 799행 이후)는 독자가 위로 이동했을 때 자동 스크롤을 멈춘다. 이 경험을 `useChatFollow.ts`로 독립 구현했다. 새 채팅 알림과 복귀 버튼, 세션 전환, 뷰포트 크기 변경, 리스너 정리를 함께 처리한다.
- [SimulChat app.py](https://github.com/Ty0x7/SimulChat/blob/3874c237d2edf5320a500562050ced63f3658bdf/backend/app.py)의 bounded analysis queue는 과도한 대기 작업을 막는 방향이 유용하다. 반면 `perform_visual_analysis`의 시간/context_type 기반 분석 캐시는 새 이미지 내용을 구분하지 않아 채택하지 않는다. BACKSEAT의 시간·세션·sourceId·확인된 전달 구간을 유지한다.
- 같은 파일의 `response_cache = {}` 선언이나 README의 비용 절감 주장은 실제 한국어 품질/절감의 증거로 사용하지 않는다. [ChatSim bot_engine.py](https://github.com/TBA115/ChatSim/blob/f1c618614f2cbde55de8d1de464e130ae657cd37/backend/bot_engine.py)의 semaphore(2)와 시각 분석 간격 제한도 동시 추론 상한이라는 원리로 평가하며 기존 발언 우선 취소 구조를 보존한다.
- **새 구조 개선:** 모델/기억 캐시가 아닌 UI 상태 전송을 최적화한다. `server/state-stream.js`는 초기 전체 스냅샷 후 변경된 최상위 필드·메시지 추가/삭제/교정만 보내고 동일 상태 heartbeat는 생략한다. 느린 창은 과거 스냅샷을 무한 대기시키지 않고 drain 후 최신 상태로 합친다. `shared/state-patch.js`는 변경되지 않은 메시지 참조를 유지하므로 기존 `memo(ChatLine)`이 실제로 재사용된다. `useStudioState.ts`가 상태 연결 수명을 맡고 App에서 분리했다. 기존 `/api/events` 전체 스냅샷 프로토콜도 유지한다.

## 진행과 검증

- 독립 worktree 생성, `npm ci` 성공(취약점 0건).
- **첫 제품 묶음 구현:** 네 가지 분위기 프리셋(규모 느낌/속도/관망 비율), 이전 채팅 읽는 위치 유지/새 채팅 복귀, 최근 1분 질문·후원·같은 표현을 원문으로 모아보기. 브리핑은 추가 모델 호출 없이 남아 있는 실제 표시 채팅만 추리며 AI 의미 요약이나 미답변 질문으로 표시하지 않는다. 가상 기획·리허설·삭제/비활성 관객·이전 세션·미래 시각 제외. 새로운 저장소나 기억을 생성하지 않는다.
- `artifacts/benchmark-check-2.log`: 609개 테스트와 TypeScript/Vite 통과. 느린 연결의 backpressure 처리와 회귀 테스트 추가 후 `benchmark-check-final.log`에서 **610개 테스트/TypeScript/Vite 통과**. ChatLine의 콜백 참조도 고정하여 memo 재사용을 보장했다. 최종 코드에서 `benchmark-check-callbacks.log`의 **610개 테스트/TypeScript/Vite**와 `service-benchmark-ui-1789385514384/result.json`의 **5개 실제 렌더러 흐름**을 다시 통과했다.
- `artifacts/benchmark-focused.log`: 실제 SSE 두 연결에서 초기 93,301바이트, 500개 이력의 한 건 교체 패치 230바이트. 합성 데이터의 **전송량** 비교이며 추론 속도·캐시 토큰 비용·실제 게임 FPS 개선 측정이 아니다.
- `artifacts/service-benchmark-ui-1789385324868/result.json`: 실제 Electron/격리 서버에서 프리셋 초안·저장/기존 관객 보존, 스크롤 읽기 위치/복귀, 브리핑 원문/삭제 반영, 1440·1100·600폭, 새 세션 초기화 5흐름 통과. 해당 폴더 desktop/layout PNG를 시각 확인했다. 모델/대화는 합성이며 실계정·물리 마이크·실제 게임 수용이 아니다.
- 초기 UI 검증에서 낮은 창의 채팅 공간 부족을 발견했다. 브리핑을 문서 body의 떠 있는 패널로 바꾸고 별도 행을 없앴으며 낮은 창에서는 고정 규칙의 본문을 접었다. 원본 실패는 `service-benchmark-ui-1789384867427`, `1789384939040`, `1789385007973`, `1789385102573`과 `benchmark-ui-*.log`에 보존한다. 숨긴 창의 비동기 스크롤 시험은 표시한 전용 QA 창에서 검증하도록 보정했다.
- 첫 묶음 통합: 다른 작업 `codex/nagneon-brand`의 통합 잠금이 있어 보류 중이다. 해당 잠금을 삭제하거나 우회하지 않는다. 검증된 작업 브랜치를 먼저 게시한다. OBS/외부 채팅/선택 로컬 제공처/나머지 경험의 실제 수용은 계속 남아 있다.

## 외부 연동 다음 단계

### OBS 첫 구현 · 2026-09-14

`server/obs-input.js`는 공개 MIT 클라이언트 `obs-websocket-js@5.0.8`를 사용한다. 앱 UI의 **OBS 장면 연결**에서 같은 PC의 포트/비밀번호로 연결하고 장면을 고르면, 기존 관찰 주기의 `/api/react`가 그 장면의 JPEG를 읽어 시간·sourceId·방송 sessionId가 있는 기존 영상 입력 경로로 보낸다. 장면 전환이나 해제는 `studio.endVideo`로 이전 응답/대기 메시지를 취소한다. 네이티브 긴급 정지의 직접 `studio.stop()` 호출도 연결을 해제한다. 일반 화면으로 전환할 때는 새 캡처 준비 후 OBS를 해제한다.

인증과 RPC를 직접 재작성하지 않고 검증된 클라이언트에 맡기며, 제품 어댑터는 `GetSceneList`/`GetSourceScreenshot` 두 읽기만 호출한다. 비밀번호는 연결 요청에만 사용하고 일반 상태/내보내기/설정/프롬프트에 넣지 않는다. 사용자 화면에서 연결 취소는 HTTP 요청 중단과 서버 연결 정리를 함께 수행한다. 오래된 응답/잘못된 이미지/크기 초과는 화면 연결을 해제하고 다시 장면 선택을 안내한다. 요청 중첩은 새 대기열을 만들지 않는다.

검증:

- `artifacts/obs-focused-final.log`: 연결·선택, JPEG 정규화, 이전 장면/연결의 늦은 결과 차단, 인증 비밀 비노출, 실제 v5 JSON WebSocket의 challenge 인증, 인증된 HTTP API에서 모델 입력 전달/긴급 종료 등 7개 통과.
- `artifacts/obs-check-1.log`: 첫 OBS 구현 기준 615개 전체 테스트/TypeScript/Vite 통과. 이후 취소·인증 테스트와 미리보기 안내를 보강했으므로 최종 검사 로그는 후속 기록으로 추가한다.
- `artifacts/service-benchmark-ui-1789386135840/result.json`: 격리된 실제 Electron에서 연결·장면 선택·유효 JPEG 미리보기·해제와 기존 기능 6흐름 통과. OBS 응답과 모델은 합성이다. 별도 프로토콜 시험은 실제 WebSocket 소켓과 실제 클라이언트를 사용하지만 OBS 프로그램 자체가 아니다.

**남은 실제 수용:** 설치된 OBS의 실제 장면과 픽셀/모델 반응 대조. 표준 OBS 설치 경로에서는 실행 파일을 확인하지 못했으며 다른 설치 경로의 부재를 단정하지 않는다. 현재 OBS 연결은 관찰 주기의 정지 이미지이며 연속 프레임·OBS 오디오·클립 녹화 입력은 포함하지 않는다. 개인 방송실의 기존 직접 캡처·시스템 소리 기능은 유지한다. 전체 벤치마킹 목표와 다른 연동은 계속 진행 중이다.

- [OBS WebSocket v5](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md): 명시적으로 선택한 장면의 `GetSourceScreenshot` 읽기. 방송 시작/정지/장면 변경 명령을 보내지 않는다. 기존 캡처와 입력 소유권·해제 취소를 공유한다.
- [치지직 Session](https://chzzk.gitbook.io/chzzk/chzzk-api/session): 공식 앱/사용자 인증 후 채팅 조회 scope로 세션 생성, SYSTEM 연결 완료의 sessionKey로 CHAT 구독. 자동 재접속은 새 인증 세션과 중복 제거/이전 세션 취소를 검증한다.
- [YouTube LiveChatMessages](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list): 공식 API의 liveChatId, nextPageToken, pollingIntervalMillis와 방송 종료/권한 오류를 처리한다. 시청자 대신 메시지를 게시하는 API는 연결하지 않는다.
- 연결 정보는 일반 설정/SSE/내보내기/AI 프롬프트에 넣지 않는다. 외부 메시지는 스트리머 명령이나 AI 관객의 기억과 출처를 혼동하지 않는다. 비공개 코드 제품의 내부 구조를 확인했다고 주장하지 않는다.

최종 OBS 검증: `artifacts/obs-check-release.log`에서 **617개 테스트/TypeScript/Vite 통과**, `artifacts/service-benchmark-ui-1789386507001/result.json`에서 **실제 Electron 6흐름 통과**. 실제 OBS 프로그램 연결은 여전히 미검증이다.

사용자 확인: 치지직·YouTube 개발자 앱/API 설정은 아직 없다. [외부 채팅 설정 준비 안내](EXTERNAL-CHAT-SETUP.md)를 추가했다. 콜백 URL과 연결 UI가 구현되기 전에는 설정 완료나 실계정 수용을 주장하지 않는다. YouTube 공식 Streaming Live Chat 문서에서 API 키 인증 지원을 확인했으며, 최신 권장 방식인 `streamList` 지속 연결을 우선 검토한다.

다음: 치지직·YouTube 읽기 전용 연결과 설정 흐름, 선택 로컬 제공처, 나머지 경험 및 실제 수용 검증을 계속한다. 모든 행의 검증이 끝나기 전 전체 목표 완료로 표시하지 않는다.

### YouTube 수신 계층 · 2026-09-14

`server/youtube-chat.js`는 공식 `streamList` gRPC 서비스를 읽는 전용 어댑터다. `@grpc/grpc-js@1.14.4`와 `@grpc/proto-loader@0.8.1`를 고정했다. `youtube-chat.proto`는 공식 문서의 필드 번호를 사용하는 수신용 부분 스키마이며, 쓰기 서비스가 없다. 영상 ID는 허용된 YouTube URL에서만 추출하며 메타데이터 요청의 리디렉션을 금지한다. 키는 헤더/gRPC 메타데이터로 전달하고 일반 상태나 오류로 반환하지 않는다. 메시지 크기 상한, 중단 신호, 마지막 토큰으로 최대 3회 재접속, 권한/할당량 오류의 종료를 구현했다.

`server/external-chat.js`는 플랫폼·연결 UUID·방송 세션별 임시 버퍼다. 오래된 초기 이력과 이전 연결/세션 메시지를 제외하고, 삭제 표식과 중복 ID를 처리한다. 최대 200개 표시 원문과 4,000개 중복 ID를 보유하며 AI 입력 후보는 최근 1분/최대 20개다. 무제한 전체 이력 중복 방지는 아니다. 작성자 이름이 `streamer`여도 `kind: external`을 유지하며 페르소나·후원 재화·기억으로 등록하지 않는다. 입장 전 메시지는 개인 맥락에서 제외한다.

검증: `artifacts/external-chat-focused-final-2.log`의 8개 시험에서 실제 gRPC 소켓의 재개 토큰/인증 메타데이터/취소/재시도 상한, 오류의 키 비노출, URL/응답 크기 제한, 플랫폼 출처·중복·삭제·홍수 입력·세션 전환을 확인했다. 첫 오류 모의 시험은 서버 스트림 `destroy`가 상태를 전송하지 않아 시간 초과했으며, 라이브러리의 `error` 처리 경로를 확인하고 실제 gRPC 오류 상태를 보내도록 고쳤다. 실패 원본은 `external-chat-focused-final.log`에 남아 있다. `artifacts/youtube-transport-check.log`에서 전체 625개 테스트와 TypeScript/Vite 빌드가 통과했다.

**아직 연결하지 않은 범위:** 앱 라우트·설정 화면·관객 반응 경로, 치지직 어댑터. 현재 어댑터를 실계정 YouTube에 접속한 증거도 없다. 다음 단계에서 임시 버퍼를 개인 맥락과 연결하고, 외부 채팅 삭제/연결 해제가 진행 중 AI 응답까지 무효화하도록 구현한다. 사용자 개발자 설정은 준비되지 않았으므로 실제 플랫폼 수용은 별도 단계로 남긴다.

배포 검토에서 기존 서버 파일 허용 목록이 `.js`만 포함해 `.proto`가 빠질 문제를 확인했다. Windows 패키징과 소스 무결성 검사 양쪽에 `.proto`를 포함하고 ASAR 포함/해시 검증 fixture를 보강했다. 이 변경 후 최종 필수 검사는 `artifacts/youtube-transport-check-final.log`에 기록한다. 전체 Windows 설치 파일 재생성과 실제 플랫폼 수용을 이 검사로 대체하지 않는다.

### YouTube 앱 연결 및 관객 맥락 · 2026-09-14

`external-chat-session.js`와 `ExternalChatPanel.tsx`를 추가했다. 실제 AI 방송 중 URL/API 키로 연결하면, 플랫폼 출처가 붙은 원문을 별도 화면에서 확인할 수 있다. 텍스트를 HTML로 실행하지 않는다. 연결 요청 취소·실패·재연결·방송 종료는 세션별로 정리하며, 이전 연결의 늦은 콜백은 새 연결을 변경하지 않는다. API는 기존 로컬 앱 인증을 적용하고 키를 저장하거나 SSE로 반환하지 않는다.

`liveViewerContext`는 입장 이후 원문만 `externalChat`에 별도 전달한다. 일반 채팅·스트리머 발언·개인 기억으로 합치지 않으며, 외부 글로 훈수 허락을 만들지 않는다. 새 원문 ID를 기존 관찰 중복 제어에 포함해 같은 화면에서도 반응할 수 있다. 모델 호출과 대기 반응에는 입력 원문의 ID를 붙이고 삭제·해제·보관 시간 만료로 해당 ID가 사라지면 관련 응답을 취소한다. 원문 보관은 최대 1분이며 주기적으로 만료한다.

검증: `artifacts/external-session-check-final.log`에서 **629개 테스트와 TypeScript/Vite 통과**. 인증 API → 실제 Studio 반응 경로에서 출처 전달/훈수 금지, 삭제 시 생성 취소, 늦은 콜백 차단, 입장 시점 제한, 만료 및 긴급 종료를 검증했다. `artifacts/service-benchmark-ui-1789387460960/result.json`에서 **Electron 7흐름 통과**: YouTube 연결, 원문 표시/HTML 비실행, 삭제 반영, 해제 및 키 초기화를 기존 OBS·프리셋·스크롤·브리핑 검증에 추가했다. 외부 수신과 모델은 fixture이며 실제 YouTube 계정 연결 성공을 뜻하지 않는다.

사용 안내를 `EXTERNAL-CHAT-SETUP.md`에 갱신했다. 현재 작업 브랜치에서는 YouTube 연결을 시도할 수 있다. 치지직 연결, 선택 로컬 모델, 나머지 경험 및 실제 플랫폼/OBS 수용, main 통합은 여전히 남아 있다.

### 치지직 인증·수신 모듈 · 2026-09-14

`chzzk-auth.js`는 기본 `http://127.0.0.1:4319/chzzk/callback`에서 일회용 인증 응답을 받는다. 임의 state/중복 파라미터/다른 경로·Host를 거절하고, 취소·5분 만료 때 소유한 서버와 요청을 정리한다. Client Secret과 인증 코드는 공식 토큰 API에만 전송하고 콜백 본문/일반 상태에 넣지 않는다. 공통 API 응답의 `content` 봉투를 처리한다. Refresh Token은 저장하지 않으며, 현재 구현은 만료 후 사용자 재인증 방식이다. 앱 로컬 해제와 플랫폼 전체 토큰 철회는 다른 동작이다.

`chzzk-chat.js`는 공식 세션 생성 → SYSTEM connected → 채팅 구독 → SYSTEM subscribed 순서를 따른다. 수신은 승인된 채널의 CHAT만 허용하고 권한 철회·연결 종료·인증 만료 때 멈춘다. 세션 URL은 HTTPS의 `*.nchat.naver.com`만 허용하며 리디렉션과 과대 응답을 차단한다. 채팅 전송 API는 없다. 공식 채팅 이벤트에는 고유 message ID/삭제 이벤트가 명시되어 있지 않으므로 채널·작성자·시각·내용의 해시로 중복을 구분한다. 동일 작성자가 같은 밀리초에 같은 내용을 보내면 한 건으로 합쳐질 수 있으며 원격 개별 삭제 동기화는 보장하지 않는다. 이 한계를 실제 연결 안내에도 반영해야 한다.

치지직이 지정한 Socket.IO 1.x–2.0.3과 호환되도록 공식 [Socket.IO protocol 4](https://raw.githubusercontent.com/socketio/socket.io-protocol/v4/Readme.md) / [Engine.IO protocol 3](https://raw.githubusercontent.com/socketio/engine.io-protocol/v3/README.md)의 기본 네임스페이스 텍스트 이벤트·클라이언트 ping/pong만 구현했다. 제품 의존성은 `ws@8.21.3`이며 구형 polling/JSONP 패키지는 제품에 포함하지 않는다. 자동 재접속은 아직 없으며 실패 후 명시적으로 다시 연결한다.

검증: `artifacts/chzzk-focused.log`의 6개 시험은 실제 loopback HTTP 인증/취소/만료, 실제 WebSocket 수신/중복 구독 방지/ping/권한 철회, 채널·URL 제한을 확인한다. 별도 `artifacts/socketio-compat`에 스크립트 실행 없이 설치한 공식 Socket.IO 2.0.3 서버를 `scripts/verify-chzzk-protocol.mjs`로 구동했고 `artifacts/chzzk-socketio-compat.log`에서 이벤트 2개와 ping 2회의 호환성을 확인했다. 이 참고 의존성은 배포 대상이 아니다. `artifacts/chzzk-check.log`: **635개 전체 테스트/TypeScript/Vite 통과**. 인증 변경의 필수 회귀인 `chzzk-account-device.log`, `chzzk-account-runtime.log`도 통과했으며 빈 Codex 홈/별도 앱 프로필에서 발급·취소만 시험했다. 로그인 완료·모델 호출·기존 계정 변경은 없다.

남은 치지직 범위: 앱의 인증 시작/취소 화면, 브라우저 열기, 공통 외부 채팅 세션 연결, 실제 개발자 앱/계정 수용. 모듈 및 프로토콜 시험을 실제 치지직 연결 성공으로 간주하지 않는다.
