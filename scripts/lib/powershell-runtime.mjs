import { statSync } from 'node:fs';
import { win32 } from 'node:path';
import { spawnSync } from 'node:child_process';

function queryHost(executable, command, run = spawnSync) {
  const result = run(
    executable,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 8192,
    },
  );
  if (result.error || result.status !== 0) {
    const error = new Error(
      `PowerShell 조회 실패 (${result.error?.code || result.status}): ${executable}. ${result.error?.message || result.stderr || result.status}. 정책 변경이나 다른 엔진 재시도를 하지 않았습니다.`,
      { cause: result.error },
    );
    error.code = result.error?.code;
    error.executable = executable;
    throw error;
  }
  return result.stdout.trim();
}

export function readPowerShellVersion(executable) {
  return queryHost(executable, '$PSVersionTable.PSVersion.ToString()');
}

export function readPowerShellPolicy(executable, run = spawnSync) {
  const output = queryHost(
    executable,
    '[pscustomobject]@{effective=(Get-ExecutionPolicy).ToString();scopes=@(Get-ExecutionPolicy -List | ForEach-Object { [pscustomobject]@{scope=$_.Scope.ToString();policy=$_.ExecutionPolicy.ToString()} })} | ConvertTo-Json -Depth 4 -Compress',
    run,
  );
  try {
    return JSON.parse(output);
  } catch (cause) {
    throw new Error(`PowerShell 정책 JSON을 읽을 수 없습니다: ${executable}`, { cause });
  }
}

// Read-only preflight; success does not replace signature/zone checks by -File.
export function preflightPowerShellRuntime({ policy = readPowerShellPolicy, ...options } = {}) {
  const runtime = selectPowerShellRuntime(options);
  const observed = policy(runtime.executable);
  if (
    !['Restricted', 'AllSigned', 'RemoteSigned', 'Unrestricted', 'Bypass'].includes(
      observed?.effective,
    ) ||
    !Array.isArray(observed.scopes) ||
    observed.scopes.length !== 5 ||
    new Set(observed.scopes.map((row) => row?.scope)).size !== 5 ||
    observed.scopes.some(
      (row) =>
        !['MachinePolicy', 'UserPolicy', 'Process', 'CurrentUser', 'LocalMachine'].includes(
          row?.scope,
        ) ||
        ![
          'Undefined',
          'Restricted',
          'AllSigned',
          'RemoteSigned',
          'Unrestricted',
          'Bypass',
        ].includes(row?.policy),
    )
  )
    throw new Error(`PowerShell 정책 조회 결과가 유효하지 않습니다: ${runtime.executable}`);
  if (observed.effective === 'Restricted')
    throw new Error(
      `PowerShell 파일 실행이 Restricted 정책으로 차단됩니다: ${runtime.executable} (${runtime.version}). scopes=${JSON.stringify(observed.scopes)}. 정책 변경이나 다른 엔진 재시도를 하지 않았습니다.`,
    );
  return { ...runtime, policy: observed };
}

// Resolve once, before executing a file script. Permission errors are not an
// absent candidate; a rejected host must never trigger another engine attempt.
export function selectPowerShellRuntime({
  env = process.env,
  stat = statSync,
  version = readPowerShellVersion,
} = {}) {
  const configured = env.NAGNEON_TEST_POWERSHELL;
  const candidates = configured
    ? [{ path: configured, source: 'configured-test-host' }]
    : [
        { path: win32.join(env.ProgramFiles || '', 'PowerShell/7/pwsh.exe'), source: 'standard' },
        {
          path: win32.join(env.LOCALAPPDATA || '', 'Microsoft/WindowsApps/pwsh.exe'),
          source: 'store',
        },
        {
          path: win32.join(env.SystemRoot || '', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          source: 'legacy',
        },
      ];
  for (const candidate of candidates) {
    const executable = candidate.path;
    if (
      !win32.isAbsolute(executable) ||
      !['pwsh.exe', 'powershell.exe'].includes(win32.basename(executable).toLowerCase())
    )
      throw new Error(
        `PowerShell 호스트는 pwsh.exe 또는 powershell.exe의 절대 경로여야 합니다: ${executable}`,
      );
    let info;
    try {
      info = stat(executable);
    } catch (cause) {
      if (!configured && ['ENOENT', 'ENOTDIR'].includes(cause.code)) continue;
      const error = new Error(
        `PowerShell 경로 확인 실패 (${cause.code || 'UNKNOWN'}): ${executable}. ` +
          '접근 거절은 런타임 없음으로 처리하지 않습니다. 정책 변경이나 다른 엔진 재시도를 하지 않았습니다.',
        { cause },
      );
      error.code = cause.code;
      error.executable = executable;
      throw error;
    }
    if (!info.isFile())
      throw new Error(`PowerShell 호스트가 일반 실행 파일이 아닙니다: ${executable}`);
    const observed = version(executable);
    const match = /^(\d+)\.(\d+)(?:\.\d+){0,2}$/.exec(observed);
    const supported =
      match &&
      (win32.basename(executable).toLowerCase() === 'pwsh.exe'
        ? Number(match[1]) >= 7
        : Number(match[1]) === 5 && Number(match[2]) === 1);
    if (!supported)
      throw new Error(
        `지원되지 않는 PowerShell 버전: ${executable} (${observed}). 다른 엔진으로 재시도하지 않았습니다.`,
      );
    return { executable, version: observed, source: candidate.source };
  }
  throw new Error(
    '지원 PowerShell 실행 파일을 찾지 못했습니다. 기존 검증된 호스트의 절대 경로를 NAGNEON_TEST_POWERSHELL에 검사 시작 전에 명시하세요.',
  );
}
