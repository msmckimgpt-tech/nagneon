# 로컬 JSON 저장(JsonStore) 모듈

`JsonStore` 는 리테일 데스크톱 배포를 위한 **견고한 로컬 JSON 영속화 building block**
입니다. 전원이 갑자기 꺼지거나 파일이 손상되어도 사용자의 설정/데이터를 조용히
잃거나 초기화하지 않는 것을 목표로 합니다.

- 서버 로직: `server/storage.js` (`JsonStore` 클래스)
- 테스트: `test/storage.test.js`
- 외부 의존성 없음(Node 내장 `node:fs`, `node:path` 만 사용), `eval` 미사용

이 모듈은 `server/index.js`의 설정·게임 지식·관객·포인트·핫클립·기획 방송 저장에 연결됐다. `server/data-schema.js`가 저장 형식을 검증하며 복구 알림은 앱에 표시된다. 원본이 손상되고 유효한 백업도 없으면 앱을 초기화하지 않고 시작 오류를 표시한다.

통합 검토에서 짧은 쓰기(부분적인 `writeSync`)를 끝까지 반복하도록 수정했고, 한국어 UTF-8 파일과 쓰기 진행 중단을 재현한 검증을 추가했다. 저장 모듈 19개, 앱 복구 2개를 포함한 전체 98개 테스트와 빌드가 통과했다. 앱의 여러 JSON 파일을 하나로 묶는 트랜잭션이나 실제 전원 차단 실험까지 검증한 것은 아니다. `artifacts/retail-foundation-check.log`, `artifacts/storage-integration.log` 참고.

---

## API

```js
import { JsonStore } from './storage.js';

const store = new JsonStore(file, {
  validate,          // (data) => validatedData  — 검증·정규화된 데이터를 "반환"해야 함(throw 로 거부)
  initial,           // () => initialData        — 최초 실행 시 기본값(기본값: () => ({}))
  backupCount = 3,   // store 당 유지할 백업 세대 수(0 이상 정수)
  fs,                // 선택: 파일시스템 어댑터(테스트에서 특정 메서드만 교체)
});

const data = store.load();   // 검증된 데이터(사본)를 반환
const saved = store.save(v); // 검증 후 원자적으로 커밋, 저장된 데이터(사본) 반환

store.warnings;       // string[]  — 복구/비치명적 백업 관련 경고
store.recoveredFrom;  // string|null — 손상 복구에 사용한 백업 파일 경로
```

`validate` 는 zod 스키마를 그대로 감싸 쓸 수 있습니다: `validate: (d) => Settings.parse(d)`.
검증 함수는 반드시 **검증된 데이터를 반환**해야 하며(반환값이 `undefined` 면 오류),
잘못된 입력은 예외를 던져 거부합니다.

---

## 동작 보장 (Guarantees)

### load()

- 기본 파일이 유효 → 그 값을 검증해 반환.
- 기본 파일도 없고 백업도 **한 번도 없었다면** → `initial()` 을 검증해 반환(디스크에 쓰지 않음).
- 기본 파일이 손상(JSON 파싱 실패 또는 스키마 검증 실패)됐다면 → **같은 store 의
  최신 유효 백업**으로 복구하고 `recoveredFrom` 과 `warnings` 에 명시적으로 보고.
  최신 백업도 손상됐다면 그다음 유효 백업으로 순차 시도.
- 기본 파일이 손상됐는데 **유효한 백업이 없다면** → 명확한 한국어 오류를 던지고,
  절대 조용히 덮어쓰거나 초기화하지 않습니다(손상 원본은 그대로 보존).
- 기본 파일이 사라졌지만 백업이 있으면(중단된 저장) → 최신 유효 백업으로 복구.

### save(value)

1. 입력을 **사본으로 복제 후 검증**합니다. 검증 실패 시 **디스크를 전혀 건드리지 않고**
   던집니다. (호출자가 넘긴 객체를 이후에 변형해도 저장 내용에 영향 없음)
2. `파일.tmp` 에 기록 → **fsync** → `rename` 으로 **원자적 커밋**.
3. 커밋 전, 직전의 **유효한** 기본 파일을 백업 세대로 회전 저장합니다.
   - 손상 복구 직후의 저장이라면, 백업 세대에 손상본을 섞지 않고 손상 원본을
     `파일.corrupt-<타임스탬프>` 로 **먼저 보존**한 뒤 새 데이터를 커밋합니다.
