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

### 치지직 앱 연결 · 2026-09-14

외부 채팅 패널에서 YouTube/치지직을 선택한다. 치지직은 Client ID/Secret과 콜백 등록 안내 → 기본 브라우저 승인 → 채팅 수신 흐름을 제공한다. 서버가 만든 고정 치지직 인증 URL만 데스크톱의 `shell.openExternal`로 열며, 렌더러가 임의 URL을 전달해 열 수 없다. 브라우저 실행이 불가능할 때 복사 가능한 인증 주소를 제공한다. 주소는 인증 시작 응답과 컴포넌트의 임시 상태에만 있고 일반 SSE에는 넣지 않는다.

승인 후 확인된 채널을 기존 ExternalChat 버퍼/개인 관객 맥락에 연결했다. 세션 전환·취소·방송 종료는 인증 콜백 서버와 채팅 연결을 함께 정리하고 늦은 응답은 무시한다. 원격 개별 삭제 동기화 한계는 화면과 설정 안내에 명시했다. 현재 한 플랫폼씩 연결하며 자동 교차 게시 기능은 없다.

`artifacts/chzzk-session-check.log`: **637개 전체 테스트/TypeScript/Vite 통과**. 인증된 앱 API, 실제 loopback 승인 콜백, 서버가 생성한 주소만 브라우저로 전달, 승인 취소 후 포트 해제, 채널 분리/모델 입력/비밀 비노출을 검증했다. `chzzk-session-account-device.log`와 `chzzk-session-account-runtime.log`의 필수 인증 회귀도 별도 프로필에서 통과했다.

`artifacts/service-benchmark-ui-1789388726243/result.json`: **실제 Electron 8흐름 통과**. 치지직의 인증 시작·콜백·원문 출처·해제를 추가했다. 최초 캡처는 스크롤 아래 패널을 보여주지 못했고, 다음 캡처도 compositor 갱신 전이었다. 스크롤 후 실제 크기/가시 영역/두 렌더 프레임을 확인하도록 보강했다. 같은 폴더 `chzzk-layout.json`의 패널 좌표(246,437), 크기(785×208.75), visible/block과 `chzzk.png`의 원문/안내를 시각 확인했다. 이 과정에서 기능 CSS가 숨겨졌다는 증거는 없었고 제품 CSS를 임의 수정하지 않았다. 외부 승인·수신·모델은 fixture이며 실제 치지직 계정/권한 동의 성공은 미검증이다.

다음 범위: 선택 로컬 모델과 남은 서비스 경험 비교·적용, 실제 플랫폼/OBS 수용, 최종 통합. 전체 목표는 진행 중이다.

### 선택 Ollama 어댑터 · 2026-09-14

