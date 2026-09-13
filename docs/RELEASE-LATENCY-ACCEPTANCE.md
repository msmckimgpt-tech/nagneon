# Windows 실행본 실게임 검증과 자연스러운 카드 선택 요청

2026-09-14 KST. 작업: `codex/release-latency-acceptance`, 기준 `7d3b096eb54e497ae3903eee1c3d8032e34d8eb7`.
작업 폴더: `G:/dev/ai/00_game_backseat-worktrees/release-latency-acceptance`.
목표는 이전 첫 채팅 대기 개선을 실제 배포 실행본에서 확인하고, 실게임에서 발견되는 소통 실패를 수정하는 것이다. 전체 Steam 출시 품질 수용을 의미하지 않는다.

## 발견과 수정

Steam의 Slay the Spire 2를 실행하고, 이전 QA 프로필 3의 카드 보상 화면을 새 BACKSEAT Windows 실행본에 연결했다. 개인 프로필 1의 진행 중 게임은 재개하지 않았다. 방송과 게임 출력만 연결했으며 마이크는 켜지 않았다.

“뭉칫, 이번엔 셋 중에 뭐 골라볼까? 한 장만 같이 골라줘. 이유는 짧게 ㅋㅋ”에 모델은 채팅을 만들지 않았다. 해당 호출에 목격자와 응답 대상은 각각 2명이 있었고, 7개 프레임을 받았으며 최신 프레임은 7ms 전이었다. 모델 처리 9,567ms 뒤 생성 0개였으므로 뒤늦은 채팅 삭제나 표시 필터 실패는 아니다. 같은 발언에 기존 `adviceIntent`는 requested=false를 반환했다.

같은 카드 보상 화면에서 “카드 선택 힌트 하나만 부탁해”라고 다시 말하자 13,960ms 뒤 왼쪽 공격 카드를 추천하고 이번 턴 힘 효과를 이유로 들었다. 두 발언은 시점과 관객 상태가 완전히 같은 통제 실험은 아니므로 이 비교만으로 모든 침묵의 원인을 단정하지 않는다. 다만 요청 인식 누락은 코드로 재현된다.

`advice-intent.js`에서 “같이 골라줘”, “뭐 고를까”, “추천해 주세요” 등 선택 요청을 허용하며 “한 장만”은 단일 훈수 예산으로 전달한다. 선택·추천 거절, 인용, 과거 요청 회상은 현재 요청으로 열지 않는다. `never` 설정과 다음 화면에서 요청이 만료되는 동작도 유지한다. 문장 인식은 보수적인 규칙이며 모든 한국어 표현을 이해한다고 보장하지 않는다.

## 실제 실행본에서 확인한 결과

- 원본 검증 패키지: `release/2026-09-13T21-29-11-820Z/app/BACKSEAT-win32-x64`. ASAR SHA-256: `377f76a5f6881da90c5097eeb5677366b78dd0811b192f65b81044f57ce6e1c0`.
- 2,452개 파일, 3,130,241,280바이트. 패키지 소스 77개, 전체 파일 해시와 Electron fuses 검증 통과. 서명되지 않은 개발용 패키지다.
- 해당 ASAR에서 추출한 런타임으로 번들 Python·Whisper 한국어 전사·YAMNet·출력 대사 전사·공식 CLI·실제 Astra low 응답 검증 통과. 음성은 합성 WAV이며 실제 사람의 마이크 전사 검증이 아니다.
- 실방송 67회 일반 호출: 생성/전달 각 2개, 모델 침묵 62회, 새 입력·화면 해제로 취소 3회, 최종 대기 0개. 전체 67회 진단을 보존했다.
- 모델 응답 시간 중앙값 9,451ms, 95백분위 12,078ms. 채팅을 전달한 2회에서 모델 완료 후 첫 전달 대기는 56ms와 59ms였다. 저널 시각과 진단 시각은 13ms 이내로 대응한다. 이는 UI 렌더링이나 전체 음성 지연 측정이 아니다.
- 정적인 보상 화면이 오래 유지된 동안 자율 채팅은 관찰되지 않았다. 실제로 표시된 것은 인사 답장과 명시적 힌트 답장이다. 이 침묵을 일반 방송의 자연스러움에 대한 통과로 처리하지 않는다.

게임의 ‘백그라운드에서 음소거’가 켜진 상태에서 출력 분석은 silent=true, −160dB였다. QA 프로필에서 해당 옵션을 잠시 해제한 뒤 BACKSEAT 창을 보고 있어도 silent=false, −37.3dB의 출력이 들어왔고 YAMNet이 Music으로 추정했다(score 0.3171, peak 0.6468). 게임 소리 연결 자체가 실패한 것은 아니었다. 옵션은 다시 켰으며 원래 음량은 바꾸지 않았다. 효과음 종류·게임 내 대사 인식의 정확도까지 입증한 결과는 아니다.

## 수정본 검증