4. 임시 파일 기록/커밋 중 어느 단계에서 실패해도 **이전의 유효한 기본 파일은 유지**됩니다.
5. `load()`/`save()` 는 항상 **사본(clone)** 을 반환하므로, 반환값을 변형해도 내부
   캐시나 디스크 데이터가 바뀌지 않습니다.

---

## 파일 레이아웃

정확히 지정한 store 이름에 종속된 경로만 다룹니다(전역·재귀 삭제 없음).

| 파일 | 용도 |
| --- | --- |
| `<file>` | 기본 데이터 파일 |
| `<file>.tmp` | 저장 중 임시 파일(성공/실패 시 정리) |
| `<file>.bak.1 … <file>.bak.N` | 백업 세대. `.bak.1` 이 **최신**, `N = backupCount` 가 상한 |
| `<file>.corrupt-<ts>` | 손상 복구 시 보존한 원본(포렌식용, 자동 삭제 안 함) |

- 백업 회전은 `.bak.N` 을 버리고 `.bak.k → .bak.(k+1)` 로 밀어 올린 뒤 현재
  기본 파일을 `.bak.1` 로 복사합니다. 상한(`backupCount`)이 줄었을 때 남은
  더 높은 번호의 백업은 저장 시 함께 정리됩니다.
- 백업 탐지는 `^<파일명>\.bak\.(\d+)$` 정규식으로 **정확히 이 store 의 파일명**에만
  일치시키므로, 같은 폴더의 다른 store 백업이나 무관한 파일은 건드리지 않습니다.

---

## 통합 예시

`server/index.js` 의 반복되는 임시파일+rename 패턴을 대체할 수 있습니다.

```js
import { JsonStore } from './storage.js';
import { Settings } from './schema.js';

const settingsStore = new JsonStore(resolve(dataDir, 'settings.json'), {
  validate: (d) => Settings.parse(d),
  initial: () => Settings.parse(defaults),
  backupCount: 3,
});

let settings = settingsStore.load();
if (settingsStore.recoveredFrom) console.warn(settingsStore.warnings.join('\n'));
// ...
settingsStore.save(nextSettings);
```

---

## 테스트

```bash
node --test test/storage.test.js
```

WSL 에 node 가 없으면 Windows node 로 실행합니다(프로젝트 폴더에서):

```bash
"/mnt/c/Program Files/nodejs/node.exe" --test test/storage.test.js
```

실제 임시 파일(`os.tmpdir()`)에서 다음을 검증합니다: 손상/복구, 잘못된 스키마,
백업 정렬·상한, 복구 불가 시 예외(초기화 금지), 검증 실패 시 디스크 불변,
호출자 변형 격리, 경로 한정 정리·무관 파일 보존, 복구 이후 저장. 결정적인
쓰기 실패 재현에는 주입식 fs 어댑터를 사용합니다. 마지막 실행 원본 로그는
`artifacts/claude-storage-test.log` 에 보존되어 있습니다.

---

## 한계 (Limitations)

- **동기 API**: `readFileSync`/`writeFileSync` 계열을 사용합니다. 설정/소규모 상태
  저장에 적합하며, 대용량이나 고빈도 쓰기에는 맞지 않습니다.
- **단일 프로세스 가정**: 파일 잠금이 없습니다. 여러 프로세스가 같은 파일을
  동시에 쓰는 상황은 대상이 아닙니다(데스크톱 단일 앱 전제).
- **저장마다 직전 기본 파일 재검증**: 외부 변조/‘load 없는 save’ 로 인한 백업
  오염을 막기 위해 저장 시 기존 기본 파일을 한 번 더 읽어 검증합니다. 소규모
  JSON 기준 비용은 무시할 수 있는 수준입니다.
- **디렉터리 fsync 는 best-effort**: 일부 플랫폼(Windows 등)에서 디렉터리 fsync 가
  지원되지 않으면 조용히 건너뜁니다. 파일 데이터 자체는 항상 fsync 됩니다.
- **`.corrupt-*` 보존본은 자동 삭제하지 않습니다**: 사용자가 확인 후 직접 정리합니다.
