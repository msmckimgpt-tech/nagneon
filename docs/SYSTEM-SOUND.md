# 시스템 출력 소리

화면과 별도로 Windows 출력 소리를 관객에게 연결한다. 게임 배경음악, 효과음, 화면 밖 소리, 게임/영상 대사, Just Chatting 중 재생하는 음악이 대상이다. 소리 선택은 기본 꺼짐이며 방송 설정에 자동 저장하지 않는다.

## 사용

방송실의 **소리 연결** → **시스템 출력 소리도 공유** → 캡처 대상을 선택한다. 소리는 선택한 창에만 한정되지 않고 **다른 앱을 포함한 Windows 시스템 출력 전체**다. **선택한 화면도 관객에게 전달**을 끄면 소리만 공유한다. 이 경우 로컬 캡처 연결에 필요한 비디오 트랙은 유지하지만 모델 이미지와 영상 클립에는 사용하지 않는다. 마이크는 독립적으로 켠다.

방송 전에는 캡처 연결만 준비하고 인식하지 않는다. 실제 AI 방송에서 4초 구간으로 분석한다. 리허설에서는 모델/음향 분석을 하지 않는다. 소리 버튼을 다시 누르면 출력 오디오 트랙을 멈추고 대기 요청과 서버의 최근 소리 문맥을 지운다. 방송 종료/긴급 중지/화면 해제는 두 입력을 종료한다. 다음 방송에 자동 재연결하지 않는다.

화면/소리 선택과 방송 창 권한은 `desktop/capture.cjs`에서 한 번만 소비한다. 오버레이/서브프레임에는 캡처를 허용하지 않는다. Chromium의 `restrictOwnAudio`를 요청해 앱 자체 클립 재생의 재입력을 줄이며, 실제 동작은 OS/출력 장치에 따라 검증이 더 필요하다. 미리보기와 녹음용 믹서를 스피커에 연결하지 않는다.

## 실제 인식 경로와 한계

Windows loopback → MediaRecorder/Opus → 인증된 로컬 HTTP → PyAV/16 kHz → YAMNet ONNX → 음향 종류·구간·음량·좌우 음량 차이. 음성이 감지된 구간은 별도 Whisper small로 자동 언어 전사한다. `systemSpeech`는 게임/영상/앱의 대사다. 스트리머 마이크 큐나 훈수 요청으로 변환하지 않는다.

