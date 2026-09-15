# 관객 모델 선택과 실제 응답 시험

## 사용 방법

방송 설정 → 연결·사용량 → **AI 제공처·관객 모델 선택**에서 모델과 추론 수준을 선택하고 **선택한 설정 적용**을 누른다. 이 버튼이 즉시 저장하며 대화창의 다른 설정 저장과는 독립적이다. **모델 응답 확인 · 1회 사용**으로 선택한 모델의 실제 연결을 확인한다.

- GPT-6 Astra, GPT-5.4 mini, GPT-5.6 Luna를 선택할 수 있다. mini는 none/low/medium/high/xhigh, Astra는 low/medium/high/xhigh, Luna는 none/low/medium/high/xhigh/max를 제공한다.
- ‘앱 기본 설정 사용’은 기존 OPENAI_MODEL/OPENAI_REASONING_EFFORT 환경 설정을 따른다. 설정이 없으면 기존 기본값 gpt-6-astra/low다. 이번 변경은 사용자 기본값을 자동으로 mini로 전환하지 않는다.
- 선택값은 해당 프로필의 provider-choice.json에 저장되어 재시작 후 복원된다. API 키는 이 파일에 저장하지 않는다.
- 방송·연습·응답 생성·계정 연결 중에는 변경할 수 없다. 변경하면 이전 모델의 연결 시험 결과를 초기화한다. 로컬 음성 인식, 사용자/전역 Codex 설정은 별개다.
- 관객 대화·화면 반응과 같은 제공처를 쓰는 관객 활동에 함께 적용된다. 관객별로 서로 다른 모델을 배정하는 기능은 아니다.
- 모델을 선택할 수 있다는 것은 현재 계정의 접근 권한을 보장하지 않는다. 오류가 나면 사용 가능한 모델로 다시 선택한다. 다른 모델이나 유료 API로 자동 전환하지 않는다.

## 2026-09-15 구독 경로 실측

사용자는 **구독 경로만 사용**하도록 지정했다. API 키를 사용하거나 API 과금을 발생시키지 않았다.

공식 Codex CLI 0.154.0과 현재 ChatGPT 로그인으로 실제 생성 요청을 보냈다. 동일한 가상 한국어 대화 4종(취향 질문, 후속 대화, 화면 결과·체력 읽기, 음성 전사의 부정/숫자 의미 보존)을 구성하고 두 번 반복했다. 실제 사용자 대화·화면·마이크는 수집하지 않았다. 화면은 숨겨진 Electron 창에서 만든 가상 게임 fixture다.

| 구성 | 성공/시도 | 완료 시간 중앙값 | 범위 |
|---|---:|---:|---:|
| gpt-6-astra / low | 8/8 | 9.881초 | 8.967–13.005초 |
| gpt-5.4-mini / low | 0/1 | 미측정 | 모델 미지원으로 거절 |
| gpt-5.4-mini / none | 0/1 | 미측정 | 모델 미지원으로 거절 |

