# CulturePack 후보 선택 모듈

`server/culture/index.js`는 문화 지식 팩을 검증하는 `compileCulturePack()`과 소수의 표현 후보를 고르는 `selectCultureCandidates()`를 제공한다. 현재 모듈과 합성 단위 테스트만 존재한다. 실제 인터넷 밈 수집기, 실제 카탈로그, 방송·커뮤니티 요청 연결, 관객별 습득 기록, 설정 UI는 제공하지 않는다. 이 모듈 추가만으로 앱의 응답은 바뀌지 않는다.

## 입력과 선택

schemaVersion 1 팩은 ID, revision, publishedAt, entries를 가진다. 각 entry는 classic/trend/hybrid 분류, familyId, 의미, 언어별 표현, 적용 범위, 사용 제약, 출처 근거를 가진다. 컴파일 결과는 원본과 분리된 불변 snapshot이다.

후보 선택은 live/community, 언어·지역·게임, 방송/커뮤니티 태그, 상황, 차단 family, spoiler 허용 여부를 검사한다. `balanced`, `fresh-only`, `classic-only` 모드를 지원한다. 기본 최대 후보는 2개, 지정 가능한 최대는 5개이며 같은 family는 하나만 반환한다. 기능 비활성이나 적합 후보 없음은 정상 결과 `[]`다. 후보는 표현 제안이며 특정 관객의 지식·선호·실제 사용 또는 노출을 뜻하지 않는다.

## 최신성과 권리

trend의 시간은 UTC epoch milliseconds다. `observedFrom <= observedUntil <= verifiedAt <= validUntil`을 검사하며 observedFrom은 생략할 수 있다. 선택 시 관측 종료와 검증 시점이 현재보다 미래이면 trend를 사용하지 않는다. `now > validUntil`이면 만료되며 hybrid는 고전 경로로 남을 수 있다. `fetchedAt`은 최신성 판정에 사용하지 않는다.

현 단계의 SourceEvidence는 `real-external`만 허용한다. 가상 게시글·AI 생성량·열람 기록을 현실 유행의 근거로 넣을 수 없다. 생성 후보에는 entry의 generationAllowed와 최소 한 source의 generationAllowed가 모두 필요하다. referenceAllowed만으로는 충분하지 않다. withdrawn, family 차단, 상황 회피, spoiler 제약은 최신성보다 우선한다.

권리 필드는 입력된 허용 여부를 검사할 뿐 실제 서비스의 이용 권한을 확인하는 기능이 아니다. 팩 배포·권리 회수 알림·네트워크 수집·영속 저장 기능은 포함하지 않는다. 팩 변경은 새 snapshot을 컴파일해 다음 선택에 전달해야 한다.

## 검증

합성 데이터로 `node --test test/culture-pack.test.js`를 실행한다. 미래/역전 시간, 최신성 만료와 fetchedAt 분리, hybrid fallback, live/community 범위, 생성 권리 회수·withdrawn, spoiler, family 중복, 후보 수, 입력 순서, 가상 근거 거절, snapshot 불변성을 확인한다. 저장 프로필이나 장치·계정을 사용하지 않는다. 전체 필수 검사는 `npm run check`, 의존성 검사는 `npm audit --audit-level=high`다.
