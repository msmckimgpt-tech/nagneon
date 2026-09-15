# 비판 리뷰 개선 진행

기준: 1c61cf98b8f73e67badb7bbbc7ddc155b2506ba5. 원문: project-analysis-review/docs/CRITICAL-REVIEW.md (리뷰 커밋 5b5539e).
작업: codex/critical-review-remediation, G:/dev/ai/00_game_backseat-worktrees/critical-review-remediation.

## 사용자 결정

- 방송 체험·연습, 빈 방송실의 괴리감 완화, AI 동반자와 관계를 쌓는 게임을 하나의 경험으로 제공한다.
- 시즌·기획 방송은 의도한 기능이 아니다. 정해진 시나리오를 강제로 주입하지 않는다. 사용자가 자연스럽게 주도하고 관객은 실제 대화를 인지한다. 기존 저장 기록은 보존하며 비활성 기능을 제거한다.
- 기존 관객 생성 방식을 유지하고 새 프로필 시작 포인트만 200P로 올린다. 체험용 관객이나 무료 생성은 추가하지 않는다.
- 개인용·공개용 오버레이를 선택할 수 있게 한다. 공개용에는 AI 관객과 가상 포인트를 명시한다.
- 외부 채팅은 기본 익명화, 명시적으로 선택할 때만 닉네임을 전달한다. 연결 전 전송 안내와 확인을 추가한다.
- 이름·성격은 관객 자율성을 유지한다. 사용자 편집·닉네임 승인 기능은 추가하지 않는다. 5-5/5-6의 편집 제안은 사용자 결정으로 채택하지 않는다.

## 검증 기준

각 지적을 사실·제품 결정·외부 조건으로 구분한다. 수정은 npm run check와 관련 회귀·격리 UI/런타임 검증 후 squash 통합한다. 실제 계정·장치·배포 검증과 synthetic 결과는 구분한다. 서명 구매·상용 계약·게시자 정보는 사용자 결정과 외부 조건이 필요하며 코드 검사로 대체하지 않는다.

## 기준 검증

- 격리 worktree npm ci: 228 패키지 설치, audit 0건.
- npm run check: 679/679 테스트 및 TypeScript/Vite 빌드 통과. 원본: artifacts/critical-review/baseline-check.log.
- CI .github/workflows/check.yml에는 이미 main checkout → npm ci → check가 있다. CI 누락 주장은 사실과 다름.
- 실행 중 고정 설치본 0.1.2가 확인되어 main 의존성 갱신과 테스트는 별도 작업으로 구분한다.
- 웹 xhigh 검토·종합은 아직 실행 전. 브라우저 상태 조회 지연을 조사 중이다.

## 전체 지적 원장

