# 0.1.5 역할별 모델 라우팅 추가 빌드

2026-09-16 사용자가 기존 0.1.5 릴리즈와 설치본 반영을 요청했다. 버전은 유지하며 기존 파일과 태그를 보존하고 `routing` 이름의 새 배포 파일을 추가한다.

## 코드와 파일

- 제품 소스: `6de54b45ed4ebcce7fc258e981f5b1e01385575e` (main 통합). 원본 구현: `10548299863833cb971d6db07ac7b98f6b8443ff`.
- 기존 v0.1.5 태그: `0c3f369ab4babe7f9cc668cb48ba8744d96976f0`, 이동하지 않는다. GitHub 자동 Source code ZIP은 이 이전 태그 소스다. 개선 빌드는 아래 별도 파일과 install-tools의 BUILD-INFO.json으로 식별한다.
- 앱: `Nagneon-0.1.5-routing-win32-x64.zip`, 304523142 bytes, SHA256 `e276385819f0ce649c248d1f9baa4c6b7457317fc928c853ffb2e1345f32267e`.
- 설치 도구: `Nagneon-0.1.5-routing-install-tools.zip`, 17340 bytes, SHA256 `6f0f7480db9ee694fe09e00f70edbdf76d616f3cce40cb05cd77f6ad12735d5a`.
- 패키지: components 형식, 89개 파일/104개 원본 대조. 기존 런타임 구성 요소는 카탈로그 해시로 검증하며 LLM 모델은 포함하지 않는다. 기존과 같이 코드 서명되지 않았다.

## 변경

방송 설정 → 연결·사용량 → 역할별 모델 라우팅에서 연결 방식, 임의 모델 ID, 작업별 경로와 대체 연결을 설정한다. ChatGPT 구독·Codex, Ollama, OpenAI 호환 API를 같은 대화/기록 흐름에서 사용한다. 기존 단일 제공처 설정은 보존하며 자동으로 유료 API나 로컬 모델로 바꾸지 않는다. 상세 계약은 [PROVIDER-ROUTING.md](PROVIDER-ROUTING.md)를 따른다.

RTX 2070 8GB에서는 이전에 시험한 추천 경량 모델이 만족할 만한 성능과 응답 품질을 보이지 않았다. 이번 변경은 모델 라우팅 확장이며 그 성능 문제가 해결됐다는 의미는 아니다. [실측 결과](LOCAL-LLM-VALIDATION-20260916.md)를 릴리즈 문서로 제공하고 앱 안에는 해당 제한 고지나 AI 작업 기록을 추가하지 않는다.

## 검증과 적용

증거 루트: `../00_game_backseat-worktrees/provider-routing-integration/artifacts/`. 원본 사용자 데이터·개인 프로필 증거는 로컬에만 보존한다.

- 필수 검사: 685개 테스트, TypeScript/Vite 빌드 통과 (`check-release.log`). 제품 소스 Windows CI 35097061342 및 security CI 35097061227 통과.
- 실제 패키지: GPU 음성 인식, 소리 분류, 공식 CLI 계정 상태, 워커 종료 통과 (`packaged-runtime-test.json`, `runtime-routing.log`). 합성 음성 입력이며 실제 사용자 마이크 품질 시험과 구분한다.
- 무결성: 패키지와 압축본 89개 파일 해시 대조 통과 (`integrity-routing.log`, `zip-routing.log`).
- 업데이트: 이전 배포본으로 시험 제목·공유 기억 저장 → 새 설치본 실행 → 실제 라우팅 편집기로 연결/역할 저장 → 재시작 후 유지 → 단일 제공처 복귀 → 복사한 시험 프로필로 원래 0.1.5 실행 통과 (`ui-old.log`, `ui-new.log`, `ui-restart.log`, `ui-rollback.log`). 실제 패키지 UI 시험이며 모델 추론/장치 캡처는 하지 않았다.
- 사용자 설치: 방송 대기 상태 확인 후 정상 종료. 고정 설치 경로 `G:\dev\ai\Nagneon`에 0.1.5 추가 빌드를 적용했다. 업데이트 중 기존 데이터 338개 파일의 해시가 모두 동일했다 (`user-data-preserved.json`, `install-user.log`). 기존 ChatGPT 구독 연결과 새 라우팅 편집기 표시를 실제 창에서 확인했다 (`user-installed-routing.png`). 정상 종료 후 고정 실행기로 재시작했다.
- 사용자 백업: `G:\dev\ai\Nagneon\backups\update-20260916-215246-ab0e9895`. 현재 실행 폴더: `versions/0.1.5-20260916-215246-ab0e9895`.
- 추가 유료 API 호출 없음. 기존 구현 단계의 실제 구독 라우팅 추론 증거는 PROVIDER-ROUTING.md에 기록되어 있다. 새 빌드에서 장시간 게임/다양한 유료 공급자 전체 행렬은 재시험하지 않았다.

## 복귀

라우팅을 사용했다면 먼저 단일 제공처를 선택하고 앱을 정상 종료한다. 원래 0.1.5 앱 ZIP과 설치 도구로 같은 설치/저장 경로에 재설치한다. 사용자 대화 저장소를 과거 백업 전체로 덮어쓰지 않는다. 설정 복원이 필요하면 해당 백업의 provider-choice.json만 복원하고 새 기록은 보존한다. 별도 복사본에서 이전 0.1.5의 실행·기록 호환성을 확인했다.

## 게시 추적

[v0.1.5 릴리즈](https://github.com/msmckimgpt-tech/nagneon/releases/tag/v0.1.5)에 새 파일과 SHA256SUMS-routing.txt를 추가한다. 기존 첨부 파일을 덮어쓰지 않는다. 게시 결과와 재다운로드 해시는 `release-routing-remote.json`, `download-routing-verification.json`으로 보존한다. 문서/시험 도구의 후속 커밋은 제품 소스/패키지 내용에 영향을 주지 않는다.
