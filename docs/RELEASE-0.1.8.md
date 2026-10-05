# Nagneon 0.1.8 릴리즈 기록

## 변경 이유

0.1.7의 모델 설정에는 GPT-6 Sol·Luna가 표시됐지만, 동봉 Codex CLI 0.154.0이 이 계정의 두 모델 요청을 `model` 오류로 거절했다. 실행 중인 사용자 앱의 **모델 응답 확인**에서도 두 모델이 실패했고 기존 GPT-5.6 Luna는 응답했다. 0.1.8은 공식 Codex CLI를 0.156.1로 고정한다. 같은 ChatGPT 구독 경로에서 새 동봉 CLI로 Sol·Luna가 각각 응답했다. 기존 모델 선택값이나 저장 기록은 자동 변경하지 않는다. 유료 API나 대체 제공처도 추가하지 않는다.

## 대상과 파일

- 기준 코드: 2bf36dea2a61716ad29c41378c913151504452e6 + 이 릴리즈의 모델 런타임 수정. 공개 태그 `v0.1.8`은 통합 후 정확한 코드를 가리킨다.
- 버전: 0.1.8, Windows x64, 서명되지 않은 선택형 구성. 기본 패키지는 73개 파일, 840,027,468바이트다.
- `Nagneon-0.1.8-win32-x64.zip`: 308,519,970바이트, SHA-256 `5ec197b294f03ac444dd09b92e6ab74066329261eb25b03a240666551b0cfe67`.
- `Nagneon-0.1.8-install-tools.zip`: 6,210바이트, SHA-256 `e20895f59fd7151c720e8a7d1b7628f9e00a1b9da3a3616f4f3f13e98496954f`.
- 내부 `Nagneon.exe` SHA-256: `641e78fc2c0512ab351c1f1c536e812b53513204819196d6f6ac992a86ef7f68`. `resources/app.asar` SHA-256: `a91d82a6ed01c02cd9d99e3b71d1fe73460147d8a7a329906eb4efd750817d83`.
- 로컬 빌드 목록: 격리 작업 공간 `release/2026-09-23T16-53-58-507Z/manifest.json`; ZIP 및 SHA256SUMS는 같은 공간의 `artifacts/`에 보존한다. ZIP 속 73개 파일의 SHA-256을 빌드 목록과 모두 대조했다.

## 검증

| 영역 | 상태 | 근거 및 범위 |
|---|---|---|
| 필수 검사와 보안 | PASS | `npm ci` 후 `npm run check`: 형식 검사, 1,024개 시험, TypeScript/Vite 빌드 통과. `npm audit --audit-level=high`: 취약점 0개. 로컬 기록: `artifacts/gpt6-repair-package.log`, `artifacts/gpt6-repair-audit.log`. |
| 실제 계정 요청 | PASS | 실행 중인 0.1.7 앱에서 Sol/Luna 각각 실패, 기존 GPT-5.6 Luna 성공을 확인했다. 새 0.156.1 CLI와 동일 계정으로 Sol/low, Luna/low 각각 실제 응답했다. 요청은 합성 한국어 인사이며 구독 사용량을 소비했다. |
| Electron 설정 및 배포 비트 | PASS | 격리 소스 Electron과 새 패키지 ASAR/동봉 CLI 각각에서 모델 선택·저장·재시작·실제 응답 8개 검사를 통과했다. `artifacts/model-settings-ui-1790182203160/result.json`, `artifacts/model-settings-ui-1790182549053/result.json`. |
| 계정 연결 회귀 | PASS | 빈 격리 계정의 기기 코드 발급·취소, Electron 기존 계정 인식, 기존 계정 교체 없는 상태 확인, 격리 계정의 취소 완료를 확인했다. `artifacts/gpt6-repair-account-device.log`, `artifacts/account-runtime-bHksLm/result.json`, `artifacts/account-runtime-Wd1miK/result.json`. |
| 설치·업데이트·보존 | PASS | 격리 설치의 0.1.7 실행·정상 종료 후 동일 프로필로 0.1.8 업데이트·실행·정상 종료를 확인했다. 업데이트 전 11개 파일이 백업과 일치하고 마커 해시도 유지됐다. `artifacts/gpt6-repair-ui-017.log`, `artifacts/gpt6-repair-ui-018.log`, 격리 설치 백업. |
| 사용자 환경 적용 | 진행 기록 별도 | 공개 릴리즈 후 고정 설치 경로·실제 실행 프로세스·기존 프로필·두 모델의 응답을 대조한다. 설치 실행 종료 코드만으로 합격 처리하지 않는다. |
| 서명·외부 송출 | N/A | 서명되지 않은 패키지이며 OBS/실제 방송 플랫폼 송출은 이 런타임 수정의 수용 범위가 아니다. |

## 호환성과 복귀

0.1.8은 모델 런타임과 배포 버전만 바꾸며 저장 형식은 바꾸지 않는다. 설치기는 업데이트 전 data를 백업하고 패키지 파일의 해시를 확인한 뒤 포인터를 바꾼다. 문제가 생기면 [고정 설치·복귀 안내](STABLE-INSTALLATION.md)에 따라 이전 `current.json`과 업데이트 전 백업을 **별도 프로필**로 사용한다. 기존 data를 덮어쓰지 않는다. 실제 모델 이용 가능 여부는 계정 및 제공처 상태에 따른다.