| 번호 | 지적 | 상태 |
|---|---|---|
| 1-1 | 리브랜딩이 절반만 됐고, 그게 화면에 보인다. | 1차: 주요 라임 강조색을 --neon으로 통일. 전체 토큰 정리는 남음 |
| 1-2 | 첫 실행에서 보여주는 캐릭터가 실제로는 존재하지 않는다. | 수정: 가상 인물 미리보기 대신 실제 빈 방송실·도우미·초대 안내 |
| 1-3 | 그 도우미가 관객 행세를 한다. | 수정: system 페르소나 리허설 채팅 제외, 빈 방은 notice |
| 1-4 | 정보 밀도가 폰트 크기로 도망갔다. | 수정: CSS 8~10px 글씨를 최소 11px로 확대; 격리 화면 검사 통과 |
| 1-5 | 설정이 32개 필드인데 섹션 제목은 3개다. | 사실 정정: 설정은 이미 7개 탭. 고급 항목 설명은 추가 검토 |
| 1-6 | 아이콘 버튼의 접근성이 반쪽이다. | 수정: title-only icon 버튼과 알림 닫기에 aria-label |
| 1-7 | 오버레이가 방송 송출용인지 개인 모니터용인지 불명확하다. | 수정: 개인/공개 선택과 AI·가상 포인트 표시. 실제 OBS 캡처 검증 남음 |
| 2-1 | 지금 이 저장소의 main에서 `npm run check`가 실패한다. | 해결: main npm ci 후 679개 테스트·빌드 재현. 기존 CI 절차 확인 |
| 2-2 | 한 줄에 2,547자. | 수정: 주요 진입점 5개 파일 포매팅, 고정 Prettier 및 check 편입 |
| 2-3 | 원숭이 패치 체인. | 수정: state/stop 덮어쓰기 체인을 단일 attachRuntime 연결로 교체 |
| 2-4 | 죽은 코드가 배포본에 들어간다. | 수정: 기획 엔진·자동 제안·전용 UI 제거, 옛 기록은 조회/내보내기 전용 |
| 2-5 | `reactInput()` 단일 함수 117줄. | 수정: 화면 준비·리허설·요청 구성·응답 수용·경험 저장 분리, 취소/오류 정리는 호출자에 유지 |
| 2-6 | 주석은 영어, 코드는 한국어, 문서는 한국어. | 정리: 개발 안내에 코드 식별자·제품 문구·주석 언어 규칙 명시 |
| 2-7 | worktree 40개가 방치되어 있다. | 대조·개선 예정 |
| 3-1 | 컨텐츠 총량을 세어보면 초라하다. | 대조·개선 예정 |
| 3-2 | 컨텐츠를 추가하는 방법이 "코드 수정"뿐이다. | 대조·개선 예정 |
| 3-3 | 만든 자산을 버렸다. | 사용자 결정: 시나리오 복구 미채택. 실행 자산 제거, 저장 판본 검증만 보존 |
| 3-4 | 관객 수 상한 40명이 컨텐츠 천장이다. | 사용자 결정: 수 상한 없음. 생성/저장·목격자/개인 시청 기록 상한 제거, README 사양별 운영 제안 |
| 3-5 | 밈(lore)이 30일 만에 죽는다. | 수정: 자동 만료·30개 초과 삭제 제거, 발언 관련 최대 3개 선별, 수동 삭제 |
| 3-6 | 게임 프로필 4개 중 3개가 한물간 선정이다. | 대조·개선 예정 |
| 4-1 | 제품 이름이 두 개다. | 1차: 사용자 JSON 파일명을 nagneon으로 변경. 내부 호환 식별자는 보존 |
| 4-2 | 팔 수 있는 상태가 아닌데 팔 준비 문서만 있다. | 대조·개선 예정 |
| 4-3 | 사용자가 비용을 두 번 낸다. | 대조·개선 예정 |
| 4-4 | 온보딩이 없는 기능을 약속한다. | 해결: 온보딩의 차단된 팬 페스티벌·기념 방송 예고 제거 |
| 4-5 | 포지셔닝이 방어되지 않았다. | 반영: 방송 체험·연습·빈 방 괴리감 완화·AI 관계 게임으로 README 명시 |
| 4-6 | MIT 라이선스로 공개했다. | 사용자 결정: 무료 공개·MIT 유지 |
| 5-1 | 설치부터 첫 관객까지의 경로가 잔인하다. | 사용자 결정: 생성 방식 유지, 시작 200P. 무료 프리셋은 미채택 |
| 5-2 | 포인트가 안 모인다. | 1차: 새 프로필 200P, 기존 잔액 보존. 경제 속도 추가 검토 남음 |
| 5-3 | 20초 늦는 관객은 게임 반응으로 쓸 수 없다. | 대조·개선 예정 |
| 5-4 | 호출 한도가 25분이다. | 해결: 시간·횟수 자동 제한 제거. 사용량 참고는 선택적으로 펼쳐 확인 |
| 5-5 | 관객이 내 허락 없이 자기 이름을 바꾼다. | 사용자 결정: 자율 닉네임 유지, 승인·편집 미채택 |
| 5-6 | 관객을 만들 수도, 고칠 수도 없다. | 사용자 결정: 관객 자율성 유지, 직접 편집 미채택 |
| 5-7 | 마이크가 GPU를 요구한다. | 대조·개선 예정 |
| 5-8 | 긴급 정지 단축키가 F9다. | 사용자 결정: 긴급 정지 기능 미채택. 전역 Ctrl+Shift+F9와 IPC 제거, 일반 방송 종료 유지 |
| 6-1 | 모델 호출 1회에 프로세스 하나를 fork한다. | 측정: CLI 시작 이벤트까지 0.3~0.7초, 응답 완료까지 추가 6.0~9.5초. 상주 방식의 격리 문제와 개선 범위는 RESPONSE-LATENCY.md |
| 6-2 | 13,004자 프롬프트가 매 요청 전송된다. | 측정: 지시문 36,054바이트, 대화 5~13KB, 입력 1.9~2.1만 토큰. 문맥 최적화·회귀 비교 남음 |
| 6-3 | 250ms마다 전체 상태를 직렬화한다. | 사실 정정: pump는 변경 시 발행, 별도 상태 확인은 5초. 빈 큐 40회 pump 발행 0회 확인 |
| 6-4 | SSE 패치 인코더가 비싸다. | 수정: 동일 직렬화 결과 조기 반환·이전 필드 문자열 재사용. 합성 2창 300회에서 15~66% 시간 감소, 전송량 동일 |
| 6-5 | 3개의 런타임을 동시에 들고 있다. | 1차: 서버 시작 시 음성 워커 기동 제거. 마이크 준비 시 지연 기동 |
| 6-6 | 이미지가 매 프레임 base64로 왕복한다. | 대조·개선 예정 |
| 6-7 | 실패 백오프가 관대하다. | 대조·개선 예정 |
| 8-1 | 내 채팅이 내 동의 없이 OpenAI로 간다. | 수정: 전송 안내·확인, 기본 작성자 익명화, 명시적 닉네임 선택. 실연결 검증 남음 |
| 8-2 | 스트리머가 나를 무시하고 봇에게 답한다. | 대조·개선 예정 |
| 8-3 | 지연이 나에게는 이상하게 보인다. | 대조·개선 예정 |
| 8-4 | 스트리머가 가짜 후원에 감사 인사를 한다. | 수정: 공개용 가상 포인트 후원 표시. 실제 OBS 검증 남음 |
| 8-5 | 인원수가 안 맞는다. | 수정: 공개용 AI 관객 명시. 실제 OBS 검증 남음 |
| 8-6 | 들키는 방식이 가장 나쁘다. | 수정: 공개 모드의 AI/가상 포인트 고정 표시. 실제 OBS 검증 남음 |

## 추가 제안 및 중복 지적

7절 커뮤니티 반응과 각 절의 억까도 원문의 해당 근거와 대조한다. 접근성·문서 진입점·브랜드·데모·내부 문화 지속성은 개선 대상으로 다룬다. 취향이나 근거 없는 추정은 결함으로 단정하지 않는다. 라이선스·유료 판매·공개 방송 모드는 사용자 결정 후 반영한다.

## 다음 작업

1. 시스템 도우미 리허설 위장 수정, 온보딩의 허위 예고 제거, 접근성·색상·문자 크기 정리.
2. 위 원장의 각 지적을 코드와 대조해 개별 해결 상태·검증 근거 갱신.
3. 사용자 결정에 맞게 자율 관계·자연 대화 흐름 유지, 시즌/director 호출과 UI 타입 의존 제거.
4. 지연과 상태 전송 비용 측정 후 개선; 외부 채팅 전송 고지와 익명화; 배포·문서·정리 진행.

## 1차 수정 검증 (2026-09-16)

