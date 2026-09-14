# 웹 보조 개발 환경

## 목적과 구성

2026-09-14 요청: 기존 로컬 개발 경로에 웹쫀쿠와 Remote Desktop Commander를
보조 경로로 연결하고, `웹 다방면 병렬 검토/작업 → 웹 종합·Best way 검토 →
로컬 최종 검토·실제 검증`을 전역 기본 흐름으로 사용할 수 있게 한다.

- Codex Web GPT 5.0.6: 공식 GitHub Windows 릴리스 설치, 공개 checksums.txt와
  SHA-256 일치 확인. 설치 EXE 해시:
  `3de875f30f70c4d15bf06c500760796be8956b1d92a4e0fb6763e0ee9d9b32f9`.
- Desktop Commander 0.2.50: npm 고정 버전 설치. 원격 MCP 주소는
  `https://mcp.desktopcommander.app/mcp`, OAuth와 기기 페어링 필요.
- `scripts/web-development/skill`: 역할별 입력, 원본 응답 수집, 종합 요청,
  원본 코드와 파일 해시 검증, 로컬 최종 검토 문서 생성을 제공한다.
- `scripts/web-development/install.py`: Windows/WSL Codex·Claude 전역 문서에
  관리 블록을 추가하고 스킬·실행 래퍼를 설치한다. 기존 문서와 수정된 스킬을
  보존하고 백업·재적용 확인을 제공한다.

RDC는 파일·터미널 연결이며 웹 대화의 병렬 실행기는 아니다. 각 웹 대화의
실행과 종합은 사용 가능한 브라우저 도구 또는 선택한 웹쫀쿠 연결이 담당한다.
단순 수정/테스트는 로컬에서 수행하고, 분리 가치가 있는 작업에만 이 흐름을 쓴다.
웹 구현 작업은 작업별 브랜치/worktree를 사용한다. 최종 통합·검증은 로컬에서
기존 [병렬 개발 규칙](PARALLEL-DEVELOPMENT.md)을 따른다.

## 전역 설치와 사용

```text
python scripts/web-development/install.py
python scripts/web-development/install.py --check
python scripts/web-development/test_install.py
python scripts/web-development/test_workflow.py
```

Windows에서는 설치된 Python 경로를 사용한다. WSL에서는 해당 배포판의
`python3`로 설치기를 실행한다. 설치 대상:

- Codex: `~/.codex/AGENTS.md`, `~/.agents/skills/web-development/`
- Claude: `~/.claude/CLAUDE.md`, `~/.claude/skills/web-development/`
- 도구·백업·작업 자료: `~/.local/share/ai-web-development/`
- Windows 래퍼: 위 폴더의 `bin/*.ps1`; WSL: `~/.local/bin/web-development`

Windows `start-web-gpt.ps1`은 별도의 CODEX_HOME, 브리지 상태, Electron 프로필로
공식 런처를 연다. 기존 Codex/Claude 모델·추론·설정을 변경하지 않는다.
그 런처에서 로그인·browser smoke·Install models를 완료한 후
`start-web-codex.ps1`로 해당 보조 Codex를 실행한다. 기본 시작 메뉴의 일반
런처 대신 이 격리 래퍼를 사용한다. 자격 증명은 복사하지 않는다.

`start-rdc.ps1`은 설치된 기기 에이전트를 필요할 때 시작한다. 기기 코드 확인과
웹 클라이언트의 OAuth 연결은 별도 단계다. `stop-rdc.ps1`은 자신이 기록한
PID·생성 시각·실행 파일·명령 경로가 일치하는 기기 에이전트만 종료한다.
자동 시작 서비스는 등록하지 않는다. RDC는 실행 계정의 셸 권한을 사용하므로
디렉터리 설정이나 worktree를 보안 샌드박스로 간주하지 않는다.

## 검증 결과

- Windows/WSL 전역 설치 및 `--check` 무변경 확인.
- Windows/WSL 실제 Codex app-server `skills/list`: `web-development`가 user
  scope, enabled로 발견됨. Claude는 양쪽 파일 설치까지 확인했으며 새 Claude
  런타임에서의 스킬 호출은 미검증.
- 전달 도우미 테스트 15개: Windows symlink 1개 권한 제한으로 건너뜀,
  WSL 15개 통과. 누락된 역할, 파일 변조, 기준 코드 변동, 경로 이탈,
  불완전 자료, 응답을 실행하지 않는 성질을 검증했다.
- 설치기 테스트 8개: Windows symlink 1개, WSL Windows 파서 1개를 각각
  건너뛰었으며 두 환경을 합쳐 전체 경로 검증. 원문 보존·재적용·백업·충돌
  거부·설치된 래퍼 실행과 PowerShell 구문 검사 포함.
