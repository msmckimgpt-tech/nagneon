# BACKSEAT 검증 기록

검증일: 2026-09-13. Windows 로컬 개발 빌드, Electron 44.3, GPT-6 Astra / low. 정적 검사, 합성 입력, 실제 모델, 실제 Steam 창 테스트를 구분한다. 완전한 실제 방송 경험이나 모든 게임의 정확도를 검증했다는 뜻은 아니다.

## 통과한 검사

| 검사 | 결과 | 원본 증거 |
|---|---|---|
| `npm run check` | Node 테스트 16개 통과, TypeScript와 Vite 빌드 통과 | `check.log`, `test/` |
| Electron 렌더러 | 8개 항목 통과: 마이크 중복 획득, 획득 도중 종료, 탭 이동 후 화면 유지, 외부 중지 시 해제, 늦은 화면 획득 취소, 유입 설정 저장·후보 추가, 유입 현황 표시, 오버레이 CSS 투명 배경 | `artifacts/desktop-test.json`, `desktop-test.log` |
| 실제 Codex 계정·모델 | ChatGPT 인증, Astra low 텍스트·이미지 응답 확인 | `artifacts/vision-result.json`, `artifacts/discovery-live-result.json` |
| 알려진 이미지 인식 | 테스트 화면의 HP 20/100, 라운드 3, BOSS DEFEATED를 정확히 읽음. 11,361ms | `artifacts/vision-fixture.jpg`, `artifacts/vision-result.json` |
| 로컬 한국어 전사 → 일반 대화 → 후기 | 합성 한국어 WAV 전사 2,821ms, 음성 단서 전달, Just Chatting 응답, 후기 생성 통과. STT는 모델 호출 0회 | `artifacts/just-chatting-result.json`, `conversation-test.log` |
| 신규 관객 → 실제 모델 대화 | 가상 시계로 순차 입장한 공략 관심 관객을 호명. 첫 방문을 인정하고 게임 취향 질문에 응답. 9,284ms, 실제 모델 1회 | `artifacts/discovery-live-result.json`, `discovery-test.log` |
| Windows 오버레이 | 실제 독립 오버레이 창 생성, 본창 버튼으로 클릭 통과를 켠 뒤 오버레이 접근성 텍스트에서 ‘통과 중’ 확인 | `artifacts/overlay-native.txt` |
| 독립 Claude Code 검토 | WSL에서 읽기 전용 검토 완료. 마이크 획득 경쟁, 프로세스 종료·임시 파일 정리, STT stdin 오류 처리 개선 | `artifacts/claude-review.txt`, `docs/CLAUDE-REVIEW-RESOLUTION.md` |

렌더러 검사는 합성 MediaStream이며 물리 마이크를 사용하지 않는다. 한국어 음성은 Windows TTS로 만든 9.4초 fixture다. 실제 사용자의 생목소리·억양·웃음·게임 소음이 섞인 연속 대화는 아직 검증하지 않았다. 음성 특성은 낮은 확신의 관찰 단서이며 감정 분류기의 정답률을 측정한 결과가 아니다.

오버레이의 캡처 보호 때문에 OS 캡처 이미지에 오버레이가 빠질 수 있다. 투명 CSS 통과와 실제 창·클릭 통과 상태를 확인했지만 모든 게임의 독점 전체화면 위에서 실제 픽셀 합성을 검증한 것은 아니다.

## 실제 Steam 게임

### Slay the Spire 2 — 화면 연결·요청 훈수·전투 HUD

설치된 Steam App ID 2868840을 선택했다. 게임 진행을 시작하기 전에 `%APPDATA%/SlayTheSpire2/steam`을 `artifacts/spire-save-before`에 백업했다. 새 아이언클래드 런을 시작하고, 앱의 화면 선택기에서 게임 창을 직접 연결해 미리보기를 확인했다.

실제 UI에서 각보는고양이에게 세 선택지의 효과를 근거로 훈수를 요청했다. AI는 잃어버린 궤짝의 카드 보상 1회·무작위 포션 1개, 다른 선택지의 경로 건너뛰기와 카드 변환·최대 체력 비용을 화면에 맞게 설명했다. 그 후 상자와 카드 보상을 선택하고 첫 전투에 진입했다. AI 관찰은 플레이어 80/80, 적 38/38, 에너지 3/3, 손패 5장을 읽었다.

