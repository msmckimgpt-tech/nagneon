// Real renderer/navigation, synthetic MediaStreams. No user device access.
const {app,BrowserWindow,session}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const base=resolve('artifacts/capture-lifecycle-'+Date.now());mkdirSync(base);app.setPath('userData',join(base,'profile'));
let service,win;const report={base,passed:false,syntheticMedia:true,checks:[],errors:[]},inputs=[];
setTimeout(()=>app.exit(2),60000).unref();
app.whenReady().then(async()=>{try{
  const {startServer}=await import(pathToFileURL(resolve('server/index.js')));
  service=await startServer({port:0,dataDir:join(base,'data'),localSpeech:false,provider:{status:()=>({configured:true,model:'capture acceptance'}),react:async args=>{inputs.push({image:!!args.image});return {observation:{game:'Synthetic',scene:'Synthetic canvas',confidence:.9,excitement:0,messages:[]}};}},soundWorker:{prepare:async()=>true,close(){},analyze:async()=>({durationSeconds:4,volumeDb:-25,balance:0,silent:false,classes:[],systemSpeech:'',language:'ko',source:'system-output',caveat:'Synthetic fixture'})}});
  const s=service.studio;s.configure({...s.settings,mode:'live',intervalSeconds:5});
  win=new BrowserWindow({width:1260,height:900,show:true,webPreferences:{session:createStudioSession(session,service),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  win.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});await win.loadURL(service.url);
  const js=code=>win.webContents.executeJavaScript(code,true),pause=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(fn,timeout=7000)=>{const at=Date.now();while(Date.now()-at<timeout){if(await fn())return;await pause(50);}throw Error('Capture lifecycle condition timed out');};
  const button=async text=>until(()=>js(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!b)return false;b.click();return true;})()`));
  await button('나중에 설정하기');await button('방송 시작');
  await js(`window.canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;window.paint=setInterval(()=>{const c=canvas.getContext('2d');c.fillStyle='#355';c.fillRect(0,0,640,360);c.fillStyle='white';c.fillText('frame '+Date.now(),30,30);},50);window.audio=new AudioContext();window.audioDestination=audio.createMediaStreamDestination();window.makeStream=()=>new MediaStream([...canvas.captureStream(15).getVideoTracks(),...audioDestination.stream.getAudioTracks().map(t=>t.clone())]);navigator.mediaDevices.getDisplayMedia=async()=>window.testStream=makeStream();window.originalPlay=HTMLMediaElement.prototype.play;window.previewWaits=[];HTMLMediaElement.prototype.play=function(){const actual=originalPlay.call(this);if(this.matches('.preview video')){actual.catch(()=>{});return new Promise((resolve,reject)=>previewWaits.push({element:this,resolve,reject}));}return actual;};void 0;`);
  await js(`document.querySelector('[title="시스템 출력 소리"]').click()`);
  // Preparation now commits a decoded source before attaching the preview,
  // so one pending preview play is sufficient for this navigation race.
  await until(()=>js('previewWaits.length>=1'));await button('나의 관객');
  await until(()=>js('!document.querySelector(".preview video")'));
  await js(`previewWaits.splice(0).forEach(w=>w.reject(new DOMException('The play() request was interrupted because the media was removed from the document.','AbortError')));void 0;`);
  await pause(300);
  assert.equal(await js(`testStream.getTracks().every(t=>t.readyState==='live')`),true,'unmounted preview must not stop the capture or sound tracks');
  s.lastRequest=0;await until(()=>inputs.some(i=>i.image));assert.equal(s.sound.snapshot().connected,true);
  report.checks.push('navigation during pending preview playback retains screen frames and system sound');
  await js(`HTMLMediaElement.prototype.play=originalPlay;void 0;`);await button('방송실');
  await until(()=>js(`document.querySelector('.preview video')?.videoWidth===640`));
  assert.equal(await js(`document.body.textContent.includes('media was removed')`),false);report.checks.push('returning preview reattaches without a false capture error');
  await button('방송 종료');await until(()=>js(`testStream.getTracks().every(t=>t.readyState==='ended')`));assert.equal(s.sound.snapshot().connected,false);report.checks.push('actual broadcast stop still releases picture and sound');
  await button('방송 시작');
  await js(`HTMLMediaElement.prototype.play=function(){if(!this.isConnected)return Promise.reject(new Error('Synthetic capture decoder failure'));return originalPlay.call(this);};document.querySelector('[title="시스템 출력 소리"]').click();`);
  await until(()=>js(`document.body.textContent.includes('Synthetic capture decoder failure')`));assert.equal(await js(`testStream.getTracks().every(t=>t.readyState==='ended')`),true);report.checks.push('independent capture playback failure remains visible and releases the stream');
  await js(`HTMLMediaElement.prototype.play=originalPlay;void 0;`);
  await js(`navigator.mediaDevices.getDisplayMedia=()=>new Promise(r=>window.resolveLate=r);document.querySelector('[title="시스템 출력 소리"]').click();`);
  await until(()=>js(`typeof resolveLate==='function'`));await button('방송 종료');
  await js(`window.lateStream=makeStream();resolveLate(lateStream);void 0;`);await until(()=>js(`lateStream.getTracks().every(t=>t.readyState==='ended')`));report.checks.push('late acquisition after stop cannot restore capture');
  writeFileSync(join(base,'page.png'),(await win.webContents.capturePage()).toPNG());await js('clearInterval(paint);audio.close();');assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=error.stack;console.error(error.stack);if(win&&!win.isDestroyed())writeFileSync(join(base,'failure-page.txt'),await win.webContents.executeJavaScript('document.body.innerText'));}
finally{win?.destroy();await service?.close();writeFileSync(join(base,'result.json'),JSON.stringify(report,null,2));writeFileSync('artifacts/capture-lifecycle-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.passed?0:1);}});
