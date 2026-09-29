import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, readFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('stable launchers never change script policy or search the current directory for a runtime', async () => {
  for (const file of ['Start-Nagneon.cmd', 'scripts/Launcher-Command.ps1', 'scripts/Install-NagneonRelease.ps1']) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /ExecutionPolicy|Set-ExecutionPolicy|Unblock-File|EncodedCommand/i, file);
  }
  const installer = await readFile('scripts/Install-NagneonRelease.ps1', 'utf8');
  assert.match(installer, /Get-NagneonLauncherCommand -Installed/);
});

test('real CMD entrypoints select once, quote paths and preserve failures without retry', {
  skip: process.platform !== 'win32',
}, async () => {
  await mkdir('artifacts/launcher-command-tests', { recursive: true });
  const root = await mkdtemp(resolve('artifacts/launcher-command-tests/run-'));
  const script = join(root, 'generate.ps1');
  await writeFile(script, `param([string]$Helper,[string]$Output)
$ErrorActionPreference = 'Stop'
. $Helper
[IO.File]::WriteAllText((Join-Path $Output 'repository.cmd'), (Get-NagneonLauncherCommand), [Text.Encoding]::ASCII)
[IO.File]::WriteAllText((Join-Path $Output 'installed.cmd'), (Get-NagneonLauncherCommand -Installed), [Text.Encoding]::ASCII)
`);
  const standard = join(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe');
  const store = join(process.env.LOCALAPPDATA, 'Microsoft/WindowsApps/pwsh.exe');
  const legacy = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  // Packaged development hosts can see a redirected WindowsApps directory.
  // An explicitly configured test host avoids conflating that view with the
  // native launcher. Never retry a rejected script with another engine.
  const engine = process.env.NAGNEON_TEST_POWERSHELL ||
    (existsSync(standard) ? standard : existsSync(store) ? store : legacy);
  const generated = spawnSync(engine, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script,
    '-Helper', resolve('scripts/Launcher-Command.ps1'), '-Output', root], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(generated.status, 0, generated.stderr || generated.error?.message);
  assert.equal((await readFile(join(root, 'repository.cmd'), 'utf8')).replaceAll('\r\n', '\n'),
    (await readFile('Start-Nagneon.cmd', 'utf8')).replaceAll('\r\n', '\n'));

  // An executable fixture records actual Windows argument parsing and selection.
  // It cannot execute PowerShell, launch the app or access a real profile.
  const source = join(root, 'Recorder.cs');
  const recorder = join(root, 'recorder.exe');
  await writeFile(source, `using System; using System.IO; using System.Reflection; using System.Text;
class Recorder {
  static int Main(string[] args) {
    var values = new string[args.Length + 1];
    values[0] = Assembly.GetExecutingAssembly().Location;
    Array.Copy(args, 0, values, 1, args.Length);
    for (int i = 0; i < values.Length; i++) values[i] = Convert.ToBase64String(Encoding.UTF8.GetBytes(values[i]));
    File.AppendAllText(Environment.GetEnvironmentVariable("NAGNEON_FIXTURE_OUTPUT"), String.Join(",", values) + "\\n");
    return int.Parse(Environment.GetEnvironmentVariable("NAGNEON_FIXTURE_EXIT"));
  }
}`);
  const compiler = join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const compiled = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64',
    `/out:${recorder}`, source], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const observations = [];
  for (const installed of [false, true]) {
    for (const variant of ['standard', 'store', 'legacy', 'failure']) {
      const home = join(root, `${installed ? 'installed' : 'repository'} ${variant} ! & 한글`);
      const paths = {
        standard: join(home, 'program files/PowerShell/7/pwsh.exe'),
        store: join(home, 'local/Microsoft/WindowsApps/pwsh.exe'),
        legacy: join(home, 'windows/System32/WindowsPowerShell/v1.0/powershell.exe'),
      };
      const available = variant === 'standard' || variant === 'failure'
        ? ['standard', 'store', 'legacy'] : variant === 'store' ? ['store', 'legacy'] : ['legacy'];
      for (const key of available) {
        await mkdir(dirname(paths[key]), { recursive: true });
        await copyFile(recorder, paths[key]);
      }
      const entry = join(home, 'Start-Nagneon.cmd');
      await copyFile(join(root, installed ? 'installed.cmd' : 'repository.cmd'), entry);
      const output = join(home, 'calls.jsonl');
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !['programfiles', 'localappdata', 'systemroot'].includes(key.toLowerCase())));
      Object.assign(env, {
        ProgramFiles: join(home, 'program files'), LOCALAPPDATA: join(home, 'local'),
        SystemRoot: join(home, 'windows'), NAGNEON_FIXTURE_OUTPUT: output,
        NAGNEON_FIXTURE_EXIT: variant === 'failure' ? '37' : '0',
      });
      // Windows reconstructs ProgramFiles when starting cmd.exe. Set the
      // synthetic directories inside the owning CMD, before calling the entry.
      const driver = join(home, 'fixture-driver.cmd');
      await writeFile(driver, ['@echo off', 'setlocal DisableDelayedExpansion',
        'set "ProgramFiles=%~dp0program files"',
        'set "LOCALAPPDATA=%~dp0local"',
        'set "SystemRoot=%~dp0windows"',
        'call "%~dp0Start-Nagneon.cmd"', 'exit /b %errorlevel%', ''].join('\r\n'), 'ascii');
      const run = spawnSync(join(process.env.SystemRoot, 'System32/cmd.exe'),
        ['/d', '/s', '/c', `""${driver}""`], {
          encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true,
          timeout: 10000, input: '\r\n', env,
        });
      await writeFile(join(home, 'process.json'), JSON.stringify({ status: run.status,
        stdout: run.stdout, stderr: run.stderr, error: run.error?.message }, null, 2));
      assert.equal(run.status, variant === 'failure' ? 37 : 0, run.stdout + run.stderr || run.error?.message);
      const calls = (await readFile(output, 'utf8')).trim().split('\n').map(line => {
        const [executable, ...args] = line.split(',').map(value => Buffer.from(value, 'base64').toString('utf8'));
        return { executable, args };
      });
      observations.push({ installed, variant, status: run.status, calls });
      assert.equal(calls.length, 1, 'A failed engine must never invoke another runtime');
      assert.equal(calls[0].executable, paths[variant === 'failure' ? 'standard' : variant]);
      assert.deepEqual(calls[0].args, ['-NoLogo', '-NoProfile', '-File',
        join(home, installed ? 'Start-InstalledNagneon.ps1' : 'scripts/Start-InstalledNagneon.ps1'),
        ...(installed ? ['-InstallRoot', home + '\\.'] : [])]);
    }
  }
  await writeFile(join(root, 'result.json'), JSON.stringify({ passed: true, engine, observations }, null, 2));
});
