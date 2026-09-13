// Whole delivered application acceptance. TEST identity only. Run install,
// exercise the installed app separately, then run uninstall with --record=.
// Failed operations leave the exact target and evidence intact.
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyPackage} from './build-installer.mjs';
const option=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const hash=b=>createHash('sha256').update(b).digest('hex');
const phase=option('phase')||'install';
assert.ok(['install','uninstall'].includes(phase));
assert.equal(process.platform,'win32');
const record=phase==='install'?null:await json(resolve(option('record')));
const base=record?.base||resolve('artifacts','installer-full-test-'+new Date().toISOString().replace(/[:.]/g,'-'));
const target=record?.target||resolve('artifacts','full-'+Date.now().toString(36));
assert.equal(dirname(base),resolve('artifacts'));assert.match(basename(base),/^installer-full-test-[0-9TZ-]+$/);
assert.equal(dirname(target),resolve('artifacts'));assert.match(basename(target),/^full-[a-z0-9]+$/);
if(!record)await mkdir(base);
const result=record||{base,target,checks:[],operations:[],installed:false,uninstalled:false};
result.passed=false;
async function run(file,args,options={}){
  let output='';const code=await new Promise((done,fail)=>{
    const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options});
    child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    child.once('error',fail);child.once('close',done);
  });
  const log=join(base,'command-'+result.operations.length+'.log');await writeFile(log,output);
  result.operations.push({file,args,code,log});return code;
}
async function external(name){
  const path=join(base,'external-'+name+'.json');
  assert.equal(await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/installer-snapshot.ps1'),'-OutputPath',path]),0);
  return json(path);
}
async function waitReport(path){
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){try{return await json(path);}catch{}await new Promise(r=>setTimeout(r,200));}
  throw Error('No fresh completed operation report: '+path);
}
try{
  if(phase==='install'){
    assert.equal(existsSync(target),false);
    const before=await external('before');
    assert.equal(before.registries.Registry64,null);assert.equal(before.registries.Registry32,null);assert.equal(before.group.exists,false);
    const project=resolve(option('project'));
    const build=await json(join(project,'build-result.json')),request=await json(join(project,'install-request.json'));
    assert.equal(build.ok,true);assert.equal(build.compiled,true);assert.equal(build.compileExitCode,0);
    assert.equal(request.identity.marker,'test');assert.equal(request.identity.appId,'{2F8B1D04-9E3A-4C77-B6A2-1C0E5D9F4B88}');
    assert.equal(request.identity.uninstallerName,'Uninstall BACKSEAT Studio (Test).exe');
    assert.ok(request.files.length>2000,'Not a full application package');
    const setup=join(project,'BACKSEAT-Setup.exe');
    result.project=project;result.setupSha256=hash(await readFile(setup));result.appId=request.identity.appId;
    result.uninstallerName=request.identity.uninstallerName;result.payload=join(target,'app',request.identity.payloadDirname);
    const reportPath=join(base,'install-result.json');
    assert.equal(await run(setup,['/S','/REPORT="'+reportPath+'"','/D='+target],{windowsVerbatimArguments:true}),0);
    const installed=await waitReport(reportPath);assert.equal(installed.ok,true,JSON.stringify(installed));assert.equal(installed.root,target);
    const state=await json(join(target,'.backseat/state.json'));
    assert.equal(state.appId,result.appId);assert.equal(state.current.payloadDirname,request.identity.payloadDirname);
    const verified=await verifyPackage(result.payload,request.files);assert.equal(verified.ok,true,JSON.stringify(verified));
    result.verifiedFiles=verified.checked;result.payloadBytes=request.files.reduce((n,f)=>n+f.bytes,0);
    const published=await external('installed');assert.equal(published.registries.Registry64.InstallLocation,target);
    assert.equal(published.shortcut.target,join(target,'BACKSEAT Launcher.exe'));
    result.checks.push('full NSIS installation: all delivered file sizes and SHA256, state, HKCU and Start Menu');
    result.installed=true;
  }else{
    assert.equal(result.installed,true);assert.equal(result.uninstalled,false);
    assert.equal(result.appId,'{2F8B1D04-9E3A-4C77-B6A2-1C0E5D9F4B88}');
    assert.equal(result.uninstallerName,'Uninstall BACKSEAT Studio (Test).exe');
    const state=await json(join(target,'.backseat/state.json'));assert.equal(state.appId,result.appId);assert.equal(state.installRoot,target);
    const processes=join(base,'processes-before-uninstall.json');
    const psquote=s=>"'"+s.replaceAll("'","''")+"'";
    const script='$r='+psquote(target+'\\')+'; ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($r,[StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId,ExecutablePath,CreationDate) | Set-Content -Encoding utf8 -LiteralPath '+psquote(processes);
    assert.equal(await run('powershell.exe',['-NoProfile','-Command',script]),0);
    assert.deepEqual(await json(processes),[],'Installed app is still running; close it normally first');
    const sentinel=join(target,'my-recording.txt');assert.equal(existsSync(sentinel),false);await writeFile(sentinel,'User file: preserve');
    const reportPath=join(base,'uninstall-result.json');assert.equal(existsSync(reportPath),false);
    result.uninstallerParentExit=await run(join(target,result.uninstallerName),['/S','/REPORT="'+reportPath+'"'],{windowsVerbatimArguments:true});
    const removed=await waitReport(reportPath);assert.equal(removed.ok,true,JSON.stringify(removed));assert.equal(removed.operation,'uninstall');assert.equal(removed.root,target);
    assert.deepEqual(await readdir(target),['my-recording.txt']);assert.equal(await readFile(sentinel,'utf8'),'User file: preserve');
    const after=await external('after');assert.equal(after.registries.Registry64,null);assert.equal(after.registries.Registry32,null);assert.equal(after.group.exists,false);
    result.uninstalled=true;result.checks.push('full normal NSIS temporary-copy uninstall: owned files and publication removed, user file preserved');
  }
  result.passed=true;delete result.error;
}catch(error){result.error=error.stack;process.exitCode=1;}
result.lastPhase=phase;result.checkedAt=new Date().toISOString();
await writeFile(join(base,'acceptance-'+phase+'.json'),JSON.stringify(result,null,2));
await writeFile('artifacts/latest-full-installer-test.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
