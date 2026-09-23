# 브랜드 강조색

나그네온의 기본 강조색은 src/nagneon.css의 `--neon`(`#80e6cf`)이다. 선택 상태의 배경·테두리·포커스 보조색은 `--accent-soft`, `--accent-border`, `--accent-focus`를 사용한다. 후원 알림 배경은 `--donation-surface`, 본문은 `--ink`, 보조 글씨는 `--quiet`를 사용한다.

2026-09-23 원본 리뷰 1-1 후속으로 화면 선택기, 채팅 표시 체크박스, 튜토리얼, 온보딩, 기억 고정, 저장 안내, 설정 선택 탭과 후원 알림에 남아 있던 연두색 강조를 공통 변수로 연결했다. 경고·오류의 의미색과 화면 배치는 유지한다. 이 단계에서는 모든 중립색·배경색 리터럴을 제거하지 않았다. 아래 후속 단계에서 기본 스타일의 색상 정의를 분리했다.

## 검증

- 격리 작업공간 `review-brand-colors-20260923`에서 npm ci, npm run check(708/708 및 TypeScript/Vite 빌드), npm audit --audit-level=high(0건), git diff --check 통과.
- CSS 구문 비교에서 9개 파일의 기존 선언 중 색상 관련 39개만 바뀌고 선택자·배치·애니메이션 선언 구조는 같음을 확인했다. 새 공통 색상 변수 4개는 별도로 추가했다.
- 실제 Electron 렌더러에서 합성 후원 알림·기억 고정·저장 표시가 `rgb(128, 230, 207)`, 후원 본문이 `rgb(237, 244, 246)`, 보조 글씨가 `rgb(164, 178, 195)`로 계산됨을 확인했다. 임시로 --neon 값을 바꾸면 세 강조 요소도 함께 바뀐다. 실제 설정의 선택 탭 색도 확인했다.
- 기존 온보딩·탐색·세로/좁은 화면·리허설·오버레이 검사를 포함해 12개 renderer 검사 통과. 계정·장치·사용자 데이터는 사용하지 않았다. 합성 DOM 후원 표시는 실제 후원 생성이나 OBS 송출 수용 검증을 뜻하지 않는다.
- 원본은 해당 작업공간 artifacts의 brand-check.log, brand-audit.log, css-scope.json, css-scope-final.log, brand-ui.log, brand-ui/computed-colors.json 및 PNG다. 재현 스크립트는 check-css-scope.mjs와 verify-brand-colors.cjs다.
- 최초 CSS 비교는 Git LF와 작업 파일 CRLF의 선택자 줄바꿈 차이로 실패했다(css-scope.log). 비교기가 줄바꿈만 정규화한 뒤 구조 검사를 통과했으며 제품 CSS를 이 이유로 바꾸지 않았다.

로컬 소스·렌더러 검증 결과다. 설치본 업데이트와 릴리즈는 별도 절차다.

## 기본 스타일 색상 정의 분리

`src/style.css`의 색상 리터럴 171종(179곳)을 `src/nagneon.css`의 `--ui-*` 변수로 옮겼다. 입력란·본문·테두리·상태 표시·각 화면 요소의 역할로 이름을 붙였다. 같은 값이 여러 곳에서 쓰이면 하나의 변수를 공유하므로 변경 전 사용처를 함께 확인한다. 색상 값을 한 팔레트로 합치거나 색조를 재설계한 작업은 아니다.

기본 스타일은 브랜드 변수와 함께 로드되며, `src/main.tsx`가 두 파일을 모두 가져온다. 다른 보조 CSS의 직접 색상 값이나 변수 정의 자체의 색상 리터럴까지 제거했다는 의미는 아니다. CSS 변수 이름과 정의가 추가되므로 스타일 텍스트 크기는 늘어난다.

- 변수값을 펼친 CSS의 선언 1,137개, 선택자, 미디어/애니메이션 규칙과 순서가 이전 커밋 `5be18c1b4fd500b5ab1cfa60fc4a09baf8ebd372`과 같음을 확인했다. 기존 브랜드 규칙도 유지한다.
- 최초 비교는 Prettier가 긴 그라데이션을 여러 줄로 펼친 차이로 실패했다. 양쪽 CSS를 같은 Prettier 서식으로 맞춘 뒤 비교를 통과했으며, 최초 로그를 보존했다.
- 필수 검사 708/708·빌드와 audit(취약점 0) 통과. 별도 Electron 검사에서 171개 변수를 실제 계산한 색상과 원래 상수의 계산 결과가 모두 같았다. 기존 화면·온보딩·기억·후원·좁은 화면·오버레이 검사를 함께 통과했다.
- 원본: `artifacts/palette-css-proof.json`, `palette-css-proof.log`, `palette-css-proof-final.log`, `palette-check.log`, `palette-audit.log`, `palette-ui.log`, `palette-ui/palette-colors.json`, `palette-ui/renderer-result.json`. 재현 스크립트는 `verify-palette-css.mjs`, `verify-palette-ui.cjs`다.
