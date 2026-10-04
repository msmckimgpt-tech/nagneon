# Windows 패키지의 프로필 reader 검증

`scripts/verify-packaged-profile-reader.mjs`는 지정한 배포 폴더의 실제
`Nagneon.exe`를 숨긴 관측 모드로 실행한다. 원본 패키지를 수정하거나 설치하지
않으며, 이 worktree의 새 `artifacts/packaged-profile-reader-*` 폴더에 생성한
합성 프로필만 사용한다. 실제 사용자 프로필, 계정, 화면, 마이크, 게임 및
모델 호출은 검증 대상이 아니다.

## 실행

먼저 해당 worktree에서 `npm ci`를 수행한다. 실행 대상은 reader 5를 선언하는
0.1.18 Windows 패키지이며, 10초 종료 유예 및 시작 실패 JSON을 지원하는
백그라운드 관측 코드가 포함되어야 한다. 패키지를 만든 작업자가 전달한
전체 manifest, EXE, ASAR SHA-256을 명시한다.

```powershell
node scripts/verify-packaged-profile-reader.mjs `
  --folder=C:/absolute/path/Nagneon-win32-x64 `
  --manifest=C:/absolute/path/manifest.json `
  --manifest-sha256=<manifest-sha256> `
  --exe-sha256=<exe-sha256> `
  --asar-sha256=<asar-sha256>
