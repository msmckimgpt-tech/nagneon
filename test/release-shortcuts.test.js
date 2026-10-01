import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectPowerShellRuntime } from '../scripts/lib/powershell-runtime.mjs';

test(
  'Windows shortcuts preserve old links and follow the fixed launcher across releases',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    // Keep the tiny fixture as evidence; never touch the real Desktop or Start menu.
    await mkdir('artifacts/shortcut-tests', { recursive: true });
    const root = await mkdtemp(resolve('artifacts/shortcut-tests/run-'));
    const quote = (text) => "'" + text.replaceAll("'", "''") + "'";
    const script = `
$ErrorActionPreference = 'Stop'
. ${quote(resolve('scripts/Register-NagneonShortcut.ps1'))}
$root = ${quote(root)}
$install = Join-Path $root 'install with spaces'
New-Item -ItemType Directory -Path $install | Out-Null
[IO.File]::WriteAllText((Join-Path $install 'Start-Nagneon.cmd'), '@echo off')
$shell = New-Object -ComObject WScript.Shell
foreach ($surface in @('Desktop','Programs')) {
    $path = Join-Path (Join-Path $root $surface) 'Nagneon.lnk'
    New-Item -ItemType Directory -Path (Split-Path $path) | Out-Null
    $old = $shell.CreateShortcut($path)
    $old.TargetPath = Join-Path $root 'old-version/Nagneon.exe'
    $old.Arguments = '--nagneon-profile="old-profile"'
    $old.Save()
    $before = (Get-FileHash -LiteralPath $path).Hash
    $backup = Join-Path $root ($surface + '-old.lnk')
    Register-NagneonShortcut -LinkPath $path -BackupPath $backup -InstallRoot $install -Executable (Join-Path $install 'versions/0.1.11/Nagneon.exe')
    if ((Get-FileHash -LiteralPath $backup).Hash -ne $before) { throw 'Old shortcut bytes were lost.' }
    $link = $shell.CreateShortcut($path)
    if ($link.TargetPath -ne (Join-Path $install 'Start-Nagneon.cmd') -or $link.Arguments -ne '' -or $link.WorkingDirectory -ne $install) { throw 'Shortcut still selects the old app or profile.' }
    Register-NagneonShortcut -LinkPath $path -BackupPath (Join-Path $root ($surface + '-second.lnk')) -InstallRoot $install -Executable (Join-Path $install 'versions/0.1.12/Nagneon.exe')
    $link = $shell.CreateShortcut($path)
    if ($link.TargetPath -ne (Join-Path $install 'Start-Nagneon.cmd') -or $link.Arguments -ne '' -or -not $link.IconLocation.Contains('0.1.12')) { throw 'Next release changed the stable target or kept the old icon.' }
    $current = (Get-FileHash -LiteralPath $path).Hash
    $rejected = $false
    try { Register-NagneonShortcut -LinkPath $path -BackupPath $backup -InstallRoot $install -Executable 'unused.exe' } catch { $rejected = $true }
    if (-not $rejected -or (Get-FileHash -LiteralPath $path).Hash -ne $current -or (Get-FileHash -LiteralPath $backup).Hash -ne $before) { throw 'Existing backup must not be overwritten.' }
}
$fresh = Join-Path $root 'fresh/Programs/Nagneon.lnk'
Register-NagneonShortcut -LinkPath $fresh -BackupPath (Join-Path $root 'fresh-backup.lnk') -InstallRoot $install -Executable (Join-Path $install 'Nagneon.exe')
if (-not (Test-Path -LiteralPath $fresh) -or (Test-Path -LiteralPath (Join-Path $root 'fresh-backup.lnk'))) { throw 'Fresh shortcut registration failed.' }
Write-Output 'Shortcut fixture passed.'
`;
    const scriptPath = join(root, 'verify.ps1');
    await writeFile(scriptPath, script);
    const runtime = selectPowerShellRuntime();
    console.log('Shortcut fixture host:', JSON.stringify(runtime));
    const result = spawnSync(
      runtime.executable,
      ['-NoProfile', '-NonInteractive', '-File', scriptPath],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
      },
    );
    await writeFile(
      join(root, 'result.json'),
      JSON.stringify(
        {
          runtime,
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
          error: result.error?.message,
        },
        null,
        2,
      ),
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /Shortcut fixture passed/);
  },
);
