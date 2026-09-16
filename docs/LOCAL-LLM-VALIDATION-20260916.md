# 추천 경량 모델의 이 머신 실측 · 2026-09-16

## 결론

Ollama와 추천 상위 로컬 모델 3종의 설치·GPU 추론·설치된 앱의 연결은 확인했다. **현재 0.1.4의 전체 관객 제공처를 이 모델들로 교체하는 것은 검증되지 않았다.** 기존 사용자 프로필과 기본 제공처는 변경하지 않았다. 검증 도구/기록은 원본 `0c0d0ae`, 통합 `d7b9ab8`로 게시했다. 사용자의 명시적 요청에 따라 0.1.5를 릴리즈하되 실측 제한과 AI 작업 기록은 앱 UI에 넣지 않고 릴리즈 문서에만 남긴다. 게시/적용 결과는 [0.1.5 배포 기록](RELEASE-0.1.5.md)에 별도로 기록한다.

참고 대화의 가정은 짧은 persona + 최근 대화 → 한두 문장이다. 현재 앱은 관객별 목격 범위, 장면, 기억, 훈수 정책, 클립/정정 등의 전체 구조를 한 호출로 처리한다. 두 작업을 구분해 시험했다. 유료 API는 호출하지 않았다. 템플릿 대사를 모델 출력으로 바꾸어 보고하지 않았다.

## 환경과 설치