- 작업본 npm run check: 681/681 및 TypeScript/Vite 빌드 통과.
- 온보딩 안내 최종 수정 후 npm run build 통과.
- scripts/verify-nagneon.cjs: 실제 Electron 렌더러, synthetic 인메모리 프로필로 9개 검사 통과. 계정·마이크·화면 캡처 수집 없음. 420~1440px 레이아웃·세로 화면·온보딩·리허설·투명 오버레이 확인. 원본 artifacts/nagneon/renderer-result.json 및 PNG.
- main 자체도 npm ci + npm run check 679/679·빌드 통과. 원본 G:/dev/ai/00_game_backseat/artifacts/critical-review-main/.
- 첫 검토 문서에 지정한 상태 구성 architecture 웹 검토는 Extra High로 전송됨. 성능 탭은 Debugger unattached 오류로 미전송. 종합은 아직 미실행.
- 전체 개선은 진행 중이며 이번 묶음은 초기 UX와 새 프로필 잔액 수정이다. 배포·성능·비활성 코드 제거·외부 채팅/공개 모드는 남아 있다.

## 2차 수정: 외부 채팅 전송과 공개용 오버레이

- 8-1/8-2: UI 연결 전 안내·확인, 두 플랫폼 서버 연결도 acknowledgeAiTransfer=true 필수. 확인 없는 연결은 transport/auth 시작 전에 거절한다.
- 모델 컨텍스트만 기본 닉네임 익명화하며 연결마다 별칭 변경. 명시적 shareNames 선택 때만 닉네임 전달. 작성자 ID·sourceId는 전달하지 않는다. 원문 자체에 적힌 개인정보까지 제거한다고 주장하지 않는다. 원문 화면 표시·목격 시각·삭제에 의한 pending 취소는 유지한다.
- 1-7/8-4/8-5/8-6: private/public 오버레이 설정. private은 캡처 제외, public은 허용. 공개용은 투명도와 별개로 AI 관객·가상 포인트 표시를 유지하고 후원 토스트도 실제 금전 후원과 구분한다.
- 8절 README 사용 입장·전송 한계 설명 추가. 사용자 확인을 시청자 동의나 AI 제공처 원격 삭제로 오인시키지 않는다.
- npm run check 683/683 및 빌드 통과. scripts/verify-public-overlay.cjs 실제 Electron 창에서 private → public → private 보호 상태 전환과 공개 표시 확인. synthetic 세션이며 OBS 실제 캡처는 아직 미검증.
- 증거: artifacts/critical-review/privacy-check.log, artifacts/public-overlay/result.json, artifacts/public-overlay/public.png.
- 웹 architecture 응답 수신은 브라우저 Debugger unattached 상태로 확인 불가. 전송 당시 URL https://chatgpt.com/c/WEB:21745bb3-6fbd-4057-b576-498683c6c96b . performance는 미전송, synthesis 미실행.
- 1차 원본 a6466527b36ebe623affe3040db147ca0725b34c 원격 게시 일치. main은 audience-model-selection 통합 잠금 중 57fd39d로 변경됨. 잠금 우회 없이 최신 main에 격리 통합해야 한다.

## 3차 수정: 마이크 지연 기동·내보내기 파일명

- 6-5: 서버 시작의 speech.start 제거. 기존 /api/audio/prepare에서 저장된 장치 선택으로 워커를 기동한다. 설정의 GPU 기본값은 변경하지 않는다. 처음 마이크를 켤 때 모델 준비 시간은 여전히 필요하며 감소했다고 주장하지 않는다.
- 로컬 음성·실제 자식 프로세스 충돌/취소/복구·진단 HTTP 회귀 통과: artifacts/critical-review/lazy-speech-tests.log.
- 4-1: 서버의 Content-Disposition 내보내기·진단 파일명도 nagneon으로 통일. 내부 IPC/프로필 식별자 호환은 유지.
- 1-5 정정: SettingsDialog.tsx에는 이미 방송/분위기/연결/매니저/미디어/게임/디버그 7개 탭이 있다. 제목 태그 개수만으로 분류 부재를 판단한 원문은 부정확하다. 고급 옵션의 설명과 화면 가독성은 계속 검토한다.
- 2차 원본 커밋 57201445a729837b04aeb7a9ec20cc2360872d31 원격 게시 일치. 현재 브랜치는 전체 목표 진행 중이므로 worktree와 원격 브랜치를 보존한다.
- 사용자 추가 결정: 호출 제한을 시간 기준으로 전환하고 세션 예상 사용량을 안내한다. 당분간 무료 공개·MIT 유지, 배포 편의와 용량부터 개선한다. 유료 서명 구매나 라이선스 변경은 이번 작업에서 수행하지 않는다.

## 첫 통합 검증

- 대상 main: 57fd39d (관객 모델 선택 0.1.3). 원본 작업 a646652 → 5720144 → 61a934fceb10362b2f0cc76860a259d85c4c0d2d를 이 작업 단위로 squash 통합한다.
- README 충돌은 모델 선택 안내와 외부 채팅·공개 방송 안내를 모두 보존해 해결했다. 모델 선택 기능을 유지한다.
- 통합본 npm run check: 686/686 테스트와 빌드 통과. 격리 Electron 기본 UI 9개 검사 및 공개 오버레이 캡처 보호 전환 검사 통과.
- 원본 증거: G:/dev/ai/00_game_backseat-worktrees/critical-review-integration/artifacts/critical-review-integration/check.log, artifacts/nagneon/renderer-result.json, artifacts/public-overlay/result.json.
- 전체 목표는 진행 중. 시간 기준 이용 한도, 기획 기능 제거, 상태 구성/성능, 배포 용량, 기타 원장 항목이 남아 있다. OBS 캡처·외부 플랫폼 실연결과 최종 릴리즈는 별도 검증 후 진행한다.

## 사용자 결정 수정: 시간과 횟수로 방송을 제한하지 않음

