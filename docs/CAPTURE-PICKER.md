# 화면·소리 선택창

2026-09-13. `CapturePicker.tsx`/`capture-picker.css`가 UI를 맡고 `desktop/capture.cjs`가 메인 프레임에만 목록과 미리보기를 제공한다.

## 동작

선택창을 먼저 열고 이름 목록을 불러온다. 이름 조회는 thumbnailSize 0, 화면/앱 창 미리보기는 별도 요청이다. 썸네일이 필요 없을 때 크기를 0으로 지정하면 픽셀 캡처 시간을 줄인다는 [Electron 공식 API](https://www.electronjs.org/docs/latest/api/desktop-capturer)를 사용한다. 그룹, 이름 검색, 새로고침, 목록 오류 복구를 제공하며 미리보기가 없어도 선택할 수 있다.

4초가 지나면 미리보기 로딩 대신 이름 선택 안내를 보여준다. 늦은 이미지는 현재 목록의 같은 ID/이름에만 적용하고 닫거나 새로고침한 이전 결과는 무시한다. Electron native 썸네일 요청은 취소할 수 없으므로 종류별 진행 중 요청을 공유한다. OS의 WGC 경고를 없앴다는 의미가 아니라 해당 대기와 UI 사용 가능 상태를 분리한 것이다.

소리·화면 옵션은 설명이 연결된 두 카드다. 소리 공유 중에만 화면을 끌 수 있고, 소리를 끄면 화면 공유를 다시 선택한다. 하단에 최종 구성을 표시한다. 격자는 `minmax(0,1fr)`, 제목은 두 줄/접근성 전체 이름/툴팁으로 구성한다. 작은 창과 확대에서 본문만 스크롤되며 닫기와 공유 요약이 남는다. 실제 권한은 기존 단일 사용 선택 경로를 유지하고 미리보기는 미디어 스트림/모델 호출을 시작하지 않는다.

## 검증

- `capture-picker-check.log`: 전체 Node219, TS/Vite 통과. capture 정책6개는 프레임 격리, 단일 사용, 이름 조회의 픽셀 접근 없음, 진행 중 요청 병합/실패 재시도/화면·소리 선택 독립성을 확인했다.
- `capture-picker-test.json`, `capture-picker-renderer-final.log`: 실제 Electron8흐름. 지연/닫기/이전 응답 무시, 미리보기 없는 선택, 소리·화면 조건, 검색, 새로고침 복구, ID 재사용, 정확한 선택 인수. 합성 IPC. 1426×973, 1280×720, 800×720, 620×700, 380×650, 1280×900의 200% 확대에서 실제 bounds/스크린샷으로 잘림 없음을 확인했다.
- `capture-picker-dialog-current.log`: 기존 설정/선택 대화상자13개 접근성 흐름 통과. Tab/Shift+Tab/Escape, inert, 초안/저장 실패/포커스 복귀.
- `capture-native-test.json`: 실제 Windows 이름 조회711ms, 화면 미리보기636ms, 창 미리보기1111ms, 미리보기 중 재조회670ms. 실제 fixture ID와 썸네일 확인. 한 호스트의 한 번 측정이며 모든 장치 지연 보장은 아니다.
- `capture-picker-loopback.log`, `sound-ui-1789263905810`: Windows loopback5흐름 통과. 실제 로컬 음향 모델, 합성 관객. 880Hz 출력/440Hz 합성 마이크가 녹화의 단일 오디오 트랙에 함께 있음(`capture-picker-loopback-mix.log`).

새 패키지: `release/2026-09-13T01-45-11-001Z/app/BACKSEAT-win32-x64`, 1,599,419,543바이트/2444파일/미서명. 전체 해시/핵심 원본28개/fuses 일치(`capture-picker-package-integrity.json`). 새 ASAR에서 추출한 앱 코드와 번들 런타임을 개발 PATH 없이 실행했다. 음성 준비6.429초/전사2.506초, 소리 준비2.200초/분석·전사5.923초, 실제 Astra low 대화14.834초/소리문맥10.840초(`capture-picker-packaged-runtime.json`). 합성 음원/가상 캡처 시계로 실제 Steam·물리 마이크 시험과 구분한다.

native 빈 프로필 `artifacts/picker-native-20260913-104803`: 새 원본 ASAR 첫 실행/안내 건너뛰기/개선 선택창/Escape/정상 종료 확인. `capture-picker-native-dialog.jpg/.txt`, `capture-picker-native-result.json`, `capture-picker-native-processes-after.json`. PID27028과 해당 패키지 프로세스 모두 종료. 일부 창의 WGC 5초 경고와 fs.Stats 경고는 stderr에 남겼다. native 창에서 전송을 켜지는 않았고 실제 loopback은 위 별도 시험이다.

초기 renderer의 함수 반환 직렬화 오류는 검사 도구에 `void 0`을 추가하여 수정했다. 최초 native 시험은 창 준비와 실제 ID 확인을 보강했다. 실패 원본 `capture-picker-1789263566461/result.json`, `capture-native-1789263788908/result.json` 보존. 최종 GUI 검사 실행은 Node 부모가 child close를 기다려 실제 종료 코드와 보고서를 함께 확인했다.

이후 관객 자율성·관객 주도 클립·자연스러운 상황·설정 탭은 `docs/AUDIENCE-AUTONOMY.md`의 새 요구사항이다. 이 선택창 배포는 해당 전환이나 Steam 판매 완료가 아니다.
