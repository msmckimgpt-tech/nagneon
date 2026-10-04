import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createPackage } from '@electron/asar';
import { writePackageCapabilities } from '../scripts/lib/package-capabilities.mjs';

test('Windows fixed installer validates a complete immutable backup before advancing its pointer', {
  skip: process.platform !== 'win32',
}, async t => {
  await mkdir('artifacts/release-backup-tests', { recursive: true });
  const root = await mkdtemp(resolve('artifacts/release-backup-tests/run-'));
  const source = join(root, 'Fixture.cs'), executable = join(root, 'Nagneon.exe');
  await writeFile(source, `using System.Reflection;
[assembly: AssemblyVersion("0.1.18.0")]
[assembly: AssemblyFileVersion("0.1.18.0")]
[assembly: AssemblyInformationalVersion("0.1.18")]
class Fixture { static int Main() { return 0; } }
`);
  const compiled = spawnSync(join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', '/target:exe', '/platform:x64', `/out:${executable}`, source],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  await writeFile(join(root, 'compiler-result.json'), JSON.stringify({ status: compiled.status, stdout: compiled.stdout, stderr: compiled.stderr, error: compiled.error?.message }, null, 2));
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);

  const runner = join(root, 'verify.ps1');
  await writeFile(runner, `param([string]$Installer,[string]$FixtureRoot,[string]$Scenario)
$ErrorActionPreference = 'Stop'
$env:APPDATA = Join-Path $FixtureRoot 'roaming'
$env:LOCALAPPDATA = Join-Path $FixtureRoot 'local'
$fixturePackage = Join-Path $FixtureRoot 'package'
$fixtureInstall = Join-Path $FixtureRoot 'install'
$fixtureProfile = Join-Path $FixtureRoot 'profile'
$fixtureData = Join-Path $fixtureProfile 'data'
if ($Scenario -eq 'invalid-root') { $fixtureInstall = Join-Path $fixtureData 'nested/install' }
$fixturePointer = Join-Path $fixtureInstall 'current.json'
if (Test-Path -LiteralPath (Join-Path $fixtureData 'hidden/secret.json')) {
    [IO.File]::SetAttributes((Join-Path $fixtureData 'hidden/secret.json'), [IO.FileAttributes]::Hidden)
    [IO.File]::SetAttributes((Join-Path $fixtureData 'hidden'), [IO.FileAttributes]::Hidden)
}
if ($Scenario -eq 'linked-data') {
    $fixtureTarget=Join-Path $FixtureRoot 'link-target'
    [IO.Directory]::CreateDirectory($fixtureTarget) | Out-Null
    [IO.File]::WriteAllText((Join-Path $fixtureTarget 'outside.json'),'isolated fixture target')
    New-Item -ItemType Junction -Path (Join-Path $fixtureData 'linked') -Target $fixtureTarget | Out-Null
}
$script:fixtureCopyDone = $false
$script:fixtureMutationDone = $false
function Copy-Item {
    [CmdletBinding()]
    param([Parameter(ValueFromPipeline=$true)][object]$InputObject,[string[]]$LiteralPath,[string]$Destination,[switch]$Recurse,[switch]$Force)
    process {
        if ($PSBoundParameters.ContainsKey('InputObject')) {
            Microsoft.PowerShell.Management\\Copy-Item -LiteralPath $InputObject.FullName -Destination $Destination -Recurse:$Recurse -Force:$Force
        } else {
            Microsoft.PowerShell.Management\\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Recurse:$Recurse -Force:$Force
        }
        if ($LiteralPath -and $LiteralPath[0] -eq $fixtureData -and -not $script:fixtureCopyDone) {
            $script:fixtureCopyDone = $true
            switch ($Scenario) {
                'source-delete' { [IO.File]::Delete((Join-Path $fixtureData 'world.json')); $script:fixtureMutationDone=$true }
                'source-add' { [IO.File]::WriteAllText((Join-Path $fixtureData 'added.json'),'new'); $script:fixtureMutationDone=$true }
                'source-change' { [IO.File]::WriteAllText((Join-Path $fixtureData 'world.json'),'changed'); $script:fixtureMutationDone=$true }
                'source-directory-delete' { [IO.Directory]::Delete((Join-Path $fixtureData 'empty')); $script:fixtureMutationDone=$true }
                'backup-add' { [IO.File]::WriteAllText((Join-Path $Destination 'added.json'),'extra'); $script:fixtureMutationDone=$true }
                'backup-directory-add' { [IO.Directory]::CreateDirectory((Join-Path $Destination 'added-directory')) | Out-Null; $script:fixtureMutationDone=$true }
                'backup-change' { [IO.File]::WriteAllText((Join-Path $Destination 'world.json'),'changed backup'); $script:fixtureMutationDone=$true }
            }
        }
        if ($LiteralPath -and $LiteralPath[0] -eq $fixturePointer -and $script:fixtureCopyDone -and -not $script:fixtureMutationDone) {
            switch ($Scenario) {
                'source-late-delete' { [IO.File]::Delete((Join-Path $fixtureData 'world.json')); $script:fixtureMutationDone=$true }
                'source-late-add' { [IO.File]::WriteAllText((Join-Path $fixtureData 'late.json'),'late'); $script:fixtureMutationDone=$true }
            }
        }
    }
}
$fixtureRejected=$false
$fixtureMessage=''
try { . $Installer -PackageFolder $fixturePackage -Version '0.1.18' -InstallRoot $fixtureInstall -Profile $fixtureProfile | Out-Null }
catch { $fixtureRejected=$true; $fixtureMessage=$_.Exception.Message }
[IO.File]::WriteAllText((Join-Path $FixtureRoot 'observation.json'), ([pscustomobject]@{rejected=$fixtureRejected;message=$fixtureMessage;copied=$script:fixtureCopyDone;mutation=$script:fixtureMutationDone} | ConvertTo-Json))
`);
  const standard = join(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe');
  const legacy = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const engine = process.env.NAGNEON_TEST_POWERSHELL || (existsSync(standard) ? standard : legacy);
  const invoke = (folder, scenario) => spawnSync(engine,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', runner,
      '-Installer', resolve('scripts/Install-NagneonRelease.ps1'), '-FixtureRoot', folder, '-Scenario', scenario],
    { encoding: 'utf8', windowsHide: true, timeout: 45000 });
  const names = ['stable', 'empty', 'source-delete', 'source-add', 'source-change', 'source-directory-delete',
    'backup-add', 'backup-directory-add', 'backup-change', 'source-late-delete', 'source-late-add', 'invalid-root', 'linked-data'];
  for (const scenario of names) await t.test(scenario, async () => {
    const folder = join(root, scenario + ' 한글 ! &');
    const profile = join(folder, 'profile'), data = join(profile, 'data');
    const install = scenario === 'invalid-root' ? join(data, 'nested/install') : join(folder, 'install');
    const pack = join(folder, 'package');
    for (const dir of [join(pack, 'resources'), install, join(data, 'nested'), join(data, 'empty'), join(data, 'hidden')]) {
      await mkdir(dir, { recursive: true });
    }
    await copyFile(executable, join(pack, 'Nagneon.exe'));
    const app = join(folder, 'synthetic-app');
    await mkdir(join(app, 'shared'), { recursive: true });
    await writeFile(join(app, 'package.json'), JSON.stringify({ version: '0.1.18' }));
    await writeFile(join(app, 'shared/profile-reader.json'), JSON.stringify({ schema: 'nagneon.profile-reader/1', reader: 5 }));
    await createPackage(app, join(pack, 'resources/app.asar'));
    await writePackageCapabilities(pack);
    const originalArchive = await readFile(join(pack, 'resources/app.asar'));
    if (scenario !== 'empty') {
      await writeFile(join(data, 'world.json'), '{"fixture":"방송 기록"}');
      await writeFile(join(data, 'nested/notes.txt'), '별명과 관계 기억');
      await writeFile(join(data, 'hidden/secret.json'), '{"fixture":"hidden"}');
    }
    const initialPointer = JSON.stringify({ version: '0.1.17', executable: 'versions/old/Nagneon.exe', profile, exeSha256: '0'.repeat(64) });
    await writeFile(join(install, 'current.json'), initialPointer);
    await writeFile(join(install, 'Start-Nagneon.cmd'), 'old fixture launcher');
    const result = invoke(folder, scenario);
    await writeFile(join(folder, 'process-result.json'), JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }, null, 2));
    assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message || ''));
    const observation = JSON.parse(await readFile(join(folder, 'observation.json'), 'utf8'));
    if (scenario === 'invalid-root' || scenario === 'linked-data') {
      assert.equal(observation.copied, false, 'Unsafe profile reached recursive backup.');
      assert.equal(observation.rejected, true, 'Unsafe profile was accepted.');
      assert.match(observation.message, scenario === 'invalid-root' ? /outside profile data/ : /Profile links/);
      assert.equal(await readFile(join(install, 'current.json'), 'utf8'), initialPointer);
      assert.equal(await readFile(join(data, 'world.json'), 'utf8'), '{"fixture":"방송 기록"}');
      assert.equal(existsSync(join(install, 'backups')), false);
      return;
    }
    assert.equal(observation.copied, true, observation.message);
    if (scenario === 'stable' || scenario === 'empty') {
      assert.equal(observation.rejected, false, observation.message);
      const previousPointerBytes = await readFile(join(install, 'current.json'), 'utf8');
      const pointer = JSON.parse(previousPointerBytes);
      assert.equal(pointer.version, '0.1.18');
      assert.equal(pointer.profile.replaceAll('\\', '/'), profile.replaceAll('\\', '/'));
      for (const name of scenario === 'empty' ? [] : ['world.json', 'nested/notes.txt', 'hidden/secret.json']) {
        assert.equal(await readFile(join(pointer.backup, 'data', name), 'utf8'), await readFile(join(data, name), 'utf8'));
      }
      assert.deepEqual(await readdir(join(pointer.backup, 'data/empty')), []);
      const inventory = JSON.parse(await readFile(join(pointer.backup, 'profile-inventory.json'), 'utf8'));
      assert.equal(inventory.files.length, scenario === 'empty' ? 0 : 3);
      assert.deepEqual(inventory.directories, ['empty', 'hidden', 'nested']);
      assert.deepEqual(await readFile(join(dirname(join(install, pointer.executable)), 'resources/app.asar')), originalArchive);
      // A second real invocation must release its previous update lock and preserve the same data.
      const next = invoke(folder, scenario);
      assert.equal(next.status, 0, next.stdout + next.stderr);
      const nextObservation = JSON.parse(await readFile(join(folder, 'observation.json'), 'utf8'));
      assert.equal(nextObservation.rejected, false, nextObservation.message);
      const nextPointer = JSON.parse(await readFile(join(install, 'current.json'), 'utf8'));
      assert.notEqual(nextPointer.backup, pointer.backup);
      assert.equal(await readFile(join(nextPointer.backup, 'current.json'), 'utf8'), previousPointerBytes);
    } else {
      assert.equal(observation.mutation, true, 'The intended mutation did not execute.');
      assert.equal(observation.rejected, true, `Accepted ${scenario} during backup`);
      assert.match(observation.message, /Profile .*changed|Profile .*mismatch|cannot find|Cannot find|does not exist/i);
      assert.equal(await readFile(join(install, 'current.json'), 'utf8'), initialPointer, 'Failed update advanced its pointer.');
    }
  });
});