- 사용자는 시간 안내만 하는 방식도 심리적 부담을 줄 수 있다고 정정했다. 시간 제한·카운트다운·만료 알림을 추가하지 않는다.
- 세션 모델 호출 상한과 미디어·관객 생성의 연동 차단을 제거한다. 기존 maxCalls 설정은 로드 시 제거되며 자동 중단을 만들지 않는다.
- 연결 화면의 접힌 사용량 참고에서 요청 횟수·제공처 보고 토큰·반응 간격 기준의 10분 예상 요청을 볼 수 있다. 계정 잔량이나 요금으로 해석하지 않는다.
- 요청 실패 백오프, 동시에 실행하는 요청 수, 자동 커뮤니티 방문 시간당 6회 정책은 유지한다.
- 이번 변경의 원본 검증 로그: artifacts/critical-review/no-session-limit-check.log. 전체 리뷰 개선은 계속 진행 중이다.

- 검증: 첫 전체 실행 685/686 (clip-arrival-memory 서버 재연결 fetch failed). 해당 파일 재실행 12/12, 최종 전체 npm run check 686/686와 TypeScript/Vite 빌드 통과. 최종 로그 artifacts/critical-review/no-session-limit-check-final.log. 패키지 무결성 목록의 제거된 설정 파일 참조를 정리했고 node --check 통과.

- 통합: 원본 121248aacbf273bec601080bac5006a896e501c7 + main a502993. 통합본 686/686 및 빌드, 격리 실제 Electron synthetic UI 9개 검사 통과. 증거 critical-review-integration/artifacts/critical-review-integration/no-session-limit.log 및 artifacts/nagneon/renderer-result.json. 실행 중 사용자 앱 적용과 릴리즈는 아직 하지 않았다.

## 기획 방송 엔진 제거

- 사용자 의도에 따라 Director/StorySeasons 실행 엔진, 자동 제안, 단계/선택 프롬프트, 생성 API 구현, 전용 React 컴포넌트·CSS·카탈로그를 제거했다.
- live 반응은 항상 현재 목격자·발언·화면 기준으로 처리한다. 사용자가 꺼낸 역할극은 일반 대화이며 허구를 실제 게임 성과로 해석하지 않도록 프롬프트에 남긴다.
- 기존 episodes.json / seasons.json은 읽기 전용 기록으로 보존한다. 설정에 autoProposals=true가 저장되어 있어도 실행되지 않는다. 예전 방송 목록은 펼칠 때만 별도 조회하며 SSE 전체 상태에 카탈로그와 기록을 싣지 않는다.
- seasonsArchive 내보내기 호환을 유지하고 episodesArchive에 전체 에피소드 대화도 담는다. 옛 변경 API는 410으로 종료를 알린다. 기록 파일은 자동 삭제·변경하지 않는다. 기존 허구 클립 식별과 기억 구분은 유지한다.
- 이전 기획 기능 전용 검사는 제거하고 저장 파일 바이트 보존·재시작·조회/내보내기·모든 변경 경로 종료·자동 생성 없음 검사를 추가했다. 상황 연습과 일반 방송/기억/지연 검사는 유지한다. 구버전 전용 수동 검증 스크립트도 제거했으며 과거 증거는 artifacts와 Git 이력에 남아 있다.
- 시즌 구판 데이터 검증에 필요한 분기 연결과 기념품 정의만 legacy-season-versions.json에 보존한다. 실행용 프롬프트나 시나리오 진행 코드가 아니다.

- 작업본 검증: 660/660 테스트와 빌드 통과 (artifacts/critical-review/story-final-check.log). 저장 파일·프롬프트·일반 방송 회귀를 포함한다. 스타일 정리 후 build 재검증 및 격리 Electron 검증 진행.

- Electron DOM 검사 10개 통과. 숨겨진 창의 기존 캡처가 이전 프레임을 반환해 offscreen 렌더링으로 검증 스크립트를 보정했다. 보정 후 natural-experiences.png에서 실제 기록 펼침 화면 확인. 방송 놀이터 머리말의 남은 팬 페스티벌 약속도 자연 대화/상황 연습 안내로 수정했다.

## 사용자 범위 정정: 방송 놀이터 자체 제거

- 사용자가 방송 놀이터 자체가 의도하지 않은 기능이라고 재차 명확히 했다. 앞서 자연 대화 안내와 상황 연습 화면으로 존치하려던 해석을 철회한다.
- 방송 놀이터 메뉴·머리말·진입 안내와 전용 화면을 제거한다. 별도 상황 연습 엔진·UI·API 실행도 제거한다. 기본 방송실에서 화면/음성/채팅으로 체험·연습한다.
- 옛 기획 기록 전용 메뉴나 새 조회 화면을 만들지 않는다. 기존 파일과 내보내기는 보존한다. 이전 기획·연습 실행 경로는 410으로 종료를 알린다.
- 추가 사용자 결정: 밈/공통 추억은 자동 만료 없이 보존하고 현재 대화에 관련된 기억만 사용한다. 이 항목은 기획 기능 제거 통합 후 구현한다.

- 최종 범위 작업본: 647/647 테스트·빌드 통과, offscreen 실제 Electron synthetic UI 10개 검사 통과. 7개 메뉴에 방송 놀이터가 없고 기본 리허설·오버레이 동작 확인. 원본 artifacts/critical-review/playground-check.log 및 artifacts/nagneon/renderer-result.json, studio-1440.png.

- 최종 통합 검증: 원본 fdc68ba → 6e95371c9ac47b447d976c6057ccdd36b0c7e391을 main 67abdc8 기준으로 squash 통합. 실제 통합본 npm run check 647/647·빌드, offscreen Electron UI 10개 검사 통과. 증거 critical-review-integration/artifacts/critical-review-integration/playground-check.log 및 artifacts/nagneon/renderer-result.json. 실행 중 사용자 앱과 릴리즈는 아직 변경하지 않았다.

## 공통 기억 영구 보존과 선별 조회