```

`--output=<절대 경로>`는 이 worktree의 `artifacts` 아래에 아직 존재하지 않는
폴더만 허용한다. 링크·junction·경로 탈출을 거부하며 기존 실행의 프로필을
받는 옵션은 없다. 결과와 모든 합성 입력을 보존하고 자동 삭제하지 않는다.

패키지를 실행하지 않고 합성 입력 생성만 확인하려면 다음 명령을 사용한다.

```powershell
node scripts/verify-packaged-profile-reader.mjs --prepare-only
node --test test/packaged-profile-reader.test.js
```

`--prepare-only`의 종료 코드 0은 fixture 생성 결과이다. 이때 최종 JSON의
`passed`는 false, `nativeExecuted`는 false이며 네이티브 수용을 뜻하지 않는다.
가드 단위 테스트도 실제 EXE 검사를 대체하지 않는다.

## 검증하는 데이터와 실제 경로

원본 합성 fixture는 소스의 `WorldData`, `ConversationJournal` 및
`JournalStore`를 통해 준비한다. 방송을 시작하지 않고, 모델 제공처는 호출을
거부하는 합성 객체를 사용한다. 임시 파일 경로 `TEMP`와 `TMP`도 미리 검증하고
생성한 합성 프로필의 `temp` 폴더에 고정하며 부모 프로세스 환경은 바꾸지 않는다.
패키지 실행용 복사본은 `provider-choice.json`의
`kind: openai`, API 키가 없는 격리 환경, 완료된 시작 안내와 미리 생성한
`profile/data`를 사용한다. AI 정책 및 방송 밖 활동을 중지하고 캡처 기능을
비활성화한다. 인증 토큰을 추출하지 않고 실제 renderer의 기존 인증 fetch를
통해 저장 API를 사용한다.

양성 사례는 다음 네 가지이다.

- 출처 정보가 있는 reader 4 프로필
- 4000자 원문이 있는 reader 5 journal
- 기존 marker 4와 4000자 journal이 함께 있는 프로필
- 출처 world와 4000자 journal이 함께 있으며 marker가 4인 복합 프로필

각 입력에는 짧은 전사만 포함한 유효 index 백업, 정확한 목격자·원문·전사
필드, 사회 열람 receipt, 관객 메모와 별명, 잔액 및 별도 합성 sidecar가 있다.
출처 사례에는 strict `TrendFact`, 댓글·대댓글, 추천과 `activityReads`도 있다.
출처가 없는 유효 world 백업도 두어 기본 파일을 잘못 대체하는지 확인한다.
sidecar 검사는 파일 보존 검사이며 해당 기능의 실행 합격이 아니다.

각 양성 프로필에서 실제 EXE의 새로운 CDP page에 연결한다. 준비 JSON의
프로필·앱 버전·화면 준비·방송 정지·주기 작업 정지와 `shutdownDelayMs: 10000`을
확인한 후, 한 번의 `Runtime.evaluate` 안에서 순차 실행한다.

1. journal GET으로 모든 합성 원문을 확인한다.
2. 정상 `POST /api/journal/:id/pin`으로 한 원문을 고정한다.
3. journal GET으로 정확한 원문과 고정 저장 결과를 확인한다.
4. 정상 `PUT /api/settings`로 합성 방송 제목만 변경한다.
5. 상태와 AI 사용 기록, 출처 게시물 projection을 다시 읽는다.

4000자 원문을 `/api/speech`에 전송하지 않는다. 해당 입력 API의 3000자 제한과
보관된 원문의 4000자 계약은 다르다. 원문 고정은 실제 기존 기록 저장 경로를
검증한다. 방송이나 신규 음성 입력을 시작하는 검사는 포함하지 않는다.

자동 정상 종료 후 exit 코드·signal, stdio close, writer lease 해제를 별도로
확인한다. 디스크에서 원문 ID·저장 순서·목격자·전사와 source world 전체를
확인하고, 지정한 제목과 고정 필드 외 데이터가 보존됐는지 검사한다. 같은
프로필을 정상 재시작해 읽기 결과와 전체 durable 파일 inventory를 재확인한다.
재시작은 기존 정상 종료가 수행하는 world 백업의 정확히 한 번 회전만 허용한다.
기본 world 파일의 원문 bytes와 SHA는 같아야 하며, `bak.1`은 이전 기본 파일,
`bak.2`는 이전 `bak.1`, `bak.3`은 이전 `bak.2`의 bytes와 SHA여야 한다.
이전 `bak.3`은 기존 3세대 보관 정책에 따라 교체된다. 재시작 전에 `bak.2`와
기본 파일의 SHA가 달라 0회·1회·2회 저장을 구별할 수 있어야 하며, 구별할 수
없으면 입력을 고치지 않고 실패한다. 그 외 모든 기존 durable 파일과 기존
trace의 해시는 같아야 하며 신규 파일은 정확한 이름의 lifecycle trace segment만
허용한다. 새로운 백업 번호·임시 파일·손상 파일·알 수 없는 경로는 거부한다. 첫 데스크톱
시작에서 생성하는 `desktop-origin.json`은 정확한 schema와 실제 renderer의
포트가 같은 경우에만 신규 파일로 허용하고 재시작 때 해시 보존을 검사한다.
marker 4의 장기 원문은 5로 올라가야 하며 짧은 백업으로 되돌아가면 실패한다.

음성 사례와 별도로 최소 reader 6, 최소 앱 0.1.19, 잘못된 출처 provenance,
다른 손상 store 네 가지를 실제 EXE로 실행한다. `passed: false`, `stage: startup`
JSON과 예상 stderr, 긍정 준비 신호 부재, 정상 종료 및 **모든 durable 입력
해시 불변**이 함께 있어야 거부 동작으로 인정한다. 시작 실패가 exit 0이어도
JSON이 없거나 오류가 다르면 성공으로 인정하지 않는다.

## 시간·소유권·실패 기록

10초는 준비 결과 뒤 정상 종료 요청을 예약하는 유예이다. 시작과 비동기 종료
정리 전체의 상한을 뜻하지 않는다. runner는 시작 기준 관측 deadline,
각 debugger 요청의 남은 시간, 별도의 종료 drain을 사용한다. 원격·다른
포트·다른 page의 debugger URL을 거부한다. 새 profile의 writer PID와 실제
spawn PID가 같아야 저장을 진행한다. 신선한 `DevToolsActivePort`를 Chromium이
작성하는 동안의 `ENOENT`·`EBUSY` 읽기는 동일 child와 전체 deadline 안에서만
재시도하며 코드·시각을 보존한다. 접근 거부나 잘못된 파일 내용 등은 실패한다.

관측 실패 후에도 같은 child handle의 종료를 추적한다. 필요하면 동일한
CDP page와 writer nonce를 확인한 후 정상 page 닫기를 요청한다. 요청 응답은
종료 증거가 아니며 exit와 pipes close를 계속 확인한다. 강제 종료나 실행 중인
프로필 재시작은 하지 않는다. 최초 시간 초과는 늦은 정상 종료로 합격 처리하지
않는다. 실행이 남으면 프로필과 로그를 보존하고 후속 실행을 중단한다.

`stdout.log`와 `stderr.log`, 각 실행의 `result.json`, 시작/종료 시각 및
프로필 inventory를 별도로 보존한다. spawn 직후 등록한 close 처리기가
`terminal-*` 파일에 완결된 raw streams와 같은 handle의 종료 증거를 남긴다.
각 native 실행의 결과는 transport와 lifecycle 단계 결과이며, 데이터 의미를
확인하는 바깥 사례의 합격과 구분한다. 최상위 `result.json`의 `passed: true`는 모든 양성·음성
사례와 패키지 전후 해시가 확인된 경우에만 설정된다.

## 증거의 수용 범위

runner는 실제 EXE·ASAR·capability 파일·sourceManifest·fuses와 전체 패키지
inventory를 전달받은 해시에 바인딩한다. 포함된 sourceManifest의 각 소스와
ASAR/resource bytes도 대조한다. 하네스 worktree 소스가 패키지 생성 소스와
같다는 뜻은 아니므로 빌드 담당자가 별도 소스 대응 검사를 수행해야 한다.

이 검사는 합성 데이터의 **실제 Windows 패키지 실행** 증거이다. 사용자 환경에
설치·업데이트·복귀한 결과, 기존 실계정, 물리 장치, 실제 사용자 경험,
미션 실행, 출처 표시 UI 또는 Steam 판매 심사의 합격을 의미하지 않는다.