- 기준 main `03679a32ae6fc52753440ae550fa6fd1f65ab649`, 설치 앱 0.1.4.
- Windows, NVIDIA RTX 2070 8GB. 격리 작업 `codex/local-llm-setup` / `00_game_backseat-worktrees/local-llm`.
- 안정 설치 루트 아래 `local-llm/runtime/0.34.0`, `local-llm/models`, `local-llm/logs`에 런타임·모델·로그 분리.
- [공식 Windows 배포](https://docs.ollama.com/windows)의 기존 보존 ZIP을 재사용하기 전에 [공식 0.34.0 release](https://github.com/ollama/ollama/releases/tag/v0.34.0)의 SHA-256과 대조했다: `a7dd1b174f39d3d1b8a25d4cbc86045d0e190b17187bfdcbe2f2ee3b5a11470e`. 실행 파일 서명 Valid; 설치 exe SHA-256 `1f9b38e594a3e1cffdf606a507ac8660626c0985ee0782dd6b49309153d38080`.
- 서버는 `127.0.0.1:11434`, `OLLAMA_NO_CLOUD=1`, Flash Attention, q8_0 KV cache, 병렬 1, 적재 모델 1. 5분 유휴 후 모델 해제. 시스템/사용자 전역 환경 변수와 자동 시작은 변경하지 않았다.
- `/api/ps`에서 Qwen 0.8B 전체 GPU 적재, 65,536 문맥, 약 1.92GB VRAM 확인. 게임/Whisper 동시 부하는 측정하지 않았다.

| 모델 | 설치 규격 | 크기 | manifest digest |
|---|---|---:|---|
| qwen3.5:0.8b | Q8_0, vision | 1,036,046,583 B | f3817196d142eaf72ce79dfebe53dcb20bd21da87ce13e138a8f8e10a866b3a4 |
| gemma3:1b | Q4_K_M, text | 815,319,791 B | 8648f39daa8fbf5b18c7b4e6a8fb4990c692751d49917417b8842ca5758e7ffc |
| qwen2.5:1.5b-instruct | Q4_K_M, text | 986,061,892 B | 65ec06548149b04c096a120e4a6da9d4017ea809c91734ea5631e89f96ddc57b |

[Qwen 공식 Ollama 태그 목록](https://ollama.com/library/qwen3.5/tags)에서 0.8B 기본은 Q8_0이다. 추천 글의 INT4와 동일 조건이라고 주장하지 않는다. 270M router와 한국어가 우선이 아닌 SmolLM3 등 나머지 후보는 이번 시험 대상이 아니다.

## A. 현재 앱의 전체 입력

`scripts/verify-local-audience.mjs`는 실제 제공처와 Studio를 사용한다. 사용자 기록 없이 합성 단골 5명, 가상 시계로 발언 간격/채팅 대기열을 진행한다. 추론 시간은 실제 벽시계다. 게임/마이크/자연 세션 검증은 아니다.

| 조건 | 결과 |
|---|---|
| Qwen 0.8B, 변경 없는 제공처, 65,536 문맥 | 최초 연결 probe 60초 timeout |
| 설치 0.1.4, 같은 모델/문맥, 실제 UI probe | 연결 준비됨 표시 성공. 실제 요청 약 35.3초 후 미완료 응답 오류 표시 |
| Qwen 0.8B, 진단용 `think=false` | probe 7.34초, 질문을 그대로 반복. 기술적으로 ready이지만 의미 성공 아님 |
| 같은 진단 조건, 실제 Studio 5턴 | 14.28 / 6.76 / 9.18 / 10.92 / 13.57초. 4턴은 채팅 전달 없음, 1턴은 잘못된 화자의 JSON 조각 섞인 문장. 의미 성공 0/5 |
| Gemma 1B, 지원 문맥 32,768 | 전체 prompt의 보수적인 UTF-8 byte 예산 검사에서 거부. 실제 모델의 문맥 능력 실패로 해석하지 않는다 |
| Qwen2.5 1.5B, 지원 문맥 32,768 | 같은 예산 검사에서 거부. 전체 prompt 추론은 실행되지 않음 |

Qwen 0.8B의 원본에는 근거 없는 음성 정정, `streamer`를 관객 ID로 생성, 화면 설명 대신 질문 반복이 있었다. 표시된 한 문장도 `모모, 오늘도 정말 재미있어!\",\"attention\":\"momo\"}],`였다. JSON 파싱/스키마 통과와 의미 품질을 분리한다. 최초 시험 harness에서 world 미주입 예외가 발생해 고쳤으며, 그 실행은 probe 이후 Studio 검증 근거로 사용하지 않는다. Gemma의 첫 harness 예외도 최종 재실행의 probe-only 실패로 대체했다.

`LOCAL_TEST_NO_THINK=1`은 시험 fetch에서만 요청을 변경한다. 설치 앱/제품 어댑터에는 적용하지 않았다. 앱의 전체 지침을 줄이거나 검증 규칙을 풀어 통과시키지 않았다.

## B. 추천 글이 가정한 짧은 worker

`scripts/verify-local-worker.mjs`: 4,096 문맥, 최대 출력 160, think=false, temperature 0.4, seed 42. 위로/회상/정정/훈수 자제/모르는 정보/농담 6개 합성 입력. 모델마다 1회씩으로 통계적 순위·일반 성공률은 아니다. 전체 서비스와 별도인 진단이다.

| 모델 | 첫 호출(모델 전환/적재 포함) | 이후 5건 | 의미 검토 |
|---|---:|---:|---|
| Qwen 0.8B | 5.71초 | 0.16~0.40초 | 파란 열쇠 기억을 부정하고 체력을 100%로 날조. 호칭/역할 혼동. 일반 worker 대체 미달 |
| Gemma 1B | 14.38초 | 0.09~0.14초 | 위로·정정은 가능. 체력 날조, 농담에 비한국어 단어, 공감 부적절 |
| Qwen2.5 1.5B | 35.03초 | 0.09~0.19초 | 회상·정정·훈수 자제·미관측 정보 보류는 적절. 위로에 중국어 혼입, 농담은 입력 반복. 좁은 역할의 추가 검증 후보 |

추가 API 사용료는 발생하지 않았다. 전력·게임 FPS·구독 한도 절감·운영 비용 효과는 미측정이다. 짧은 출력의 warm latency를 전체 앱 속도로 제시하지 않는다.

## 운영과 복귀

- 이 머신에서는 `<install-root>/local-llm/Start-LocalLLM.cmd`로 서버 재시작 가능. `scripts/Start-LocalOllama.ps1 -Root <local-llm>`은 기존 11434 소유 프로세스/실행 경로/버전을 확인하며 다른 서버를 종료하지 않는다.
- 실행 중 서버 재사용과 소유 서버 중지 후 재시작을 확인했다. 설치본 검증 창은 정상 종료했다. 모델은 보존하며 서버는 다음 로컬 시험을 위해 준비되어 있다.
- 설치본 연결은 `local-llm/validation-profile`에만 저장했다. 원래 `current.json`, 저장 위치 선택, 사용자 `provider-choice.json`을 변경하지 않았다. 기존 앱의 정상 진입점을 그대로 사용하면 기존 제공처가 유지된다.
- 설치된 세 모델은 앱의 선택 창에서 수동 선택 가능하지만 위 제한으로 기본 사용을 권하지 않는다. 실험 후에는 ChatGPT 구독 · Codex로 복귀한다. 이 설정 작업으로 재로그인은 필요 없다.
- 다음 구현 후보는 짧은 반응 worker와 상위 구독 모델의 역할 분리, 실제 토큰화에 맞춘 예산 검사, 생각 모드 제어다. 현재 전체 제공처와 동등하다고 간주해 자동 전환하지 않는다.

## 증거와 검증

작업 worktree `artifacts/`에 원본 요청/응답을 보존했다. 모두 합성 입력이다.

- `local-audience-lFHJKT/result.json`: 최초 Qwen probe timeout (이후 harness 실패 포함).
- `local-audience-dBNUiJ/result.json`: no-think 진단의 probe와 Studio 5턴 전체 원본. 당시 exit 0은 의미 통과가 아니며 최종 harness는 채팅 누락 시 exit 1로 수정.
- `local-audience-8zEOla/result.json`, `local-audience-6khcW9/result.json`: Gemma/Qwen1.5 최종 예산 거부.
- `local-worker-m5O1Fe/result.json`: 짧은 worker 18건 전체 원본/사용량/시간.
- 설치 루트 `local-llm/native-ui-result.json`: 실제 설치 앱 UI 연결/응답 오류; `installed-models.json`: 설치 digest.
- `artifacts/check.log`: `npm run check` 676 tests, format, TypeScript/Vite 통과. 이는 모델 품질 통과가 아니다.

완료한 것은 런타임 설치, 3모델 실제 추론 비교, 현재 앱 연결 및 제한 확인, 재현 도구다. 현재 앱 전체 로컬 대체·하이브리드 자동 라우팅·새 제품 릴리즈는 완료로 표시하지 않는다.
