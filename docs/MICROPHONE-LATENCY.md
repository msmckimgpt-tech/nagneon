# 마이크 발언 전사 지연 수정

후속: [한국어 인식 정확도 개선](STT-ACCURACY.md)은 medium 마이크 모델의 정확도/지연 비교와 설치 상태를 기록한다. 아래 small 모델의 수치는 당시 검증 기록이다.

2026-09-13. 사용자가 확인한 문제는 마이크 발언이 텍스트로 표시되기까지의 STT 지연이다. 현재 제품에 관객 음성 TTS는 없다.

## 작업 범위와 원인

- 작업: `G:/dev/ai/00_game_backseat-worktrees/microphone-tts-latency`, `codex/microphone-tts-latency`.
- 시작 기준: `acf8ca439d86c7481df892b7b2b54c3dcf3536c6`. main 통합 전 최신 변경을 별도 작업 트리로 받아 필수 검사를 다시 수행한다.
- 화면/창/마이크/출력 장치를 열거나 사용자 앱을 재시작하지 않았다. 별도 runtime/model 복사본, 합성 WAV, 임시 포트의 메모리 전용 서버만 사용했다. 사용자 데이터와 계정은 읽지 않았다.
- 기존 렌더러는 450ms 무음 후 발언을 보내고, 연속 발언은 최대 6초로 나눈다. 인식은 순차 큐다. 서버와 수집 파일에는 기존 호출별 지연이 없어 실사용 지연의 정확한 소급 측정은 불가능하다.
- 설치된 faster-whisper 1.2.1은 짧은 발언도 encoder에 3000 feature frames, 즉 30초로 패딩한다. CPU 부하가 높은 첫 합성 측정에서는 3초 음성에 21,976ms가 걸렸다. 별도 계측에서는 6초 입력의 11~14초 처리 중 encoder가 8~9초를 차지했다. 이 숫자는 측정 시점의 다른 CPU 부하를 포함한다.

## 구현