요청 모델은 **gpt-6-astra / low**를 유지한다. Astra는 원본 오디오 입력을 지원하지 않아, 원본 파형 대신 로컬 모델이 해석한 단서를 전달한다. [OpenAI 모델 문서](https://developers.openai.com/api/docs/models/gpt-6-astra), [Electron loopback 문서](https://www.electronjs.org/docs/latest/api/session).

YAMNet은 일반 음향 분류기다. 배경음악이나 효과음을 들을 수 있지만 모든 게임의 고유 효과음 의미, 노래 제목, 악기, 적의 정확한 방향을 식별한다고 보장하지 않는다. 합성 화음을 전자음/전화 신호로 분류하는 사례도 시험에서 나왔다. 점수는 게임 사건의 검증된 확률이 아니다. 좌우 음량 차이는 게임 세계의 방향이 아니다. 짧은 대사·겹친 음악·외국어·출력 장치 변경은 오인식/누락이 가능하다. 모델 응답 지연이 더해지므로 즉시 반사 반응을 보장하지 않는다.

소리 문맥은 최대 8구간/45초를 RAM에 보관하고, 관객에게는 최근 30초 중 최대 4구간만 제공한다. 구간 시작 전에 입장했고 구간 제출 때도 있는 관객만 청취자로 기록한다. 중간 입장자에게 앞부분을 들었다고 가정하지 않는다. 원시 소리는 메모리에서 처리하며 음향 분석 전용 파일로 저장하지 않는다. 선택한 핫클립 저장은 예외다. 서버 로그와 대화에는 모델이 생성한 반응이 남을 수 있다.

음향 분석은 마이크 STT와 별도 프로세스/요청 큐다. 느린 처리 시 오래된 환경음 대기 구간을 교체하고 최대 2구간만 기다린다. 마이크 발언 큐를 버리지 않는다. 취소한 요청의 늦은 응답을 UUID와 연결 세대로 격리한다. 두 로컬 Whisper 인스턴스를 함께 사용하므로 추가 RAM/CPU를 사용한다.

## 핫클립

화면 + 시스템 소리 + 마이크를 녹화할 수 있다. Web Audio가 공유 중인 두 오디오 입력을 단일 트랙으로 합쳐 일부 브라우저에서 한쪽 트랙만 녹화되는 문제를 피한다. 입력 수로 게인을 나누며 원본 스트림은 녹화 종료 시 정지시키지 않는다. 캡처 대상을 변경하거나 소리 전용으로 전환하면 이전 영상 버퍼를 폐기한다. 자동 명장면의 기존 이미지/대화 저장과 수동 영상 저장을 구분한다.

## 모델 출처와 준비

`node scripts/prepare-sound-model.mjs`로 고정 리비전을 받아 크기/SHA256 또는 Git blob 해시를 검증한다. `shared/sound-model.json`이 기준이다. Google YAMNet v1을 **Audio Magic이 ONNX로 변환한 제3자 배포본**이며, Google 공식 ONNX 배포로 표현하지 않는다. [변환자의 모델 카드](https://huggingface.co/audiomagic/yamnet-onnx/blob/f25b741c2f0bdc6d7e6db24b5fddda23347dbafd/README.md)에 변경 내역과 출처가 있다. 모델 카드/Apache 라이선스/AudioSet 라벨 출처를 패키지에 함께 넣는다. 별도 상용 배포 법률 검토를 대체하지 않는다.

배포는 기존 검증된 Python/ONNX Runtime을 재사용하며 `resources/sound`에 약 16 MB 모델과 작업자를 추가한다. 사용자가 Python을 별도로 설치할 필요가 없다. 새 Windows와 다양한 오디오 장치/Steam 게임/장시간 실제 소리 수용 검사는 별도로 유지한다.

## 2026-09-13 검증 근거

- 전체 Node 213개, TypeScript/Vite, 새 패키지: `artifacts/sound-package-final.log`, 테스트 fixture의 로컬 모델 의존 제거 후 같은 213개 `sound-final-tests.log`.
- 실제 YAMNet/Whisper: `sound-worker-test.json`. 무음·합성 비프·화음·8초 합성 한국어·손상 파일 거부. 한국어 구간은 Speech로 분류하고 전사했다. 초기 NumPy bool의 JSON 직렬화 오류를 수정했다. 이것은 실제 게임 효과음의 정확도 벤치마크가 아니다.
- Electron 5개 흐름: `sound-desktop-test.json`, 실제 Windows 출력 5개 흐름: `sound-loopback-test.json`. 후자는 별도 프로세스가 만든 880 Hz 소리를 **실제 loopback**으로 받고, 마이크 역할의 440 Hz 합성 입력과 함께 녹화했다. 음성 장치/실제 플레이어 발성 테스트와 구분한다. 앱 출력 전송 전 대기·관객별 문맥·중지·소리 전용 이미지/영상 차단을 확인했다.
- 실제 녹화의 두 주파수 확인: `sound-mix-test.log`, `sound-loopback-mix-test.log`, 각 `sound-ui-*/mixed-audio-test.json`. 두 경우 모두 오디오 트랙 1개 안에 440/880 Hz가 있었다. 첫 시험은 마이크 클릭 시점이 너무 빨라 시스템 소리만 기록됐고, 연결 상태를 기다리는 시험으로 수정했다.
- 실제 Astra low: `sound-live-test.json` / `.log`, 10.455초. loopback의 실제 신경망 인식 결과를 가상 시계로 재생했다. “전화 연결 기다리는 느낌”, “삐 하는 듯한 소리”에 반응하고 게임 이름/장면은 단정하지 않았다. 첫 시도 `sound-live-invalid-witness-fixture.*`는 시험에서 입장 시각을 방송 시작보다 앞으로 옮겨 청취자 목록이 비었으며 실제 소리 반응 증거가 아니다. 구조적 passed 값만으로 합격 처리하지 않았다.
- 최신 전체 폴더 배포: `release/2026-09-12T23-41-52-732Z/app/BACKSEAT-win32-x64`, 1,599,409,614바이트/2,444파일/미서명. 전체 SHA256·핵심 원본28개·fuses 일치: `sound-package-integrity-test.json`.
- 새 번들의 개발 PATH 제외 실행: `sound-packaged-runtime-test.json`. 마이크 준비6.147초/한국어 전사2.769초, 소리 준비2.630초/8초 한국어 음향 분류+별도 전사5.571초, 실제 Astra10.310초. 소리 분류와 전사는 번들에서 직접 실행했다. 실제 모델의 소리 문맥 반응은 위 별도 재생 시험으로 구분한다.
- native 새 프로필 시작/안내 건너뛰기/소리 제어 표시/정상 종료: `sound-native-test.json`, `sound-native-page.jpg/.txt`. 새 native 창에서 loopback을 다시 실행한 것은 아니며, 생산 캡처 모듈은 위 Electron Windows 시험 및 패키지 원본 해시로 확인했다. `sound-native-error.log`의 fs.Stats deprecation 경고를 보존했다.
- 기존 사용자 앱은 설정 파일 SHA256과 관객11명을 보존해 갱신했다. `sound-user-app-process.json`, `sound-delivered-state.txt`, `sound-delivered-page.jpg`. 방송/마이크/화면/시스템 소리 꺼짐, 모델 호출0. 개인 프로필에 시험 기록을 넣지 않았다.

Windows/GPU/드라이버·장르별 실제 게임 소리·음악과 대사의 혼합·헤드셋/스피커 변경·장기 몰입 검증이 남는다. 스피커 소리가 물리 마이크에 다시 들어갈 수 있으며, 마이크의 echoCancellation 요청이 모든 장치에서 완전히 제거한다고 보장하지 않는다.

## 전체 설치본 재검증 · 2026-09-13

실제 NSIS로 설치한 2,444파일 전체를 해시 확인한 뒤, 설치본의 Python/모델/Codex와 `app.asar`에서 추출한 앱 모듈을 직접 실행했다. 음성 준비2.106초/한국어 전사2.741초, 소리 준비2.524초/8초 합성 한국어 음향 분석과 별도 전사5.665초. 실제 Astra low의 소리 문맥 응답10.655초에서 미완의 “신나는 일이…” 대사에 반응하고 화면을 봤다고 주장하지 않았다. 이는 가상 캡처 시계로 분석 결과를 전달한 시험으로, 물리 마이크/실제 Steam 게임 소리 벤치마크와 구분한다.

원본 `artifacts/installer-full-test-2026-09-13T01-18-12-233Z/runtime-result.json`에는 두 입력의 전사, 음향 분류, 관객별 청취자, 실제 모델 응답이 있다. `scripts/verify-packaged-runtime.mjs --folder=... --report=... --live --sound-live`로 재현한다. 설치본 native 창에서도 소리·화면 독립 선택 옵션과 정상 종료를 확인했다. 캡처 선택창 여백/미리보기 잘림과 일부 창의 WGC 썸네일 지연은 별도 수정 대상으로 남겼다. 설치·제거 범위는 `docs/INSTALLER.md`를 따른다.
