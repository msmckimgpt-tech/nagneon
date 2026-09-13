// Real Electron lifecycle + real CodexProvider temporary files, with a synthetic
// slow CLI subprocess. No account request, user data, display or audio capture.
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {extractAll} from '@electron/asar';
import {verifyPackageSources} from './lib/package-sources.mjs';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const legacy=process.argv.includes('--legacy');
await mkdir(join(root,'artifacts'),{recursive:true});
const folder=await mkdtemp(join(root,'artifacts/native-shutdown-'));
const delivered=process.argv.find(arg=>arg.startsWith('--package='))?.slice(10);
let sourceRoot=root,archiveSha256=null,sourceCheck=null;
if(delivered){
  assert.equal(legacy,false,'Legacy reproduction must run on the old source');
  const packaged=resolve(delivered),archive=join(packaged,'resources/app.asar');
  const manifest=JSON.parse(await readFile(join(packaged,'../../manifest.json'),'utf8'));
  sourceCheck=await verifyPackageSources(root,packaged,manifest.sourceManifest);assert.equal(sourceCheck.passed,true,JSON.stringify(sourceCheck));
  archiveSha256=createHash('sha256').update(await readFile(archive)).digest('hex');
  sourceRoot=join(folder,'delivered-source');extractAll(archive,sourceRoot);
}
const childFile=join(folder,'slow-cli.cjs'),harness=join(folder,'harness.cjs');
await writeFile(childFile,`const fs=require('node:fs');
fs.writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,readyAt:Date.now()}));
process.stdin.resume();setInterval(()=>{},1000);
`);
await writeFile(harness,`const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const [root,folder,mode]=process.argv.slice(2);
app.setPath('userData',path.join(folder,'profile'));
let service,win,child,tempDirectory,settled=false,drained=false;
const record=(name,value)=>fs.writeFileSync(path.join(folder,name+'.json'),JSON.stringify(value,null,2));
if(mode==='legacy')app.on('will-quit',()=>{void service?.close();});
else require(path.join(root,'desktop/graceful-quit.cjs')).installGracefulQuit(app,async()=>{await service?.close();drained=true;});
app.on('quit',()=>record('exit-state',{settled,drained,at:Date.now(),tempDirectory}));
app.whenReady().then(async()=>{
 const {CodexProvider}=await import(pathToFileURL(path.join(root,'server/codex-provider.js')));
 const {startServer}=await import(pathToFileURL(path.join(root,'server/index.js')));
 const provider=new CodexProvider({},(_bin,args,options)=>{
  tempDirectory=options.cwd;
  child=spawn(process.execPath,[path.join(folder,'slow-cli.cjs'),path.join(folder,'child-ready.json')],{...options,env:{...options.env,ELECTRON_RUN_AS_NODE:'1'}});
  child.once('close',(code,signal)=>record('child-closed',{pid:child.pid,code,signal,at:Date.now()}));return child;
 });
 provider.available=true;provider.check=async()=>provider.status();
 // The probe is synthetic. Add one tiny synthetic frame solely to test cleanup.
 const react=provider.react.bind(provider);
 provider.react=(args,signal)=>react({...args,image:'data:image/jpeg;base64,eA=='},signal).finally(()=>{settled=true;record('request-settled',{at:Date.now(),tempDirectory,removed:!fs.existsSync(tempDirectory)});});
 service=await startServer({port:0,persist:false,localSpeech:false,provider});
 win=new BrowserWindow({show:false});win.on('closed',()=>app.quit());
 fetch(service.url+'/api/connection/probe',{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio'}}).catch(()=>{});
 const start=Date.now();while(!fs.existsSync(path.join(folder,'child-ready.json'))){if(Date.now()-start>10000)throw Error('CLI fixture not ready');await new Promise(r=>setTimeout(r,10));}
 record('before-close',{at:Date.now(),pid:child.pid,tempDirectory,framePresent:fs.existsSync(path.join(tempDirectory,'frame-1.jpg')),settled,probe:service.studio.state().connectionProbe.status});
 win.close();
}).catch(error=>{record('failure',{error:error.stack});app.exit(1);});
`);
const executable=join(root,'node_modules/electron/dist/electron.exe');
const report={schema:'backseat.native-shutdown/1',folder,root,sourceRoot,delivered,archiveSha256,sourceCheck,legacy,synthetic:true,accountRequest:false,deviceCapture:false,passed:false};
let timer;
try{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const code=await new Promise((done,fail)=>{
  const child=spawn(executable,[harness,sourceRoot,folder,legacy?'legacy':'fixed'],{cwd:root,windowsHide:true,env});
  report.electronPid=child.pid;const output=[];
  child.stdout.on('data',b=>output.push(b));child.stderr.on('data',b=>output.push(b));
  timer=setTimeout(()=>{report.timedOut=true;child.kill();},25000);
  child.on('error',fail);child.on('close',async code=>{await writeFile(join(folder,'electron.log'),Buffer.concat(output));done(code);});
 });
 clearTimeout(timer);report.exitCode=code;assert.equal(code,0);assert.equal(report.timedOut,undefined);
 const json=async name=>JSON.parse(await readFile(join(folder,name+'.json'),'utf8'));
 report.before=await json('before-close');report.exit=await json('exit-state');
 assert.equal(report.before.probe,'checking');assert.equal(report.before.settled,false);assert.equal(report.before.framePresent,true);
 report.temporaryFilesRemain=existsSync(report.before.tempDirectory);
 try{process.kill(report.before.pid,0);report.childAlive=true;}catch(error){if(error.code!=='ESRCH')throw error;report.childAlive=false;}
 assert.equal(report.childAlive,false);
 if(legacy){assert.equal(report.temporaryFilesRemain,true);assert.equal(report.exit.settled,false);}
 else{report.closed=await json('child-closed');report.request=await json('request-settled');assert.equal(report.request.removed,true);assert.equal(report.exit.drained,true);assert.equal(report.exit.settled,true);assert.equal(report.temporaryFilesRemain,false);assert.ok(report.closed.at<=report.request.at&&report.request.at<=report.exit.at);}
 report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 clearTimeout(timer);
 // Only the exact fixture-owned path is eligible, never other backseat folders.
 const target=report.before?.tempDirectory;
 if(legacy&&target&&!report.childAlive&&dirname(resolve(target))===resolve(tmpdir())&&basename(target).startsWith('backseat-'))await rm(target,{recursive:true,force:true});
 await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