- 기존 expiresAt은 구판 메타데이터로 읽되 만료 조건으로 사용하지 않는다. 새 기록은 생성 시각과 안정된 ID를 저장한다. 이전 만료 기록도 복원하며 30개 초과 자동 삭제를 제거한다.
- 모델에는 현재 발언과 핵심어가 일치하는 공통 기억을 최대 3개/각 300자 전달한다. 별도 모델 호출을 추가하지 않는다. 핵심어 기반이라 표현이 전혀 다른 의미상의 연결은 놓칠 수 있으며, 발언 없는 화면만으로 관련 기억을 추측해 주입하지 않는다.
- 공통 맥락은 streamer-note로 구분한다. 신규 관객의 직접 목격이나 개인 경험을 뜻하지 않는다.
- UI에서 수동 삭제할 수 있으며 관련 진행 요청과 아직 표시하지 않은 대기 반응을 취소한다. 삭제·등록 저장 실패 시 기존 메모리 상태를 유지한다.
- 테스트: 구판 날짜/30개 초과 보존, 관련 기억 선별과 비관련/빈 발언 제외, 저장 실패 원본 보존, HTTP 등록·재시작·개별 삭제, 영향받는 응답만 취소. 원본 artifacts/critical-review/lore-tests.log.

- 작업본 npm run check 651/651·빌드 통과. 격리 offscreen Electron synthetic UI 11개 검사에서 기억 등록/삭제·만료 표시 없음 확인. artifacts/critical-review/lore-check.log, artifacts/nagneon/renderer-result.json. 실제 모델 응답의 의미상 회상 품질은 핵심어 선별 테스트와 별개다.

- 새 안정성 정책에 따라 구버전 읽기 호환도 확인했다. 신규 기억의 expiresAt은 옛 스키마가 요구하는 유효한 최댓값(8.64e15)으로 저장한다. 현재 버전의 만료 동작이나 UI 날짜 표시는 없으며 구버전에서 날짜 누락으로 파일을 거절하는 것을 방지한다. 실제 패키지 업데이트/복귀 검증은 릴리즈 단계에서 별도로 수행한다.

- 통합 검증: 원본 a65f3ef → 700cab171d670483b20de76e872df8306902a0f8을 main 628640d의 새 안정성 정책과 격리 squash 통합. npm run check 651/651·빌드와 offscreen Electron synthetic UI 11개 검사 통과. 원본 critical-review-integration/artifacts/critical-review-integration/lore-check.log 및 artifacts/nagneon/renderer-result.json. 사용자 앱·배포 버전은 아직 변경하지 않았다.

## 주요 코드 서식과 런타임 상태 연결

- Windows core.autocrlf 환경에서도 새 checkout의 서식 검사가 같도록 검사 대상 5개 파일은 .gitattributes에 LF를 명시한다. 통합본 첫 검사의 CRLF 실패를 통해 확인하고 수정했다.

- Prettier 3.9.6을 개발 의존성으로 고정하고 주요 진입점 5개에 format/format:check를 적용했다. npm run check에 서식 검사도 포함한다. 설치 결과 audit 0건, 런타임 의존성 증가는 없다.
- state 메서드 3단·stop 메서드 2단 덮어쓰기를 제거했다. 외부 채팅·OBS·디버그·시작 안내 상태는 attachRuntime 한 곳에서 조립한다. 종료 연결 실패를 개별 처리해 다음 연결·방송 취소가 계속된다.
- 개발 안내에 계층/데이터 흐름·검사·언어/저장 호환성 규칙을 기록했다. reactInput 내부 책임 분리는 별도 후속 작업이며 포매팅만으로 완료했다고 주장하지 않는다.
- 종료 연결 실패와 HTTP 시작/종료의 상태 조합 검증 통과 (artifacts/critical-review/runtime-tests.log). 전체 검사 원본 artifacts/critical-review/maintainability-check.log.

- 작업본 검증: format:check, 653/653 테스트, 빌드, 격리 offscreen Electron synthetic UI 11개 검사 통과. App.tsx는 JSX 인접 텍스트 조각을 합쳐 비교한 출력 AST가 동일하고 types.ts AST도 동일했다. 원본 artifacts/critical-review/format-emitted-ast.json 및 format-ast.json. 일반 코드 줄 길이는 App/studio/types 100자 이하, style 89자 이하이며 index의 일부 긴 문자열은 내용 보존을 위해 유지했다.

- 통합 검증: 원본 73dade9 → 8aca76258123984161370e0164f6430bcd636ede를 main 547852d 기준 squash 통합. 독립 npm ci 후 LF 규칙 적용, format:check·653/653 테스트·빌드 및 offscreen Electron synthetic UI 11개 검사 통과. 첫 전체 검사 갤러리 fetch 실패는 해당 파일 재검사와 최종 전체 검사에서 통과했으며 원인을 확정하지 않는다. 증거 critical-review-integration/artifacts/critical-review-integration/maintainability-check-final.log, maintainability-gallery-recheck.log, artifacts/nagneon/renderer-result.json. 사용자 앱·릴리즈는 변경하지 않았다.


## 반응 처리 책임 분리

- 포매팅 이후 514줄이던 reactInput을 170줄의 호출 조정으로 줄이고 화면 준비, 리허설, 관객별 요청 구성, 응답 수용, 경험 저장을 별도 메서드로 분리했다. 동작 순서·중단/교체된 요청·관객 목격·기억 삭제·전사 보류·후원 조건을 유지한다.
- 작업본 format:check·653/653 테스트·빌드 통과. 기존 회귀 검사에서 중단 후 늦은 응답, 만료된 화면, 관객 퇴장, 기억 삭제 취소, 개인정보 범위, 조용한 동행의 보상 제외를 검증한다. 원본 artifacts/critical-review/reaction-split-check.log. 모델 응답 품질 개선을 주장하는 변경은 아니다.

