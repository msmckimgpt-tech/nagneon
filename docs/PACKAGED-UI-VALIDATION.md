# 배포 UI 검사와 디버거 포트

`node scripts/verify-packaged-ui.mjs`는 별도 시험 프로필로 실제 배포 EXE를 실행한다. `--folder`, `--profile`, `--seed`, `--expect`로 설치된 후보와 합성 기록의 저장·재시작을 확인한다. 사용자 프로필을 전달하지 않는다.

검사 전용 Chromium 디버거는 자동 포트를 배정한다. 2026-09-23 재시작 시험에서 4190번이 배정되자 Node `fetch`가 `bad port`로 거부했지만, 같은 주소의 Node HTTP 조회는 200과 실제 page 목록을 반환했다. 앱 창은 실행 중이었다. 이 실패는 제품 서버의 포트 선택과 별개다.

디버거 목록 조회만 `node:http`로 수행하고 5초 요청 시간 초과, HTTP 상태 및 JSON 배열을 확인한다. 제품 renderer의 fetch·인증·브라우저 차단 정책은 변경하지 않는다. `--debug-port=4190`은 같은 조건을 재현하는 검사 옵션이며, 기본은 자동 배정이다. 실제 재검사에서 제목·공통 기억 보존, 리허설 시작/중지, 창의 정상 종료 코드 0을 확인했다.

실패 당시 초기 정리는 창이 준비되기 전에 닫기를 요청해 실패했다. 이후 소유 창의 정상 닫기는 접수됐지만 15초 종료 대기는 초과했고, 나중에 프로세스 종료를 확인했다. 이 종료 지연의 원인은 미확인이다. 후속 검사 통과를 앞선 실패의 소급 통과로 취급하지 않는다.

## 0.1.7 통합 후보 검사

- 제품 SHA: `43881c3827a64cdaa609e6ab6d1cb639ec86b7ce`.
- 기본 패키지: 34개 파일, 795,708,358바이트. 원본 122개와 전체 파일 해시·ASAR 보호 설정 일치. 선택 구성 3,911,526,614바이트는 기본 패키지에 포함하지 않았다.
- ASAR SHA-256: `2971f5ff5adac295c0027a1181e4e948ff49fd566c38dbb1d02d165c60bd48ef`.
- ZIP: 292,153,194바이트, SHA-256 `4c163c4a29dc46e19c9be3c6037b954ecb9883b34eef90d746554958682b826e`. 압축 내부 34개 파일을 매니페스트 해시와 대조했다.
- 실제 공개 0.1.6을 격리 설치하고 합성 기록을 만든 뒤 새 후보로 업데이트했다. 실행 전 데이터 8개 파일과 설치 백업이 일치했고, World v1 원본과 마이그레이션 백업도 동일했다. World v2 변환 후 제목·공통 기억 및 재시작을 확인했다.

원본은 `review-overlay-squash-20260923/artifacts/`의 `component-package-verification.json`, `main017-zip-verification.json`, `update-prelaunch-preservation.json`, `world2-main017-migration.json`, `native017-update.log`, `native017-restart.log`, `native017-restart-fixed4190.log`에 보존한다. 최초 구버전 검사에는 맞지 않는 `--legacy` 옵션을 사용해 실패했으며, 이를 제거한 `native016-seed-corrected.log`에서 통과했다.

물리 장치·모델 요청·일반 탐색기 진입·사용자 설치 등록·공개 배포는 이 시험의 범위가 아니다. 패키지 생성과 격리 검사 통과만으로 정식 릴리즈 완료를 선언하지 않는다.
