# 방송 화면 미리보기의 자원 사용

## 표시와 캡처의 수명

`useMedia`가 획득한 화면 스트림은 화면 분석용 비디오와 클립 녹화에 전달된다. `ScreenPreview`는 같은 스트림을 표시하는 별도 비디오만 소유한다. 미리보기의 숨김·교체·해제는 공유 트랙을 종료하거나 분석용 비디오를 멈추지 않는다.

다음 조건에서는 표시용 비디오를 일시정지하고 `srcObject`를 해제한다.

- Electron 메인 창이 숨겨지거나 최소화된다.
- 문서가 숨겨지거나 미리보기가 viewport 밖으로 나간다.
- 방송실 탭의 미리보기 컴포넌트가 해제된다.

복귀하면 현재 스트림을 다시 연결한다. 표시할 과거 프레임의 큐는 만들지 않는다. 창 상태는 `preview:visibility` 조회와 `preview:visible` 변경 이벤트로 전달하며, 프레임 데이터는 이 IPC를 통과하지 않는다. 캡처·녹화를 위해 유지하는 `backgroundThrottling:false`에서도 native 창 상태를 별도로 확인한다. 조회는 메인 창의 main frame만 허용한다.

표시 상태 확인은 보이는 동안에만 1초 간격으로 수행한다. React 상태는 표시 상태가 달라질 때만 갱신한다. 컴포넌트 해제 시 타이머, 문서 listener, IntersectionObserver와 preload 구독을 제거한다. 창 종료 시 native 이벤트와 IPC handler도 제거한다. 늦게 완료된 `play()`는 이전 표시 세대의 타이머를 다시 시작하지 않는다.

`화면 연결됨`은 공유 스트림의 연결 상태다. 미리보기는 대기·표시·일시정지·마지막 화면·표시 실패를 별도로 알린다. 보이는 비디오의 미디어 시간이 약 2.5초 이상 진행하지 않으면 `마지막 화면 · 새 프레임 대기`로 바뀐다. 확인 주기만큼 감지 지연이 있을 수 있다.

기존 캡처의 해상도·15fps 요청, 화면 분석의 500ms 샘플링, STT, 클립 버퍼, 시스템 오디오와 별도 마이크 녹음은 유지한다. 표시 해상도나 fps를 추가로 낮추는 설정도 도입하지 않는다.

## 검증 범위

제품 경로는 native 비디오 표시를 유지하며 추가 캡처, 프레임별 base64/IPC 전달, 표시 fps·해상도 제한을 도입하지 않는다. `scripts/lib/sampled-screen-preview.ts`와 benchmark는 canvas 표시 대안을 비교하는 실험용이며 앱에서는 사용하지 않는다. CPU·메모리·GPU 절감률과 실제 게임 fps 개선은 이번 분리 작업에서 측정하지 않았다.

Node 회귀는 창 상태 IPC의 발신자 검증·종료 정리, 표시 타이머 중복 방지, 숨김·복귀, 늦은 `play()` 완료, 마지막 화면 안내와 표시 실패 시 공유 트랙 보존을 검사한다. `test/*.test.js` 패턴을 사용하는 기본 검사에 새 테스트 세 파일이 포함된다.

`scripts/verify-screen-preview.cjs`는 실제 `ScreenPreview`, `prepareCapture`, `startTemporalCapture`, `useClipBuffer`를 React StrictMode에서 실행한다. 합성 canvas와 440/880Hz 트랙만 사용하며, 창은 숨겨진 offscreen 창이고 프로필은 자기 worktree의 `artifacts/`에 격리한다. native 숨김·최소화 이벤트는 모사하며 문서 숨김, viewport 교차, 탭 해제·복귀, 소스 교체, 방송 중지·재시작과 타이머·listener 정리를 확인한다. 캡처·클립 구현은 기존 main을 사용한다.

`scripts/verify-preview-exit.cjs`는 같은 합성 입력으로 기존 표시 방식과 새 controller를 각각 실행하여 숨김 중 분석 진행, 녹화 데이터 생성, 트랙·AudioContext 종료와 native listener 정리를 확인한다.

