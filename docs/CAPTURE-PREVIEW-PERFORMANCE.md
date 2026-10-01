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

기존 캡처의 해상도·15fps 요청, 화면 분석의 500ms 샘플링, STT, 클립 전후 맥락, 시스템 오디오와 별도 마이크 녹음은 유지한다. 표시 해상도나 fps를 추가로 낮추는 설정도 도입하지 않는다.

## 조사와 합성 측정

이 경로에는 미리보기용 두 번째 `getDisplayMedia` 호출이나 매 프레임 base64/IPC 전달이 없다. 분석 인코딩은 이미 한 번에 하나만 실행되고 시간 프레임 저장도 제한된다. 두 비디오가 같은 스트림을 소비한다는 사실만으로 별도 디코더가 중복 실행된다고 단정할 수 없다.

1920×1080, 15fps 합성 canvas와 440Hz 합성 음성을 사용했다. 실제 MediaRecorder와 500ms JPEG 샘플링을 함께 실행하고, 모드 순서를 바꾸어 각 모드를 8초씩 세 번 측정했다. 모든 창은 격리 프로필의 offscreen 창이다.

| 모드                          | 8초 표시 프레임 callback | 분석 비디오 프레임 callback | 분석 샘플 |
| ----------------------------- | -----------------------: | --------------------------: | --------: |
| 기존 방식 native 표시         |                  119–121 |                     119–121 |        16 |
| 현재 controller의 보이는 표시 |                  120–121 |                     120–121 |        16 |
| 현재 controller의 숨겨진 표시 |                        0 |                     119–120 |        16 |

숨김 상태에서도 분석 비디오는 재생 중이었고 녹화 트랙은 live 상태였다. callback 수는 비디오 프레임 갱신 관측값이며 실제 모니터 출력이나 인코딩된 프레임 수와 같다고 가정하지 않는다.

렌더러 CPU와 working set은 반복마다 변동했고 일부 측정에서는 외부 프로세스 집합도 변했다. CPU·메모리 절감률을 확정하지 않는다. Electron GPU 프로세스의 CPU 값도 기록했지만 실제 GPU 사용률은 측정하지 않았다. 실제 게임 fps, 사용자 화면에서의 최종 표시 지연과 장시간 방송 부하는 이 합성 검사로 확인하지 않았다.

960px/8fps canvas 표시도 비교했다. 표시 callback은 줄었지만 CPU 이점이 일정하지 않아 제품 경로에는 적용하지 않았다. 분석용 비디오를 직접 DOM에 표시하는 대안은 숨김 때 DOM에서 제거하면 그 비디오가 일시정지되어 분석 프레임 갱신이 멈췄으므로 적용하지 않았다. `scripts/lib/sampled-screen-preview.ts`는 이 비교 실험에만 사용된다.

## 회귀 결과와 범위

2026-10-01 로컬 검사 결과:

- 미리보기·캡처 준비·비동기 샘플링·클립 및 오디오 관련 Node 회귀 57개 통과.
- 실제 `ScreenPreview`, `prepareCapture`, `startTemporalCapture`, `useClipBuffer`를 사용하는 React StrictMode 합성 QA 통과. 반복 표시, native 숨김 이벤트 모사, 문서 숨김, 실제 viewport 교차, 탭 해제·복귀, 소스 교체, 정지 화면 안내와 방송 중지·재시작을 확인했다.
- 숨김 중에도 분석 시간이 진행되고 클립 후속 맥락이 포함되었다. QA 결과의 표시 타이머·문서 listener·observer·preload 구독은 종료 후 모두 0개다.
- 완성된 합성 클립을 기존 PyAV로 디코딩했다. 영상은 640×360, 227프레임, 약 14.978초, 15.089fps이고 화면 내용이 변한다. 시스템 음성 440Hz와 별도 마이크 880Hz를 각각 확인했다.
- 기존 표시 방식과 현재 controller의 독립 종료 검사 모두 exit 0. 실제 BrowserWindow 종료 후 추가한 native listener는 기존 개수로 돌아가고 공유 트랙 종료·AudioContext 종료를 확인했다.
- `npm run build` 통과. 승인된 온라인 `npm audit --audit-level=high --json`은 2026-10-01 06:16:26–06:16:28 UTC에 공식 npm registry를 조회하고 exit 0, 취약점 0개를 반환했다. 이전 offline audit 결과는 최신 보안 근거로 사용하지 않는다.
- `npm run check`는 서식 검사 후 1327개 테스트 중 1326개 통과, 1개 실패로 중단되었다. 수정하지 않은 `test/launcher-command.test.js`의 실제 CMD 진입점 검사가 Windows PowerShell 실행 정책에 의해 생성된 `-File` 스크립트를 실행하지 못했다. 실행 정책 변경·우회·테스트 skip은 하지 않았다. 별도 빌드 통과가 전체 `check` 통과를 대신하지 않는다.

native 최소화·복귀는 숨겨진 QA 창에 이벤트를 모사했다. 물리 Windows 최소화, 실제 캡처 선택창, 사용자 설치본과 OBS 동시 방송은 미검증이다. 1260×900·420×850 컴포넌트 fixture에서 상태 문구의 preview 내부 배치를 확인했지만 fixture는 전체 앱 테마·레이아웃을 재현하지 않으므로 실제 앱의 좁은 화면 검증을 대신하지 않는다. 기존 capture lifecycle/preparation 스크립트에는 선택적 `--offscreen` 실행을 추가했으나 이번 결과에는 그 스크립트의 실행을 포함하지 않는다.

중간 QA에서 종료하지 않은 자체 시험 프로세스를 발견하여 해당 시험의 소유권을 확인하고 정리했다. 이후 baseline과 최종 QA·종료 검사는 정상 종료했다. 최초 hang의 단일 원인은 확정하지 않았다.

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

최신 결과 pointer는 `artifacts/screen-preview-benchmark-result.json`, `artifacts/screen-preview-qa-result.json`, `artifacts/preview-exit-baseline-result.json`, `artifacts/preview-exit-candidate-result.json`이다. 합성 녹화 검증은 PyAV와 NumPy가 이미 제공되는 Python 환경에서 `python scripts/verify-preview-recordings.py <결과 폴더>`로 수행한다. 이 검사를 위해 새 패키지를 자동 설치하지 않는다. 결과 JSON·녹화·스크린샷·프로필은 Git에 포함하지 않는다.
