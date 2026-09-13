// Actual silent NSIS install/update/uninstall, including the uninstaller's
// normal temporary-copy process. TEST identity only; retain evidence on error.
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createSyntheticPackage,generateInstaller,verifyPackage} from './build-installer.mjs';
import {buildInstallerEngine} from './build-installer-engine.mjs';
if(process.platform!=='win32')throw Error('Windows required');
const base=resolve('artifacts','installer-nsis-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(base);
const result={passed:false,base,checks:[],operations:[]},hash=b=>createHash('sha256').update(b).digest('hex');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
async function run(file,args,options={}){let output='';const code=await new Promise((done,fail)=>{const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',fail);child.once('close',done);});const log=join(base,'command-'+result.operations.length+'.log');await writeFile(log,output);result.operations.push({file,args,code,log});return code;}
async function external(name){const path=join(base,'external-'+name+'.json');assert.equal(await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/installer-snapshot.ps1'),'-OutputPath',path]),0);return json(path);}
async function waitReport(path){for(let i=0;i<200;i++){try{return await json(path);}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('No completed operation report: '+path);}
try{
  const before=await external('before');assert.equal(before.registries.Registry64,null);assert.equal(before.registries.Registry32,null);assert.equal(before.group.exists,false,'TEST identity already occupied; refusing');
  const source=join(base,'source'),project=join(base,'project'),target=join(base,'installed 한글 $0');
  const {manifest}=await createSyntheticPackage(source);
  assert.equal(await run('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:winexe','/platform:x64','/out:'+join(source,'BACKSEAT.exe'),resolve('scripts/installer-fixture-app.cs')]),0);
  for(const file of manifest.files){const bytes=await readFile(join(source,file.path));file.bytes=bytes.length;file.sha256=hash(bytes);}
  const engine=await buildInstallerEngine(join(base,'engine')),setup=join(project,'Setup.exe');result.engine=engine.sha256;
  const {identity}=await generateInstaller({manifest,packageFolder:source,outDir:project,mode:'test',buildId:'nsis-real',outFileWin:setup,engineFile:engine.file,enableTestInstall:true});
  assert.equal(await run(resolve('artifacts/installer-tools/nsis-3.12/makensis.exe'),['/INPUTCHARSET','UTF8',join(project,'backseat.nsi')]),0);
  for(const name of ['install','refresh']){
    const reportPath=join(base,name+'-result.json');
    assert.equal(await run(setup,['/S','/REPORT="'+reportPath+'"','/D='+target],{windowsVerbatimArguments:true}),0);
    const report=await waitReport(reportPath);assert.equal(report.ok,true,JSON.stringify(report));assert.equal(report.operation,'install');assert.equal(report.root,target);
    const state=await json(join(target,'.backseat/state.json'));assert.equal(state.current.buildId,'nsis-real');assert.equal((await verifyPackage(join(target,'app',state.current.payloadDirname),manifest.files)).ok,true);
    const ext=await external(name);assert.equal(ext.registries.Registry64.InstallLocation,target);assert.equal(ext.shortcut.target,join(target,'BACKSEAT Launcher.exe'));
    result.checks.push('NSIS '+name+' commits exact Unicode/dollar payload and exports fresh engine report');
  }
  const control=join(base,'control');await mkdir(control);
  const child=spawn(join(target,'BACKSEAT Launcher.exe'),[],{windowsHide:true,stdio:'ignore',env:{...process.env,BACKSEAT_FIXTURE_CONTROL:control}});
  const finished=new Promise((done,fail)=>{child.once('exit',done);child.once('error',fail);});
  try{
    for(let i=0;!existsSync(join(control,'ready'))&&i<100;i++)await new Promise(r=>setTimeout(r,50));assert.ok(existsSync(join(control,'ready')));
    const stateBefore=await readFile(join(target,'.backseat/state.json'),'utf8'),reportPath=join(base,'busy-result.json');
    assert.equal(await run(setup,['/S','/REPORT="'+reportPath+'"','/D='+target],{windowsVerbatimArguments:true}),5);
    const report=await waitReport(reportPath);assert.equal(report.ok,false);assert.equal(await readFile(join(target,'.backseat/state.json'),'utf8'),stateBefore);
    result.checks.push('NSIS returns engine busy status and fresh failure report while application remains intact');
  }finally{await writeFile(join(control,'stop'),'stop');await finished;}
  const sentinel=join(target,'my-recording.txt');await writeFile(sentinel,'User file: preserve');
  const reportPath=join(base,'uninstall-result.json'),uninstaller=join(target,identity.uninstallerName);
  const parentExit=await run(uninstaller,['/S','/REPORT="'+reportPath+'"'],{windowsVerbatimArguments:true});result.uninstallerParentExit=parentExit;
  // The original NSIS process may exit before its temporary-copy uninstaller.
  // Completion is established by its fresh report AND actual owned state.
  const removed=await waitReport(reportPath);assert.equal(removed.ok,true,JSON.stringify(removed));assert.equal(removed.operation,'uninstall');assert.equal(removed.root,target);
  assert.equal(existsSync(join(target,'.backseat/state.json')),false);assert.equal(existsSync(uninstaller),false);assert.equal(await readFile(sentinel,'utf8'),'User file: preserve');
  assert.deepEqual(await readdir(target),['my-recording.txt']);
  const after=await external('after');assert.equal(after.registries.Registry64,null);assert.equal(after.registries.Registry32,null);assert.equal(after.group.exists,false);
  result.checks.push('normal NSIS temporary-copy uninstall removes owned files and publication, preserves the user sentinel');result.passed=true;
}catch(error){result.error=error.stack;process.exitCode=1;}
await writeFile(join(base,'acceptance.json'),JSON.stringify(result,null,2));await writeFile('artifacts/latest-installer-nsis-test.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