물리 Windows 최소화·복귀, 실제 캡처 선택창, 사용자 설치본·계정·마이크와 OBS 동시 방송은 이 합성 검사 범위에 포함되지 않는다. 컴포넌트 fixture의 1260×900·420×850 배치는 전체 앱의 좁은 화면 검증을 대신하지 않는다. Just Chatting의 화면 없는 시작과 기존 캡처 준비·취소 흐름은 유지한다.

## 로컬 실행 결과 (2026-10-05)

- `npm ci`와 `npm audit --audit-level=high`: exit 0, 취약점 0건.
- `npm run check`: exit 1, 1,784개 중 1,781개 통과·3개 실패·skip 0개. 변경하지 않은 `release-reader-gate.test.js`의 설치 fixture 두 건이 PowerShell 실행 시간 제한을 초과했고, 상위 테스트도 실패했다. 개별 재검증에서도 시간 초과가 발생해 전체 검사 통과를 확보하지 못했다. 이 결과는 릴리즈 수용 근거가 아니다.
- `npm run build`: exit 0. TypeScript 검사와 Vite production build를 통과했다.
- `verify-screen-preview.cjs`: exit 0, 합성 QA 10항목 통과. 숨김 중 분석 샘플·녹화 유지, 복귀 시 최신 화면 표시, 공유 트랙 보존과 표시 수명 정리를 확인했다. 종료 후 표시 타이머·문서 listener·observer·IPC 구독은 모두 0개이고 native listener 수는 기존 값으로 돌아갔다.
- `verify-preview-exit.cjs --baseline`과 새 controller 검사: 각각 exit 0. 숨김 중 분석 진행과 녹화 데이터 생성, 공유 트랙·AudioContext 종료, 창 종료 후 native listener 복원을 확인했다.
- PyAV 녹화 디코딩: 현재 Python에 `av`가 없어 미검증 (`ModuleNotFoundError`). 새 Python 패키지를 설치하지 않았다. 합성 녹화 파일은 자기 worktree의 QA 증거 폴더에 보존했다.
- 원본의 과거 benchmark 수치·전체 검사 결과는 이번 작업의 수용 근거로 사용하지 않는다. 선택적 benchmark와 실제 설치·물리 장치 검증은 실행하지 않았다.

전체 검사 로그는 `artifacts/split-check.log`, 의존성 설치·audit 로그는 `artifacts/split-npm-ci.log`·`artifacts/split-audit.log`, build 로그는 `artifacts/split-build.log`, 합성 QA 로그는 `artifacts/split-screen-preview.log`·`artifacts/split-preview-exit-baseline.log`·`artifacts/split-preview-exit-candidate.log`에 보존한다. 증거 파일과 프로필은 커밋하지 않는다.

## 재현

아래 명령은 자기 worktree에서 실행한다. Electron 검사는 격리된 합성 프로필을 `artifacts/`에 만들고 물리 장치나 사용자 방송 로그를 사용하지 않는다. GPU 프로세스 실행이 제한되는 실행 환경에서는 정책을 바꾸지 말고 허용된 실행 경로를 사용한다.

```powershell
npm ci
npm run check
node --test test/preview-visibility.test.js test/video-preview.test.js test/screen-preview.test.js test/capture-preparation.test.js test/temporal-capture-async.test.js test/clip-buffer.test.js test/clip-system-audio.test.js test/clip-uploads.test.js
.\node_modules\electron\dist\electron.exe scripts/benchmark-screen-preview.cjs
.\node_modules\electron\dist\electron.exe scripts/verify-screen-preview.cjs
.\node_modules\electron\dist\electron.exe scripts/verify-preview-exit.cjs --baseline
.\node_modules\electron\dist\electron.exe scripts/verify-preview-exit.cjs
```

검사 실행 시 생성되는 결과 pointer는 `artifacts/screen-preview-benchmark-result.json`, `artifacts/screen-preview-qa-result.json`, `artifacts/preview-exit-baseline-result.json`, `artifacts/preview-exit-candidate-result.json`이다. 합성 녹화 검증은 PyAV와 NumPy가 이미 제공되는 Python 환경에서 `python scripts/verify-preview-recordings.py <결과 폴더>`로 수행한다. 이 검사를 위해 새 패키지를 자동 설치하지 않는다. 결과 JSON·녹화·스크린샷·프로필은 Git에 포함하지 않는다.