mini는 서버가 HTTP 400으로 “The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account.”를 반환했다. 접근 오류 후 반복 요청을 중단했다. 실패까지 걸린 2.360/2.128초는 생성 지연으로 비교하지 않는다. API 지원 문서가 구독 경로 지원을 뜻하지 않는다. [공식 GPT-5.4 mini 문서](https://developers.openai.com/api/docs/models/gpt-5.4-mini)

지연은 provider.react 시작부터 전체 JSON 파싱 완료까지이며 CLI 기동을 포함한다. 마이크 인식, 화면 캡처, 서버 대기열, 채팅 표시 시간은 포함하지 않는다. 8회의 작은 표본이며 일반적인 지연 보장이 아니다. 구독 비용 효과는 NOT_MEASURED다.

### 품질 검토

Astra 8개 원문을 직접 검토했다. 모두 유효한 관객 ID의 한국어 응답을 반환했고, 요청하지 않은 게임 조작 조언·스포일러·의미 변경 교정은 없었다. 두 화면 응답 모두 보스 격파와 체력 20/100을 정확히 읽었다. 후속 대화는 이미 정한 숲속 오두막을 유지했고, ‘아직 못 깼다/일곱 번 실패’에 승리 축하를 하지 않았다. 짧고 자연스러운 편이지만 취향 질문의 두 답은 유사했고 존댓말/반말의 일관성까지 입증한 것은 아니다. mini의 생성 품질과 상대 속도는 응답 부재로 평가할 수 없다.

### 설정 기능 검증

- 682개 단위/통합 테스트와 TypeScript/Vite 빌드 통과.
- 숨겨진 실제 Electron 설정 화면에서 mini/none 저장 → 서버·창 재시작 후 복원 → 실제 모델 접근 실패 표시를 확인했다.
- 같은 화면에서 Astra로 전환하면 none은 low로 조정되고 이전 시험 결과가 지워진다. 실제 연결 확인 응답을 8.112초에 받았다. 이 한 번은 위 8회 벤치마크에 합산하지 않는다.
- 540px 너비 화면과 방송 중 선택 비활성화를 확인했다. API 키 메모리 유지, 이전 형식 마이그레이션, 잘못된 모델/추론 거부, 저장 실패 시 활성 모델 보존을 회귀 검사했다.
- GPU를 쓰는 숨김 시험 창은 UnknownVizError로 시작 실패했다. 시험 프로세스에만 --disable-gpu를 주어 재검증했다. 실제 사용자 앱을 변경하거나 종료하지 않았다.

## 재현과 원본 증거

작업 경로: `G:/dev/ai/00_game_backseat-worktrees/audience-model-selection`, 브랜치 `codex/audience-model-selection`, 기준 `1c61cf98b8f73e67badb7bbbc7ddc155b2506ba5`.

```powershell
# 각 명령의 완료와 결과 파일을 확인한 뒤 다음 명령을 실행한다.
node_modules/electron/dist/electron.exe --disable-gpu scripts/capture-model-benchmark.cjs
node scripts/benchmark-audience-models.mjs
node_modules/electron/dist/electron.exe --disable-gpu scripts/verify-audience-model-settings.cjs --live
npm run check
```

벤치마크는 실제 구독 사용량을 소비한다. 재실행 시 `--out=<새 경로>`를 화면 생성/벤치마크 양쪽에 지정하여 이전 원본을 보존한다. UI 시험은 실행마다 새 폴더를 만든다.

- `artifacts/audience-model-benchmark/inputs.json`, `vision.png`, `results.json`, `run.log`: 동일 시험 입력, 실제 원문/사용량, 실패 및 완료 시간.
- `artifacts/model-settings-ui-1789483472855/result.json`, `mini.png`, `narrow.png`: 실제 UI 저장/복원, 구독 서버 오류, Astra 응답.
- `artifacts/check.log`: 682개 테스트와 빌드 결과.

원본 증거는 로컬에 보존한다. 개인 대화나 계정 진단 원문을 공개 저장소에 게시하지 않는다. mini의 구독 접근 조건이 바뀌면 이 시험을 다시 수행해야 하며, 그 전에는 ‘품질·지연 검증 완료’로 표시하지 않는다.

## 시험 입력 보정

최초 시험의 후속 대화 ID(s1/m1)와 음성 후보 ID(stt1)는 실제 앱의 UUID 형식과 달랐다. Luna 추가 시험에서 응답 replyTo가 입력의 s1을 그대로 참조하여 UUID 검증이 실패한 것을 원문으로 확인했다. `artifacts/luna-schema-diagnostic.json`에 해당 출력과 `messages[0].replyTo: Invalid UUID`를 보존했다. 이는 시험 데이터 결함이며 모델의 응답 형식 실패율로 집계하지 않는다. 최초 비교의 해당 결과도 최종 모델 간 비교에서 제외한다.

ID를 UUID로 고치고 과거 발언의 personaId/kind/time을 실제 앱 형식에 맞춘 뒤, `artifacts/audience-luna-valid`에서 Astra low, Luna low, Luna none을 다시 교차 시험했다. 이 최종 측정 중에는 빌드/전체 테스트/패키지 압축을 함께 실행하지 않았다. 기존 결과는 삭제하거나 덮어쓰지 않았다.

## GPT-5.6 Luna 최종 비교

공식 문서는 Luna를 비용에 민감한 대량 처리용 모델로 설명하며 기존 nano급에 대응한다. [공식 Luna 문서](https://developers.openai.com/api/docs/models/gpt-5.6-luna). 여기서는 API 가격으로 구독 절감액을 추정하지 않는다.

| 구성 | 실제 정상 응답 | 중앙값 | 최소–최대 | 채팅 개수 지시 준수 |
|---|---:|---:|---:|---:|
| Astra / low | 8/8 | 10.249초 | 9.000–12.865초 | 8/8 |
| Luna / low | 8/8 | 9.322초 | 7.583–16.615초 | 8/8 |
| Luna / none | 8/8 | 8.073초 | 6.964–12.710초 | 7/8 |

각 구성은 같은 4개 입력을 두 번 처리했다. 두 번째 반복은 모델 순서를 뒤집었고 모델 호출은 직렬로 실행했다. Luna low 중앙값은 약 9%, none은 약 21% 짧았다. 표본이 작고 low의 가장 느린 응답은 Astra보다 길어 항상 빠르다는 결론은 내리지 않는다.

24개 원문을 검토했다. 한국어 취향 질문/후속 맥락, 보스 격파·체력 20/100, 실패 발언의 부정·숫자 의미는 모두 유지했다. 의미를 바꾸는 전사 교정과 요청하지 않은 게임 조작 조언은 없었다. Luna는 Astra보다 여러 관객의 반응을 더 자주 만들고 단골식 응원을 자주 반복하는 경향이 보였다. 긴 대화에서의 기억·개성 안정성이나 복잡한 실제 게임 영상 품질은 미검증이다.

Luna none의 첫 화면 응답은 최대 2개 요청에 3개를 생성했다. 이는 JSON 형식 오류는 아니지만 출력 개수 지시 위반이다. 실제 Studio.accept는 chatPace로 잘라 표시하므로 이 사례가 3개 표시를 보장하는 것은 아니다. 형식 정상 8/8과 지시 준수 7/8을 구분한다.

**판단:** 일반적인 한국어 관객 채팅의 선택지로 비교할 가치가 있다. 속도 우선이면 Luna none, 추론을 유지하며 비교하려면 Luna low를 시험할 수 있다. 기본 모델은 자동 전환하지 않는다. 현재 경로에서 호출 자체가 거절된 GPT-5.4 mini와 달리 두 Luna 설정은 실제 구독 응답까지 확인했다.

재현: 화면 fixture를 새 폴더에 생성/복사한 뒤 `node scripts/benchmark-audience-models.mjs --luna --out=<새 폴더>`를 실행한다. 원본 입력·출력·시간·사용량은 `artifacts/audience-luna-valid/{inputs.json,vision.png,results.json,run.log}`에 있다. 최초 잘못된 ID의 결과는 `artifacts/audience-luna-benchmark`에 별도 보존하며 이 표에서 제외했다.

## 이전 버전 복귀

0.1.2는 새 모델 선택 필드를 읽지 못한다. 복귀 전 모델·추론 수준을 모두 ‘앱 기본 설정 사용’으로 저장하거나, 설치 백업의 provider-choice.json을 별도 복사본에서 확인한다. 고정 설치 위치의 백업 current.json으로 실행 버전을 복구하며 개인 기록 전체를 자동으로 과거 버전으로 되돌리지 않는다.

## 0.1.3 통합·배포 검증 기록

- 원본 작업 `19008c6`와 시즌 시험 격리 보완 `c4606eb`를 `57fd39d` 한 커밋으로 squash 통합했다. main 원격 SHA 일치를 확인했다.
- 격리 통합 worktree `audience-model-integration`의 `artifacts-integration-final.log`: 682개 테스트, TypeScript/Vite 빌드 통과. 최초 검사에서 기존 HTTP fetch 실패 4건이 있었고 해당 19개 검사는 재검사에서 통과했다. 후속 검사에서 시즌 시험의 실제 250ms 채팅 타이머가 가상 시간/수동 제안 호출에 끼어든 것을 확인했다. 해당 시험만 실제 타이머를 정지시켜 기존 모든 단언을 유지했으며 관련 38개 회귀 검사와 최종 전체 검사를 통과했다. 최초 HTTP 오류의 상세 원인은 확정하지 않았고 호스트 포트 설정은 변경하지 않았다.
- `artifacts/model-settings-ui-1789484412107/result.json`: 소스의 실제 UI에서 mini 거절, Luna low 8.714초, Astra low 10.492초. 모델별 선택과 none/max에서 Astra low로의 추론 수준 보정, 재시작 복원 및 방송 중 잠금을 확인했다.
- 패키지 `release/2026-09-15T15-01-49-087Z/app/Nagneon-win32-x64`: `artifacts/package-integrity-test.json`에서 2,476개 파일의 해시, 100개 소스, ASAR 보호 fuses 일치. 기존 검증된 음성/소리 런타임을 복사하고 빌더에서 다시 해시 검증했다.
- `artifacts/packaged-runtime-test.json`: 해당 ASAR에서 추출한 모듈과 번들 Python/Whisper/YAMNet/Codex로 합성 한국어 음성과 실제 Astra low 응답을 확인했다. 앱의 로컬 GPU 음성 인식 경로가 동작했다. 스피커·마이크는 사용하지 않았다.
- `artifacts/model-settings-ui-1789485005211/result.json`: 실제 배포 ASAR의 서버/화면과 번들 Codex를 숨겨진 Electron 창에서 실행했다. mini 미지원, Luna low 6.437초, Astra low 9.402초 및 설정 동작을 확인했다. 이 단일 연결 시험들은 24회 비교에 합산하지 않는다. 배포 EXE의 사용자 창을 새로 띄운 시험은 아니다.
- `artifacts/release-0.1.3/archive-files.json`, `archive-decode.json`: 두 ZIP의 파일 합계가 패키지 2,476개와 정확히 일치하며 누락·추가·중복 없이 압축 해제가 가능했다. 공개 파일은 개인 기록을 포함하지 않는다.
- 사용자 앱이 정상 종료된 것을 확인한 뒤 고정 설치 도구를 적용했다. 현재 고정 진입점은 0.1.3을 가리키고 기존 프로필을 유지한다. 자동으로 앱을 다시 열지 않았다. `artifacts/install-0.1.3.log`, `installed-inspect.json`, `installed-model-preservation.json`에서 설치·실행 파일 해시·모델 선택 무변경을 확인했다. 이전 실행 포인터와 기록은 설치 루트 `backups/update-20260916-001156-dee2ce05`에 보존되어 있다.
- 원본 작업 브랜치 `codex/audience-model-selection`은 원격 SHA와 squash 결과의 전체 트리 일치를 확인한 뒤 로컬/원격에서 삭제했다. 작업/통합 worktree는 패키지·모델·검증 원본이 있어 보존한다. 다른 작업의 worktree는 사용 종료 여부가 불명확하여 삭제하지 않았다.

릴리즈 대상은 [Nagneon 0.1.3](https://github.com/msmckimgpt-tech/nagneon/releases/tag/v0.1.3)이다. 업로드 원본 해시와 원격 자산 검증은 `artifacts/release-0.1.3`에 보존한다.
