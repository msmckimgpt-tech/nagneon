# Nagneon 0.1.0 Preview 2

비교 기준은 현재 공개 릴리즈 [v0.1.0-preview.1](https://github.com/msmckimgpt-tech/nagneon/releases/tag/v0.1.0-preview.1), 소스 `878c41e244ddade113a6ef4c845aa67bae3c1dd4`다. 해당 릴리즈도 prerelease이며, 별도의 정식 릴리즈가 있는 것으로 간주하지 않는다. 이번 변경은 `codex/preview-0.1.0-2` 브랜치에서 검증하고 프리뷰로만 게시한다.

## 현재 릴리즈와 비교

| 영역 | Preview 1 | Preview 2에서 두 옵션을 모두 켜면 |
|---|---|---|
| AI 제공처 | 기본 Codex, 환경 설정 기반 OpenAI | 설정에서 Codex/OpenAI 모델 ID·추론 수준, Ollama 모델·주소·문맥 크기, Claude/Gemini 구독 CLI·API 모델 선택 |
| 프롬프트 | 자동 생성 | 추가/전체 대체, 기본값 복원, 기존 관객의 잠긴 설정 JSON 편집 |
| 방송 입력 | 앱에서 화면 선택 | OBS 장면 선택과 화면 입력 추가; 방송 시작·녹화 제어는 없음 |
| 실제 채팅 | 개인 AI 방송실 | 치지직 또는 YouTube 읽기 전용 연결; 발신·양쪽 동시 연결 없음 |
| 채팅 읽기 | 기존 스크롤 동작 | 읽던 위치 유지, 새 채팅으로 이동, 최근 질문·후원·반복 문구 요약 |
| 채팅 작성 | 텍스트 입력 | 텍스트 리액션을 커서 위치에 삽입; 자동 전송 없음 |
| 방송 분위기 | 개별 설정 | 네 가지 분위기 프리셋; 기존 관객과 훈수 정책 보존 |
| 상태 전달 | 전체 SSE 상태 | 변경 부분만 전달; 꺼지면 기존 연결도 전체 상태로 전환 |
| 프로필 | 기존 `backseat-studio` | 기본 `nagneon-preview`로 분리; 기존 프로필 자동 복사 없음 |

관객은 계속 텍스트로 반응한다. 외부 연동 없이 개인 방송실을 사용할 수 있다. 배포 무결성·출력 검증·취소 및 테스트 안정성 보완은 기본 경로에도 유지한다. 출처와 이전 실제 서비스 벤치마킹은 [SERVICE-BENCHMARK.md](SERVICE-BENCHMARK.md)에 있다.

## 사용 방법

두 ZIP을 같은 폴더에 풀어 내부 `Nagneon` 폴더를 합친 뒤 `Nagneon.exe`를 실행한다. 설치 프로그램과 자동 업데이트는 포함하지 않는다. 모델 ZIP의 `Nagneon/resources/speech/microphone-model/model.bin`이 앱 폴더 안에 있어야 한다.

방송 설정 → 디버그 → **디버그 모드 사용**과 **신규 기능 사용해보기**를 모두 켠다. 둘 다 기본 꺼짐이며, 하나만 켜면 신규 기능이 작동하지 않는다. 방송·연습·모델 요청 중에는 변경할 수 없다. 기존 debug.json에 새 플래그가 없어도 자동 활성화되지 않는다.

한쪽을 끄면 OBS·외부 채팅 연결을 정리하고 기본 제공처로 돌아간다. 저장한 사용자 프롬프트는 적용하지 않는다. 이미 직접 저장한 관객 설정이나 대화 기록은 지우지 않는다. 원복할 설정값은 편집기에서 복원한다. 기본 AI는 기존 환경 설정이 없을 때 `gpt-6-astra / low`다.

프리뷰 데이터는 `%APPDATA%/nagneon-preview/data`에 저장한다. 기존 릴리즈의 `%APPDATA%/backseat-studio`는 변경하지 않는다. `--nagneon-profile=<절대 경로>`로 지정하면 해당 경로가 우선한다. 별도 프로필이어도 공식 Codex 계정 로그인은 CLI가 관리한다.

연결 안내: [모델 설정](MODEL-PROVIDERS.md), [OBS·외부 채팅](EXTERNAL-CHAT-SETUP.md), [로컬 모델](OLLAMA-SETUP.md), [디버그 편집](DEBUG-MODE.md).

## 검증과 남은 항목

- 660개 Node 테스트와 TypeScript/Vite 빌드 통과: `artifacts/preview2-check.log`.
- 네 가지 스위치 조합, 인증된 HTTP 직접 호출 차단, 기존 프로필 기본 꺼짐, 저장된 Ollama 비활성 시작, 해제 시 기본 제공처 복원, 기존 SSE 연결의 전체 상태 복귀를 검사했다.
- 실제 Electron에서 프롬프트 편집·적용·복원과 잠긴 설정 변경, 프리셋·OBS·외부 채팅·리액션·스크롤·요약 등 9개 화면 흐름을 검증했다. 이 UI 검사의 모델·플랫폼 응답은 합성 fixture다.
- 공식 Codex 기기 코드 발급·취소 및 실제 Electron 계정 화면 검사 통과. 계정 로그인 완료나 기존 계정 변경은 하지 않았다.
- 이전 단계에서 실제 OBS/Codex 화면 반응은 확인했다. 치지직·YouTube는 개발자 설정이 없어 실제 계정 연결 미검증이다.
- Claude/Gemini는 공식 API·구독 CLI 요청/이미지 변환·응답 스키마·실패/취소를 검사했다. 실제 Claude 구독 세션 만료와 Gemini 수동 Google 로그인 필요를 확인했으며, 사용자 재로그인 후 실응답과 한국어 품질은 미검증이다. 앱에서 공식 CLI 로그인 창을 열 수 있다.
- 시험한 소형 로컬 모델은 구조 검증을 통과해도 응답 내용/관객 전달 품질에 미달했다. 기본 모델로 권장하지 않는다.
- 물리 마이크와 자연스러운 장시간 게임 방송, 신규 Windows PC, 서명·설치형 업데이트는 별도 검증이 필요하다.

배포 패키지와 ZIP의 최종 검증 기록은 릴리즈 게시 시 아래에 추가한다. 이전 Preview 1 또는 이전 빌드의 결과를 새 파일의 검증으로 대체하지 않는다.

## 정식 통합 조건

사용자가 이 프리뷰를 실제로 사용한 뒤 결과를 알려주고, 해당 기능에 남은 재현 가능한 이슈가 없음을 확인한 뒤 정식 통합한다. 시간 경과나 피드백 부재를 승인으로 해석하지 않는다. 현재 프리뷰를 main에 추가 병합하거나 정식 태그로 재분류하지 않는다.

사용 결과에는 버전, 켠 기능, 선택 모델, 재현 절차, 기대/실제 결과를 남긴다. 계정 키·토큰·개인 대화 원문은 첨부하지 않아도 된다. 이슈 수정은 후속 프리뷰에서 재검증한다. 승인 후에는 최신 main과 격리 통합 → 필수 회귀/패키지 검사 → 정식 기능의 이중 스위치 해제 → 새 정식 릴리즈 순으로 진행한다.

## 최종 소스 검증 추가

`artifacts/preview-model-ui.log`에서 실제 Electron의 모델/CLI/API 선택, 공식 로그인 버튼 전달, 두 옵션 해제 시 기본 gpt-6-astra/low 복귀를 확인했다. 실제 계정 인증을 대신하는 UI fixture 검사다. CLI의 실제 실행 한계는 MODEL-PROVIDERS.md에 기재했다.

전체 검사 중 테스트 타이밍 경합 두 건을 좁혀 수정했다. 마이크 hang 검사의 200 ms는 의도적으로 멈춘 요청에만 적용하고 복구 요청은 기존 2초 예산으로 검사한다. fake clock 시즌 제안 검사에서는 테스트가 직접 maybePropose를 호출하므로 관계없는 250 ms 실시간 pump를 중지했다. 생산 코드의 타임아웃/동작은 바꾸지 않았다. 수정 후 660개 전체 검사와 빌드가 통과했다.

웹 보조 검토는 실제 `chatgpt-web/high` 두 대화와 별도 종합 대화로 수행했다. 원문/도구 완료 receipt는 `artifacts/preview-cli-web-review`에 보존한다. 임시 ChatGPT 대화여서 재방문 가능한 고유 URL은 없다. helper finalize는 진행 중 수정된 subscription-provider.js의 drift를 감지해 거부했으며, 그 검토를 최종 원본 일치로 주장하지 않는다. 로컬에서 변경 diff·공식 2.1.270/0.59.0 CLI·테스트로 다시 판단했다.

검토의 취소 종료 deadline, UTF-8 청크 조립, Claude 인증 enum/stream 출력 옵션은 수정했다. 정규식 `*`가 리터럴이라는 웹 진단은 원본과 테스트로 반증되어 반영하지 않았다. CLI 선택 저장을 무조건 거부하자는 제안은 로그인 전 선택→공식 로그인 버튼 흐름과 충돌하므로 채택하지 않았으며, 선택 저장/설치 준비/실제 인증을 UI와 안내에서 구분했다. 공식 설치 경로는 실제 npm 패키지로 확인했고 임의 셸 문자열은 실행하지 않는다. 사용자 지정 실행 파일은 인증된 로컬 설정의 신뢰 경계다. Gemini @file 해석은 생성한 파일명만 요청 문법으로 전달하며 내부 사용자 텍스트는 다시 CLI 인자로 넣지 않는다. 실제 Google 인증 후 모델 입력 경계 검증은 남은 프리뷰 수용 항목이다.

## 배포 파일 검증 · 2026-09-15 KST

소스 `f1db9da46bf09086c0f6332dba3d3a49c1747447`에서 만든 최종 실행본은 `release/2026-09-14T15-09-05-829Z/app/Nagneon-win32-x64`다. 2,452개 파일, 3,142,448,907바이트, 소스 98개가 일치했다. ASAR SHA-256은 `403749551068d29eb8627b9e56162178ed8e9cb2c4f1c7607064619c9f67904f`다.

- `artifacts/package-integrity-test.json`: 전체 파일/소스 무결성 통과.
- `artifacts/preview2-runtime.json`: 개발 도구 PATH 제외, 배포 ASAR의 모듈과 번들 Python/음성 모델/YAMNet/공식 Codex 실행. 합성 한국어 전사 4,437 ms, 실제 Astra low 응답 11,069 ms. 물리 마이크 검증은 아니다.
- `artifacts/preview2-native.json`: 새 프로필로 실제 Nagneon.exe 창 생성·정상 종료·프로필 생성 통과.
- [Windows CI 34860385768](https://github.com/msmckimgpt-tech/nagneon/actions/runs/34860385768): 660개 테스트/빌드, 설치 엔진 검사, Electron 세로 화면 검증 통과.
- `artifacts/preview2-delivery.json`: 두 ZIP 안의 총 2,454개 파일을 원본 매니페스트 및 추가 README/프로젝트 라이선스와 SHA-256으로 대조해 통과. 사용자 프로필·키·로그를 포함하지 않는다.

| ZIP | 바이트 | SHA-256 |
|---|---:|---|
| Nagneon-v0.1.0-preview.2-windows-x64-app.zip | 860,434,080 | `511465b982c6771ebf1341639cc09acce6394981c5732d395ec460a85f99d02b` |
| Nagneon-v0.1.0-preview.2-microphone-model.zip | 1,413,591,768 | `f4df520d78681eae58f586e729c68fd4037d90b273b101f0bf6c953c4fa486a7` |

이 검증 기록 추가 커밋은 문서만 변경하며 실행 코드·패키지·ZIP을 변경하지 않는다. 기존 v0.1.0-preview.1 태그와 main은 이번 프리뷰 게시 작업에서 변경하지 않았다.
