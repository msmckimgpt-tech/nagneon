Nagneon v0.1.0-preview.2 · 나그네온 프리뷰 2

실행
1. windows-x64-app.zip과 microphone-model.zip을 같은 폴더에 풉니다.
2. 두 ZIP 안의 Nagneon 폴더가 하나로 합쳐졌는지 확인합니다.
3. Nagneon.exe를 실행합니다. 설치형/자동 업데이트가 없는 미서명 프리뷰입니다.

신규 기능 켜기
방송 설정 → 디버그 → '디버그 모드 사용'과 '신규 기능 사용해보기'를 모두 켭니다.
두 옵션 모두 기본 꺼짐입니다. 하나만 켜면 신규 기능이 동작하지 않습니다.
방송·연습·모델 요청이 끝난 뒤 변경할 수 있습니다.

프리뷰 기능
OBS 장면 입력, 치지직/YouTube 읽기 전용 채팅, 분위기 프리셋, 채팅 요약,
텍스트 리액션, 읽던 위치 유지, 상태 전송 최적화, 프롬프트/잠긴 설정 편집,
사용자 지정 모델 및 Claude/Gemini 구독 CLI·API·Ollama 선택.
관객은 계속 텍스트로만 반응합니다. 개인 방송실은 외부 연결 없이 사용할 수 있습니다.

모델 연결
기본값은 ChatGPT 구독 gpt-6-astra / low입니다.
Claude/Gemini 구독 연결은 별도로 설치한 최신 공식 CLI를 사용합니다.
설정 → 연결·사용량 → AI 제공처 선택에서 모델을 적용하고
'공식 CLI 로그인 창 열기'로 직접 인증한 뒤 연결 상태와 모델 응답을 확인합니다.
Claude Code 2.1.270+, Gemini CLI 0.59.0+가 필요합니다.
기존 CLI 세션이 만료되었거나 로그인되지 않았으면 직접 로그인해야 합니다.
API 키 연결은 선택 사항이며 별도 요금이 발생할 수 있습니다.
CLI·Ollama와 해당 모델 파일은 이 ZIP에 동봉하지 않습니다.

프로필
프리뷰 기본 데이터: %APPDATA%/nagneon-preview/data
기존 릴리즈의 backseat-studio 프로필과 분리됩니다. 기존 기록을 자동 복사하지 않습니다.
한쪽 옵션을 끄면 외부 연결을 종료하고 기본 제공처/자동 프롬프트로 돌아갑니다.
이미 저장한 관객 설정값과 기록은 삭제하지 않습니다.

알려진 제한
치지직/YouTube 실제 계정 검증은 개발자 앱/API 설정이 필요합니다.
Claude/Gemini 재로그인 후 실제 모델 품질, 물리 마이크, 장시간 게임 방송과
새 Windows PC 검증은 남아 있습니다. 시험한 소형 로컬 모델의 관객 품질은 미달했습니다.
정식 통합은 사용자의 실제 사용 결과와 이슈 해소 확인 이후 별도로 진행합니다.

비교·설정·검증 안내
https://github.com/msmckimgpt-tech/nagneon/blob/v0.1.0-preview.2/docs/PREVIEW-2.md
https://github.com/msmckimgpt-tech/nagneon/blob/v0.1.0-preview.2/docs/MODEL-PROVIDERS.md
https://github.com/msmckimgpt-tech/nagneon/blob/v0.1.0-preview.2/docs/EXTERNAL-CHAT-SETUP.md

프로젝트 소스는 LICENSE-Nagneon.txt의 MIT 라이선스입니다.
Electron/Chromium, Codex, 음성 도구와 모델에는 각 resources 폴더와
LICENSES.chromium.html의 개별 라이선스 및 고지가 적용됩니다.
