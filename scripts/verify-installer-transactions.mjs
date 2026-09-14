// Real Windows filesystem/HKCU/Start Menu transactions, isolated TEST identity.
// No cleanup on failure: leave the exact root and reports for diagnosis.
import {mkdir,readFile,writeFile,readdir,lstat,readlink,copyFile,chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createSyntheticPackage,resolveIdentity,buildFileEntries,verifyPackage} from './build-installer.mjs';
import {buildInstallerEngine} from './build-installer-engine.mjs';
if(process.platform!=='win32')throw Error('Run the real transaction acceptance on Windows');
const id=new Date().toISOString().replace(/[:.]/g,'-'),base=resolve('artifacts','installer-txn-'+id);await mkdir(base);
const engine=await buildInstallerEngine(join(base,'engine'),{sourceDir:process.env.BACKSEAT_INSTALLER_ENGINE_SOURCE||'installer/engine'}),checks=[],operations=[];
const report={passed:false,base,engine:engine.sha256,engineSource:engine.sourceDir,checks,operations};
let controlSequence=0;
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function run(file,args,options={}){
  const seq=operations.length;let output='';const result=await new Promise((done,fail)=>{const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',fail);child.on('close',code=>done({code,pid:child.pid}));});
  const log=join(base,'command-'+seq+'.log');await writeFile(log,output);operations.push({file,args,...result,log});return result;
}
async function snapshot(root){const found={};if(!existsSync(root))return found;async function walk(dir){for(const name of await readdir(dir)){const path=join(dir,name),info=await lstat(path),key=relative(root,path);if(info.isSymbolicLink())found[key]='link:'+await readlink(path);else if(info.isDirectory())await walk(path);else found[key]=hash(await readFile(path));}}await walk(root);return found;}
async function external(name){const out=join(base,'external-'+name+'.json');const result=await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/installer-snapshot.ps1'),'-OutputPath',out]);assert.equal(result.code,0);return json(out);}
async function call(op,root,req){const out=join(base,'result-'+operations.length+'.json');const args=op==='install'?[op,req,source,root,uninstaller,out]:[op,root,identity.appId,out];const result=await run(engine.file,args);return {...result,report:existsSync(out)?await json(out):null};}
const source=join(base,'source'),target=join(base,'target root'),uninstaller=join(base,'fixture-uninstaller.exe');
const {manifest}=await createSyntheticPackage(source);
const compiler='C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
const compiled=await run(compiler,['/nologo','/target:winexe','/platform:x64','/out:'+join(source,'Nagneon.exe'),resolve('scripts/installer-fixture-app.cs')]);assert.equal(compiled.code,0);
await copyFile(engine.file,uninstaller);
for(const file of manifest.files){const bytes=await readFile(join(source,file.path));file.bytes=bytes.length;file.sha256=hash(bytes);}
const identity=resolveIdentity({mode:'test',version:'0.1.0',buildId:'one'}),entries=buildFileEntries(manifest);
async function request(buildId,fault){const path=join(base,`request-${buildId}-${fault?.replace(':','-')||'normal'}.json`);await writeFile(path,JSON.stringify({schema:1,identity:resolveIdentity({mode:'test',version:'0.1.0',buildId}),engineSha256:engine.sha256,files:entries.map(({path,bytes,sha256})=>({path,bytes,sha256})),...(fault?{testFault:fault}:{})},null,2));return path;}
async function state(){return json(join(target,'.backseat/state.json'));}
async function intact(current){const result=await verifyPackage(join(target,'app',current.payloadDirname),current.files);assert.equal(result.ok,true,JSON.stringify(result.errors));}
async function whileRunning(exe,args,check){
  const control=join(base,'control-'+controlSequence++);await mkdir(control);
  const child=spawn(exe,args,{windowsHide:true,env:{...process.env,BACKSEAT_FIXTURE_CONTROL:control},stdio:'ignore'});
  const exit=new Promise((done,fail)=>{child.once('exit',done);child.once('error',fail);});
  try{for(let i=0;!existsSync(join(control,'ready'))&&i<150;i++)await new Promise(r=>setTimeout(r,50));assert.ok(existsSync(join(control,'ready')),'fixture did not become ready: '+exe);await check(control);}
  finally{await writeFile(join(control,'stop'),'stop');await exit;}
}
async function publication(name){const ext=await external(name);return {registries:ext.registries,target:ext.shortcut?.target,workingDirectory:ext.shortcut?.workingDirectory,uninstaller:hash(await readFile(join(target,identity.uninstallerName))),launcher:hash(await readFile(join(target,'Nagneon Launcher.exe')))};}
try{
  const before=await external('before');assert.equal(before.registries.Registry64,null,'Existing TEST registry belongs to another run; do not alter');assert.equal(before.registries.Registry32,null);assert.equal(before.group.exists,false,'Existing TEST Start Menu belongs to another run');
  const first=await call('install',target,await request('one'));assert.equal(first.code,0,JSON.stringify(first.report));const one=await state();await intact(one.current);
  const published=await external('installed');assert.equal(published.registries.Registry64.InstallLocation,target);assert.equal(published.registries.Registry64.AppId,identity.appId);assert.equal(published.shortcut.target,join(target,'Nagneon Launcher.exe'));checks.push('real install publishes owned payload, launcher, shortcut and HKCU state');
  const refresh=await call('install',target,await request('one'));assert.equal(refresh.code,0,JSON.stringify(refresh.report));await intact((await state()).current);checks.push('same-build reuse verifies the complete manifest');
  const control=join(base,'control');await mkdir(control);const running=spawn(join(target,'Nagneon Launcher.exe'),[],{windowsHide:true,env:{...process.env,BACKSEAT_FIXTURE_CONTROL:control},stdio:'ignore'});const exit=new Promise(r=>running.once('exit',r));
  try{for(let i=0;!existsSync(join(control,'ready'))&&i<100;i++)await new Promise(r=>setTimeout(r,50));assert.ok(existsSync(join(control,'ready')),'stable launcher did not start fixture');const files=await snapshot(target),ext=await external('running-before');
    const result=await call('uninstall',target);assert.notEqual(result.code,0);assert.deepEqual(await snapshot(target),files);assert.deepEqual(await external('running-after'),ext);checks.push('running stable launcher prevents uninstall before any owned file or publication changes');
  }finally{await writeFile(join(control,'stop'),'stop');await exit;}
  const forwarded=['--backseat-profile',join(base,'한글 profile')+'\\','quoted"argument','','uninstall'];
  await whileRunning(join(target,'Nagneon Launcher.exe'),forwarded,async folder=>{
    const received=(await readFile(join(folder,'arguments'),'utf8')).replace(/^\uFEFF/,'').split(/\r?\n/).slice(0,-1);
    assert.deepEqual(received,forwarded);checks.push('stable launcher forwards exact app arguments including spaces, quotes, Unicode and empty values');
  });
  for(const [name,exe,args] of [
    ['direct application',join(target,'app',(await state()).current.payloadDirname,'Nagneon.exe'),[]],
    ['payload data lock',join(source,'Nagneon.exe'),['--hold',join(target,'app',(await state()).current.payloadDirname,'resources/app/index.txt')]],
    ['uninstaller lock',join(source,'Nagneon.exe'),['--hold',join(target,identity.uninstallerName)]],
  ]){
    const files=await snapshot(target),ext=await external('lock-before-'+controlSequence);
    await whileRunning(exe,args,async()=>{const result=await call('uninstall',target);assert.notEqual(result.code,0,name);});
    // An exclusive lock intentionally also prevents the verifier reading bytes.
    // Compare the full state after graceful fixture exit releases that lock.
    assert.deepEqual(await snapshot(target),files,name);assert.deepEqual(await external('lock-after-'+controlSequence),ext,name);checks.push(name+' prevents partial uninstall');
  }
  const readOnly=join(target,'app',(await state()).current.payloadDirname,'resources/app/index.txt');
  await chmod(readOnly,0o444);
  try{const files=await snapshot(target),ext=await external('readonly-before');const result=await call('uninstall',target);assert.notEqual(result.code,0,'readonly file must prevent partial deletion');assert.deepEqual(await snapshot(target),files);assert.deepEqual(await external('readonly-after'),ext);checks.push('read-only file refuses removal without losing already-opened files');}
  finally{await chmod(readOnly,0o666);}
  // Change the control binary bytes so a rollback that only restores payload
  // metadata, but leaves a new uninstaller installed, cannot pass the oracle.
  await writeFile(uninstaller,Buffer.concat([await readFile(engine.file),Buffer.from('fixture version two')]));
  const update=await call('install',target,await request('two'));assert.equal(update.code,0,JSON.stringify(update.report));assert.equal((await state()).current.buildId,'two');assert.equal((await state()).previous.buildId,'one');await intact((await state()).current);checks.push('update preserves previous version and publishes current only after commit');
  for(const fault of ['throw:after-stage','throw:after-promote','throw:after-shortcut','throw:after-registry','throw:before-state']){
    const beforeFault=await publication('before-'+fault.split(':')[1]);await writeFile(uninstaller,Buffer.concat([await readFile(engine.file),Buffer.from('fixture '+fault)]));
    const result=await call('install',target,await request('fault-'+fault.split(':')[1],fault));assert.notEqual(result.code,0,fault);assert.equal((await state()).current.buildId,'two',fault);await intact((await state()).current);assert.equal(existsSync(join(target,'.backseat/pending.json')),false,fault);
    assert.deepEqual(await publication('after-'+fault.split(':')[1]),beforeFault,fault+' must restore publication AND old control bytes');
    checks.push(fault+' rolls back to complete previous publication');
  }
  for(const fault of ['crash:after-shortcut','crash:before-state','crash:after-state']){
    const next='crash-'+fault.split(':')[1],old=(await state()).current.buildId,beforeCrash=await publication('before-'+next);
    await writeFile(uninstaller,Buffer.concat([await readFile(engine.file),Buffer.from('fixture '+fault)]));
    const result=await call('install',target,await request(next,fault));assert.equal(result.code,79,fault);assert.ok(existsSync(join(target,'.backseat/pending.json')));const recovered=await call('recover',target);assert.equal(recovered.code,0,JSON.stringify(recovered.report));assert.equal((await state()).current.buildId,fault==='crash:after-state'?next:old);await intact((await state()).current);assert.equal(existsSync(join(target,'.backseat/pending.json')),false);
    const afterCrash=await publication('after-'+next);if(fault==='crash:after-state')assert.equal(afterCrash.uninstaller,hash(await readFile(uninstaller)));else assert.deepEqual(afterCrash,beforeCrash);
    checks.push(fault+' recovered payload and control binaries according to the durable commit point');
  }
  const sentinel=join(target,'my-recording.txt');await writeFile(sentinel,'Owned by the user. Preserve this.');const removed=await call('uninstall',target);assert.equal(removed.code,0,JSON.stringify(removed.report));assert.equal(await readFile(sentinel,'utf8'),'Owned by the user. Preserve this.');assert.equal(existsSync(join(target,'.backseat/state.json')),false);const after=await external('after');assert.equal(after.registries.Registry64,null);assert.equal(after.registries.Registry32,null);assert.equal(after.shortcut,null);checks.push('uninstall removes all tracked versions/publication while preserving unknown user data');report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await writeFile(join(base,'acceptance.json'),JSON.stringify(report,null,2));await writeFile('artifacts/latest-installer-transaction-test.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,base,checks,error:report.error},null,2));}
