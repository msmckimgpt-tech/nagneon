# 구독 음성의 0 크레딧 잔액 확인

음성 연결은 공식 CLI가 확인한 ChatGPT 구독 계정과 포함량을 사용한다. 구매 크레딧으로 자동 전환하지 않는다. 포함량·잔액을 확인할 수 없으면 연결 전에 한국어 오류를 표시하고 호스트를 종료한다.

`SubscriptionVoiceHost.checkAllowance()`는 각 한도 응답의 크레딧 사용 가능 여부, 무제한 여부, 명시적인 0 잔액과 소진 여부를 확인한다. 잔액은 0으로만 이루어진 십진 문자열이어야 한다. `0`, `0.00`과 앞뒤 공백·부호가 있는 십진 0은 인정한다. `null`, 누락, 빈 문자열, 공백만 있는 문자열과 잘못된 자료형은 확인되지 않은 값이다. 16진수·지수 표기 등 예상 밖 표현도 승인하지 않는다.

이전에는 `Number(null)`과 빈 값이 0이 되어 확인되지 않은 잔액을 승인했다. 아주 작은 양수 문자열의 숫자 변환도 0으로 소실될 수 있었다. 이제 숫자 변환 없이 원래 십진 표현을 검사한다. 한 응답의 명확한 0이 다른 한도의 미확인 잔액을 대신하지 않는다.

이 변경은 계정 로그인, 토큰 보관, 모델·추론 수준, 과금 설정, 사용자 프로필·녹화 형식을 바꾸지 않는다. 실제 크레딧이 있는 상태와 소진된 포함량은 계속 거절한다. 잔액이 확인되지 않았다는 오류를 실제 잔액이 0이라는 뜻으로 해석하지 않는다.

## 검증

```powershell
npm ci
node --test test/subscription-voice-allowance.test.js test/subscription-voice-host.test.js test/subscription-voice-guard.test.js test/subscription-voice.test.js test/subscription-sound.test.js
npm run check
npm audit --audit-level=high
```

2026-09-30 회귀 14건은 수정 전 11건이 실패했다. 수정 후 관련 검사 41건이 통과했다. 합성 RPC 응답으로 미확인 값·명시적인 0·다중 한도·소진을 비교하며, 호스트 시작 코드에서 음성 세션을 요청하기 전에 거절하고 합성 자식 프로세스 모형을 정리하는 동작을 검사한다. 테스트가 실제 장치나 유료 연결을 사용하지는 않는다. 원본 실패와 회귀 로그는 격리 작업 공간의 `artifacts/before.log`, `artifacts/regression.log`에 보존한다.

보안 의존성 패치가 반영된 0.1.17 기준 코드에서 전체 `npm run check`의 형식 검사·1,223개 테스트·TypeScript/Vite 빌드와 `npm audit --audit-level=high`의 경고 0건을 확인했다. 원본은 `artifacts/check-0.1.17.log`와 `artifacts/audit-0.1.17.json`이다. Codex의 시험 호스트 환경에서는 [실행 도구 안내](RELEASE-0.1.15-LAUNCHER.md)의 명시적인 `NAGNEON_TEST_POWERSHELL`을 사용하며 OS 실행 정책을 바꾸지 않는다.

별도 공식 CLI 0.159.2 시험은 읽기 전용 계정 사전 검증의 거절과 소유한 실제 호스트의 정상 종료까지 확인했다. 원음·물리 장치를 사용하거나 관객 모델을 호출하지 않았다. 실제 음성 연결·자동 전사·비언어 소리의 수용 검증과 구분한다.

공식 CLI의 생성 스키마는 실행한 버전에 대응한다. 잔액의 nullable 필드와 전송 규약을 대조할 때 [App Server 스키마 생성 안내](https://learn.chatgpt.com/docs/app-server)를 따른다. 사전 검증 통과는 실제 RTP·자동 전사·음향 의미 이해의 성공과 구분한다. 설치·기록 보존·실제 입력의 수용은 해당 배포본에서 별도로 확인한다.
