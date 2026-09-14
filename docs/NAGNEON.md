# Nagneon 전환 · 2026-09-14

## 브랜드

**Nagneon · 나그네온**은 나그네 + On-air입니다. “방송을 켜면, 이야기가 찾아옵니다.”를 중심으로 첫 방문자가 단골이 되는 AI 관객 방송실을 표현합니다. 원본 SVG의 N 모양은 열린 문과 방송 표시등을 함께 나타냅니다. 짙은 남색과 민트색을 사용하며 한국어 설명을 우선합니다.

앱·온보딩·오버레이·개발 연결 페이지·Windows 창과 실행 파일·README를 같은 이름으로 정리했습니다. favicon, Windows ICO, PNG는 프로젝트에서 직접 만든 SVG로 생성했습니다. `scripts/build-brand-icon.cjs`로 다시 생성할 수 있습니다.

## 세로 화면

세로 비율 4:5 이하, 폭 621px 이상에서는 화면 미리보기와 채팅을 위아래로 배치합니다. 채팅은 남은 세로 공간을 사용하고, 방송 제어와 입력창은 함께 보입니다. 게임 상태·관객 목록 등 부가 패널은 위쪽 화면 영역 안에서 스크롤하여 접근합니다. 작은 창에서는 메뉴가 가로로 스크롤되며 사라지지 않습니다. 데스크톱 최소 폭은 420px입니다.

실제 Electron 렌더러에서 1080×1920, 850×1500, 540×960, 420×900 및 가로 창 1440·1000·850px를 검증했습니다. 850px와 420px에서 8개 메뉴 모두 가로 넘침이 없습니다. 물리 장치나 사용자 방송을 이용한 검증은 아닙니다.

## 호환성과 라이선스

### 방송 화면의 문구

방송실·후원·포인트·관객·핫클립·온보딩에서 `무료`, `검증`, `가상`, `시뮬레이션` 같은 서비스 외부 설명을 제거했습니다. 후원 금액과 익명 표시는 유지하고, 모델 호출 카드는 응원 포인트로 바꾸었습니다. 캐릭터와 포인트의 성격, 리허설의 범위는 README와 설치 환영 화면에 명시합니다. 연결 설정의 장치·계정·사용량 안내와 내부 기억의 사실/연출 구분은 유지합니다.

`scripts/verify-nagneon.cjs`가 8개 메뉴의 실제 렌더링 문구와 세로 배치를 확인합니다. 원본 사용자 대화나 저장 기록은 일괄 치환하지 않습니다. 이전 기획 클립과 첫 포인트 기록의 서비스 생성 라벨만 표시할 때 정리합니다.

- 기존 기본 프로필 `backseat-studio`를 유지하여 관객 기억을 잃지 않습니다. `--nagneon-profile=<절대 경로>`와 기존 `--backseat-profile`을 모두 지원합니다.
- `window.backseat`, 내부 HTTP 헤더·저장 키·매니페스트 스키마는 호환성을 위해 유지합니다. 창 캡처에서는 새 이름과 예전 이름의 앱을 모두 제외합니다.
- 새 Nagneon 설치 식별자·폴더는 기존 BACKSEAT 설치와 분리합니다. 기존 설치를 자동 제거하거나 덮어쓰지 않습니다. 기본 사용자 기록은 같은 경로를 사용하므로 두 앱을 동시에 같은 프로필로 실행하지 마세요.
- MIT 라이선스는 수정·상업적 사용·재배포를 허용하면서 저작권 고지와 허가 문구 보존을 요구합니다. 원본 저장소 링크는 권장 사항이며, 메인 화면 로고 표시는 요구하지 않습니다. 배포 ASAR에도 LICENSE를 포함하고 무결성 검사합니다.

## 검증 증거

작업 브랜치: `codex/nagneon-brand`, 기준 커밋: `a10682910ddaad302a1e00c432e54734b0bf46f4`.

작업별 `artifacts/nagneon/`과 `artifacts/`에 원본 결과를 보존합니다. 사용자 데이터와 테스트 프로필은 Git에 포함하지 않습니다.

| 검사 | 증거 |
| --- | --- |
| Node 테스트 603개 + TypeScript/Vite | `artifacts/nagneon/immersive-check.log` |
| 설치 엔진 253개 | `artifacts/latest-installer-unit-test.json` |
| 온보딩·8개 메뉴·세로 화면·리허설 시작/종료·투명 오버레이 | `artifacts/nagneon/renderer-result.json`와 같은 폴더의 PNG |
| 독립 실행본 제목·격리 프로필·정상 종료 | `artifacts/nagneon/native-result.json` |
| 번들 Python·한국어 전사·시스템 소리 분석·공식 CLI 기존 계정 확인 | `artifacts/packaged-runtime-test.json` |
| 2,452개 파일 / 3,130,266,140바이트 / 소스 81개·ASAR fuses | `artifacts/package-integrity-test.json` |
| npm audit | 검출 0건 |
| 격리 통합 worktree | `artifacts/nagneon/integration-immersive-check.log`, `integration-engine.log`, `renderer-result.json` |
| GitHub Windows CI | [전체 검사 통과](https://github.com/msmckimgpt-tech/nagneon/actions/runs/34839044040) |

독립 실행 폴더는 `release/2026-09-14T11-49-28-713Z/app/Nagneon-win32-x64`입니다. 새로운 실제 모델 응답이나 물리 게임 캡처는 이번 브랜드 변경의 검증 범위가 아닙니다.

## 배포 상태

소스 실행과 미서명 독립 실행 폴더를 준비했습니다. NSIS 3.12의 solid 압축은 2GiB를 넘는 원본에서 메모리 매핑 오류가 발생하여 파일별 LZMA 압축으로 변경했습니다([NSIS 이슈](https://sourceforge.net/p/nsis/bugs/1284/)). `artifacts/nagneon/installer/makensis-output.log`에 최초 오류를 보존했습니다. 이전 문구 페이로드의 전체 압축은 문구 변경 요청으로 중단했습니다(`installer-files/superseded.txt`). 최신 설치 안내는 합성 페이로드로 컴파일을 통과했습니다(`installer-disclosure/build-result.json`). 전체 용량 설치 파일의 완성·실제 설치 수용은 아직 확인되지 않았습니다. 기존 설치 수용 차단을 유지하며 서명된 정식 설치·자동 업데이트 완료를 주장하지 않습니다.

GitHub에는 소스·라이선스·소개 이미지·검증 workflow를 게시합니다. 모델·개인 기록·미완성 설치 파일은 게시하지 않습니다.