- `npm run check`: 인증 후 기준 7590aba에서 기존 648개 테스트와 TypeScript/Vite 빌드 통과.
- 실제 로그인된 ChatGPT 웹에서 합성 `mean()` 예제를 정확성·경계값·유지보수
  세 대화로 검토하고, 별도 네 번째 대화에서 원문 세 결과를 종합했다.
  정상 응답 완료를 UI에서 확인한 후 로컬 수집·최종 검토를 수행했다.
- 웹 세 리뷰와 종합안 모두 놓친 희소 배열 허용과 큰 유한 수의 합산 오버플로를
  로컬 검토가 발견했다. 격리된 로컬 예제에서 보완하고 실제 Node 테스트
  4개를 통과했다. 웹 합의를 자동 승인으로 취급하지 않는 흐름을 확인했다.

원본 증거는 작업 worktree의 `artifacts/web-development/` 및 사용자 도구 폴더의
`runs/web-acceptance-20260914/`에 보존한다. 웹 응답 파일은 UI에서 확인한 응답을
가독성 있게 전사한 것으로, 원시 HTML/서버 바이트와 동일하다는 뜻은 아니다.
웹 종합에는 세 응답의 실제 접근성 트리 발췌를 전달했다. 개별 대화 URL은
개인 로컬 자료에만 보존하며 공개 저장소에 포함하지 않는다.

## 연결 상태

OBS 입력 방해 해제 후 별도 웹쫀쿠 런처의 ChatGPT 로그인과 browser smoke가
완료됐다. 사용자가 Google 인증을 직접 완료했고, Computer Use로 후속 설정을
진행했다. 화면에서 `CODEX WEB GPT READY` 응답과 Smoke test passed를 확인했다.
Install models로 격리된 보조 CODEX_HOME에 라우팅을 설치했고, doctor의 설정·
인증 브라우저·Codex 라우트·런처 서비스·루프백 프록시 검사 모두 통과했다.
보조 Codex 자체도 공식 OAuth로 로그인했다. 실제 `codex exec`에서
`chatgpt-web/high`를 선택해 웹 응답을 수신했고 종료 코드 0을 확인했다.
응답은 Markdown 이스케이프된 `WEB\_BRIDGE\_READY`로 보존돼 있다.
증거는 사용자 도구 폴더 `logs/web-bridge-codex-smoke.log`와
`runs/web-bridge-smoke.txt`에 있다. `chatgpt-web`만 지정하면 유효 모델이 아니므로
실제 모델 슬러그를 사용한다. 기본 Codex 앱을 재시작하거나 제공처를 변경하지 않았다.

웹쫀쿠는 browser-only로 운영한다. 이 경로에 로컬 Codex 도구가 없다는 경고는
예상된 동작이며 파일 전달은 별도로 인증된 RDC 웹 클라이언트에서 수행한다.
Full MCP 터널은 설치하지 않았다. 런처를 켠 상태에서 `start-web-codex.ps1`로
보조 CLI를 열고 `/model`에서 필요한 웹 모델을 선택한다.

RDC는 Computer Use로 기기 인증과 ChatGPT 공식 앱 OAuth 연결을 완료했다.
서버에서 해당 기기의 온라인 상태를 확인했고, 실제 Web 모델이 비민감 fixture를
read_file로 읽고 write_file로 새 파일에 반환했다. 로컬에서 입력+지정 접미사의
정확한 문자열 일치를 확인했다. 결과 파일 SHA-256:
`082513B636AFF9842DB8C71BEF45A2994515B3EBC4D4FA4BF6C1540B35AE292B`.
로컬 증거: 사용자 도구 폴더 `runs/rdc-acceptance-20260914/`.
이 검증은 별도 웹쫀쿠 런처의 모델 연결 검증을 대신하지 않는다.
토큰·요금 절감 효과는 NOT_MEASURED다.

## 원본 설치 자료

- https://github.com/miuuyy/codex-chatgpt-web/releases/tag/v5.0.6
- https://github.com/miuuyy/codex-chatgpt-web/blob/v5.0.6/launcher/electron/profile.cjs
- https://github.com/desktop-commander/remote-desktop-commander/blob/main/docs/SETUP.md
- https://github.com/desktop-commander/remote-desktop-commander/blob/main/SECURITY.md

새 Windows 머신에서는 위 공식 릴리스와 checksums.txt를 검증해 설치하고,
`npm install --prefix <도구폴더>/tools/desktop-commander --save-exact
@wonderwhy-er/desktop-commander@0.2.50`으로 별도 설치한 뒤 전역 설치기를 실행한다.
