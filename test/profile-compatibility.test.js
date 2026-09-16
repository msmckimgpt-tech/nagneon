import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('missing native profile restores the unique redirected copy and preserves both existing profiles and ambiguous sources', {skip:process.platform!=='win32'}, async()=>{
  await mkdir('artifacts',{recursive:true});
  const folder=await mkdtemp(resolve('artifacts/auto-profile-recovery-'));
  const appData=join(folder,'Roaming'),profile=join(appData,'backseat-studio'),packages=join(folder,'Packages');
  const source=join(packages,'Agent/LocalCache/Roaming/backseat-studio/data');
  await mkdir(source,{recursive:true});
  const raw=JSON.stringify({settings:{title:'retained'},points:103});
  await writeFile(join(source,'world.json'),raw);await writeFile(join(source,'history.json'),'["retained"]');
  const runner=join(folder,'recover.ps1');
  await writeFile(runner,`param([string]$Helper,[string]$Profile,[string]$AppData,[string]$Packages)\n$ErrorActionPreference='Stop'\n. $Helper\nRestore-NagneonRedirectedProfile -Profile $Profile -AppData $AppData -Packages $Packages -NonInteractive\n`);
  const invoke=()=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',runner,'-Helper',resolve('scripts/Profile-Compatibility.ps1'),'-Profile',profile,'-AppData',appData,'-Packages',packages],{encoding:'utf8',windowsHide:true});
  let result=invoke();assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/True/);
  assert.equal(await readFile(join(profile,'data/world.json'),'utf8'),raw);assert.equal(await readFile(join(source,'world.json'),'utf8'),raw);
  await writeFile(join(profile,'data/world.json'),'existing record must win');
  result=invoke();assert.equal(result.status,0);assert.match(result.stdout,/False/);assert.equal(await readFile(join(profile,'data/world.json'),'utf8'),'existing record must win');
  const {rename,access}=await import('node:fs/promises');await rename(join(profile,'data'),join(profile,'saved-data'));
  const second=join(packages,'Other/LocalCache/Roaming/backseat-studio/data');await mkdir(second,{recursive:true});await writeFile(join(second,'world.json'),'{}');
  assert.notEqual(invoke().status,0);await assert.rejects(access(join(profile,'data')));
  assert.equal(await readFile(join(source,'world.json'),'utf8'),raw);
});

test('launcher reports recoverable startup failures without a PowerShell stack or creating records', {skip:process.platform!=='win32'}, async()=>{
  await mkdir('artifacts',{recursive:true});
  const folder=await mkdtemp(resolve('artifacts/launcher-errors-'));
  const appData=join(folder,'roaming'),local=join(folder,'local'),profile=join(folder,'profile');
  await mkdir(appData);await mkdir(local);await mkdir(profile);
  const invoke=(registered=false)=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/Start-InstalledNagneon.ps1'),'-Inspect',...(registered?[]:['-InstallRoot',folder])],{encoding:'utf8',windowsHide:true,env:{...process.env,APPDATA:appData,LOCALAPPDATA:local}});
  const rejected=(result,pattern)=>{assert.equal(result.status,1);assert.match(result.stderr,pattern);assert.doesNotMatch(result.stderr,/CategoryInfo|FullyQualifiedErrorId|WriteErrorException/);};
  rejected(invoke(true),/registration is missing/);
  await writeFile(join(folder,'current.json'),'broken');
  rejected(invoke(),/configuration is missing or unreadable/);
  await writeFile(join(folder,'Nagneon.exe'),'fixture');
  await writeFile(join(folder,'current.json'),JSON.stringify({executable:'Nagneon.exe',exeSha256:'0'.repeat(64),profile}));
  rejected(invoke(),/Saved profile data is missing/);
  await mkdir(join(appData,'Nagneon'));
  await writeFile(join(appData,'Nagneon/storage.json'),'broken');
  rejected(invoke(),/saved storage setting cannot be read/);
  await writeFile(join(appData,'Nagneon/storage.json'),JSON.stringify({profile:null}));
  rejected(invoke(),/saved profile path is invalid/);
  const {readdir}=await import('node:fs/promises');
  assert.deepEqual(await readdir(profile),[]);
  assert.equal(await readFile(join(appData,'Nagneon/storage.json'),'utf8'),'{"profile":null}');
});

