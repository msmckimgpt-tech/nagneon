# OBS 오버레이 캡처 검증

2026-09-23 Windows에서 OBS 32.2.2의 WGC 창 캡처로 격리 Electron 오버레이를 확인했다. 화면의 색상 표식과 문구는 검증용으로 삽입한 합성 데이터다. 실제 방송·계정·시청자 메시지·마이크·전체 화면은 사용하지 않았다.

## 관찰 결과

| 전환 | OBS가 저장한 실제 PNG | 결과 |
|---|---|---|
| 공개용 A | [공개 전환 전](images/obs-acceptance/public-before.png) | AI 관객·가상 포인트 고정 안내와 녹색 PUBLIC A 표식 표시 |
| 개인용 B | [개인용 전환 후](images/obs-acceptance/private-retained.png) | 새 자주색 PRIVATE B 표식은 나타나지 않고 마지막 공개 A 프레임 유지 |
| 공개용 C | [공개용 복귀](images/obs-acceptance/public-after.png) | 고정 안내와 파란색 PUBLIC C 표식으로 다시 갱신 |

개인용 전환 후 6초를 기다려 캡처했다. 개인용 PNG와 직전 공개 PNG의 SHA-256은 동일하다. 이는 새 비공개 내용이 해당 캡처에 나타나지 않았다는 증거이며, OBS에서 마지막 공개 화면까지 지웠다는 뜻은 아니다. 즉시 가림이 필요하면 OBS에서 소스를 숨긴다.

## 검증 범위

- 시험 창의 고유 제목을 정확히 일치시키는 창 캡처만 사용했다. 캡처 로그에서 선택·실행 방식 모두 WGC임을 확인했다.
- 실제 제품의 `createStudioSession`과 `applyOverlayPrivacy`를 사용했다. 공개용에서 보호 해제, 개인용에서 보호 설정을 확인했다.
- OBS가 생성한 PNG를 검사했다. Electron 자체 화면 저장만으로 OBS 캡처를 판정하지 않았다.
- 오디오 소스·방송·녹화·가상 카메라와 WebSocket 원격제어 서버는 비활성 상태였다.
- 캡처 대상 제품 tree는 `1513a075a20d4d6bbaaba5ab7e431f9572460bdc`이며 통합 커밋 `f12451a280bec2a1d1fb4bfda7d26d84e8ffc496`와 동일하다.

## 제한 및 미검증

이번 결과는 격리 개발 런타임의 WGC 창 캡처다. 배포 패키지의 OBS 캡처, 다른 캡처 방식과 실제 플랫폼 송출은 검증하지 않았다. 가상 후원 메시지는 아래 추가 시험에서 확인했다. 모든 환경에서 개인용 내용이 보호된다는 보장은 아니다.

시험 OBS 자동 정상 종료는 확인하지 못했다. `CloseMainWindow`와 제한 시간 내 종료 대기는 실패했고, 후속 조회에서 시험 프로세스가 없는 것은 확인했다. 따라서 캡처 항목만 통과했으며 전체 실행·종료 절차의 통과로 확대하지 않는다. 앞선 두 시도는 비정상 종료 확인 화면에서 시간 초과했다.

원본 PNG는 위 링크로 저장소에 함께 보존한다. 해시는 다음과 같다.

| 파일 | SHA-256 |
|---|---|
| public-before.png | `0fd641917c31c703eff49e9aaaf672a83ee122d168a027ac2ebed84f8835603d` |
| private-retained.png | `0fd641917c31c703eff49e9aaaf672a83ee122d168a027ac2ebed84f8835603d` |
| public-after.png | `2cd7aad5a911daff197de441e2098daf3661cbe22fa3368cf84d2444c80dd85a` |

## 가상 포인트 알림과 정상 종료 추가 시험

같은 날 별도 portable OBS 사본과 합성 25P 후원 메시지로 추가 확인했다. 실제 제품의 `donationMessage`와 `publishMessage` 경로로 전달한 알림이며, 모델의 후원 생성이나 포인트 잔액 거래를 시험한 것은 아니다.

최초 캡처에서 후원 토스트가 공개 안내를 가리는 문제를 발견했다. 공개용 토스트를 안내 다음의 일반 배치로 바꿔 안내 높이에 맞춰 내려오도록 수정했다. [수정 후 실제 OBS PNG](images/obs-acceptance/public-donation.png)에서 AI·가상 포인트·응답 지연 안내와 “실제 금전 후원이 아닙니다” 문구가 함께 보이는 것을 확인했다. 개인용 토스트의 기존 배치는 유지한다. Electron 회귀 검사도 알림의 상단이 공개 안내 하단보다 아래인지 확인한다.

추가 시험에서 OBS의 구성 마법사 창과 기본 창이 함께 떠 있었다. 시험 프로세스의 경로·PID와 소유 창 핸들을 대조한 뒤 구성 마법사와 기본 창에 정상 닫기 메시지를 보냈다. 프로세스 종료와 종료 코드 0을 확인했다. 앞선 `CloseMainWindow` 실패를 소급해 통과로 바꾸지는 않는다. OBS 종료 로그의 메모리 누수 1건 표시는 남아 있으며, OBS 자체의 누수 없는 동작을 입증한 시험은 아니다.

이 시험도 마이크·전체 화면·사용자 OBS 프로필·실제 송출을 사용하지 않았다. 원본은 작업 worktree의 `artifacts/obs-donation-run-r7sdin/`에, 실패한 최초 시도는 `artifacts/obs-donation-run-tAmMlR/`에 보존했다. 필수 검사 849개와 빌드, 의존성 감사가 통과했다.

`public-donation.png` SHA-256: `ec6986ce31077e2d09810d00b6d0555b8556d076a3ce3867f5282b7a9f159085`.
