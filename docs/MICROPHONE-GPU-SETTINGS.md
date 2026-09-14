# 음성 인식 GPU 설정 · 2026-09-15

설정 → 미디어·기록 → 음성 인식 처리 장치에서 GPU 또는 CPU를 선택한다. 신규 설정과 기존 설정에 장치 항목이 없을 때 모두 GPU가 기본값이다. 방송·연습·응답 생성 중 설정 잠금은 기존 규칙을 유지한다. 저장한 장치는 다음 마이크 준비와 앱 재시작 때 적용한다.

- GPU: NVIDIA CUDA, medium / int8_float16. 모델 준비 시 실제 encoder 추론을 실행해 지연 로딩되는 DLL까지 확인한다.
- CPU: medium / int8, 4 threads. GPU 라이브러리를 로드하지 않는다.
- GPU 준비 실패 시 CPU로 자동 전환한다. 설정 선택은 GPU로 유지하고 현재 작동 장치와 전환 여부를 표시한다. 추론 중 CUDA/cuBLAS/cuDNN/메모리 오류는 모델을 내리고 같은 발언을 CPU로 한 번 재시도한다. 잘못된 음성 입력은 GPU 오류로 취급하지 않는다.
- 장치 변경은 작업이 없는 음성 프로세스의 종료를 확인한 뒤 새 프로세스를 시작한다. 처리 중 음성을 강제로 끊지 않는다. 방송 중 마이크 유지·자동 재연결·발언 시점 화면 연결은 [기존 동기화 개선](MICROPHONE-AV-SYNC.md)을 유지한다.

## 런타임 설치와 배포

개발 작업 폴더에서 `python scripts/install-speech-gpu.py`를 실행한다. 시스템 Python 패키지나 PATH를 바꾸지 않고 `.models/gpu`에 공식 NVIDIA wheel을 설치한다. Python에 pip가 필요하다. 이미 받은 pip target은 `--source <폴더>`로 재사용할 수 있으며 wheel RECORD SHA-256과 크기를 검증한다.

고정 버전: `nvidia-cublas-cu12==12.4.5.8`, `nvidia-cudnn-cu12==9.1.0.70`. 배포 시 manifest와 DLL 해시를 검증하고 원본 배포 메타데이터·라이선스를 포함한다. GPU 런타임 없는 개발 환경은 CPU 자동 전환이 가능하지만, Windows 패키징은 GPU 런타임을 필수로 요구한다. 사용자 GPU 드라이버는 설치하거나 변경하지 않는다.

## 검증

작업 폴더: `G:/dev/ai/00_game_backseat-worktrees/microphone-gpu-settings`.

- `artifacts/gpu-settings-runtime.json`: 실제 RTX 2070에서 GPU / int8_float16 준비·인식 성공. 동일 3초 한국어 파일 처리 GPU 555ms, CPU 2145ms, GPU 라이브러리 없는 경우 CPU 전환 2271ms. 세 경로 모두 “지금 왼쪽으로 가면 되는 건가요?” 인식. 한 파일 비교이며 전체 지연 분포나 물리 마이크 측정은 아니다.
- `artifacts/gpu-settings-ui.json`: 별도 Electron 프로필에서 GPU 기본값, CPU 저장, 화면 새로고침, 서비스 재시작 후 설정 유지 통과.
- `test/local-speech.test.js`: 구 설정 마이그레이션, CPU/GPU 인자, 실제/선택 장치 구분, 작업 중 변경 거절, 저장된 CPU 시작·준비 라우팅 회귀 검사.
- `test/speech-worker.test.py`: GPU 추론 오류 시 원래 발언 재시도, 손상 입력과 GPU 오류 구분 등 11개 통과.

사용자 실행 앱과 프로필을 종료하거나 수정하지 않았다. 물리 마이크·실제 게임 장면의 의미 정합성은 이번 설정 검증 범위에서 측정하지 않았다.

최종 `npm run check`는 테스트 동시 실행 수 2로 수행하여 662개 테스트, TypeScript 검사, Vite 빌드가 통과했다 (`artifacts/check-final.log`). 패키지의 실제 Python/medium 모델과 GPU DLL을 사용한 검사에서 `speechDevice=GPU / int8_float16`, `speechFallback=false`를 확인했다 (`artifacts/packaged-runtime-test.json`). 모델 초기 준비 10.3초, 별도 한국어 시험 음성 처리 1.27초였다. 준비 시간은 모델을 처음 올리는 시간이며 매 발언 처리 시간과 구분한다. 소리 모델과 공식 CLI 연결 확인도 통과했으며 실제 관객 모델 호출은 수행하지 않았다.

GPU 포함 Windows 개발 배포본은 `release/2026-09-14T16-43-20-928Z/app/Nagneon-win32-x64` (4,755,255,185 bytes, 2476 files). 같은 release 폴더의 `Nagneon-GPU.lnk`는 기존 `nagneon-preview` 프로필을 명시하여 실행한다. 실행 중인 이전 버전이 있으면 종료 후 이 바로가기를 사용한다. 배포본은 기존과 같은 서명 없는 개발 빌드다.
`artifacts/package-integrity-test.json`: 배포 파일 2476개 해시, 원본 소스 96개 일치 및 실행 보호 설정 확인 통과.
