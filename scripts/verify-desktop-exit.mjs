// Runs the actual desktop entrypoint twice with one isolated profile. The
// previous shutdown test covers a slow model child; this covers a fast drain
// after the real renderer and its SSE connection have loaded, plus reopening.
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
await mkdir('artifacts',{recursive:true});const root=resolve('.'),folder=await mkdtemp(resolve('artifacts/desktop-exit-'));
const report={folder,root,passed:false,runs:[],accountGeneration:false,deviceCapture:false,sourceHashes:{},scope:'Real source desktop entrypoint, renderer, SSE, native close and same-profile reopen. Official account status only; no model generation.'};
for(const file of ['desktop/main.cjs','desktop/graceful-quit.cjs','server/index.js','scripts/verify-desktop-exit.mjs'])report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const profile=join(folder,'profile'),harness=join(folder,'harness.cjs');
await writeFile(harness,`const {app}=require('electron');
const {writeFileSync}=require('node:fs');const {join}=require('node:path');
const [root,folder,profile,run]=process.argv.slice(2);process.argv.push('--backseat-profile='+profile);
const report={pid:process.pid,run,events:[],passed:false};
const save=()=>writeFileSync(join(folder,run+'.json'),JSON.stringify(report,null,2));
const record=event=>{report.events.push({event,at:Date.now()});save();};
const fail=error=>{report.error=error.stack;save();app.exit(1);};
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
app.on('before-quit',()=>record('before-quit'));app.on('will-quit',()=>record('will-quit'));
app.on('quit',(_event,code)=>{record('quit');report.exitCode=code;report.passed=code===0&&report.rendererLoaded&&report.sseConnected&&report.closeRequested;save();});
app.on('browser-window-created',(_event,win)=>{
 win.webContents.once('did-finish-load',async()=>{try{
  const start=Date.now();
  // Both the welcome page and the main status render only after App receives
  // state from its actual EventSource. A fresh profile has no main header yet.
  while(!await win.webContents.executeJavaScript('!!document.querySelector(".welcome-shell") || document.body.innerText.includes("로컬 연결됨")')){if(Date.now()-start>5000)throw Error('Renderer SSE did not connect');await new Promise(r=>setTimeout(r,50));}
  const state=await win.webContents.executeJavaScript('fetch("/api/state").then(r=>r.json())');
  if(state.running||state.calls!==0)throw Error('Unexpected broadcast or generation');
  report.rendererLoaded=true;report.sseConnected=true;report.onboarding=state.onboarding.status;record('renderer-ready');
  await new Promise(r=>setTimeout(r,100));report.closeRequested=true;record('close-requested');win.close();
 }catch(error){fail(error);}});
});
record('starting');require(join(root,'desktop/main.cjs'));
`);
const save=()=>writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));
try{
 let before;
 for(const run of ['fresh','reopen']){
  const fd=openSync(join(folder,run+'.log'),'w'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const entry={run,startedAt:Date.now()};report.runs.push(entry);
  try{entry.code=await new Promise((done,fail)=>{
   const child=spawn(resolve('node_modules/electron/dist/electron.exe'),[harness,root,folder,profile,run],{cwd:root,env,windowsHide:true,stdio:['ignore',fd,fd]});entry.pid=child.pid;
   const timer=setTimeout(()=>{entry.timedOut=true;child.kill();},20000);
   child.once('error',error=>{clearTimeout(timer);fail(error);});child.once('close',code=>{clearTimeout(timer);done(code);});
  });}finally{closeSync(fd);}
  entry.finishedAt=Date.now();await save();assert.equal(entry.timedOut,undefined);assert.equal(entry.code,0);
  entry.native=JSON.parse(await readFile(join(folder,run+'.json'),'utf8'));assert.equal(entry.native.passed,true);assert.equal(entry.native.onboarding,'new');
  const events=entry.native.events;assert.equal(events.filter(e=>e.event==='quit').length,1);assert.equal(events.filter(e=>e.event==='will-quit').length,2);
  entry.closeMs=events.find(e=>e.event==='quit').at-events.find(e=>e.event==='close-requested').at;assert.ok(entry.closeMs<5000);
  try{process.kill(entry.pid,0);throw Error('Electron process remains after exit');}catch(error){if(error.code!=='ESRCH')throw error;}
  const settings=JSON.parse(await readFile(join(profile,'data/world.json'),'utf8')).settings;
  if(before)assert.deepEqual(settings,before,'Reopening must preserve stored settings');else before=settings;
  await save();console.log(JSON.stringify({run,code:entry.code,closeMs:entry.closeMs,passed:entry.native.passed}));
 }
 report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await save();await writeFile('artifacts/desktop-exit-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({folder,passed:report.passed,error:report.error}));}
