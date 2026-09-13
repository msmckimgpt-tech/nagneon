# 한국어 음성 인식 정확도 개선

2026-09-13. 작업 트리 `G:/dev/ai/00_game_backseat-worktrees/stt-accuracy`, 브랜치 `codex/stt-accuracy`, 시작 main `d3a23fce0249275df7d9b1c374618d91eeeb5491`. 이전 [지연 개선](MICROPHONE-LATENCY.md)의 후속이다. 사용자 앱/화면/마이크/장치를 조작하거나 재시작하지 않고 별도 runtime, 합성 음성, 메모리 전용 서버로 검증했다.

## 관찰과 변경

사용자 사례는 “바뀌어서 → 벗겨서”, “힘 → 게임”, “그렇습니다 → 네, 감사합니다”다. 허용된 최신 수집본에서 첫째/셋째의 잘못된 문장은 교정 주석이 없는 microphone 원문이었다. 둘째와 일치하는 수집 원문은 “힘을…”이며 해당 사본에는 교정 주석이 없었다. 기록의 시점과 표시 위치 차이를 추정으로 메우지 않았고, 새 음성이나 원문 대화 사본을 수집하지 않았다.

기존 small 모델의 beam 수 증가(1→3→5), 8/12/16/30초 encoder, timestamp 생략, 선행 무음, 중립 prompt를 비교했다. 단순 디코딩 조절만으로는 짧은 대답 오인식이 해결되지 않았으며, 일부 입력은 앞선 8초 연산 최적화에서 정확도가 낮아졌다. 30초 복원도 모든 사례를 개선하지 않아 일괄 적용하지 않았다.

검증한 **Whisper medium CPU/int8, beam 3**를 마이크 전용으로 추가했다. 고정된 Systran 변환 모델을 사용하며 음성을 외부에 보내거나 모델 코드를 다운로드해 실행하지 않는다. 약 1.53GB의 모델 파일은 Git에 넣지 않는다. 기존 8초 encoder와 불확실 인식 재시도, 순서 보장, 취소 처리는 유지한다. 시스템 소리 인식은 기존 small 모델을 계속 사용한다.

- `shared/microphone-model.json`: 저장소/리비전/파일 크기/SHA-256 고정.
- `scripts/download-microphone-model.py`, `scripts/install-microphone-model.mjs`: 고정 파일만 다운로드하고, 설치 전후 해시를 확인한 staging 디렉터리를 원자적으로 게시한다. 다른 기존 모델은 덮어쓰지 않으며 junction 경로를 거절한다.
- 개발 실행: `.models/microphone/manifest.json`으로 설치를 확인해 로컬 모델을 선택한다. 명시적으로 전달된 runtime 모델 경로는 우선한다. 실행 중 다운로드는 없다. `Setup-LocalSpeech.ps1`에 재현 가능한 다운로드/검증 설치를 연결했다.
- 패키지: 준비된 `.models/microphone`이 있으면 검증 후 `resources/speech/microphone-model`로 복사하고 payload 해시에 포함한다. 기존 runtime만 있는 패키지의 small 경로도 유지한다. 이번 작업에서 전체 설치 EXE는 새로 빌드하지 않았다.
- `localAudioModel` 상태로 worker가 준비한 모델 이름을 확인할 수 있다.

문맥 교정에는 별도 결함이 있었다. 긴 문장의 공통 부분을 포함한 편집 거리로 판정해 “힘→게임”이나 “바뀌어서→벗겨서”도 승인했다. 이제 **실제로 달라진 부분**의 음운 거리를 제한하고, 모델 prompt에서 게임/화면에 잘 맞는다는 이유로 단어를 바꾸지 않도록 했다. “자바서→잡아서” 같은 가까운 표기 수정은 유지한다. 원문, 숫자/부정/질문 보호와 교정 출처도 유지한다. 이 제한은 모든 의미 변화를 판별하는 정답 판정기가 아니다.

## 검증과 한계

증거는 이 작업 트리의 `artifacts/`에 있다. Windows 합성 한국어 15개(사용자 제공 문장 3개 포함), 그 3개의 15dB 합성 잡음 버전을 더한 **18개 입력**을 비교했다. 실제 사용자 음성/게임 소음의 정답률로 일반화하지 않는다. 띄어쓰기·문장부호를 제외한 문자 편집 거리이며, 숫자의 정답 표기는 corpus에 고정했다.

| 지표 | 기존 small | 수정 medium |
|---|---:|---:|
| 문자 오류 수 / 정답 216자 | 15 | 9 |
| 문자 오류율 | 6.94% | 4.17% |
| 문장 전체 일치 | 9/18 | 14/18 |
| 처리 시간 중앙값 | 599ms | 1,685ms |

`accuracy-final.json` / `accuracy-final.log`에 실제 worker 함수의 출력, 원음 파일 해시, 시간, fallback 여부가 있다. 합성 무음의 환각 출력 없음도 확인했다. 주어진 실제 녹음이 없어 사용자의 세 오류 자체가 재현·해소됐다고 주장하지 않는다. “물약→무략”, “힘을…해야 하니까”의 어미 오류는 남았고, 후자는 일부 합성 입력에서 medium이 더 틀렸다. 평가 표본은 한 합성 목소리로 작으며 모델 교체가 모든 발언의 개선을 보장하지 않는다.

별도 실제 HTTP 서버는 모델 경로를 직접 넘기지 않고 설치 탐지를 통해 `localAudioModel=medium`을 확인했다. 잘못된 오디오 요청 후에도 `네`, `아니요`, `안 돼요`, `그렇습니다`가 정상 전사되고 microphone 출처로 채팅에 전달됐다. `http-accuracy-result.json` / `http-accuracy.log` 참조. 모델 선택/파일 무결성/기존 모델 보존/교정 거절은 Node 회귀, encoder/예외 복원 등은 Python 회귀로 검사한다. 설치기는 실제 1.53GB 파일의 해시와 재실행 무변경까지 검증한다.

재현: 번들 Python으로 `scripts/verify-stt-accuracy.py --baseline-worker <이전 worker> --baseline-model <small 경로> --model <medium 경로> --corpus <합성 corpus JSON> --output <결과 JSON>`을 실행한다. 합성 corpus와 WAV, 이전 worker, 예비 비교 결과도 같은 증거 폴더에 보존했다. 사용자 음성 원본 저장을 켜지 않았다.

## 적용 상태

main에 코드를 통합하고 검증된 모델을 `G:/dev/ai/00_game_backseat/.models/microphone`에 설치하는 것이 이번 적용 범위다. 외부 push, 설치 EXE 재생성, 사용자 앱 재시작은 수행하지 않는다. 실행 중인 프로세스에는 아직 반영되지 않으며 사용자가 앱을 정상 재실행해야 한다. 그 뒤 실제 발언의 품질과 CPU 부하에서의 지연을 확인해야 한다. [사용자 테스트 제한](USER-TEST-COLLECTION.md)을 유지한다.