`MicrophoneWhisper.encode`는 길이 6.5초 이하의 마이크 입력에 800 frames(8초)를 사용한다. 모든 실제 음성과 최소 1.5초 패딩을 포함하며, 모델(small), CPU/int8, 스레드 수(4), 한국어 설정, timestamp 방식은 유지한다. 긴 입력은 기존 30초 경로를 사용한다. 짧은 입력을 받는 기능은 [고정 버전 CTranslate2 4.8.2 encoder](https://github.com/OpenNMT/CTranslate2/blob/v4.8.2/src/layers/whisper.cc#L22-L55)에서 확인했다.

짧은 첫 인식은 temperature 0으로 한 번 수행한다. 평균 log probability < -1, compression ratio > 2.4, no-speech probability >= .65, 또는 VAD가 발언을 찾았는데 전사가 빈 경우에는 기존 30초 문맥과 원래 temperature 재시도를 사용한다. 모든 종료/예외 경로에서 encoder 길이를 복원한다. 이 지표들은 정확도를 보장하는 정답 판정기가 아니다.

원본 음성은 임시 파일 대신 RAM에서 읽는다. 음성 특성 추출 실패가 이미 성공한 전사를 폐기하지 않도록 했다. worker 오류 응답에 해당 요청 ID를 유지해 한 파일 오류가 모델 전체를 사용 불가로 만들거나 다음 발언을 막지 않게 했다. 응답에 내용 없는 decode/recognition/cues/processing 시간과 fallback 여부를 추가했다. 이 수치는 파일로 자동 수집하거나 사용자의 기존 세션에 주입하지 않는다.

## 검증

모든 증거 경로는 작업 트리의 `artifacts/` 아래다.

| 검사 | 결과 | 증거 |
|---|---|---|
| 합성 한국어 4종 × 2회, 순서를 교차한 실제 small 모델 비교 | 기존 3,178~11,101ms → 수정 922~1,659ms. 8쌍 전사 문자열 동일, fallback 0회 | `latency-ab.json`, `latency-ab.log`, `corpus.json` |
| 별도 HTTP 서버: 잘못된 오디오 → 정상 음성 → 채팅 전달 | 오류 후 모델 ready 유지. 정상 2건 1,295ms / 951ms, 음성 단서와 microphone 출처 확인 | `audio-http.log`, `verify-audio-http.mjs` |
| Python 회귀 검사 | 7통과: 실제 encoder 입력 길이, 긴 입력 보존, 불확실 인식 재처리, 무음, 예외 복원, 음성 단서 실패, 오류 요청 ID | `worker-tests-final.log`, `test/speech-worker.test.py` |
| 음성/교정 집중 Node 검사 | 24통과 | `focused-tests.log` |
| 작업 브랜치 필수 검사 | Node 277통과, TypeScript/Vite 통과 | `check-final.log` |
| 최신 main 통합 후 필수/회귀 검사 | Node 287, Python 7, TypeScript/Vite 통과. 실제 HTTP 전사→채팅 2건 재검증 통과 | `integrated-check.log`, `integrated-worker-tests.log`, `integrated-audio-http.log` |

비교의 baseline은 decoder 출력까지 측정하고 수정본은 오디오 decode와 음성 단서 추출까지 포함해 측정했다. 둘 다 같은 모델/CPU 설정이고 타임스탬프를 제거하지 않았다. 처음 제안한 timestamp 제거 방식은 잘린 3초 음성에서 불필요한 문장을 추가해 채택하지 않았다. 무음/6초/9.4초 입력의 예비 비교는 `decode-benchmark.json`, `window-benchmark.json`에 있다.

전체 검사의 최초 1개 실패는 `transcript-correction.test.js`가 무작위 관객 선정에 따라 응답자를 제외하던 문제였다. 해당 fixture에 독립 Audience 난수원을 고정하고 모든 시험 관객이 후보가 되게 했다. 제품의 관객 선정 정책이나 실패한 검사의 assertion을 바꾸지 않았다.

통합 후 HTTP 재검증은 필수 검사와 함께 실행되어 전체 전달 시간이 3,278ms / 2,375ms였다. 두 번째 건은 실제 recognition 913ms, decode 1,224ms, 음성 단서 180ms였다. 부하에 따른 변동을 숨기지 않으며 1초대 응답을 실사용 보장으로 삼지 않는다. 원래 합성 A/B 결과는 재측정값으로 덮어쓰지 않았다.

합성 발언은 질문, 부정문, 숫자, 일반 대화다. `물약`을 `무략`으로 인식하는 기존 오류는 양쪽 모두 남았다. 실제 사용자 목소리/게임 소음의 정확도와 지연, 렌더러의 물리 캡처→화면 표시 시간, 장시간 대기열 안정성은 이번 검증으로 합격 처리하지 않는다. 수치는 합성 파일 처리 결과이며 발화 시간과 종료 감지 450ms를 포함하지 않는다. 불확실한 발언의 기존 경로 재처리에는 더 시간이 걸릴 수 있다.

재현: 번들 음성 Python으로 `test/speech-worker.test.py`를 실행하고, `scripts/verify-speech-latency.py --model-path <격리 모델> --audio <합성 WAV> --output <작업 증거 JSON>`을 실행한다. 앱이나 물리 장치를 실행하지 않는다.

## 적용 상태와 다음 확인

구현 커밋은 `14dd3dd`, `fb87457`까지의 main을 별도 작업 트리에 통합한 검증 커밋은 `7c46e37`이다. 다른 작업자의 오버레이/수집 복구 변경을 보존하고 위 검사를 통과했다. 저장소 공통 `ai-integration.lock`을 원자적으로 획득한 뒤 main에 fast-forward하며, 외부 push는 요청 범위가 아니다. 증거 파일별 SHA-256은 `artifacts/latency-evidence-sha256.json`에 남긴다.

실행 중인 사용자 앱은 [사용자 테스트 중 조작 제한](USER-TEST-COLLECTION.md)에 따라 재시작하지 않는다. main 통합은 소스 적용이며 이미 로드된 Python worker의 교체를 의미하지 않는다. 패키저는 이 단일 `speech_worker.py`를 복사하므로 다음 패키지에도 같은 수정이 포함된다. 설치본/현재 세션에 적용 완료했다고 주장하지 않는다. 사용자가 방송을 마친 뒤 수정된 소스로 앱을 정상 재실행하면 실제 발언의 지연과 인식 품질을 확인해야 한다. 자동 재시작이나 시간 만료 후 화면 조작 재개를 예약하지 않았다.