- 통합 검증: 원본 64bad79440acfc4144df96f0503c7af4bdb1d193을 main 1ec74ba 기준 squash 통합. 실제 통합본 format:check·653/653 테스트·빌드와 격리 offscreen Electron synthetic UI 11개 검사 통과. 증거 critical-review-integration/artifacts/critical-review-integration/reaction-split-check.log 및 artifacts/nagneon/renderer-result.json. 사용자 앱·릴리즈는 변경하지 않았다.

## 상태 전송 비용 측정과 중복 직렬화 제거

- 250ms pump와 전체 상태 발행은 다르다. 큐 전달·관객 변경 등이 있을 때 발행하며 서버 health는 5초 간격이다. direct Studio 리허설·빈 큐에서 10초에 해당하는 pump 40회는 상태 발행 0회였다. 실제 방송에서 상태 변경 빈도까지 0이라는 뜻은 아니다.
- SSE 패치는 그대로 유지한다. 동일 JSON이면 파싱/필드 비교를 생략하고, 변경이 있으면 이전 필드 문자열을 재사용한다. 객체 참조 동일성에 의존하지 않으므로 원본 배열·중첩 객체의 변경도 반영한다. 창마다 현재 직렬화 결과와 필드 문자열을 추가 보관하는 메모리 비용이 있다.
- 합성 채팅 500개·관객 40개·장부 300개, 창 2개/300회 측정: 동일 상태 1461→493ms, 카운터 변화 1459→1076ms, 채팅 순환 2534→2150ms. 전송량은 각각 0/28584/458780바이트로 동일했다. 실제 방송 FPS나 모델 응답 속도 개선 수치는 아니다. benchmark-state-stream.mjs로 재현 가능하며 기준 소스와 원본 결과는 artifacts/critical-review/state-stream-baseline.mjs, state-stream-before.json, state-stream-after.json에 보존했다.
- 기존 순환·교정·정렬·삭제·재연결·지연 창 검사에 JSON 변환, 중첩 변경, 직렬화 실패 후 복구 검사를 추가했다.

- 작업본과 통합본 각각 format:check·654/654 테스트·빌드 통과. 통합본 격리 offscreen Electron synthetic UI 11개 검사 통과. 원본 6f7a04079acbc47eb3c4ee6990627a226aac76c8을 main fe35fe8 기준 squash 통합한다. 증거 critical-review-integration/artifacts/critical-review-integration/state-stream-check.log 및 artifacts/nagneon/renderer-result.json. 사용자 앱·릴리즈는 변경하지 않았다.

## 사용자 결정: 관객 상한 없음·긴급 정지 제거

- 관객 수에 앱 상한이나 별도 동시 출석 상한을 만들지 않는다. 생성 전/정산 시 40명 검사, 자동 유입 차단, 만남 영수증 10,000개 차단, Settings 배열 상한을 제거했다. 공동 대화·지식 목격자 40명과 개인 시청 기록 80명 절삭도 제거해 인원 증가가 기억 누락으로 이어지지 않게 한다.
- README에 메모리·CPU별 권장 출발 규모 표를 별도로 추가했다. 수치는 실측 보증이 아닌 운영 제안임을 명시하며 모델 제공처 지연과 로컬 음성 처리 부하를 구분한다.
- 긴급 정지 단축키 재설정 구현은 사용자 정정 직후 철회했다. 새 설정 파일·UI·IPC를 제품에 남기지 않는다. 기존 전역 Ctrl+Shift+F9 등록, studio:panic IPC와 preload/renderer 연동도 제거했다. 일반 방송 종료 버튼의 media.stopAll과 서버 stop, 앱 종료 정리는 유지한다. 기존 Ctrl+Shift+F10 클릭 통과 기능은 별개다.
- 101명 관객의 추가 생성·목격자 보존·시청 시간·디스크 저장·재시작 읽기 검사 통과 (artifacts/critical-review/unlimited-audience-tests.log). 이전 80명 기록 제한을 기대하던 검사는 모든 120명 기록 보존으로 갱신했다. 새 대규모 기록은 구버전의 40명 스키마가 읽지 못하므로 이전 버전 복귀는 별도 호환성 검토가 필요하다.

- 작업본 및 통합본 각각 format:check·655/655 테스트·빌드 통과. 통합 빌드 완료 후 격리 offscreen Electron synthetic UI 11개 검사 통과. 원본 24447ef8eff083413751df6fb4c4e00c3cc9d838을 main 71d35d6 기준 squash 통합한다. 증거 critical-review-integration/artifacts/critical-review-integration/no-caps-no-panic-check.log, no-caps-ui-final.out 및 artifacts/nagneon/renderer-result.json. 실행 중 설치 앱은 아직 이전 버전이므로 앱 교체 시 전역 단축키 해제도 적용된다.

## 배포 후보 사전 검사

- 실제 packageSources 검사에서 server/legacy-season-versions.json이 허용 목록에 없어 패키징 불가임을 재현했다. 이 파일만 명시적으로 허용하고 스테이징/무결성 검사에서 같은 목록을 사용하도록 통일했다. 임의 JSON과 하위 폴더의 동명 JSON은 계속 거절한다.
- 0.1.4는 배포 후보이며 아직 릴리즈 합격/게시/사용자 적용 상태가 아니다. 작업본 656/656 테스트와 빌드 통과. artifacts/critical-review/package-candidate-check.log, package-source-check.log.
- 설치된 0.1.3 매니페스트 기준 GPU 1538MiB·마이크 모델 1460MiB·기본 음성 모델 464MiB가 주요 용량이다. 기능을 임의로 삭제하지 않고 배포 후보를 검증한다. 기존 설치 런타임은 읽기 소스로만 사용하며 작업별 .models에 복사하고 빌더가 핀 버전/해시를 다시 대조한다.

