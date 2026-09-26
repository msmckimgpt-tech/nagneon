# macOS 소스 미리보기

이 안내는 macOS에서 저장소 소스를 Electron으로 실행해 보는 개발용 경로입니다. 현재 공식 배포·설치 안내는 Windows용이며, macOS용 앱 묶음이나 DMG는 제공하지 않습니다. 아래 절차와 장치별 화면·소리 캡처는 macOS 실기기에서 수용 검증을 마친 경로로 보증하지 않습니다.

## 기본 실행

macOS, Node.js 22 이상, npm을 준비합니다. 저장소 루트에서 실행하세요. 예시 프로필은 기존 앱 기록과 분리된 새 폴더로 바꾸어도 되며, `--backseat-profile`에는 반드시 절대 경로를 전달해야 합니다. `--nagneon-profile`도 같은 용도로 받을 수 있습니다.

```sh
git clone https://github.com/msmckimgpt-tech/nagneon.git
cd nagneon
npm ci
npm run build
NAGNEON_PREVIEW_PROFILE="$HOME/nagneon-preview-profile"
mkdir -p "$NAGNEON_PREVIEW_PROFILE"
./node_modules/.bin/electron . --backseat-profile="$NAGNEON_PREVIEW_PROFILE"
```

다시 실행할 때는 같은 프로필 경로를 사용합니다. 이 폴더의 `data`에 설정과 대화 기록이 저장됩니다. 프로필·모델·인증 파일을 저장소나 PR에 추가하지 마세요. `npm run check`는 소스 검사 명령이며, 실제 macOS 화면·오디오 장치 검증을 대신하지 않습니다.

## AI 계정 연결

실제 AI 관객은 연결할 CLI와 그 계정의 모델 접근 권한이 필요합니다. 계정 연결 전에는 앱의 리허설을 사용할 수 있습니다.

- **ChatGPT 구독 · Codex:** `npm ci`에 포함된 공식 Codex CLI를 사용할 수 있습니다. 같은 사용자 계정의 터미널에서 `./node_modules/.bin/codex login`을 진행하거나 앱의 계정 연결 화면을 사용한 뒤 연결 상태를 새로고침하세요. 앱은 공식 CLI의 로그인 상태를 확인하며, 계정의 Codex 사용량을 소비합니다. CLI 자동 탐색이 실패하면 실행 전에 `CODEX_BIN`에 실행 파일의 절대 경로를 지정할 수 있습니다.
- **Antigravity · Gemini:** 공식 Antigravity CLI `agy`를 별도로 설치하고 해당 CLI에서 Google 계정 로그인을 마치세요. `agy models`에서 사용할 모델이 보이는지 확인한 뒤, 방송을 멈춘 상태에서 **설정 → 연결·사용량 → AI 제공처·관객 모델 선택**에서 Gemini를 선택합니다. 실행 파일을 찾지 못하면 실행 전에 `ANTIGRAVITY_BIN`에 `agy`의 절대 경로를 지정하세요. 모델 목록 확인만으로 실제 응답 성공을 보증하지 않으므로 앱의 **모델 응답 확인 · 1회 사용**으로 계정 호출을 확인할 수 있습니다.

선택한 화면·발화 전사·대화가 선택한 제공처에 전송될 수 있습니다. 실제 요청은 해당 계정의 사용량과 한도에 따릅니다. 로그인 정보나 API 키를 이 문서의 명령에 넣지 마세요.

## 선택 사항: 마이크와 시스템 소리

키보드 대화와 화면 없는 리허설에는 Python 음성 환경이 필요하지 않습니다. 마이크 전사나 시스템 출력 소리 분석을 시험하려면 프로젝트 전용 Python 3.13 가상환경을 준비하세요. 소스 실행은 Windows용 `.venv/Scripts/python.exe`를 기본값으로 찾으므로, macOS에서는 `BACKSEAT_PYTHON`을 현재 가상환경의 **절대 경로**로 지정해야 합니다. 아래 설치는 macOS용 고정 의존성 묶음의 검증 결과가 아니므로, Python 패키지의 해당 Mac/CPU용 배포 가능 여부를 먼저 확인하세요.

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install 'faster-whisper==1.2.1' 'onnxruntime==1.30.0'
export BACKSEAT_PYTHON="$PWD/.venv/bin/python"
"$BACKSEAT_PYTHON" scripts/speech_worker.py --download-only --device cpu
# 시스템 출력 소리 분석을 사용할 때만 실행
node scripts/prepare-sound-model.mjs
```

모델 다운로드에는 네트워크와 별도 저장 공간이 필요합니다. 위 음성 작업기는 기본 `small` 모델을 `.models`에 내려받습니다. 시스템 소리 분석은 `.models/sound-yamnet`의 YAMNet과 로컬 Whisper 모델을 사용합니다. 음성 장치 설정은 **CPU**로 시작하세요. 소스 경로의 자동 GPU 선택은 Mac GPU 지원을 뜻하지 않으며, Python 작업기는 실패하면 CPU로 전환합니다. `BACKSEAT_PYTHON`은 앱을 시작하는 터미널에도 유지되어야 합니다.

## 화면, 권한, 오버레이

앱의 **게임 화면 연결**에서 화면이나 창을 선택할 수 있습니다. 소리 공유를 고르면 Electron 캡처 요청에 시스템 출력 루프백을 추가합니다. macOS **시스템 설정 → 개인정보 보호 및 보안**에서 앱 또는 Electron에 화면 기록, 시스템 오디오 녹음, 마이크 권한을 허용해야 할 수 있습니다. 권한 항목 이름과 재시작 필요 여부는 macOS 버전에 따라 확인하세요. 화면·소리 선택 후 실제 미리보기와 입력 상태를 확인하고, OBS 송출 전에는 OBS 미리보기에서도 확인하세요.

오버레이는 macOS에서 여러 Spaces와 전체 화면 Space에 표시하도록 요청합니다. 게임의 독점 전체 화면이나 캡처 제외는 모든 앱·macOS 버전에서 확인된 동작이 아닙니다. 방송실이나 오버레이의 마이크 버튼을 사용할 수 있고, 전역 단축키 등록에 성공한 경우 `⌘⇧M`으로 마이크를 켜거나 끕니다. 단축키가 충돌하면 화면의 버튼을 사용하세요. 오버레이 클릭 통과는 화면의 버튼이나 `⌘⇧F10`으로 전환할 수 있습니다.

이 경로에서 확인해야 할 남은 수용 항목은 실제 Mac에서 화면·창 선택, 시스템 오디오 트랙, 마이크 전사, Spaces/전체 화면 오버레이, OBS 캡처입니다. 소스 코드와 자동 검사가 해당 경로를 다루더라도, 물리 장치·OS 권한·게임 조합에서의 성공을 뜻하지는 않습니다.
