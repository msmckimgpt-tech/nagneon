# 미리보기 디버그 설정 호환 복구 · 2026-09-15

GPU 설정 배포본에서 기존 `nagneon-preview` 프로필을 열 때 `debug.json`의 `tryNewFeatures` 키가 엄격한 스키마에 없어 시작이 중단됐다. 기존 미리보기 버전이 기록한 유효한 Boolean 항목이며 JSON 손상이 아니었다. 새 프로필 위주 배포 검증이 이 호환 문제를 놓쳤다.

`DebugConfig`에 선택적 Boolean 필드를 명시하여 기존 파일을 그대로 읽고 보존한다. 현재 클라이언트가 해당 필드를 생략해 저장해도 기존 값을 유지한다. 다른 필드의 필수 조건, 알 수 없는 항목 거절, 인증·방송 중 변경 제한은 유지한다. 사용자의 원본이나 백업 파일을 삭제·초기화하지 않는다.

검증 작업 경로: `G:/dev/ai/00_game_backseat-worktrees/debug-profile-compat`.

- `artifacts/check.log`: 동시 실행 수 2의 `npm run check`, 664개 테스트와 TypeScript/Vite 빌드 통과.
- `artifacts/debug-tests.log`: 미리보기 항목 읽기, 원본 내용 무변경, 저장·재시작 후 값 유지, 원본 백업 보존, Boolean 타입·알 수 없는 키 거절 검사 통과.
- `artifacts/existing-profile-test.json`: 기존 프로필의 격리 복사본으로 서버 시작, 디버그 설정 읽기, GPU 기본 설정 확인. 원본 161개 파일 해시 무변경. 실제 관객 모델 호출·방송은 수행하지 않았다.
- `scripts/verify-nagneon-native.ps1 -ProfileDataSource <기존 data 폴더>`는 기존 데이터를 별도 테스트 프로필에 복사하고 패키지 앱의 창 생성·정상 종료와 원본 해시 무변경을 검증한다. 원본 데이터에는 쓰지 않는다.

실제 Windows 검증: `artifacts/native-existing-profile.json`에서 수정 패키지 실행 파일이 기존 프로필 복사본으로 `Nagneon 나그네온 — AI 관객과 함께하는 방송실` 창을 열고 정상 종료했다. `passed=true`, `copiedExistingProfile=true`, `originalUnchanged=true`를 확인했다. 배포 실행 파일의 실제 시작 경로를 실행했다.

수정 배포본: `release/2026-09-14T16-53-51-203Z/app/Nagneon-win32-x64`.

`artifacts/packaged-runtime-test.json`: GPU / int8_float16 실제 인식 및 음성 런타임 검사 통과. `artifacts/package-integrity-test.json`: 배포 파일 2476개 해시와 소스 96개 일치 확인 통과.

`artifacts/applied-user-profile.json`: 실행 중인 Nagneon이 없는 것을 확인한 뒤 수정 앱을 기존 원본 프로필로 실행했고 정상 방송실 창이 열렸다. debug.json 해시는 그대로다. 기존 Nagneon-GPU.lnk를 수정본으로 연결했고 새 Nagneon-Recovered.lnk도 생성했다. 방송은 시작하지 않았다.