- 0.1.4 실제 Windows 패키지 생성 완료: release/2026-09-15T16-46-46-632Z/app/Nagneon-win32-x64, 2,476파일/4,755,244,557바이트. 포함 소스 97개 현재 파일과 일치 (artifacts/critical-review/candidate-source-integrity.json). 아직 실제 패키지 실행·업데이트 검증 전이므로 배포 합격이 아니다.
- 통합 검사: 최초 655/656 (microphone-recovery-http 첫 fetch failed), 해당 파일과 최종 전체 검사 656/656·빌드 통과. 원본 artifacts/critical-review-integration/package-candidate-check.log, package-microphone-recheck.log, package-candidate-check-final.log. 반복된 로컬 HTTP 시험의 일시 연결 오류 원인 진단은 미해결로 남긴다. 원본 작업 b64e7336ce3a4f23a8fec3935cea54aefa42a511을 main 882503e 기준 squash 통합.

## 패키지 실행·업데이트와 구버전 호환 보호

- 실제 GUI, 합성 GPU 음성 런타임, 0.1.3→0.1.4 설치와 기록 보존, 별도 백업 복사본으로 구버전 복구를 확인했다. 상세 근거와 미검증 범위는 RELEASE-0.1.4.md에 기록한다.
- 새 설치/실행 도구는 실제 EXE 버전으로 알려진 비호환을 읽기 전용 검사한다. 새 world를 구버전에 연결하는 설치 요청·실행 Inspect를 거절하고 포인터/기록을 보존했다. 한글 JSON은 Windows PowerShell 5.1에서도 UTF-8로 읽는다. 설치 도구 묶음에 Profile-Compatibility.ps1을 포함해야 한다.
- 작업본 657/657 테스트·빌드 통과. 한글 구형 기록 fixture 추가 후 해당 검사 재통과. 원본 artifacts/critical-review/profile-guard-check.log, profile-compatibility-final.log, launcher-compatibility/result.json. 원본 작업 af2f8cd를 main 9689bf3 기준 squash 통합한다.
- 배포 후보 0.1.4는 아직 게시·사용자 적용 전이며 현재 사용자 앱은 0.1.3이다. 실제 사용자 기록 복사본과 영향 있는 장치 검증, 설치 도구 동봉 및 게시가 남아 있다. 활성 작업·모델·증거가 있으므로 작업 및 통합 worktree는 보존한다.
- 격리 통합본에서도 format:check·657/657 테스트·TypeScript/Vite 빌드 통과 (critical-review-integration/artifacts/critical-review-integration/profile-guard-check.log).

## CLI 지연 구간 측정

- 원본 작업 c30dc91 (main 동기화 335a095). 실제 공식 CLI 합성 대화 4회에서 응답/침묵 의도와 전달 1·1·2·0건 확인. 지시문/스키마/텍스트 크기, spawn·stdin·thread/turn·완성 메시지·종료 이벤트를 기록했다. 원본 및 해석 한계는 RESPONSE-LATENCY.md에 있다. 제품의 모델/추론/프롬프트는 변경하지 않았다.
- 작업본 필수 검사 657/657·빌드 통과: artifacts/critical-review/latency-phases-check.log. 실제 모델 구간의 속도 개선을 선언하지 않으며 다음 작업은 문맥 기여도 비교, 남은 배포 검증 및 전체 원장 개선이다.
- 격리 통합본 657/657·빌드 통과: critical-review-integration/artifacts/critical-review-integration/latency-phases-check.log. 작업·통합 worktree는 진행 중 검증과 모델/증거 보존을 위해 유지한다.

## 미디어 문맥 조건화

- 6-2의 첫 개선으로 실제 입력이 없는 시간순 화면·발언 당시 화면 설명만 생략한다. 관련 입력이 있으면 기존 설명, 데이터·첨부·출력 계약과 항상 필요한 근거 보호는 보존한다. 합성 텍스트 지시문 3,101바이트 감소. 실제 CLI 4회 응답/침묵 동작은 확인했지만 속도 향상은 입증되지 않았다. 상세 수치·사용량·원문 경로는 RESPONSE-LATENCY.md에 기록한다.
- 원본 작업 cccb079를 main d60383c 기준 squash 통합한다. 작업본 필수 검사 660/660·빌드 통과. 제품 소스가 바뀌었으므로 기존 0.1.4 후보 패키지는 최신 소스가 아니며 다시 빌드·무결성 및 관련 실행 검증해야 한다. 아직 원격 릴리즈·사용자 설치는 변경하지 않았다.
- 격리 통합본 660/660 테스트·빌드 통과: critical-review-integration/artifacts/critical-review-integration/contextual-media-check.log. 활성 작업과 모델·검증 증거 보존을 위해 두 worktree를 유지한다.

## 사용자 우선순위: 배포 용량

배포 크기 개선을 최우선으로 전환했다. 현재 후보 4.76GB 중 기본 앱 파일은 약 844MB이며 나머지를 공통 런타임·시스템 소리·마이크 모델·GPU로 분리하는 목록/식별자를 빌더에 추가했다. 실제 기본 앱 단독 실행과 구성 다운로드/설치는 아직 구현 전이다. 진행·의존성·원본 크기는 DISTRIBUTION-SIZE.md에 기록한다. 원본 b15cd72, 작업본 662/662 테스트·빌드 통과 (artifacts/critical-review/distribution-components-check.log).
- 통합본 662/662 테스트·빌드 통과: critical-review-integration/artifacts/critical-review-integration/distribution-components-check.log. 진행 중 모델·증거와 후속 구현을 위해 worktree를 보존한다.

## 구성 압축·다운로드·설치

