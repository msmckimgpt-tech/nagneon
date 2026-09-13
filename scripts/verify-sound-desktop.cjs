const {app,BrowserWindow,session,ipcMain,desktopCapturer}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {attachCapture}=require('../desktop/capture.cjs');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync}=require('node:fs');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const native=process.argv.includes('--loopback'),folder=resolve('artifacts/sound-ui-'+Date.now());mkdirSync(folder,{recursive:true});app.setPath('userData',join(folder,'profile'));
let service,win,fixture,emitter;const requests=[],inputs=[],checks=[],errors=[];let passed=false;
setTimeout(()=>{console.error('Sound UI watchdog');app.exit(2);},150000).unref();
app.whenReady().then(async()=>{
  const until=async(fn,limit=30000)=>{const at=Date.now();while(Date.now()-at<limit){if(await fn())return;await new Promise(r=>setTimeout(r,75));}throw Error('Sound UI condition timed out');};
  try{
    const {LocalSound}=await import(pathToFileURL(resolve('server/local-sound.js')).href),{startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
    const worker=new LocalSound(),analyze=worker.analyze.bind(worker);worker.analyze=async(buffer,signal)=>{const at=Date.now(),result=await analyze(buffer,signal);requests.push({at,ms:Date.now()-at,result});return result;};
    service=await startServer({port:0,dataDir:join(folder,'data'),localSpeech:false,soundWorker:worker,provider:{localSpeech:true,status:()=>({configured:true,model:'Sound UI synthetic audience',effort:'low'}),react:async args=>{inputs.push({at:Date.now(),speech:args.speech,viewerContext:args.viewerContext,hasImage:!!args.image});return {observation:{game:'Just Chatting',scene:'소리를 함께 듣는 시험',confidence:.4,excitement:0,messages:[{personaId:'momo',text:'소리가 들리네요 '+inputs.length,kind:'chat',spoiler:false}]},usage:{total_tokens:1}};},transcribe:async()=>({text:'마이크 시험 발언',cues:{}})}});
    const s=service.studio;s.configure({...s.settings,mode:'live',category:'just-chatting',lurkRatio:0,clipBufferEnabled:true,intervalSeconds:5,maxCalls:30});
    const studioSession=createStudioSession(session,service);
    win=new BrowserWindow({width:1440,height:980,show:true,webPreferences:{session:studioSession,preload:resolve('desktop/preload.cjs'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
    studioSession.setPermissionRequestHandler((contents,p,cb)=>cb(contents===win.webContents&&['media','display-capture'].includes(p)));
    studioSession.setPermissionCheckHandler((contents,p)=>contents===win.webContents&&['media','display-capture'].includes(p));
    fixture=new BrowserWindow({width:520,height:330,show:true,title:'Sound capture fixture',webPreferences:{backgroundThrottling:false}});await fixture.loadURL('data:text/html,<title>Sound capture fixture</title><body style="background:%23192b39;color:white;font:24px sans-serif;padding:30px">Generated test scene<br>Sound travels outside the frame.</body>');
    attachCapture({session:studioSession,ipcMain,desktopCapturer,main:win});
    ipcMain.handle('account:status',()=>({status:'idle'}));
    await win.loadURL(service.url);const js=async code=>{try{return await win.webContents.executeJavaScript(code,true);}catch(e){throw Error(code.slice(0,160)+": "+e.message);}};
    const button=async text=>{await until(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`));await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled).click()`);};
    await button('나중에 설정하기');
    await js(`window.testCtx=new AudioContext();window.micDest=testCtx.createMediaStreamDestination();window.micOsc=testCtx.createOscillator();micOsc.frequency.value=440;window.micGain=testCtx.createGain();micGain.gain.value=.1;micOsc.connect(micGain).connect(micDest);micOsc.start();navigator.mediaDevices.getUserMedia=async()=>micDest.stream;testCtx.resume();`);
    if(!native)await js(`window.soundDest=testCtx.createMediaStreamDestination();window.soundOsc=testCtx.createOscillator();soundOsc.frequency.value=880;window.soundGain=testCtx.createGain();soundGain.gain.value=.12;soundOsc.connect(soundGain).connect(soundDest);soundOsc.start();window.canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;window.paint=setInterval(()=>{const c=canvas.getContext('2d');c.fillStyle='#233143';c.fillRect(0,0,640,360);c.fillStyle='white';c.fillText('Synthetic game frame '+Date.now(),20,30);},50);window.displayRequests=[];navigator.mediaDevices.getDisplayMedia=async options=>{displayRequests.push(options);window.displayStream=new MediaStream([...canvas.captureStream(15).getVideoTracks(),...(options.audio?soundDest.stream.getAudioTracks().map(t=>t.clone()):[])]);return displayStream;};void 0;`);
    const choose=async(soundOnly=false)=>{
      await until(()=>js(`!!document.querySelector('[title="시스템 출력 소리"]')`));
      await js(`document.querySelector('[title="시스템 출력 소리"]').click()`);
      await until(()=>js(`!!document.querySelector('.source-options')`));
      assert.equal(await js(`document.querySelector('.source-options input').checked`),true);
      if(soundOnly)await js(`document.querySelectorAll('.source-options input')[1].click()`);
      await until(()=>js(`Array.from(document.querySelectorAll('.source-grid button')).some(b=>b.textContent.includes('Sound capture fixture'))`));
      await js(`Array.from(document.querySelectorAll('.source-grid button')).find(b=>b.textContent.includes('Sound capture fixture')).click()`);
    };
    await choose();await until(()=>js(`document.body.textContent.includes('소리 공유 중')`));assert.equal(requests.length,0);assert.equal(s.sound.active,null);checks.push('explicit system-output disclosure and no recognition before broadcast');
    if(native){let ready=false;emitter=spawn(process.execPath,[resolve('scripts/sound-emitter.cjs'),folder],{windowsHide:true,stdio:['pipe','pipe','pipe']});emitter.stdout.on('data',b=>{if(b.toString().includes('SOUND_FIXTURE_READY'))ready=true;});emitter.stderr.on('data',()=>{});await until(()=>ready);}
    await button('방송 시작');await until(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='방송 종료')`));await js(`document.querySelector('[title="마이크"]').click()`);await until(()=>js(`document.body.textContent.includes('마이크 켜짐')`));await until(()=>requests.some(r=>!r.result.silent),45000);
    await until(()=>inputs.some(i=>Object.values(i.viewerContext||{}).some(p=>p.heardSounds?.length)));
    assert.ok(requests.some(r=>r.result.volumeDb>-55));assert.ok(inputs.every(i=>!i.speech||i.speech==='마이크 시험 발언'));checks.push(native?'real Windows loopback via production capture policy reaches the real local sound model':'real MediaRecorder Opus decoding, local model and per-viewer sound context');
    await until(()=>js(`document.body.textContent.includes('영상 버퍼 켜짐')||document.body.textContent.includes('버퍼 준비')||!!document.querySelector('[title="핫클립 저장"]')`),1000).catch(()=>{});
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('핫클립 저장')).click()`);
    await until(()=>s.clips.data.some(c=>c.video));const clip=s.clips.data.find(c=>c.video);assert.equal(clip.hasAudio,true);checks.push('hotclip stores a single mixed system + microphone audio track');
    await until(()=>js(`!Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('핫클립 저장'))`));await js(`document.querySelector('nav button').click()`);await until(()=>js(`!!document.querySelector('[title="시스템 출력 소리"]')`));await js(`document.querySelector('[title="시스템 출력 소리"]').click()`);await until(()=>!s.sound.active);assert.equal(s.sound.events.length,0);checks.push('system sound off clears listening evidence while screen remains');
    await choose(true);await until(()=>s.sound.active);await until(()=>requests.length>=2);const oldCount=inputs.length;await until(()=>inputs.length>oldCount);assert.equal(inputs.at(-1).hasImage,false);
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('핫클립 저장')).click()`);await until(()=>s.clips.data.length>=2);assert.equal(s.clips.data.at(-1).video,false);assert.equal(s.clips.data.at(-1).thumbnail,null);checks.push('Just Chatting sound-only mode sends no frame and saves no stale video');
    win.show();win.focus();await new Promise(r=>setTimeout(r,300));writeFileSync(join(folder,'page.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
    s.stop();await until(()=>!s.sound.active);await js('testCtx.close();if(window.paint)clearInterval(paint);');assert.deepEqual(errors,[]);passed=true;
    writeFileSync(join(folder,'clip-test.json'),JSON.stringify({file:s.clips.file(clip.id,'webm'),hasAudio:clip.hasAudio},null,2));
  }catch(error){errors.push(error.stack);console.error(error.stack);if(win&&!win.isDestroyed())writeFileSync(join(folder,'failure-page.txt'),await win.webContents.executeJavaScript('document.body.innerText'));}
  finally{
    if(emitter&&emitter.exitCode===null){writeFileSync(join(folder,'stop-emitter'),'stop');await new Promise(r=>emitter.once('exit',r));}
    for(const w of [win,fixture])if(w&&!w.isDestroyed())w.destroy();await service?.close();
    const report={passed,nativeLoopback:native,syntheticAudio:true,syntheticAudience:true,folder,requests,inputs,checks,errors};writeFileSync('artifacts/sound-'+(native?'loopback':'desktop')+'-test.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed,folder,checks,errors}));app.exit(passed?0:1);
  }
});
