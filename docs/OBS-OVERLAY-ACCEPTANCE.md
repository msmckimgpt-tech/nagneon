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

이번 결과는 격리 개발 런타임의 WGC 창 캡처다. 배포 패키지의 OBS 캡처, 다른 캡처 방식, 실제 플랫폼 송출과 가상 후원 메시지 자체의 캡처는 검증하지 않았다. 모든 환경에서 개인용 내용이 보호된다는 보장은 아니다.

시험 OBS 자동 정상 종료는 확인하지 못했다. `CloseMainWindow`와 제한 시간 내 종료 대기는 실패했고, 후속 조회에서 시험 프로세스가 없는 것은 확인했다. 따라서 캡처 항목만 통과했으며 전체 실행·종료 절차의 통과로 확대하지 않는다. 앞선 두 시도는 비정상 종료 확인 화면에서 시간 초과했다.

원본 PNG는 위 링크로 저장소에 함께 보존한다. 해시는 다음과 같다.

| 파일 | SHA-256 |
|---|---|
| public-before.png | `0fd641917c31c703eff49e9aaaf672a83ee122d168a027ac2ebed84f8835603d` |
| private-retained.png | `0fd641917c31c703eff49e9aaaf672a83ee122d168a027ac2ebed84f8835603d` |
| public-after.png | `2cd7aad5a911daff197de441e2098daf3661cbe22fa3368cf84d2444c80dd85a` |
