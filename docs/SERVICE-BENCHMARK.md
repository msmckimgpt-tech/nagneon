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