- 원본 b434483. 런타임 gzip 묶음 생성, 고정 카탈로그 기반 스트리밍 다운로드·취소·크기/해시 검증, 임시 디렉터리 복원 후 원자적 공개·재사용을 구현했다. 기능별 UI·경량 앱 시작에는 아직 연결하지 않았다.
- 실제 기본 앱 파일 ZIP 304,382,635바이트, 88개 항목 해시 일치. 공통 음성/소리/마이크/GPU 묶음은 전 파일 복원 일치. 상세 크기와 재현은 DISTRIBUTION-SIZE.md에 있다. 기존 후보 소스의 구조 검증물이며 사용자 릴리즈로 게시하지 않았다.
- 첫 분리 캐시 실행은 Windows DLL 경로 길이로 실패했다. 짧은 캐시 루트와 32자리 폴더 식별자로 수정하고 전체 SHA-256 검증은 유지했다. 실제 전달 모듈·분리된 Python/medium/small/GPU/YAMNet, 개발 PATH 제외 한국어 합성 음성과 소리 분석·정상 종료 통과. 실제 모델 호출과 물리 장치·경량 GUI는 미검증이다.
- 작업본 668/668 테스트·빌드 통과. artifacts/critical-review/runtime-packs-final-check.log 및 components-runtime-short-path-result.json. 새 구성 다운로드 시점은 권장안인 기능 최초 사용을 기준으로 진행하며 사용자 답변이 오면 반영한다. 사용자 설치본과 기존 원격 릴리즈는 변경하지 않았다.
- 통합본 668/668 테스트·빌드 통과: critical-review-integration/artifacts/critical-review-integration/runtime-packs-check.log. 활성 구현과 모델/압축 파일/검증 증거를 보존하기 위해 두 worktree를 유지한다.

## 경량 앱 구성 연결 통합 (2026-09-16)

- 원본 422fcb1337a31ccb2c24f9b09d464572cc784cb3을 main 0197ff1 위 격리 squash 통합했다. 제품 소스는 원본과 일치하며 기존 통합 원장 내용도 보존했다. 통합 필수 검사 674/674·빌드 통과: artifacts/critical-review-integration/runtime-components-check.log.
- 최신 실제 후보 release/2026-09-15T18-17-00-406Z: 기본 설치 844,295,048바이트/89파일, ZIP 315,237,318바이트(모든 항목 길이·해시 검증). 기존 공개 앱 ZIP 1,936,656,696바이트보다 약 83.7% 감소. 추가 기능의 구성 다운로드/저장 공간은 별도이며 전체 기능 설치 크기가 84% 감소한 것은 아니다.
- 작업 worktree artifacts/critical-review/lightweight-native-release.log에서 실제 EXE 온보딩·리허설 시작/정상 중지·앱 종료 통과. lightweight-runtime-release-result.json에서 전달 ASAR·분리 캐시로 합성 한국어 전사/시스템 소리 인식·GPU int8_float16(fallback=false) 통과. 물리 장치 입력이나 실제 모델 대화 검증으로 표시하지 않는다.
- lightweight-integrity-release.log의 현재 소스/ASAR/전체 파일/실행 fuse 검사 통과. lightweight-zip-result.json은 ZIP 실제 크기와 경로를 기록한다. 분리 구성 카탈로그 URL은 아직 미게시이며 사용자 0.1.3 설치는 유지한다.
- 다음: 고정 구성 자산 게시와 실제 HTTPS 다운로드, 손상 캐시/기존 설치 재사용, 클립·캡처 경로와 업데이트/데이터 보존 검증. 기존 HTTP 테스트의 간헐 fetch failed 원인은 미확정이며 실패 원본과 좁힌 검사/전체 재검사 성공 모두 DISTRIBUTION-SIZE.md에 기록했다. 전체 리뷰 목표는 계속 진행 중이다.

## 구성 복구·클립 진입 경로 보완

원본 a27608e를 a614d0f 위 squash 통합했다. 충돌 파일은 각각 main 내용이 직전 원본 422fcb1과 동일함을 대조한 뒤 이번 수정으로 해소했고 기존 통합 원장은 보존했다. 통합 필수 검사 676/676·빌드 통과(artifacts/critical-review-integration/runtime-repair-check.log). 작업본 Electron 합성 화면 UI 4개 검사 통과. 고정 구성 태그 runtime-2026-09-16은 정식 앱과 분리된 구성 자산용이며 이 기록 시점에는 게시 전이다. 다음은 자산 게시·실제 다운로드·기존 설치 업데이트 검증이다. 경량 후보는 제품 소스가 바뀌어 최종 배포 전 다시 빌드해야 한다.

## 설치 후 압축본 정리

원본 a12ac1c를 9817121 위 squash 통합했다. 설치 검증 후 압축 원본을 제거하며, 재실행 시 설치 파일을 해시 검증해 오프라인 재사용한다. 통합 필수 검사 676/676·빌드 통과(artifacts/critical-review-integration/runtime-cache-space-check.log). 구성 초안 389380090은 아직 비공개다. gh 업로드 연결 오류 이후 curl/HTTP 1.1로 sound 업로드와 GitHub digest/크기 일치를 확인했으며 나머지 자산 전송은 진행 중이다. 작업/통합 worktree는 진행 중 검증·배포 산출물 때문에 보존한다.

## 경량 0.1.4 배포 수용 기록

원본 b9fdeb9를 a5a2b52 위 squash 통합했다. 제품 소스는 기존 경량 후보와 동일하고 검증 스크립트/증거 문서만 추가했다. 통합 필수 검사 676/676·빌드 통과(artifacts/critical-review-integration/lightweight-release-check.log). 고정 구성은 runtime-2026-09-16으로 게시했으며 실제 공개 HTTPS 다운로드/복원/압축본 정리/오프라인 재사용과 전달 ASAR의 GPU 한국어 전사·시스템 소리 인식을 통과했다. 사용자의 격리 데이터 복사본으로 설치·업데이트·재시작·이전 버전 복귀를 통과했고 원본은 유지했다. 소유 테스트 창의 실제 캡처는 합성7초 구성 준비 뒤 시작·교체·트랙 종료를 확인했다. 상세 원본은 DISTRIBUTION-SIZE.md 최신 절에 있다. 기본 앱 ZIP315,237,974바이트/설치844,297,517바이트이며 최종 앱 자산 게시는 다음 단계다. 전체 CRITICAL-REVIEW 원장은 아직 완료하지 않았다.
