# Nagneon 0.1.1

기존 ChatGPT 구독의 입력 부담을 줄이는 Windows x64 포터블 릴리즈다.
관객별로 반복되는 동일한 대화·장면 문맥을 한 번만 전달하고, 해당 내용을
받은 관객 ID를 명시한다. 개인 기억·입장 시각·훈수 정책을 유지한다.

## 포함된 변경

- Codex 구독 경로의 중복 문맥 압축 기본 적용.
- 기존 GPU 음성 인식, 프로필 호환 복구, 종료 처리, 대화 연속성 개선 포함.
- 모델과 추론 수준은 기존 gpt-6-astra / low를 유지한다. 추가 유료 API가 필요하지 않다.
- 아직 별도 프리뷰에 있는 외부 플랫폼/모델 기능은 이번 정식 버전에 합치지 않는다.

## 측정 범위

합성 한국어 대화 두 사례의 실제 구독 모델 호출 4회에서 입력 토큰 합계가
79,268 → 47,234로 40.4% 감소했다. 일반 방송의 절감률이나 구독 한도 차감률을
보장하지 않는다. 응답 속도 개선은 관측되지 않았다.
[측정 방법과 상세 결과](TOKEN-PRESSURE.md)를 참고한다.

## 실행

1. `windows-x64-app.zip`과 `microphone-model.zip`을 모두 받는다.
2. 같은 위치에 압축을 풀어 내부 `Nagneon` 폴더를 합친다.
3. `Nagneon.exe`를 실행한다. 기존 ChatGPT 계정 연결은 공식 CLI가 처리한다.

일반 실행은 `%APPDATA%/backseat-studio`를 사용한다. 별도 프로필은
`Nagneon.exe --nagneon-profile="절대 경로"`로 지정할 수 있다.
이번 로컬 교체는 기존 사용자의 `nagneon-preview` 프로필을 백업하고 그대로 연결한다.
프로필 백업·개인 기록·검증 로그는 공개 ZIP에 포함하지 않는다.

## 복귀

기존 배포 폴더와 바로가기 백업을 보존한다. 새 앱을 정상 종료한 뒤 이전 실행 파일로
돌아갈 수 있다. 프로필 변경이 문제라면 원본을 추가 백업한 후 교체 전 백업을 별도
프로필로 연결한다. 환경 변수 `BACKSEAT_SHARED_VIEWER_CONTEXT=0`으로 압축만 끌 수 있다.

미서명 포터블 배포본이며 자동 업데이트와 설치 프로그램은 제공하지 않는다.
물리 마이크·장시간 게임 방송·새 PC에서의 품질 보증과는 구분한다.

## 배포본 검증 기록

작업 경로는 `G:/dev/ai/00_game_backseat-worktrees/token-release`다.
버전 변경 후 `artifacts/check-release.log`의 677개 테스트와 빌드가 통과했다.
패키지는 `release/2026-09-15T11-14-15-656Z/app/Nagneon-win32-x64`이며
2,476개 파일, 4,755,276,962바이트다. ASAR SHA-256은
`212d990caa30e8968f2fa2ef4adc149eaa903b45df716b5c240be66eea584290`이다.

- `artifacts/delivered-sharing.json`: 해당 ASAR의 실제 Codex 응답에서 입력 23,632토큰,
  13.498초. 기존 관객 세 명의 정원 이름 회상과 새 관객의 미목격 답변을 확인했다.
- `artifacts/packaged-runtime-test.json`: 번들 GPU / int8_float16, CPU fallback 없음.
  합성 한국어 파일 전사 1.068초, 소리 분석 6.337초. 물리 입력 검증은 아니다.
- `artifacts/native-existing-profile.json`: 실제 실행 파일이 기존 프로필의 격리 복사본으로
  방송실 창을 열고 정상 종료했다. 원본 프로필 해시는 유지됐다.

릴리즈 후 원격 ZIP 해시와 설치본 경로는 로컬 `artifacts/delivery.json`,
`artifacts/remote-release.json`, `artifacts/applied-release.json`에 기록한다.
실행본과 원본 증거가 있는 worktree는 보존한다.

릴리즈 준비 중 이전 main CI가 삭제된 `리허설로 입장` 버튼을 찾는 문제를 확인했다.
`verify-nagneon.cjs`를 현재 온보딩의 튜토리얼 입장·일시 정지 흐름에 맞추고,
이후 레이아웃 검사는 명시적인 리허설 fixture로 수행한다. 실제 Electron 렌더러의
가로/세로 화면·8개 메뉴·리허설 시작/종료·투명 오버레이 검사가 통과했다.
이 변경은 개발 검증 스크립트만 수정하여 이미 만든 배포 실행 파일에는 영향이 없다.
