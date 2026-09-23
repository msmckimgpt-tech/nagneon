# Windows 기본 앱의 언어 리소스

Windows 빌더는 새 패키지의 Chromium 번역 파일 중 한국어(`ko`)와 영어(`en-US`)를 보존한다. 앱 UI는 기존 한국어를 유지한다. 다른 언어의 Chromium 기본 안내는 사용 가능한 언어로 대체될 수 있다. 이는 사용자 입력의 언어 제한이 아니며 ICU·글꼴·렌더링 라이브러리는 제거하지 않는다.

공식 Codex CLI와 보안 실행 구성, 라이선스 고지도 보존한다. `scripts/lib/electron-locales.mjs`는 필수 언어 파일과 일반 파일 여부를 먼저 확인한 뒤 새 패키지의 다른 `.pak` 파일만 제거한다. 기존 설치·기존 빌드·개발용 Electron은 수정하지 않는다. 언어 지원을 확대할 때는 보존 목록과 해당 언어 수용 검증을 함께 갱신한다.

## 로컬 검증 (2026-09-23)

- 기본 패키지: 843,949,712 → 794,611,394바이트, 87 → 34파일.
- 제거한 53개 번역 파일: 49,338,318바이트. 약49.3MB(47.1MiB)이며 기본 설치 크기 약5.8% 감소다. 추가 음성 구성 용량은 별도다.
- `npm run check`: format·700/700·TypeScript/Vite 통과. 의존성 audit 취약점0건.
- 실제 패키지 빌드 및 전체 파일 해시·105개 소스·실행 보호 fuse·기본 앱의 선택 구성 미포함 검증 통과.
- 동일 Electron44.3.0의 별도 복사본에서 두 언어만 남겨 비표시 실제 렌더러 검사. 한국어·영어로 앱 온보딩과 브라우저 기본 입력 안내가 표시됨을 확인했다. 일본어 요청은 이 PC에서 한국어로 대체됐다. 모든 OS의 대체 언어를 보장하는 검사는 아니다.
- 이 렌더러 검사는 새 패키지 EXE의 설치·업데이트·종료/재시작 검증을 대신하지 않는다. 새 후보의 해당 실행 수용은 미실행이며 정식 출시 합격을 뜻하지 않는다.

실제 후보: `release/2026-09-22T20-41-44-937Z/app/Nagneon-win32-x64`, 미서명0.1.6. 기존 게시 버전·파일을 교체하지 않았다.

원본: 이 작업의 `artifacts/locale-check.log`, `locale-audit.log`, `locale-package-build.log`, `locale-package-integrity.log`, `component-package-verification.json`, `locale-runtime-results/{ko,en-US,ja}/result.json`. 패키지 검증 JSON SHA-256: `e7af490395b6800bd87defa733ab884db03f655eb556e1399e5163ec265aa593`. 이전 패키지 포인터/검증 결과는 `package-before-locale-pruning.json`, `component-package-before-locales.json`에 보존했다. 원본은 로컬 검증물이며 저장소에 포함되지 않는다.

동일한 Python ZIP_DEFLATED level6로 양쪽 후보를 다시 압축하고 CRC 검사를 통과했다. ZIP은 304,411,123 → 291,886,952바이트로 12,524,171바이트(약12.5MB, 4.1%) 줄었다. 남은 34개 파일의 SHA-256은 이전 후보와 모두 동일했다. 원본 `artifacts/locale-package-size-comparison.json`과 비교 ZIP을 보존했다. 새 ZIP SHA-256: `630aa212216d16631a689ae4bb79b16a3feef81f98ab9172e9c1f16dbd6831cd`. 이 ZIP은 로컬 검증 후보이며 공개 릴리즈 파일이 아니다.

## 최신 코드 통합 검증 (2026-09-23)

문화 참고자료 기능을 포함한 `a830102` 기반에서 경량 빌드·언어 리소스 축소를 함께 검증했다. `npm run check` 749개와 TypeScript/Vite 빌드, 설치 엔진 253개 검사, 비표시 Electron UI 11개 검사가 통과했으며 의존성 audit은 0건이다.

실제 생성한 기본 패키지는 34파일·795,577,389바이트이며 소스 110개, 전체 파일 해시와 실행 보호 fuse가 일치했다. 선택형 파일 3,911,526,614바이트를 중간 폴더에 복사하지 않았다. ASAR SHA-256은 `9b6b159ab682832016133fe144bd97b112165d9b93fa494121ec3107dcd2a69a`다. 기존 비교 수치와 이 후보의 크기는 포함된 코드 버전이 다르므로 동일 조건 비교로 해석하지 않는다.

원본은 `review-distribution-integration-20260923` 작업 공간의 `artifacts/check.log`, `installer-engine.log`, `renderer.log`, `audit.log`, `package-build.log`, `component-package-verification.json`이다. 이는 로컬 후보 검증이며 새 공개 릴리즈나 사용자 설치 완료를 뜻하지 않는다. 실제 후보 EXE의 설치·업데이트·정상 종료/재시작 수용 검증은 별도로 남아 있다.