ChatSim의 로컬 제공처 선택 장점을 `OllamaProvider`로 반영했다. 기본 Codex를 유지하며 `AI_PROVIDER=ollama`를 명시했을 때만 사용한다. 기존 OpenAIProvider의 지침/시각/개인별 출처 패킷을 재사용하고 Ollama `chat` 메시지와 원래 순서의 base64 이미지로 변환한다. [공식 chat API](https://docs.ollama.com/api/chat)의 비스트리밍 응답 및 JSON schema 형식과 [show 정보](https://docs.ollama.com/api-reference/show-model-details)를 이용한다. 구조화 출력 이후에도 기존 Observation 스키마를 검증한다.

127.0.0.1의 HTTP 엔드포인트만 허용하며 리디렉션을 금지한다. GGUF/completion 확인, 원격 모델 메타데이터와 cloud 이름 차단, vision 확인, 요청 취소/시간 제한, 2MiB 응답 상한, 불완전 응답/tool call 거절을 추가했다. 선택 문맥 크기와 알려진 모델 상한을 비교하고 텍스트 UTF-8 바이트와 이미지별 여유량으로 사전 예산을 검사한다. 이는 이미지 토큰 수나 한국어 품질의 실측 보장이 아니다. 웹 검색은 지원하지 않으며, 요청 시 조용히 검색을 생략하는 대신 설정 안내를 반환한다.

연결 화면은 로컬 제공처 안내와 응답 확인을 표시하고 OpenAI API 키 입력을 숨긴다. 제공처 전환은 현재 환경 변수 단계이며 앱의 선택/저장 UI는 남아 있다. [Ollama 설정 안내](OLLAMA-SETUP.md)에 준비와 복귀 방법, 현재 한계를 기록했다.

`artifacts/ollama-focused.log`: 실제 loopback HTTP 요청의 지침·프레임 순서·스키마·usage, 텍스트 모델에 이미지 미전송, 원격 모델 거절, 잘린 응답/도구/형식 오류/검색/취소/응답 상한의 4개 시험 통과. `artifacts/ollama-check.log`: **641개 전체 테스트/TypeScript/Vite 통과**. `artifacts/ollama-ui-1789389164159/result.json`: 실제 Electron에서 로컬 안내/API 키 미표시 및 응답 확인의 어댑터 왕복 통과. `ollama-account-device.log`/`ollama-account-runtime.log`: 기본 Codex 계정의 필수 격리 회귀 통과.

실제 Ollama는 PATH와 기본 loopback 포트에서 확인되지 않았다. 자동 설치나 대용량 모델 다운로드를 수행하지 않았고 실제 추론·성능 수용은 남아 있다. 나머지 벤치마킹 범위와 통합도 계속 진행 중이다.

### 앱 안의 제공처 전환 · 2026-09-14

`ProviderChoice`는 Studio·ConnectionProbe·네이티브 계정 도우미가 참조하는 객체를 유지하고 추론 백엔드만 교체한다. 로컬 STT와 공식 Codex CLI 경로는 전환 후에도 유지한다. 모델/로컬 주소/문맥 크기만 기존 JsonStore로 저장하며 저장된 선택은 최초 환경 변수보다 우선한다. Ollama 준비 확인·저장 실패, 요청 취소, 진행 중 세션 변경은 기존 제공처를 유지한다. 방송·연습·모델 요청·기기 로그인 중에는 전환을 거절한다. 전환 뒤 이전 모델의 응답 확인 결과를 초기화한다.

연결 화면에 Codex/Ollama/OpenAI API 선택을 추가했다. Ollama 모델은 사용자가 설치한 정확한 이름으로 지정한다. OpenAI API의 별도 과금 안내를 분리했고 응답 확인 문구는 선택 모델에 공통으로 사용한다. 준비 순서와 Codex 복귀는 [로컬 모델 설정](OLLAMA-SETUP.md)에 반영했다.

- `artifacts/provider-selection-focused.log`: facade의 STT/계정 경로 유지, 준비·저장·취소 실패, HTTP API의 설정 지속성/활동 차단/세션 종료 경쟁 시험 3개 통과.
- `artifacts/provider-selection-check.log`: **644개 전체 테스트 + TypeScript/Vite 통과**.
- `artifacts/ollama-ui-1789389881267/result.json`: 별도 실제 Electron에서 Codex → Ollama 전환, 시험 응답, Codex 복귀와 이전 readiness 초기화 통과. 응답은 fixture이다. 최초 UI 시험은 검증 스크립트의 동일 lexical 변수 재선언으로 실패했고 스크립트 범위를 수정했다(1789389864504).
- `artifacts/provider-selection-account-device.log`, `provider-selection-account-runtime.log`: 격리된 공식 CLI 기기 코드 발급·취소와 실제 앱 렌더러 회귀 통과. 실제 로그인 완료나 유료 추론은 실행하지 않았다.

실제 Ollama 모델·OBS·치지직/YouTube 계정 설정에 의존하는 수용 검증, 남은 서비스 경험 비교와 main 통합은 남아 있다. 이 단계는 전체 벤치마킹 목표의 완료를 뜻하지 않는다.

### 최신 나그넌 통합 검증 · 2026-09-14

깨끗한 `G:/dev/ai/00_game_backseat-worktrees/service-benchmark-integration` / `codex/service-benchmark-integration`에서 작업 커밋 `6a749ba`와 main `878c41e`를 합쳤다. 통합 잠금 소유권을 확보하고 별도 `npm ci`를 수행했다(취약점 0). App 충돌은 나그넌 브랜딩·세로 화면 개선과 브리핑·스크롤·OBS·외부 채팅을 함께 유지했다. 패키지 소스 검사는 새 LICENSE와 YouTube proto를 모두 포함한 12개 fixture 파일을 확인한다.

최신 main의 응원 포인트 통계를 유지하며 연결 설정에 세션 요청 수/앱 한도 및 제공처가 보고한 누적 토큰을 추가했다. 실패 요청과 연결 시험/계정 전체 사용량의 차이를 표시하며 비용·잔여 구독량으로 환산하지 않는다.

- `artifacts/integration-check-final.log`: **645개 전체 테스트 + TypeScript/Vite 통과**. 첫 검사 `integration-check.log`에서는 experiences HTTP 시험의 `fetch failed`가 발생했다. 같은 코드의 해당 파일 12개 시험(`integration-experiences.log`)과 최종 전체 검사는 통과했다. 최초 출력에 하위 네트워크 원인이 없어 원인 확정은 하지 않는다.
- `artifacts/service-benchmark-ui-1789390245883/result.json`: 실제 Electron 8개 제품 흐름 통과. 치지직 패널 PNG와 가시 영역 좌표도 확인했다. 최초 통합 UI 시험은 OBS 미리보기 제거 직후 서버 해제 전에 검사하여 실패했다. 서버 상태가 반영된 장면 선택 UI 제거까지 기다리도록 검증을 보강했으며 해제 자체를 모의 성공 처리하지 않았다.
- `artifacts/nagneon/renderer-result.json`: 새 브랜드 온보딩·8개 페이지·1440/1000/850 가로·1080/850 세로·540/420 좁은 창·오버레이·리허설·콘솔 오류 검사 통과.
- `artifacts/integration-account-device.log`, `integration-account-runtime.log`: 공식 CLI 격리 기기 코드 발급/취소 및 실제 데스크톱 로그인 UI 회귀 통과.
- `artifacts/ollama-ui-1789390289100/result.json`: 실제 렌더러의 제공처 선택/시험 응답/Codex 복귀 통과. 모델과 외부 플랫폼은 fixture이며 실제 플랫폼·OBS·Ollama 수용 증거를 대신하지 않는다.

남은 서비스별 경험 감사, 실장치/외부 계정 수용은 계속 진행한다. 기존 설치 패키지는 이번 기능이 포함된 새 패키지로 검증한 상태가 아니다.

### 관객 경험 감사와 문자 반응 · 2026-09-14

[SimulChat의 EmoteManager](https://github.com/Ty0x7/SimulChat/blob/3874c237d2edf5320a500562050ced63f3658bdf/frontend/src/components/emotes/EmoteManager.jsx)는 7TV 세트로 짧은 시각 반응을 제공한다. 텍스트만 유지한다는 사용자 결정에 따라 외부 이미지 세트 대신 웃음/박수/놀람/눈물/좋아요/응원/축하/집중 문자 선택기를 독립 구현했다. 입력창의 커서 또는 선택 영역에 넣고, 자동으로 보내지 않는다. 기존 3000자 한도와 사용자의 보내기 동작을 유지하며 Escape/밖 클릭/포커스 이동/방송 종료 때 닫는다. 관객 측에는 이미 짧은 감탄과 다양한 말투를 허용하는 `conversation-rhythm.js`가 있어 모든 관객에게 이모지를 강제하는 새 규칙은 넣지 않았다.

`artifacts/text-reactions-check-final.log`: **645개 테스트 + TypeScript/Vite 통과**. `artifacts/service-benchmark-ui-1789390718571/result.json`: 실제 Electron **9개 흐름 통과**. 문자 삽입 위치, 자동 전송 방지, 입력창 포커스, Escape, 1440/600/420폭과 가려짐 여부를 확인했다. 최종 `text-reactions.png`를 시각 확인했다. 초기 캡처(1789390645391)에서 웃음 글자가 세로로 감긴 문제를 찾아 버튼 여백/nowrap을 수정했다.

[Questie FAQ](https://www.questie.ai/faq)의 세션 간 게임/대화/취향 기억 장점을 현재 구현과 대조했다. 새 클라우드 기억 저장소를 추가할 필요 없이 개인별 목격 출처와 원문 삭제가 이미 구현되어 있다. `viewer-knowledge.test.js`는 재시작 후 목격 시간/장면과 신규 관객의 무경험을, `conversation-journal.test.js`는 실제 서버 재시작·핀·내보내기·삭제 및 다른 관객의 기억 분리를 검증한다. `quiet-viewing-company.test.js`는 침묵 요청 중 일반 관객의 자발적 개입을 줄이고 직접 호명한 질문은 우선하는 입력 구성을 검증한다.

실제 기본 Codex `gpt-6-astra` / `low`로 추가 수용 검사를 수행했다:

- `artifacts/conversation-live-1789390734603/progress.json`, `artifacts/conversation-memory-live.json`, `benchmark-memory-live.log`: 8턴. 최근 이력을 넘어선 합성 원문과 재시작 뒤 금요일→토요일 정정, 이후 약속 취소, 새 관객의 직접 듣지 않은 정보 구분, 모모의 ‘이번 주 작은 기쁨’/고양이의 ‘그때 왜 그랬을까’ 코너 구분을 실제 표시 응답에서 확인했다. 입력 패킷의 출처 검사뿐 아니라 8턴의 실제 응답을 검토했다.
- `artifacts/advice-continuity-hVRfwr/result.json`, `benchmark-advice-live.log`: 6턴의 실제 모델 출력과 표시 채팅을 검토했다. 최초 방어 수치의 단일 힌트, 새 요청 없는 두 프레임의 침묵, 추가 행동 없이 이유 설명, 다음 턴 힌트 재개, ‘훈수는 그만’ 뒤 ‘지켜볼게요’만 표시되는 것을 확인했다. 구조 검사도 통과했다. 카드 정보는 타이핑으로 제공했고 이미지는 빈 PNG이므로 게임 화면 인식 검증은 아니다.

#### 현재 서비스별 수용 상태

| 서비스 | 구현·검증된 장점 | 남은 수용 범위 |
|---|---|---|
| ChatSim | 프리셋, 오버레이, Ollama 선택/복귀·HTTP 스키마 | 실제 로컬 모델 및 게임 화면/음성 추론 |
| Not Real Live | OBS 선택 어댑터, 연결 설정의 요청 수·토큰/한도 안내 | 실제 OBS 장면 픽셀과 관객 반응 |
| SimulChat | 대기열/신선도 유지, SSE 패치, 읽기 위치, 문자 반응 | 장시간 실제 게임 표시 성능 |
| Twick | 첫 사용·리허설·Just Chatting, 프리셋, 좁은/세로 창 | 실제 첫 사용자 장시간 체험 |
| Questie | 목격·대화 기억, 직접 호명, 실제 모델의 개인별 회상/정정 | 자연스러운 장시간 세션의 일반화 |
| Hakko | 단일 힌트·이유 설명·침묵·중단의 실제 모델 응답, 기존 개인 취향/참여 구조 | 실제 게임/음성에서 플레이 스타일 경험 |
| Sidekick | 치지직/YouTube 읽기 전용 맥락, 원문/출처/취소/삭제 경계 | 개발자 앱/키 준비 후 실제 플랫폼 승인·수신 |
| Razer AVA | 연결 선택/오류 복구, 첫 사용, 동반자 맥락 경로 | 실제 입력 장치·게임 변경 경험 |
| WATTSON | 추가 모델 호출 없는 최근 원문 브리핑·삭제 반영·좁은 창 | 실제 방송의 혼잡한 채팅에서 사용성 |

음성 출력과 전용 하드웨어는 사용자 결정/프로젝트 형태상 복제하지 않는다. 전체 목표는 남은 실제 수용과 새 설치 패키지 검증이 있어 계속 진행 중이다.

### 사용자 추가 요청: 디버그 모드 · 2026-09-14

설정의 디버그 탭에 활성 스위치, 시스템 프롬프트 추가/전체 대체/기본값 복원, 자동 생성 프롬프트 읽기/편집창 복사, 평소 잠긴 관객·유입 설정의 전체 JSON 편집을 추가했다. 별도 `debug.json`에 저장하며 활성일 때 모든 서버 제공처 요청에 적용한다. 일반 설정의 관객 편집 금지는 유지하고 디버그 전용 경로에서만 사용자가 명시적으로 수정할 수 있다. 상세 동작과 증거는 [디버그 모드](DEBUG-MODE.md)에 기록했다.

`World` 원자적 저장/스키마/관객 ID 보존, 오래된 초안 검사를 유지한다. JSON 고급 설정을 적용하면 창을 닫아 일반 탭의 이전 초안이 새 설정을 덮어쓰지 않도록 한다. 제공처의 구조화 출력과 실행 권한은 별도이며 프롬프트 편집만으로 바뀌지 않는다.

패키지 `release/2026-09-14T13-03-48-578Z`는 디버그 요청 전에 만든 2,452개 파일 / 3,142,414,554바이트 미서명 빌드이며 디버그 기능이 없어 최신 수용 대상으로 사용할 수 없다. 첫 무결성 검사도 선행 `packaged-runtime-test.json`이 없어 완료되지 않았다. 디버그를 포함한 새 빌드에서 런타임→무결성 순서로 검증해야 한다.

OBS 32.2.2 공식 포터블 ZIP은 `artifacts/obs-32.2.2.zip`에 받았으며 GitHub 제공 SHA-256 `4d6e40e3ab155f56b30de517380566a206d74b63cdf5ad49aa596924768f97e1`와 일치했다. `artifacts/obs-portable`에 압축 해제했지만 아직 실행하지 않았다. 포터블 격리 프로필/시험 장면을 구성해 실제 OBS 입력 검증을 이어갈 수 있다. 실제 외부 플랫폼/로컬 모델/패키지 수용 목표는 계속 진행 중이다.

### 디버그 포함 패키지와 실제 OBS 수용 · 2026-09-14

최신 기능/디버그 소스 `dd51e97`로 `release/2026-09-14T13-18-10-132Z/app/Nagneon-win32-x64` 독립 실행본을 새로 만들었다. **2,452개 파일 / 3,142,423,485바이트 / 미서명**이다. 기존 사용자 설치본을 교체하지 않았다. 설치 마법사(NSIS)와 이 독립 실행 폴더는 구분한다.

- `artifacts/debug-package.log`: allowlist 패키징 완료. 다른 작업의 음성 런타임은 읽기 원본으로만 사용하고 패키저가 검증·복사했다. sound/microphone 모델은 이 worktree의 별도 `.models`로 복사했다.
- `artifacts/packaged-runtime-test.json`: 배포된 ASAR를 별도 폴더로 추출해 해당 모듈과 번들 Python/모델/공식 CLI로 실행했다. SHA-256 `5bf71b7eac70e04f5393c26b6f6589ddc3a990922c8bb9e902586e44af0b9c70`. 새로 생성한 Heami 한국어 WAV를 1,745ms에 정확히 전사했으며 번들 YAMNet/시스템 대사, 실제 Astra low 반응도 통과했다. 시스템 대사의 ‘게임 시작합니다’에 관객이 반응한 실제 출력도 확인했다. 음성 파일은 합성이며 물리 마이크/사용자 게임 소리의 품질 시험은 아니다.
- `artifacts/package-integrity-test.json`: 소스 **95개** 및 전체 파일 해시/ASAR fuses 비교 통과, failures=[]. 런타임 결과가 같은 배포 ASAR를 가리키는 것도 확인했다.
- `artifacts/nagneon/native-result.json`: 실제 Nagneon.exe를 별도 `--nagneon-profile`로 실행하여 제목/창/데이터 생성/정상 종료 통과.

[OBS 공식 포터블 ZIP](https://github.com/obsproject/obs-studio/releases/tag/32.2.2)을 검증 후 작업 폴더에서만 실행했다. [공식 실행 옵션](https://obsproject.com/kb/launch-parameters)의 portable/profile/collection과 [WebSocket 안내](https://obsproject.com/kb/remote-control-guide)를 따랐다. 초기 `Benchmark` 컬렉션에는 입력이 없음을 확인했고, 시험 도형 PNG 한 개만 image_source로 넣어 두 이미지 사이를 전환했다. 화면·마이크·오디오 장치를 캡처하거나 외부 방송/녹화를 시작하지 않았다.

`artifacts/obs-native-98Qc0o/result.json`, `obs-native.log`: **실제 OBS 32.2.2 / WebSocket 5.7.4 → 앱의 인증된 OBS HTTP 경로 → Studio → 실제 Codex 모델 → 표시 채팅** 두 턴 통과. 첫 JPEG의 왼쪽 빨간 원/오른쪽 파란 정사각형과 다음 JPEG의 위 노란 삼각형/아래 초록 원을 실제 observation/모모 채팅에서 올바르게 구분했다. 저장한 `obs-frame-1.jpg`/`obs-frame-2.jpg`와 대조했다. 같은 sourceId의 새 픽셀을 새 장면으로 전달했고 연결 해제, 다른 sourceId로 재연결, 방송 종료 시 해제, OBS의 방송/녹화 비활성·image_source 외 입력 부재를 검사했다. 두 턴 지연은 10,440ms/10,313ms이며 광범위한 게임 성능 측정은 아니다.

시험 OBS의 숨긴 창은 CloseMainWindow와 WM_CLOSE 이후에도 종료되지 않았다. PID 29052의 생성 시각·정확한 포터블 경로를 다시 확인한 뒤 해당 시험 프로세스만 종료했고 잔존 프로세스가 없음을 확인했다(`artifacts/obs-shutdown-final.json`). 제품의 연결 해제는 그 전에 정상 통과했지만 OBS 자체의 정상 종료를 주장하지 않는다.

남은 범위: 실제 로컬 Ollama 모델, 사용자가 준비할 치지직/YouTube 개발자 설정에 기반한 승인/채팅 수신, NSIS 설치본 및 장시간 실제 게임/장치의 경험 수용. 전체 목표는 아직 진행 중이다.