test('physical storage check rejects redirected paths and removes its own probe', {skip:process.platform!=='win32'}, async()=>{
  await mkdir('artifacts',{recursive:true});
  const folder=await mkdtemp(resolve('artifacts/storage-view-'));
  const runner=join(folder,'verify.ps1');
  await writeFile(runner,`param([string]$Helper,[string]$Folder)
$ErrorActionPreference='Stop'
. $Helper
Assert-NagneonNativeStorageView -Profile $Folder
Assert-NagneonResolvedStoragePath -Requested 'C:\\Users\\fixture\\AppData\\Roaming\\app\\data' -Resolved '\\\\?\\C:\\Users\\fixture\\AppData\\Roaming\\app\\data'
$rejected=$false
try { Assert-NagneonResolvedStoragePath -Requested 'C:\\Users\\fixture\\AppData\\Roaming\\app\\data' -Resolved '\\\\?\\C:\\Users\\fixture\\AppData\\Local\\Packages\\Agent\\LocalCache\\Roaming\\app\\data' } catch { if ($_.Exception.Message -notmatch 'Storage is redirected') { throw }; $rejected=$true }
if (-not $rejected) { throw 'Redirected storage was accepted' }
if (Get-ChildItem -LiteralPath $Folder -Filter '.nagneon-storage-probe-*') { throw 'Probe leaked' }
`);
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',runner,'-Helper',resolve('scripts/Profile-Compatibility.ps1'),'-Folder',folder],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
});

test(
  'Windows launcher compatibility rejects newer records without modifying them',
  { skip: process.platform !== 'win32' },
  async () => {
    await mkdir('artifacts', { recursive: true });
    const profile = await mkdtemp(resolve('artifacts/profile-compatibility-'));
    await mkdir(join(profile, 'data'));
    const runner = join(profile, 'check.ps1'),
      world = join(profile, 'data/world.json');
    await writeFile(
      runner,
      `param([string]$Helper,[string]$Profile,[string]$AppVersion)\n$ErrorActionPreference='Stop'\n. $Helper\nAssert-NagneonProfileCompatibility -Profile $Profile -AppVersion $AppVersion\n`,
    );
    const invoke = (version) =>
      spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          runner,
          '-Helper',
          resolve('scripts/Profile-Compatibility.ps1'),
          '-Profile',
          profile,
          '-AppVersion',
          version,
        ],
        { encoding: 'utf8', windowsHide: true },
      );
    const legacy = {
      settings: { title: '방송 기록과 추억', maxCalls: 120, personas: [{ id: 'fixture' }] },
    };
    await writeFile(world, JSON.stringify(legacy));
    assert.equal(invoke('0.1.3').status, 0);
    for (const data of [
      { settings: { personas: [] } },
      {
        settings: {
          maxCalls: 120,
          personas: Array.from({ length: 41 }, (_, i) => ({ id: String(i) })),
        },
      },
    ]) {
      const raw = JSON.stringify(data);
      await writeFile(world, raw);
      const old = invoke('0.1.3');
      assert.notEqual(old.status, 0);
      assert.match(old.stderr, /0\.1\.4 or later/);
      assert.equal(await readFile(world, 'utf8'), raw);
      assert.equal(invoke('0.1.4').status, 0);
      assert.equal(invoke('0.2.0').status, 0);
    }
    await writeFile(world, 'broken');
    assert.notEqual(invoke('0.1.3').status, 0);
    assert.equal(await readFile(world, 'utf8'), 'broken');
    assert.notEqual(invoke('unknown').status, 0);
  },
);