| 증거 | 내용 |
|---|---|
| `artifacts/spire-choice.jpg` | 실제 게임의 선택지 화면 |
| `artifacts/spire-choice-state.json` | 선택지와 훈수 요청에 대한 AI 관찰·채팅 |
| `artifacts/spire-battle-state.json` | 첫 전투 HUD의 실제 모델 관찰 |
| `artifacts/spire-final-state.json` | 12회 호출 제한에 도달한 마지막 세션 상태 |
| `artifacts/spire-battle.jpg` | 이후 턴 종료를 눌러 넘어간 2턴 화면. 앞선 1턴 관찰과 동일 시점 이미지가 아님 |

카드 드래그는 카드가 커서에 붙는 상태까지 확인했으나 타격 성공을 확인하지 못했다. 취소 후 턴 종료는 동작했다. 게임 내 ‘저장 후 종료’를 사용했고 메인 메뉴에 ‘계속’이 나타나는 것을 확인한 후 게임을 종료했다. **새 테스트 런은 첫 전투에서 저장되어 있다.** 게임 클리어·공략 완주를 수행한 결과가 아니다. 기존 파일을 임의로 덮어쓰는 복원은 하지 않았다.

### Baba Is You — 메뉴·지도 인식

Steam App ID 736260. `%APPDATA%/Baba_Is_You`를 `artifacts/baba-save-before/Baba_Is_You`에 백업한 뒤 실행했다. 실제 게임 창 연결과 제목·메뉴·지도 관찰을 확인했고 16회 제한으로 모델 호출이 멈췄다. 근거는 `artifacts/baba-live-first.json`이다.

자동화 키 입력으로 퍼즐 진입을 확인하지 못했으며 마우스로 진행 메뉴와 지도까지 이동했다. 실제 퍼즐 플레이 검증은 미완료다. 게임은 닫았다. 이 결과를 게임 전체 지원이나 퍼즐 해결 능력으로 일반화하지 않는다.

## 실패 후 수정한 항목

- 처음 숨겨진 fixture의 캡처가 예상 화면과 달랐다. 창을 실제 표시하고 native screenshot을 확인한 후 저장한 fixture로 HP 값을 다시 검증했다.
- Electron의 숨김 시작 옵션 때문에 본창·오버레이가 보이지 않던 문제를 로드 후 명시적인 `show()`/`showInactive()`로 수정했다.
- 화면 미리보기 탭을 벗어나면 프레임 공급이 끊길 수 있던 구조를 독립 capture video로 분리했고 합성 렌더러 검사로 확인했다.
- 마이크 중복 클릭과 종료 후 늦은 장치 획득의 경쟁을 epoch/획득 잠금으로 수정했다.
- 모델 프로세스가 끝나기 전에 임시 폴더를 정리할 수 있던 취소 경로를 수정했다.
- 새 유입 기능에서 미입장 관객의 호명·후기 참여를 제한하고 차단 해제 시에도 대기 상태를 보존했다.

## 아직 필요한 수용 평가

실제 생목소리와 게임 소음 속 20분 이상 연속 대화, 여러 장르의 실제 게임 플레이, 요청 전후 훈수의 의미 정확도, 신규 관객의 잘못된 회상 빈도, 장기 재방문과 커뮤니티 현실감, 선택적 인터넷 공략 검색의 정답률, 모델 사용량 소진·네트워크 끊김의 실제 복구, 다중 모니터/DPI·독점 전체화면 오버레이 호환성은 별도 평가가 필요하다. 짧은 스모크 테스트를 대체 자료로 사용하지 않는다.

검증 결과와 주요 파일의 해시는 `artifacts/evidence-manifest.json`에 기록한다. 해시 일치는 파일 무결성 확인이며 테스트 성공을 대신하지 않는다.

최종 앱에서도 유입 설정 저장을 확인했다. 총 11개 관객 후보, 순차 입장 켜짐, 45초 간격. 재시작한 앱의 `/api/state`는 방송 중지·모델 호출 0·ChatGPT 연결·로컬 음성 준비를 보고한다(`artifacts/final-runtime.json`). 실제 게임과 fixture 창은 종료했고 앱만 중지 상태로 남겼다. 최종 관객 화면은 `artifacts/audience-final.jpg`에 보존했다.

