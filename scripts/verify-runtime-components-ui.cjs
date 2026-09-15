const {app,BrowserWindow,session}=require('electron');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs'),assert=require('node:assert/strict');
const {createStudioSession}=require('../desktop/session.cjs');
const out=resolve('artifacts/runtime-components-ui');fs.mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'profile'));
let service,win,downloads=0;const report={passed:false,syntheticDownload:true,physicalDevices:false,checks:[]};
app.whenReady().then(async()=>{
 try{
  const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
  service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({kind:'synthetic',configured:false})},runtime:{speech:{},sound:{},clips:{},clipPerception:{},components:{catalog:require('../shared/runtime-catalog.json'),cache:join(out,'cache'),download:async({signal,onProgress,component})=>{downloads++;signal.throwIfAborted();onProgress({downloadedBytes:Math.floor(component.archive.bytes/2)});await new Promise((yes,no)=>signal.addEventListener('abort',()=>no(signal.reason),{once:true}));}}}});
  win=new BrowserWindow({show:false,width:1000,height:980,webPreferences:{offscreen:true,session:createStudioSession(session,service),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const js=code=>win.webContents.executeJavaScript(code);
  const until=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,100));}throw Error('UI did not reach '+code);};
  const click=async label=>{assert.equal(await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`),true);};
  await win.loadURL(service.url);await until(`!!document.querySelector('.welcome-shell')`);await click('다음');await click('다음');await click('직접 조작하며 배우기');await until(`!!document.querySelector('.app-shell')`);await until(`document.body.innerText.includes('나중에 계속하기')`);await click('나중에 계속하기');
  assert.equal(downloads,0);report.checks.push('startup and onboarding do not download optional runtimes');
  await js(`window.runtimeRequest=fetch('/api/runtime/prepare',{method:'POST',headers:{'X-Backseat-Client':'studio','Content-Type':'application/json'},body:JSON.stringify({feature:'clips'})}).then(r=>r.json());true`);
  await until(`document.body.innerText.includes('다운로드')&&document.querySelector('progress')?.value>0`);
  fs.writeFileSync(join(out,'progress.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(420,900);await new Promise(r=>setTimeout(r,300));assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);report.checks.push('download progress is visible and 420px layout has no horizontal overflow');
  await click('진행 중인 설치 취소');await js('window.runtimeRequest');
  for(let i=0;i<100&&service.studio.state().runtimeComponents.components.some(c=>['checking','downloading','installing'].includes(c.status));i++)await new Promise(r=>setTimeout(r,20));
  assert.ok(service.studio.state().runtimeComponents.components.every(c=>c.status==='idle'));assert.equal(downloads,1);report.checks.push('cancel control drains the request and does not restart a download');
  win.setSize(1000,980);
  await js(`(async()=>{const s=await(await fetch('/api/state')).json();await fetch('/api/settings',{method:'PUT',headers:{'X-Backseat-Client':'studio','Content-Type':'application/json'},body:JSON.stringify({...s.settings,mode:'rehearsal',clipBufferEnabled:false})});const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');window.fixtureTimer=setInterval(()=>{ctx.fillStyle='navy';ctx.fillRect(0,0,320,180);},40);navigator.mediaDevices.getDisplayMedia=async()=>canvas.captureStream(15);})()`);
  await until(`document.body.innerText.includes('리허설 시작')`);
  assert.equal(await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^(게임 화면 연결|화면 연결 \(선택\))$/.test(b.textContent.trim()));if(!b)return false;b.click();return true})()`),true);
  await until(`!!document.querySelector('video')?.srcObject`);
  assert.equal(downloads,1);
  assert.equal(await js(`(async()=>{const s=await(await fetch('/api/state')).json();const r=await fetch('/api/settings',{method:'PUT',headers:{'X-Backseat-Client':'studio','Content-Type':'application/json'},body:JSON.stringify({...s.settings,clipBufferEnabled:true})});return r.status;})()`),200);
  await click('리허설 시작');
  for(let i=0;i<100&&downloads<2;i++)await new Promise(r=>setTimeout(r,50));assert.equal(downloads,2);
  await click('진행 중인 설치 취소');await new Promise(r=>setTimeout(r,350));assert.equal(downloads,2);
  report.checks.push('enabling clipping after synthetic screen sharing prepares runtime once and cancellation does not loop');
  await js(`clearInterval(window.fixtureTimer);fetch('/api/stop',{method:'POST',headers:{'X-Backseat-Client':'studio'}})`);report.passed=true;
 }catch(error){report.error=error.stack;process.exitCode=1;}
 finally{win?.destroy();await service?.close();fs.writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(report.passed?0:1);}
});
