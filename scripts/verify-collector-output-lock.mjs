import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeCollectorOutput} from './lib/collector-output.mjs';

if(process.platform!=='win32')throw Error('Run this file-sharing check on Windows');
const base=resolve('artifacts','collector-lock-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(base);
const file=join(base,'status.json'),original=JSON.stringify({state:'previous synthetic snapshot'});await writeFile(file,original);
const script=`$ErrorActionPreference='Stop'
$target=[IO.Path]::GetFullPath($env:BACKSEAT_LOCK_FIXTURE)
$scope=[IO.Path]::GetFullPath($env:BACKSEAT_LOCK_ROOT)
if ([IO.Path]::GetDirectoryName($target) -ne $scope -or [IO.Path]::GetFileName($target) -ne 'status.json') { throw 'Fixture path mismatch' }
$stream=[IO.File]::Open($target,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try { [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null }
finally { $stream.Dispose() }
[Console]::Out.WriteLine('RELEASED')`;
const child=spawn('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,BACKSEAT_LOCK_FIXTURE:file,BACKSEAT_LOCK_ROOT:base},stdio:['pipe','pipe','pipe']});
let output='',errors='',timedOut=false;const close=new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>yes({code,signal}));});
child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{errors+=b;});child.stdin.on('error',()=>{});
const timer=setTimeout(()=>{timedOut=true;child.kill();},15000);
const report={passed:false,base,pid:child.pid,scope:'synthetic artifact file only; no GUI, registry, devices or user source',sharingErrors:[]};
try{
  await Promise.race([new Promise(yes=>{child.stdout.on('data',()=>{if(output.includes('LOCKED'))yes();});}),close.then(()=>{throw Error('Fixture exited before locking');})]);
  await writeCollectorOutput(base,'status.json',{state:'current synthetic snapshot'},{renameFile:async(a,b)=>{
    try{return await rename(a,b);}catch(error){report.sharingErrors.push(error.code);assert.equal(await readFile(file,'utf8'),original);child.stdin.end('\n');throw error;}
  }});
  assert.ok(report.sharingErrors.some(code=>['EPERM','EBUSY','EACCES'].includes(code)),'actual Windows sharing error required');
  const exit=await close;assert.equal(exit.code,0);assert.equal(timedOut,false);assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{state:'current synthetic snapshot'});
  report.passed=true;report.childExit=exit;report.finalSha256=createHash('sha256').update(await readFile(file)).digest('hex');
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
  child.stdin.end('\n');await close;clearTimeout(timer);
  await writeFile(join(base,'child.stdout.log'),output);await writeFile(join(base,'child.stderr.log'),errors);
  await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));await writeFile('artifacts/latest-collector-output-lock.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