`npm run check`: 584개 테스트 통과, 실패·취소·건너뜀 0, TypeScript/Vite 빌드 통과. 추가 회귀는 자연스러운 선택 표현, 한 장 제한, 거절·인용·회상, 실제 Studio 전달 경로와 다음 프레임에서 훈수 재개 방지를 확인한다.

`node scripts/verify-choice-request.mjs --live`: 실제 `gpt-6-astra`, 추론 `low`, 합성 텍스트 3회. 카드 효과를 말로 설명한 뒤 “뭐 골라볼까? 한 장만 같이 골라줘”라고 요청하자 “저는 왼쪽! 피해도 주고 이번 턴 힘도 챙기는 게 끌려요.”라는 한 개의 훈수가 전달됐다. 최종 소스 실행에서 모델 처리는 9,831ms였다. 이어서 추천 중단에는 “넵, 이제 구경할게요!”, 따옴표 없이 “아까 뭐 고를까라고 했잖아”라고 회상할 때는 채팅 0개였다. 이 검사는 화면 없는 합성 대화이며 실제 새 실행본에서 게임을 재연결한 시험으로 표현하지 않는다. 앞선 후보에서도 3회 호출이 통과했으나, 혼잣말·회상 보호 보완 후 최종 소스로 재검증했다.

검증 스크립트 작성 중 category와 manager 설정 검증 오류가 각각 한 번 발생했다. 두 실행은 모델 대화 호출 전에 실패했으며 원래 오류 보고서를 보존했다. 설정을 바로잡은 3회 실행만 통과 결과로 사용했다.

필수 검사 재실행 중 `audience-autonomy.test.js`의 17개 검사를 모두 출력한 자식 프로세스가 종료되지 않은 경우가 한 번 있었다. 열린 TCP 연결은 없었고, 분리한 `node --test --test-timeout=15000 test/audience-autonomy.test.js`는 17개를 약 3.2초에 통과했다. PID·부모·생성 시각·명령을 재확인해 해당 검증 자식만 정리했다. 이 전체 검사 실행은 실패로 남겼으며 원인을 고쳤다고 주장하지 않는다. 원본은 `check-final.log`, `stalled-check-process.json`, `audience-autonomy-recheck.log`에 있다. 전체 재검증은 `check-release.log`로 별도 보존한다.

## 원본 보호와 증거

게임 실행 전 세이브 전체 230개 파일을 백업하고 해시를 대조했다. 종료 후 개인 프로필 1의 29개 파일에 변경·추가·삭제가 없음을 확인했다. QA 진행, 게임 로그와 게임 자체 진단 파일의 변경은 전체 목록에 남겼다. 프로필 1을 선택한 메뉴 상태로 복귀한 뒤 게임과 소유한 BACKSEAT QA 실행본을 정상 종료했다. QA 배경 음소거=true 복구도 파일로 재확인했다. 사용자 원본 방송 프로필을 덮어쓰거나 다시 실행하지 않았다.

작업 폴더의 `artifacts/`에는 다음 원본이 있다. 개인 데이터가 포함될 수 있는 전체 내보내기·게임 세이브·로그는 Git에 게시하지 않는다.

- `tested-package-baseline.json`, `packaged-runtime-baseline.json`, `package-integrity-baseline.json`: 실게임 시험에 사용한 패키지와 사전 런타임 검증.
- `live-launch.json`, `game-launch.json`, `live-preparation.json`: 프로세스 소유권·격리 프로필·백업 파일별 해시.
- `live-before-sound.json`, `live-after-sound.json`: 음소거 변경 전후 실제 방송 내보내기.
- `diagnostics-final.json`, `diagnostics-final-ui.txt`, `live-dialogue.json`: 진단 다운로드·표시·해시 검증된 대화 저널.
- `live-reaction-result.json`, `finish-live.log`: 소유 프로세스 종료, 원본 보호, 음소거 복구, 저널-진단 대응.
- `check-candidate.log`, `check-release.log`, `choice-request-i2luyA/result.json`, `choice-request-final.log`: 수정본 필수 검사와 최종 소스의 실제 모델 결과. 이전 후보 결과는 `choice-request-CAaWdz/result.json`에 있다.
- `latest-package.json`, `package-final.log`, `packaged-runtime-test.json`, `package-integrity-test.json`: 최종 소스를 담은 재배포 패키지의 위치·실행 검사·파일별 무결성 결과. 위의 `*-baseline.json`은 실제 게임 시험에 사용한 이전 패키지 증거로 별도 유지한다.
- `integration-result.json`과 `release-result.json`: 별도 통합 worktree 검사, 원격 커밋 일치, CI와 최종 패키지 검증을 연결하는 작업 완료 기록.

다음 검증은 자연스러운 선택 요청 수정이 들어간 패키지의 실제 게임 재연결, 조용한 장면에서의 관객 동행감, 물리 마이크의 말투·오인식·감정 단서다. 모델의 약 10초 이상 응답 시간이 여전히 전체 체감 지연의 큰 부분이다. 사용자 원본 프로필 적용 및 전체 출시 수용은 아직 완료되지 않았다.
