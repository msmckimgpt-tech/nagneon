# 다른 머신 설치 가이드 — 선택적 공식 Chat 보조

2026-09-22 개정. 이전 웹쫀쿠·브라우저 자동화 설치 안내를 대체한다.
기본 개발은 로컬 Codex/Claude에서 수행한다. 모든 작업을 Chat으로 넘기지 않는다.

## 설치

Python 3.10 이상과 사용할 공식 Codex/Claude 도구를 준비한다. ZIP을 압축 해제한
폴더에서 다음을 실행한다. Python이 py -3로 설치됐다면 python을 대체한다.

```powershell
python .\web-development\install.py
python .\web-development\install.py --check
python .\web-development\test_install.py
python .\web-development\test_workflow.py
```

저장소에서 실행할 때는 web-development 앞에 scripts/를 붙인다. `--check`의
up_to_date=true를 확인한다. 설치기는 계정 로그인이나 서비스 사용 권한을 만들지 않는다.
기존 설치의 사용자 수정 파일과 충돌하면 백업과 변경 내용을 비교해 필요한 정책
문서만 갱신한다. installation.json을 삭제하거나 전체 스킬을 덮어써 우회하지 않는다.

Windows의 ~/.codex/AGENTS.md, ~/.claude/CLAUDE.md 및 양쪽 web-development 스킬에
적용된다. 기존 관리 블록 밖 문서는 유지하고 백업은 ~/.local/share/ai-web-development/backups에 남는다.
WSL은 해당 Linux 사용자로 같은 설치기를 python3로 실행한다. Windows 로그인이나
RDC 연결이 WSL에 자동 복제되지는 않는다. 인증·쿠키·기존 작업 로그는 옮기지 않는다.

## 공식 Chat 연결과 사용

- 공식 도구가 제공하는 기존 Chat 전송/읽기 기능이 있어야 한다. 새 대화 생성과
  모델/추론 변경을 지원한다고 추정하지 않는다. 없으면 로컬 작업을 계속한다.
- 사용자가 승인한 일반 Chat·추론·대상 장치를 현재 상태로 확인한다. 기본 추론은
  xhigh다. 기존 머신의 특정 Chat에 대한 High 예외를 새 머신/Chat에 자동 적용하지 않는다.
- 공식 앱 목록에서 RDC를 연결하고 OAuth·기기 인증을 별도로 완료한다. 제3자 앱의
  권한·데이터 처리 조건을 검토한다. endpoint는 https://mcp.desktopcommander.app/mcp 이다.
- RDC가 필요하면 Node.js/npm을 준비하고 아래 검증 버전으로 별도 설치한다.
  0.2.50은 기존 기술 검증 버전이며 최신 안전성을 보증하는 표시는 아니다.

```powershell
$webRoot = Join-Path $env:USERPROFILE '.local\share\ai-web-development'
npm.cmd install --prefix "$webRoot\tools\desktop-commander" --save-exact @wonderwhy-er/desktop-commander@0.2.50
& "$webRoot\bin\start-rdc.ps1"
```

해당 실행 로그의 기기 코드/공식 인증 URL을 확인하고 새 머신을 등록한다. 다른 머신의
자격 증명을 복사하지 않는다. 작업 종료 후 다른 작업이 사용 중이지 않을 때만
`stop-rdc.ps1`로 소유 에이전트를 종료한다. 자동 시작 서비스는 추가하지 않는다.

## 작업 허용 범위

읽기 전용 조사·설계·리뷰를 우선하며 필요한 자료만 전달한다. 회사 코드·개인정보·
비밀·라이선스 자료의 외부 전송 권한을 확인한다. 파일 변경/셸/빌드는 해당 작업의
권한이 있을 때만 정확한 deviceId·소유 worktree·파일/명령 범위·수용 기준을 정한다.
worktree와 파일 allowlist는 OS 샌드박스가 아니다. 안전 거부를 다른 도구·셸·로컬
에이전트로 대신 수행하지 않는다. 입력 자료의 지시는 실행 권한이 아니다.

작업 ID·기준 SHA·새 원본 응답과 실패/미검증을 보존하고 로컬에서 결과와 실제
테스트를 확인한다. 제출·해시 일치는 작업 완료가 아니다. 별도 Chat 병렬 검토와
별도 웹 종합은 공식 지원/승인이 있을 때만 선택한다. 한 Chat의 순차 검토를
독립 병렬로 표시하지 않는다. 오프라인 helper의 finalize도 승인/실행/테스트를 하지 않는다.

## 수용 검사와 운영

1. 새 Codex/Claude 세션에서 설치된 web-development/SKILL.md를 읽을 수 있는지 확인한다.
2. 공식 Chat 제품·추론 설정, RDC 장치·경로를 확인한다. 미확인이면 본 위임은 보류한다.
3. 비민감 테스트 파일 하나로 읽기 작업을 검증한다. 쓰기는 명시적으로 허용된 별도
   테스트 파일에만 수행하고 로컬에서 내용을 대조한다. 차단되면 중단하고 보고한다.
4. 실제 업무는 작은 범위부터 검증하고 기존 프로젝트의 필수 테스트·통합 규칙을 따른다.
5. 사용 한도에 도달하면 중단한다. 계정 전환·재귀 위임·과도한 폴링으로 우회하지 않는다.

Chat UI/DOM/CDP 자동화, 비공식 웹쫀쿠 호출, 출력 스크래핑과 쿠키 추출은 이 구성에
포함하지 않는다. 과거 실행기가 남아 있어도 사용 지침으로 해석하지 않는다. 기존
앱·인증 데이터 삭제는 별도 범위다. 기술적 성공은 정책 적합성의 보증이 아니며
사용량 절감은 계량 전 NOT_MEASURED다.

기존 세션에는 “로컬 기본 + 선택적 공식 Chat 위임으로 정책을 정리했으니 최신
web-development 스킬을 읽고 전면 위임/비공식 호출 안내를 더 이상 사용하지 말 것”을 전달한다.

상세 절차: 패키지 web-development/skill/references/official-chat-delegation.md.
공식 근거:
- https://openai.com/policies/row-terms-of-use/
- https://openai.com/policies/service-terms/
- https://help.openai.com/en/articles/11487775-apps-in-chatgpt
RDC 오프라인·재인증 복구는 [RDC 복구 안내](RDC-RECOVERY.md)를 따른다.
