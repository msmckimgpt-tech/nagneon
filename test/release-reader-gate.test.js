import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createPackageWithOptions, getRawHeader } from '@electron/asar';
import { writePackageCapabilities } from '../scripts/lib/package-capabilities.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const standard = join(process.env.ProgramFiles || '', 'PowerShell/7/pwsh.exe');
const engine = process.env.NAGNEON_TEST_POWERSHELL || (existsSync(standard) ? standard : 'powershell.exe');
async function snapshot(folder) {
  const rows = [];
  async function visit(path, prefix = '') {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await visit(join(path, entry.name), relative + '/');
      else rows.push([relative, sha(await readFile(join(path, entry.name)))]);
    }
  }
  await visit(folder);
  return rows.sort((a,b) => a[0].localeCompare(b[0]));
}
test('native update checks actual same-version reader before switching, and rolls back failed entrypoint writes', { skip: process.platform !== 'win32' }, async t => {
  await mkdir('artifacts/release-reader-tests', { recursive: true });
  const root = await mkdtemp(resolve('artifacts/release-reader-tests/run-'));
  const cs = join(root, 'Fixture.cs'), exe = join(root, 'Nagneon.exe');
  await writeFile(cs, `using System.Reflection;
[assembly: AssemblyVersion("0.1.18.0")]
[assembly: AssemblyFileVersion("0.1.18.0")]
[assembly: AssemblyInformationalVersion("0.1.18")]
class Fixture { static int Main() { return 73; } }
`);
  const compiler = spawnSync(join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', '/target:exe', '/platform:x64', `/out:${exe}`, cs], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  await writeFile(join(root, 'compiler.json'), JSON.stringify({ status: compiler.status, stdout: compiler.stdout, stderr: compiler.stderr, error: compiler.error?.message }));
  assert.equal(compiler.status, 0, compiler.stdout + compiler.stderr);
  const fourExe = join(root, 'Nagneon-four.exe');
  await writeFile(cs, (await readFile(cs, 'utf8')).replace('AssemblyInformationalVersion("0.1.18")', 'AssemblyInformationalVersion("0.1.18.0")'));
  const fourCompiler = spawnSync(join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', '/target:exe', '/platform:x64', `/out:${fourExe}`, cs], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(fourCompiler.status, 0, fourCompiler.stdout + fourCompiler.stderr);
  const runner = join(root, 'run.ps1');
  await writeFile(runner, `param([string]$Installer,[string]$FixtureRoot,[string]$Scenario,[string]$Version)
$ErrorActionPreference='Stop'
$env:APPDATA=Join-Path $FixtureRoot 'roaming'
$env:LOCALAPPDATA=Join-Path $FixtureRoot 'local'
$fixtureInstall=Join-Path $FixtureRoot 'install'
$fixturePackage=Join-Path $FixtureRoot 'package'
$fixtureProfile=Join-Path $FixtureRoot 'profile'
$script:fixtureCopied=$false
$script:fixtureEntrypoint=$false
$script:fixturePointerLock=$null
$script:fixtureRestoreLock=$null
function Copy-Item {
    [CmdletBinding()]
    param([Parameter(ValueFromPipeline=$true)][object]$InputObject,[string[]]$LiteralPath,[string]$Destination,[switch]$Recurse,[switch]$Force)
    process {
        if ($PSBoundParameters.ContainsKey('InputObject')) {
            Microsoft.PowerShell.Management\\Copy-Item -LiteralPath $InputObject.FullName -Destination $Destination -Recurse:$Recurse -Force:$Force
            if ($Destination -like ($fixtureInstall+'\\versions\\*')) {
                $script:fixtureCopied=$true
                if ($Scenario -eq 'destination-tamper' -and [IO.Directory]::Exists((Join-Path $Destination 'resources'))) { [IO.File]::WriteAllText((Join-Path $Destination 'resources/app.asar'),'changed after copy') }
                if ($Scenario -eq 'source-tamper') { [IO.File]::WriteAllText((Join-Path $fixturePackage 'Nagneon.exe'),'changed after approval') }
                if ($Scenario -eq 'destination-extra') { [IO.File]::WriteAllText((Join-Path $Destination 'extra.txt'),'unapproved') }
            }
        } else {
            Microsoft.PowerShell.Management\\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Recurse:$Recurse -Force:$Force
            if ($Destination -eq (Join-Path $fixtureInstall 'Profile-Compatibility.ps1')) {
                $script:fixtureEntrypoint=$true
                if ($Scenario -eq 'late-profile-change') { [IO.File]::WriteAllText((Join-Path $fixtureProfile 'data/world.json'),'concurrent writer fixture') }
                if ($Scenario -eq 'entrypoint-write-failure') { throw 'Synthetic entrypoint write failure' }
                if ($Scenario -eq 'late-package-change') { [IO.File]::WriteAllText((Join-Path $fixturePackage 'resources/app.asar'),'late package change') }
                if ($Scenario -eq 'pointer-write-failure') { $script:fixturePointerLock=[IO.File]::OpenRead((Join-Path $fixtureInstall 'current.json')) }
                if ($Scenario -eq 'restore-target-locked') {
                    $script:fixtureRestoreLock=[IO.File]::OpenRead((Join-Path $fixtureInstall 'Start-InstalledNagneon.ps1'))
                    throw 'Synthetic rollback failure'
                }
            }
        }
    }
}
$rejected=$false;$message=''
try { . $Installer -PackageFolder $fixturePackage -Version $Version -InstallRoot $fixtureInstall -Profile $fixtureProfile | Out-Null }
catch { $rejected=$true; $message=$_.Exception.Message }
finally { if ($script:fixturePointerLock) { $script:fixturePointerLock.Dispose() }; if ($script:fixtureRestoreLock) { $script:fixtureRestoreLock.Dispose() } }
[IO.File]::WriteAllText((Join-Path $FixtureRoot 'observation.json'),([pscustomobject]@{rejected=$rejected;message=$message;copied=$script:fixtureCopied;entrypoint=$script:fixtureEntrypoint} | ConvertTo-Json))
`);
  const scenarios = [
    ['reader5-marker4', null], ['reader5-marker5', null], ['four-component-pe', null], ['reader4-marker5', /requires reader 5/],
    ['future-reader', /requires reader 6/], ['future-version', /0\.1\.19/], ['unmarked', null],
    ['missing-receipt', /capability is missing/], ['missing-embedded', /entry is missing/],
    ['lying-reader', /differs from its embedded/], ['wrong-version', /versions differ/],
    ['bad-schema', /Invalid package/], ['string-reader', /reader number/],
    ['marker-array', /JSON object/], ['marker-string-reader', /reader number/], ['marker-fraction', /reader number/],
    ['marker-directory', /format marker/], ['marker-invalid-version', /application version/],
    ['asar-tamper', /hash mismatch/], ['exe-tamper', /hash mismatch/], ['asar-offset', /capability bounds/],
    ['asar-unpacked', /packed/], ['source-tamper', /changed/], ['destination-tamper', /changed/], ['destination-extra', /changed/],
    ['late-package-change', /changed/], ['late-profile-change', /changed/], ['entrypoint-write-failure', /entrypoint write failure/],
    ['pointer-write-failure', /used by another process|being used|cannot access/i],
    ['restore-target-locked', /Synthetic rollback failure.*Unrestored entrypoints/],
  ];
  for (const [scenario, error] of scenarios) await t.test(scenario, async () => {
    const folder = join(root, scenario + ' 한글 ! &');
    const pack = join(folder, 'package'), app = join(folder, 'source'), install = join(folder, 'install'), profile = join(folder, 'profile');
    await mkdir(join(pack, 'resources'), { recursive: true });
    await mkdir(join(app, 'shared'), { recursive: true });
    await mkdir(install, { recursive: true });
    await mkdir(join(profile, 'data/nested'), { recursive: true });
    await copyFile(scenario === 'four-component-pe' ? fourExe : exe, join(pack, 'Nagneon.exe'));
    await writeFile(join(app, 'package.json'), JSON.stringify({ version: '0.1.18' }));
    if (scenario !== 'missing-embedded') await writeFile(join(app, 'shared/profile-reader.json'), JSON.stringify({ schema: 'nagneon.profile-reader/1', reader: scenario === 'reader4-marker5' || scenario === 'lying-reader' ? 4 : 5 }));
    await createPackageWithOptions(app, join(pack, 'resources/app.asar'), scenario === 'asar-unpacked' ? { unpackDir: 'shared' } : {});
    if (scenario === 'asar-unpacked') assert.equal(getRawHeader(join(pack, 'resources/app.asar')).header.files.shared.files['profile-reader.json'].unpacked, true);
    let capability;
    if (!['missing-embedded','asar-unpacked'].includes(scenario)) capability = await writePackageCapabilities(pack);
    else capability = { schema: 'nagneon.package-capabilities/1', appVersion: '0.1.18', profileReader: 5,
      exeSha256: sha(await readFile(join(pack, 'Nagneon.exe'))), asarSha256: sha(await readFile(join(pack, 'resources/app.asar'))) };
    if (scenario === 'lying-reader') capability.profileReader = 5;
    if (scenario === 'bad-schema') capability.schema = 'unknown';
    if (scenario === 'string-reader') capability.profileReader = '5';
    if (scenario === 'asar-offset') {
      const archive = await readFile(join(pack, 'resources/app.asar'));
      const headerLength = archive.readUInt32LE(12), header = JSON.parse(archive.subarray(16, 16 + headerLength).toString());
      header.files.shared.files['profile-reader.json'].offset = '9999999999999999999';
      const json = Buffer.from(JSON.stringify(header)), padded = Math.ceil(json.length / 4) * 4;
      const next = Buffer.alloc(16 + padded);
      next.writeUInt32LE(4,0);next.writeUInt32LE(8+padded,4);next.writeUInt32LE(4+padded,8);next.writeUInt32LE(json.length,12);json.copy(next,16);
      await writeFile(join(pack, 'resources/app.asar'), Buffer.concat([next,archive.subarray(8+archive.readUInt32LE(4))]));
      capability.asarSha256 = sha(await readFile(join(pack, 'resources/app.asar')));
    }
    await writeFile(join(pack, 'nagneon-package.json'), JSON.stringify(capability));
    if (scenario === 'missing-receipt') await unlink(join(pack, 'nagneon-package.json'));
    if (scenario === 'asar-tamper') await writeFile(join(pack, 'resources/app.asar'), 'changed archive');
    if (scenario === 'exe-tamper') await writeFile(join(pack, 'Nagneon.exe'), 'changed executable');
    await writeFile(join(profile, 'data/world.json'), '{"fixture":"방송 기록과 관객 메모","points":137}');
    await writeFile(join(profile, 'data/nested/journal.json'), JSON.stringify({ fixtureOriginal: '말'.repeat(4000) }));
    let marker = { minReader: scenario === 'reader5-marker4' ? 4 : scenario === 'future-reader' ? 6 : 5, minAppVersion: scenario === 'future-version' ? '0.1.19' : '0.1.18' };
    if (scenario === 'marker-array') marker = [marker];
    if (scenario === 'marker-string-reader') marker.minReader = '5';
    if (scenario === 'marker-fraction') marker.minReader = 5.5;
    if (scenario === 'marker-invalid-version') marker.minAppVersion = '0.1.18junk';
    if (scenario === 'marker-directory') await mkdir(join(profile, 'data/profile-format.json'));
    else if (scenario !== 'unmarked') await writeFile(join(profile, 'data/profile-format.json'), JSON.stringify(marker));
    const initialPointer = JSON.stringify({ version: '0.1.18', executable: 'versions/old/Nagneon.exe', exeSha256: '0'.repeat(64), profile });
    await writeFile(join(install, 'current.json'), initialPointer);
    const oldHelpers = {};
    for (const name of ['Start-Nagneon.cmd','Start-InstalledNagneon.ps1','Profile-Compatibility.ps1','Package-Capabilities.ps1']) {
      oldHelpers[name] = `old helper fixture ${name}`;
      await writeFile(join(install, name), oldHelpers[name]);
    }
    const before = await snapshot(join(profile, 'data'));
    const result = spawnSync(engine, ['-NoLogo','-NoProfile','-NonInteractive','-File',runner,'-Installer',resolve('scripts/Install-NagneonRelease.ps1'),
      '-FixtureRoot',folder,'-Scenario',scenario,'-Version',scenario === 'wrong-version' ? '0.1.19' : '0.1.18'], { encoding: 'utf8', windowsHide: true, timeout: 45000 });
    await writeFile(join(folder, 'process-result.json'), JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }, null, 2));
    assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message || ''));
    const observed = JSON.parse(await readFile(join(folder, 'observation.json'), 'utf8'));
    if (error) {
      assert.equal(observed.rejected, true, JSON.stringify(observed));
      assert.match(observed.message, error);
      assert.equal(await readFile(join(install, 'current.json'), 'utf8'), initialPointer);
      for (const [name, bytes] of Object.entries(oldHelpers)) {
        if (scenario === 'restore-target-locked' && name === 'Start-InstalledNagneon.ps1') {
          assert.match(observed.message, /Start-InstalledNagneon\.ps1/);
          assert.notEqual(await readFile(join(install, name), 'utf8'), bytes, 'Locked target unexpectedly claimed recovery.');
        } else assert.equal(await readFile(join(install, name), 'utf8'), bytes, name);
      }
      if (!scenario.includes('tamper') && !scenario.includes('extra') && !scenario.startsWith('late-') && !['entrypoint-write-failure','pointer-write-failure','restore-target-locked'].includes(scenario))
        assert.equal(existsSync(join(install, 'backups')), false, 'Preflight failure made a backup or copied candidate.');
    } else {
      assert.equal(observed.rejected, false, observed.message);
      const pointer = JSON.parse(await readFile(join(install, 'current.json'), 'utf8'));
      assert.equal(pointer.packageCapabilitySha256, sha(await readFile(join(dirname(join(install, pointer.executable)), 'nagneon-package.json'))));
      assert.equal(pointer.asarSha256, capability.asarSha256);
      // -Inspect must validate identity and compatibility without executing the fixture PE (exit73).
      const inspect = () => spawnSync(engine, ['-NoProfile','-NonInteractive','-File',join(install, 'Start-InstalledNagneon.ps1'),'-InstallRoot',install,'-Inspect'],
        { encoding: 'utf8', windowsHide: true, timeout: 45000, env: { ...process.env, APPDATA: join(folder, 'roaming'), LOCALAPPDATA: join(folder, 'local') } });
      // Recovery launcher resolves the selected registered path; registration is isolated to the fixture.
      await mkdir(join(folder, 'roaming/Nagneon'), { recursive: true });
      await writeFile(join(folder, 'roaming/Nagneon/storage.json'), JSON.stringify({ profile }));
      const inspected = inspect();
      assert.equal(inspected.status, 0, inspected.stdout + inspected.stderr);
      assert.equal(JSON.parse(inspected.stdout).profile.replaceAll('\\','/'), profile.replaceAll('\\','/'));
      if (scenario === 'reader5-marker5') {
        await writeFile(join(profile, 'data/profile-format.json'), JSON.stringify({ minReader: 6, minAppVersion: '0.1.18' }));
        assert.equal(inspect().status, 1);
        await writeFile(join(profile, 'data/profile-format.json'), JSON.stringify(marker));
        const copiedArchive = join(dirname(join(install, pointer.executable)), 'resources/app.asar');
        await writeFile(copiedArchive, 'tampered after installation');
        assert.equal(inspect().status, 1);
      }
    }
    if (scenario === 'late-profile-change') {
      // This writer belongs to the scenario, not the installer. Other profile bytes stay identical.
      assert.equal(await readFile(join(profile, 'data/world.json'), 'utf8'), 'concurrent writer fixture');
      assert.deepEqual((await snapshot(join(profile, 'data'))).filter(([name]) => name !== 'world.json'), before.filter(([name]) => name !== 'world.json'));
    } else assert.deepEqual(await snapshot(join(profile, 'data')), before);
  });
});
