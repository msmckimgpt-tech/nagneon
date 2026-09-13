# 설치 루트의 세션 공통 잠금

2026-09-13. `codex/installer-global-mutex`, 기준 `48b5b3314c8298d6a2f419667fc2c454f177db0d`. [제거 재시도](UNINSTALL-RETRY-CONTROLS.md)에 이어 같은 설치 경로의 동시 설치·제거·복구·실행을 점검했다. 사용자 앱·게임·화면·장치·로그인 세션을 조작하지 않았다.

## 근거와 구현

기존 이름에는 세션 범위를 지정하는 접두사가 없었다. 일반 사용자 세션의 기본 이름 공간은 해당 세션에 한정된다. [Microsoft의 kernel object namespaces 문서](https://learn.microsoft.com/en-us/windows/win32/termserv/kernel-object-namespaces)에 따라 `Global\`을 사용하면 로그인 세션 간 같은 객체를 공유할 수 있다. 문서의 `SeCreateGlobalPrivilege` 조건은 전역 파일 매핑/심볼릭 링크 생성에 관한 것으로 mutex에 같은 권한 요구를 추가하지 않았다.

`RootMutex.cs`는 정규화한 설치 루트의 기존 SHA256 이름을 그대로 사용해 **Global 잠금 다음 Local 잠금**을 잡는다. Global은 수정된 엔진끼리 세션을 넘어 공유한다. Local은 같은 세션의 구버전 엔진과 협력하기 위해 함께 유지한다. 둘 중 하나라도 잡지 못하면 작업을 시작하지 않고, Local 획득 실패 시 이미 잡은 Global을 풀어둔다. 호출자의 대기 시간은 두 잠금에 나누어 사용한다. 설치·제거·복구의 파일 변경은 여전히 획득 이후이며, launcher는 자식 앱 종료까지 두 잠금을 유지한다.

새 객체에는 현재 **계정 SID와 SYSTEM만** 허용하는 보호된 ACL을 생성 시 적용했다. 사용자 전체/Everyone 권한을 추가하지 않았다. [Mutex 생성자 문서](https://learn.microsoft.com/en-us/dotnet/api/system.threading.mutex.-ctor?view=netframework-4.8.1)에 따라 기존 객체의 ACL은 덮어쓰지 않는다. 권한 거절이나 다른 종류의 객체가 이름을 차지한 경우 별도 이름·권한 변경·세션 내부 잠금으로 우회하지 않고 오류를 반환한다. 이는 악의적인 동일 계정의 모든 간섭을 방어한다는 주장은 아니다.

동일 객체의 반복 획득은 OS 재귀 잠금을 추가하지 않고 이미 가진 소유권을 반환한다. 기존 Boolean 상태에 재귀 획득 횟수가 숨지 않도록 했다. 획득한 스레드만 해제할 수 있고 다른 스레드의 해제 실패가 소유 플래그를 지우지 않는다. 이전 보유자가 종료해 버려진 mutex를 획득한 경우에도 호출 엔진은 저장 상태와 저널을 검증한다. [Microsoft mutex 문서](https://learn.microsoft.com/en-us/dotnet/standard/threading/mutexes)의 중단된 보유자 설명을 복구 성공 자체로 해석하지 않는다.

## 실제 실행한 검사

개발 경로 `G:/dev/ai/00_game_backseat-worktrees/installer-global-mutex`. 테스트용 객체 이름도 각 실행의 fixture 경로에 묶어 다른 worktree의 검사와 충돌하지 않게 했다.

- 수정 전: 실제 보유 중인 루트 잠금을 `Global\`에서 열 수 없었다. **231통과/1실패**, `artifacts/global-mutex-before-fix.log`, `installer-unit-2026-09-13T07-15-46-730Z/test.log`. 이전 소스는 `global-mutex-before-source/`에 보존했다.
- 수정 후: **엔진253통과/0실패**, `global-mutex-final-unit.log` 및 `latest-installer-unit-test.json`이 가리키는 실행 폴더의 원본 `test.log`/`result.json`. C# 컴파일과 실행 종료 코드를 모두 확인하고 소스의 실행 전후 해시를 비교했다.
- 실제 하위 프로세스로 Global 클라이언트, 접두사 없는 구버전 클라이언트, 새 RootMutex 클라이언트의 상호 배제를 확인했다. 다른 루트는 실행 가능했다. Local을 잡지 못한 자식이 Global을 버린 상태로 남기지 않았고, 실제 종료79 후 두 mutex를 다시 획득했다.
- 대소문자/끝 구분자, 반복 획득과 한 번의 해제, 잘못된 스레드의 해제, 잘못된 대기 시간을 검사했다. 실제 Global 객체의 ACL을 읽어 계정/SYSTEM 범위를 확인했고, 권한 거절과 event/mutex 이름 충돌에서는 우회하지 않았다.
- **앱301개 Node 검사 + TypeScript/Vite 통과**, `global-mutex-check.log`. Windows x64/GUI subsystem 배포 엔진16개 C# 소스 컴파일 성공, `global-mutex-engine/result.json`/`compiler-result.json`. 생성한 배포 엔진은 실행하지 않았다.

모든 시험 프로세스는 **현재 로그인 세션1**에서 실행했다. 실제 Global 이름 공간을 사용했으며 문자열만 검사한 mock은 아니다. 그러나 다른 Windows 계정·로그인/RDP 세션에서 실행한 수용 시험도 아니다. 관리자 권한 상승, 새 계정/세션, HKCU·Start Menu 변경, 사용자 앱 실행은 없었다. 기존 제거 실패·파일 보존 회귀 검사도253개에 포함된다.

## 남은 기준

같은 계정의 다른 로그인 세션, 다른 계정의 접근 거절, elevated/일반 프로세스 혼합을 실제 Windows 세션에서 확인해야 한다. **구버전이 다른 세션에서 Local 잠금만 잡고 있는 상태**를 새 코드가 소급하여 전역 잠금으로 바꿀 수는 없다. 기존 실행기를 재시작하지 않았으므로 현재 사용자 앱의 잠금이 교체됐다고 주장하지 않는다.

짧은 경로 별칭, junction/경로 교체 경쟁, 디스크 부족/전원 차단, 실제 NSIS 설치·제거·실행, 새 Windows, 서명·Steam 검토는 남아 있다. 이 구현으로 전체 출시 수용 기준을 충족했다고 판단하거나 NSIS 일반 배포 차단을 해제하지 않는다.
