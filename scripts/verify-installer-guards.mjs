// Black-box mutation refusal against real installed TEST state. No cleanup on
// failure; keep the exact corrupted fixture and reports for investigation.
import {mkdir,readFile,writeFile,readdir,lstat,readlink,copyFile,rename,symlink,unlink,chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createSyntheticPackage,resolveIdentity,buildFileEntries,verifyPackage} from './build-installer.mjs';
import {buildInstallerEngine} from './build-installer-engine.mjs';
if(process.platform!=='win32')throw Error('Windows required');
const base=resolve('artifacts','installer-guards-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(base);
const report={passed:false,base,checks:[],operations:[]},hash=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const source=join(base,'source'),target=join(base,'target'),uninstaller=join(base,'uninstaller.exe');
let engine,identity,entries;
async function run(file,args){let output='';const code=await new Promise((done,fail)=>{const p=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.once('error',fail);p.once('close',done);});const log=join(base,'command-'+report.operations.length+'.log');await writeFile(log,output);report.operations.push({file,args,code,log});return code;}
async function external(name){const path=join(base,'external-'+name+'.json');assert.equal(await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/installer-snapshot.ps1'),'-OutputPath',path]),0);return json(path);}
async function snapshot(root){const data={};if(!existsSync(root))return data;async function walk(dir){for(const name of await readdir(dir)){const path=join(dir,name),info=await lstat(path),key=relative(root,path);if(info.isSymbolicLink())data[key]='link:'+await readlink(path);else if(info.isDirectory())await walk(path);else data[key]={bytes:info.size,hash:hash(await readFile(path))};}}await walk(root);return data;}
async function request(build='one',fault){const path=join(base,'request-'+build+'-'+(fault?.replace(':','-')||'normal')+'.json');await writeFile(path,JSON.stringify({schema:1,identity:resolveIdentity({mode:'test',version:'0.1.0',buildId:build}),engineSha256:engine.sha256,files:entries.map(({path,bytes,sha256})=>({path,bytes,sha256})),...(fault?{testFault:fault}:{})}));return path;}
async function call(operation,{root=target,build='one',fault}={}){const path=join(base,'result-'+report.operations.length+'.json');const args=operation==='install'?[operation,await request(build,fault),source,root,uninstaller,path]:[operation,root,identity.appId,path];const code=await run(engine.file,args);return {code,report:existsSync(path)?await json(path):null};}
async function unchanged(label,operations=['recover','uninstall','install']){
  const files=await snapshot(target),ext=await external(label+'-before');
  for(const operation of operations){const outcome=await call(operation),after=await snapshot(target);await writeFile(join(base,label+'-'+operation+'-comparison.json'),JSON.stringify({outcome,before:files,after},null,2));assert.notEqual(outcome.code,0,label+': '+operation+' unexpectedly succeeded');assert.deepEqual(after,files,label+': '+operation+' mutated files');}
  assert.deepEqual(await external(label+'-after'),ext,label+': publication changed');report.checks.push(label+' refused without file/publication changes');
}
async function tamperFile(file,label,mutate){const original=await readFile(file);const changed=JSON.parse(original.toString('utf8'));mutate(changed);await writeFile(file,JSON.stringify(changed));await unchanged(label);await writeFile(file,original);}
async function publication(action){assert.equal(await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/installer-test-publication.ps1'),'-Action',action,'-InstallRoot',target]),0,action);}
try{
  const before=await external('before');assert.equal(before.registries.Registry64,null);assert.equal(before.registries.Registry32,null);assert.equal(before.group.exists,false,'TEST identity occupied');
  engine=await buildInstallerEngine(join(base,'engine'));report.engine=engine.sha256;
  const {manifest}=await createSyntheticPackage(source);
  assert.equal(await run('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:winexe','/platform:x64','/out:'+join(source,'BACKSEAT.exe'),resolve('scripts/installer-fixture-app.cs')]),0);
  for(const file of manifest.files){const bytes=await readFile(join(source,file.path));file.bytes=bytes.length;file.sha256=hash(bytes);}
  entries=buildFileEntries(manifest);identity=resolveIdentity({mode:'test',version:'0.1.0',buildId:'one'});await copyFile(engine.file,uninstaller);
  const invalidRequest=await json(await request());invalidRequest.files.push({path:'resources',bytes:0,sha256:'0'.repeat(64)});
  const invalidRequestPath=join(base,'invalid-alias-request.json'),invalidRoot=join(base,'invalid-request-root');await writeFile(invalidRequestPath,JSON.stringify(invalidRequest));
  assert.equal(await run(engine.file,['install',invalidRequestPath,source,invalidRoot,uninstaller,join(base,'invalid-request-report.json')]),3);assert.equal(existsSync(invalidRoot),false);report.checks.push('request file-directory alias refused before creating any install directory');
  // Fail late in a first install's staging, after many files were copied.
  const bad=join(source,entries.at(-1).path),saved=await readFile(bad),corrupt=Buffer.from(saved);corrupt[0]^=1;await writeFile(bad,corrupt);
  const badRoot=join(base,'bad-source');const rejected=await call('install',{root:badRoot});assert.notEqual(rejected.code,0);assert.equal(existsSync(badRoot),false);await writeFile(bad,saved);assert.deepEqual(await external('after-bad-source'),before);report.checks.push('first-install late hash failure removes only its copied files and leaves no publication');
  assert.equal((await call('install')).code,0);
  const statePath=join(target,'.backseat/state.json'),journalPath=join(target,'.backseat/pending.json');
  const mutations=[
    ['owner',s=>s.owner='someone-else'],['owner-guid',s=>s.ownerGuid='other'],['marker',s=>s.marker='production'],['app-id',s=>s.appId='foreign'],
    ['app-name',s=>s.appName='../foreign'],['registry-key',s=>s.regUninstallKey+='-foreign'],['shortcut-group',s=>s.shortcutGroup='../foreign'],
    ['launcher-name',s=>s.launcherName='user-note.txt'],['uninstaller-name',s=>s.uninstallerName='../user-note.txt'],['exe-name',s=>s.exeName='../user-note.txt'],
    ['root',s=>s.installRoot=base],['root-alias',s=>s.installRoot+='\\.'],['transaction',s=>s.lastTxnId='txn-other'],['current-null',s=>s.current=null],
    ['payload-traversal',s=>s.current.payloadDirname='..'],['build-mismatch',s=>s.current.buildId='different'],['version-mismatch',s=>s.current.version='2.0.0'],
    ['version-exe',s=>s.current.exeName='../user-note.txt'],['file-traversal',s=>s.current.files[0].path='../user-note.txt'],
    ['file-duplicate',s=>s.current.files.push({...s.current.files[0],path:s.current.files[0].path.toUpperCase()})],
    ['file-folder-alias',s=>s.current.files.push({path:'resources',bytes:0,sha256:'0'.repeat(64)})],['version-duplicate',s=>s.previous=structuredClone(s.current)],
  ];
  for(const [name,mutate] of mutations)await tamperFile(statePath,'state-'+name,mutate);
  // A corrupt backup is not overwritten during update and not deleted during uninstall.
  const backup=join(target,'.backseat/state.json.bak');await writeFile(backup,'a user file, not installer metadata');await unchanged('foreign-state-backup',['uninstall','install']);await unlink(backup);
  await publication('foreign-registry');await unchanged('foreign-registration',['uninstall','install']);await publication('restore-registry');
  await publication('foreign-shortcut');await unchanged('foreign-shortcut',['uninstall','install']);await publication('restore-shortcut');
  await publication('customize-shortcut');const customized=await external('custom-args');assert.equal((await call('install')).code,0);assert.equal((await external('custom-args-preserved')).shortcut.arguments,customized.shortcut.arguments);report.checks.push('owned shortcut custom application arguments survive refresh');
  // Real directory junctions require no file-symlink privilege on Windows.
  for(const [name,owned] of [['control',join(target,'.backseat')],['payload-parent',join(target,'app','0.1.0+one','resources')]]){
    const outside=join(base,'junction-'+name);await rename(owned,outside);await symlink(outside,owned,'junction');
    const foreignBefore=await snapshot(outside);await unchanged('junction-'+name);assert.deepEqual(await snapshot(outside),foreignBefore);
    assert.equal((await lstat(owned)).isSymbolicLink(),true);assert.equal(await readlink(owned),outside);await unlink(owned);await rename(outside,owned);
  }
  const stale=join(target,'app','.pending-unowned');await mkdir(stale);await writeFile(join(stale,'BACKSEAT.exe'),'user data with a familiar filename');
  const staleBefore=await snapshot(target),staleExternal=await external('stale-before');const staleResult=await call('install',{build:'unowned'});assert.notEqual(staleResult.code,0);assert.deepEqual(await snapshot(target),staleBefore);assert.deepEqual(await external('stale-after'),staleExternal);report.checks.push('unknown stale stage preserved even when it contains a manifest-like filename');
  // Leave a real uncommitted journal, then mutate each critical field.
  assert.equal((await call('install',{build:'pending',fault:'crash:before-state'})).code,79);
  const journalMutations=[
    ['root',j=>j.root=base],['control-path',j=>j.controlDir=target],['stage-path',j=>j.stageDir=target],['payload-path',j=>j.newPayloadDir=target],
    ['transaction',j=>j.txnId='../other'],['operation',j=>j.op='uninstall'],['phase',j=>j.phase='unknown'],['registry',j=>j.regUninstallKey+='-foreign'],
    ['shortcut',j=>j.shortcutGroup='../foreign'],['uninstaller',j=>j.uninstallerName='../user-note.txt'],['first-flag',j=>j.firstInstall=true],
    ['first-type',j=>j.firstInstall='true'],['prior-version',j=>j.priorPayloadDirname='0.1.0+foreign'],['target-payload',j=>j.target.payloadDirname='..'],
    ['target-executable',j=>j.target.exeName='../user-note.txt'],['target-file',j=>j.target.files[0].path='../user-note.txt']
  ];
  for(const [name,mutate] of journalMutations)await tamperFile(journalPath,'journal-'+name,mutate);
  const pending=await json(journalPath);await mkdir(pending.stageDir);const note=join(pending.stageDir,'user-note.txt');await writeFile(note,'Keep this note');await writeFile(join(pending.stageDir,'BACKSEAT.exe'),'partial owned fixture');
  const legacyTemp=join(target,'.backseat/pending.json.tmp');await writeFile(legacyTemp,'Unclaimed temporary filename');
  assert.equal((await call('recover')).code,0);assert.equal(await readFile(note,'utf8'),'Keep this note');assert.equal(existsSync(join(pending.stageDir,'BACKSEAT.exe')),false);assert.equal(await readFile(legacyTemp,'utf8'),'Unclaimed temporary filename');report.checks.push('recovery deletes only staged manifest files and preserves unknown notes and legacy .tmp');
  const state=await json(statePath);assert.equal((await verifyPackage(join(target,'app',state.current.payloadDirname),state.current.files)).ok,true);
  const lockedBefore=await snapshot(target),lockedExternal=await external('locked-state-before'),control=join(base,'lock-control');await mkdir(control);
  const holder=spawn(join(source,'BACKSEAT.exe'),['--hold',statePath],{windowsHide:true,stdio:'ignore',env:{...process.env,BACKSEAT_FIXTURE_CONTROL:control}});
  const holderExit=new Promise((done,fail)=>{holder.once('exit',done);holder.once('error',fail);});
  try{for(let i=0;!existsSync(join(control,'ready'))&&i<100;i++)await new Promise(r=>setTimeout(r,50));assert.ok(existsSync(join(control,'ready')));for(const operation of ['recover','uninstall','install'])assert.equal((await call(operation)).code,5,'metadata lock must return busy');}
  finally{await writeFile(join(control,'stop'),'stop');await holderExit;}
  assert.deepEqual(await snapshot(target),lockedBefore);assert.deepEqual(await external('locked-state-after'),lockedExternal);report.checks.push('exclusive metadata lock returns busy without changing payload or publication');
  // Metadata read-only is rejected before deleting any payload.
  await chmod(statePath,0o444);await unchanged('readonly-state',['uninstall']);await chmod(statePath,0o666);
  assert.equal((await call('uninstall')).code,0);assert.equal(await readFile(note,'utf8'),'Keep this note');assert.equal(await readFile(legacyTemp,'utf8'),'Unclaimed temporary filename');assert.equal(await readFile(join(stale,'BACKSEAT.exe'),'utf8'),'user data with a familiar filename');
  const after=await external('after');assert.equal(after.registries.Registry64,null);assert.equal(after.registries.Registry32,null);assert.equal(after.group.exists,false);report.checks.push('final uninstall removes owned publication and preserves all three unknown user fixtures');report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
await writeFile(join(base,'acceptance.json'),JSON.stringify(report,null,2));await writeFile('artifacts/latest-installer-guards-test.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,base,checks:report.checks,error:report.error},null,2));
