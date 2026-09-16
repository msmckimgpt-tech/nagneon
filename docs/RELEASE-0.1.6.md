# Nagneon 0.1.6 — 앱 내부 프로필 복구

## 변경과 적용

- 제품 통합 SHA: `ea734d807bc2c80e47688557966e6a6e6079ed40`, 원본 `f329c99`. 실행기에서 처리하던 복구를 앱의 서버 시작 전 단계로 옮겼다. EXE 직접 실행도 동일하게 복구한다.
- 같은 프로필의 패키지 LocalCache 기록이 하나면 원본을 보존하고 339개 파일과 같은 전체 기록을 해시 대조하여 복구한 뒤 방송실에 진입한다. 후보가 여러 개이거나 저장 위치 설정이 손상되면 앱에서 기록 폴더 선택/다시 찾기를 제공한다. 선택 오류는 다시 선택할 수 있다.
- 기존 data와 저장소를 자동으로 덮어쓰지 않는다. 기록 폴더를 직접 선택해 다시 연결하면 이전 storage.json을 백업한다. 사용자가 종료를 선택하면 취소한다.
- 별도 복구 스크립트 구현과 `v0.1.5-launcher.1` 유지보수 릴리즈/첨부 파일/태그를 제거했다. 0.1.6 설치 도구는 일반 설치용이며 복구는 앱에 포함된다.

## 검증

- 작업 및 격리 통합 worktree에서 692개 테스트와 TypeScript/Vite 빌드 통과. 자동 복구/원본 보존/다중 후보/설정 손상/잘못 선택 후 재시도/복사 실패의 미완성 게시 방지 검증.
- 실제 0.1.6 앱 EXE를 가리키는 바로가기를 Windows 탐색기에서 마우스 더블클릭했다. 가상 AppData에만 기록이 있는 격리 프로필이 앱 내부에서 자동 복구되었고, `profile-recovery.jsonl`에 339개 파일 복구가 기록됐다. 실제 화면에서 관객 6명·103포인트와 방송실 진입을 확인했다. 별도 복구기/복구 PowerShell은 실행하지 않았다.
- 사용자 기존 0.1.5 앱의 OFFLINE 상태를 확인하고 정상 종료했다. 탐색기로 실제 사용자 data 339개 파일을 `G:\dev\ai\Nagneon\backups\in-app-recovery-0.1.6`에 복사하여 백업했다. Codex 가상 프로필을 실제 사용자 백업으로 혼동하지 않았다.
- 새 패키지 89개 파일과 105개 소스 무결성 및 ZIP 해시 일치. 기존 음성/소리/Codex 런타임·어댑터 23개 비교 변경 0건으로 0.1.5 런타임 검증을 재사용했다. 새 장치/모델 추론 시험을 수행했다는 뜻은 아니다.
- 고정 설치 경로의 0.1.6으로 전환 후 탐색기에서 직접 실행, 관객 6명·103포인트 및 설정의 기존 기본 저장 경로를 확인했다. 저장 형식은 변경하지 않았다.

## 파일 및 증거

- 앱 ZIP SHA256: `4778951e876d7a5e59752472b493ea2789aaaf77ce198d71c830ab35e5b93528`.
- 설치 도구 ZIP SHA256: `619dcd1aeb4bbb95fb9ac62c9ade0c8fb41e671cc8a5b942c5e1dee9cb8e1eea`.
- 원본: `../00_game_backseat-worktrees/in-app-profile-recovery/{check.log,package.log,package-integrity.log,artifacts/native-app-recovery/profile-recovery.jsonl,artifacts/native-user-backup-inventory.json,artifacts/installed-package-verification.json}`. 통합 검사: `../in-app-profile-integration/integration-check.log`. 개인 프로필과 백업 목록은 게시하지 않는다.
- 설치된 실행 파일: `G:\dev\ai\Nagneon\versions\0.1.6-in-app-recovery\Nagneon.exe`. 고정 진입점은 그대로 `G:\dev\ai\Nagneon\Start-Nagneon.cmd`다.

## 복귀

앱 정상 종료 후 `backups/in-app-recovery-0.1.6/current.json`과 두 실행기 파일을 설치 루트로 복원하면 기존 0.1.5 실행 파일로 돌아간다. 저장 형식 변경이 없으며 기존 0.1.5/프로필 백업은 보존한다. 사용자 data를 과거 백업으로 덮어쓰지 않는다. 복구로 생성된 기록도 삭제하지 않는다.
