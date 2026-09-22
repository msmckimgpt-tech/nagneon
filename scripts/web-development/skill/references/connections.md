# 공식 연결만 사용하는 현재 경로

기본 실행은 로컬 Codex/Claude다. 공식 Chat 위임은 작업별로 필요성과 권한을
확인한다. 먼저 [official-chat-delegation.md](official-chat-delegation.md)를 읽는다.

## 현재 지원 경계

- 공식 기존 Chat 전송/읽기 도구가 실제 제공될 때만 사용한다. 일반 Chat과
  승인된 추론 수준을 확인하며, Work/Codex/API로 몰래 바꾸지 않는다.
- RDC는 별도 제3자 앱이다. 해당 웹 클라이언트에 공식 앱 연결/OAuth가 필요하고
  기기 인증과 웹 연결은 별개다. 계정·기기·작업 경로를 현재 상태로 확인한다.
- 원격 endpoint: https://mcp.desktopcommander.app/mcp (OAuth).
- 기존 Windows 설치의 bin/start-rdc.ps1 및 stop-rdc.ps1은 작업별 기기 에이전트
  실행/종료에 사용한다. 다른 작업자가 사용 중인 에이전트를 임의 종료하지 않는다.
- WSL 전역 스킬 설치와 RDC 연결은 별개다. Windows 장치에서 WSL을 실행할 때는
  정확한 배포판·Linux worktree·명령 권한을 지정한다. 다른 머신으로 인증을 복사하지 않는다.

## 폐기된 안내

웹쫀쿠 비공식 Chat 호출과 UI/DOM/CDP 자동 전송·추출은 현재 경로에서 사용하지
않는다. 과거 start-web-gpt/start-web-codex 실행기와 설치 성공 기록은 역사적 자료다.
이 문서 정리는 이미 실행 중인 앱을 종료하거나 계정·저장 데이터를 삭제하지 않는다.
새 설치기는 이 두 실행기를 배포하지 않는다. 과거 모델 슬러그/스모크 성공을
현재 정책 승인이나 xhigh 가능성의 증거로 사용하지 않는다.

공식 Chat 도구/설정/권한이 없으면 해당 위임을 미실행으로 기록하고 로컬 작업을
계속한다. 비용은 미측정이며 비공식 전송으로 폴백하지 않는다.
