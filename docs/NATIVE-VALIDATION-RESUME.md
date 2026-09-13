# 사용자 테스트 종료 후 실제 앱 검증 재개

2026-09-14. 사용자가 개인 테스트 완료와 Computer Use·Claude Code 사용 재허용을 명시했다. `AGENTS.md`와 [사용자 테스트 수집 이력](USER-TEST-COLLECTION.md)에 현재 권한을 반영했다. 기존 플러그인을 제거하거나 전역으로 비활성화했던 것이 아니므로 재설치는 필요하지 않았다.

## 검증 범위와 실제 관측

작업은 `G:/dev/ai/00_game_backseat-worktrees/native-validation-resume`, 브랜치는 `codex/native-validation-resume`, 기준 커밋은 `afab8d65a0c2aedecf6a7a1020795d5a4b0165d8`이다. 사용자 앱이 실행 중이지 않음을 대상 앱의 창 목록과 정확한 실행 경로의 프로세스 메타데이터로 확인했다. 다른 앱의 내용을 열거나 개인 데이터 폴더를 읽지 않았다.

이전 단계의 실제 배포본 `clip-media-audience/release/2026-09-13T17-15-05-373Z/app/BACKSEAT-win32-x64/BACKSEAT.exe`를 새 `artifacts/native-profile`로 실행했다. Computer Use의 `@oai/sky`에서 반환한 해당 앱 창 하나를 선택하여 UI를 조작했다. 개발자 도구나 인증 우회 없이 다음을 확인했다.

- 첫 실행 안내의 세 단계가 표시된다. Just Chatting을 고른 뒤 AI 방송실에 입장하면 해당 카테고리와 기본 이름/제목이 설정에 유지된다.
- 공식 CLI의 기존 ChatGPT 구독 로그인과 `gpt-6-astra` / `low`, 번들 로컬 한국어 인식 준비 상태가 UI에 표시된다. 로그인 화면을 조작하거나 자격 증명을 읽지 않았다.
- 방송 설정은 방송·분위기/훈수·연결/사용량·매니저/채팅·미디어/기록·게임 탭으로 나뉜다. 미디어 탭에서 클립 버퍼·관객 장면 선택·자발적 감상 안내를 확인했다. 이 검사는 항목을 켜서 실제 장치로 녹화한 검사가 아니다.
- AI 응답 확인 버튼을 누르면 대기 상태와 취소 버튼이 보이고 설정 저장이 비활성화된다. 모델 실행 PID를 확인했다. 앱 종료 시점에도 추론이 진행 중이었는지는 확인하지 못했으므로 생성 중 취소 합격으로 기록하지 않는다.
- 검증 앱을 Alt+F4로 닫은 뒤 부모와 미리 기록한 Electron·Python·Codex 자식 PID가 모두 사라졌다. 같은 독립 프로필로 재실행하면 첫 실행 안내가 반복되지 않고 방송실로 복원된다. 재실행한 앱도 정상 종료했다.

Computer Use 스크린샷과 접근성 결과는 현재 작업의 도구 기록에 남는다. 파일 증거는 `artifacts/native-app-launch.json`, `native-children-before-close.json`, `native-children-after-close.json`, `native-restart-launch.json`, `native-restart-children-before-close.json`, `native-restart-children-after-close.json`이며 앱 stdout/stderr도 같은 폴더에 보존했다. 실제 기기 음성·화면·Steam 게임 플레이는 이번 초기 재개 검사 범위에 포함하지 않았다. 사용자 원본 테스트 프로필은 수정하지 않았다.

## Claude Code와 코드 검사

WSL Ubuntu-24.04의 `/usr/local/bin/claude`는 Claude Code 2.1.185로 실행됐다. 모델/추론 설정과 계정 파일은 바꾸지 않는다. 네이티브 종료·자식 작업 처리에 대한 읽기 전용 검토를 별도로 시작했으며 `Read,Glob,Grep`만 제공했다. 원본 요청과 결과는 `artifacts/claude-review-prompt.txt`, `claude-native-review.json`, `claude-native-review.stderr.log`에 남긴다. 검토자의 판단은 실제 재현과 구분하고, 완료된 결과를 별도로 확인해야 한다.

`artifacts/resume-check.log`에서 기존 545개 Node 검사와 TypeScript/Vite 빌드 통과를 확인했다. 이 변경은 사용자의 재허용과 실제 관측을 문서화하며 제품 소스나 배포 바이너리를 수정하지 않는다. 프로젝트 지침에 따라 별도 통합 worktree에서 필수 검사를 다시 실행하고 작업 브랜치와 main을 원격에 게시한다.

다음 실제 검증은 생성/클립 디코딩 중 종료와 임시 미디어 정리, 화면·시스템 출력·마이크·오버레이의 연결/해제, Steam 게임과 Just Chatting의 연속 대화 품질이다. 기존 설치 복구·서명·판매 조건은 [판매 준비 기준](RELEASE-GATES.md)에 유지한다.

후속 작업에서 Claude Code 검토 완료를 확인했고, 실제 Electron 종료 시 임시 화면 파일이 남는 문제를 재현·수정했다. 정확한 배포 모듈 검증과 남은 범위는 [AI 요청 중 정상 종료](NATIVE-GRACEFUL-SHUTDOWN.md)에 기록한다.
