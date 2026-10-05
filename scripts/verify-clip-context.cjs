// Isolated Electron acceptance: generated pixels/tones only, no device or model.
const {app,BrowserWindow,session}=require('electron');
const {resolve,join}=require('node:path');
const {mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const {createStudioSession}=require('../desktop/session.cjs');
const folder=resolve('artifacts/clip-context-'+Date.now());mkdirSync(folder,{recursive:true});
app.setPath('userData',join(folder,'profile'));
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.on('window-all-closed',()=>{});
const result={passed:false,synthetic:true,physicalDevices:false,modelCalls:0,cases:[],metrics:[],console:[]};
const width=Number(process.env.NAGNEON_CLIP_TEST_WIDTH||320),height=Number(process.env.NAGNEON_CLIP_TEST_HEIGHT||180),fps=Number(process.env.NAGNEON_CLIP_TEST_FPS||10);
assert.ok([320,1280].includes(width)&&[180,720].includes(height)&&[10,30].includes(fps));
result.parameters={width,height,fps};
const checkpoint=phase=>writeFileSync(join(folder,'progress.json'),JSON.stringify({phase,...result},null,2));
let win,service;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const watchdog=setTimeout(()=>app.exit(2),240000);watchdog.unref();
app.whenReady().then(async()=>{
  try{
    const {build}=require('esbuild');
    await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {useClipBuffer} from './src/useClipBuffer';import {ClipUploads} from './src/clip-uploads';
      import {ClipBuffer} from './src/clip-buffer';import {ContextClipBuffer} from './src/context-clip-buffer';
      import {createSeparatedClipSources} from './src/clip-source';import {ClipMedia} from './src/ClipMedia';
      window.errors=[];window.encoderCount=0;window.encoderMax=0;
      const Native=MediaRecorder;window.MediaRecorder=class extends Native{
        constructor(...args){super(...args);let live=false;
          this.addEventListener('start',()=>{live=true;window.encoderMax=Math.max(window.encoderMax,++window.encoderCount);});
          this.addEventListener('stop',()=>{if(live){live=false;window.encoderCount--;}});
        }
      };
      const canvas=document.createElement('canvas');canvas.width=${width};canvas.height=${height};const ctx=canvas.getContext('2d');
      window.phaseBegan=Date.now();let frame=0;
      const timer=setInterval(()=>{const age=Date.now()-window.phaseBegan;ctx.fillStyle=age<14000?'#0044ff':age<20000?'#ff2200':'#00cc44';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='white';ctx.fillRect(frame++%canvas.width,100,30,30);},${1000/fps});
      const screen=canvas.captureStream(${fps}),audio=new AudioContext();void audio.resume();
      const tone=hz=>{const out=audio.createMediaStreamDestination(),osc=audio.createOscillator();osc.frequency.value=hz;osc.connect(out);osc.start();return out.stream;};
      const mic=tone(880),system=tone(440);
      const otherCanvas=document.createElement('canvas');otherCanvas.width=${width};otherCanvas.height=${height};otherCanvas.getContext('2d').fillRect(0,0,${width},${height});const other=otherCanvas.captureStream(10);
      window.sharedLive=()=>[screen,mic,system].every(s=>s.getTracks().every(t=>t.readyState==='live'));
      window.beginBaseline=()=>{const source=createSeparatedClipSources(screen,mic,system);const buffers=[source.base,source.voice].filter(Boolean).map(s=>new ClipBuffer({sessionId:'baseline',hasAudio:s.hasAudio,kind:s.kind,create:()=>new MediaRecorder(s.stream,s.recorderOptions),onFailure:()=>window.errors.push('baseline failed')}));buffers.forEach(b=>b.start());window.baselineClose=()=>{buffers.forEach(b=>b.dispose());source.close();};};
      function Probe(){const [mode,setMode]=useState('none'),[sessionId,setSession]=useState('probe'),[preview,setPreview]=useState(null);window.mode=setMode;window.session=setSession;window.preview=setPreview;
        const clip=useClipBuffer(mode==='video'?screen:mode==='other'?other:null,mic,mode!=='none',sessionId,mode==='audio'?null:system,e=>window.errors.push(e));window.buffering=clip.buffering;window.take=clip.takeAt;
        return <div>synthetic{preview&&<ClipMedia clip={preview}/>}</div>;
      }
      window.send=candidate=>{window.queue=new ClipUploads({sessionId:'probe',takeAt:window.take,allowed:()=>true,onError:e=>window.errors.push(e)});window.queue.add([candidate]);};
      window.bound=async(type)=>{const source=createSeparatedClipSources(null,mic,null);const buffer=new ContextClipBuffer({sessionId:'bounds',hasAudio:true,kind:'audio',create:()=>new MediaRecorder(source.base.stream,source.base.recorderOptions),onFailure:()=>window.errors.push('bounds failed')});buffer.start();const began=Date.now();await new Promise(r=>setTimeout(r,100));const at=Date.now();const clip=await buffer.takeAt(at,{startedAt:began,endedAt:began+(type==='max'?45000:1000),eventStartedAt:at,eventEndedAt:at,basis:'moment'});buffer.dispose();source.close();if(!clip)return null;const body=new Uint8Array(await clip.blob.arrayBuffer());return {startedAt:clip.startedAt,endedAt:clip.endedAt,kind:clip.kind,hasAudio:clip.hasAudio,bytes:Array.from(body)};};
      window.endOwnedSource=async()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;canvas.getContext('2d').fillRect(0,0,64,64);const source=canvas.captureStream(10);let failures=0;const buffer=new ContextClipBuffer({sessionId:'ended-source',hasAudio:false,kind:'video',create:()=>new MediaRecorder(source,{mimeType:'video/webm;codecs=vp8'}),onFailure:()=>failures++});buffer.start();await new Promise(r=>setTimeout(r,150));const waiting=buffer.takeAt(Date.now());source.getTracks().forEach(t=>t.stop());const answer=await Promise.race([waiting,new Promise(r=>setTimeout(()=>r('timeout'),6000))]);buffer.dispose();return {cancelled:answer===null,timeout:answer==='timeout',failures};};
      window.cleanup=async()=>{clearInterval(timer);[screen,other,mic,system].forEach(s=>s.getTracks().forEach(t=>t.stop()));await audio.close();};
      createRoot(document.getElementById('root')).render(<Probe/>);
    `},bundle:true,format:'iife',target:'chrome130',outfile:join(folder,'probe.js')});
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')));
    const {ClipInspector}=await import(pathToFileURL(resolve('server/clip-inspector.js')));
    const runtime={clips:{python:process.env.BACKSEAT_PYTHON,worker:resolve('scripts/clip_inspector.py')}};
    const provider={status:()=>({configured:false}),react:async()=>{throw Error('Model forbidden');}};
    service=await startServer({port:0,dataDir:join(folder,'data'),localSpeech:false,runtime,provider});
    const s=service.studio;s.running=true;s.sessionId='probe';s.settings.clipBufferEnabled=true;s.settings.autoHighlights=true;
    win=new BrowserWindow({show:false,webPreferences:{session:createStudioSession(session,service),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)result.console.push(event.message);});
    // Start on JSON, so the production App never mounts device/recording hooks
    // alongside this probe when the DOM is subsequently replaced.
    await win.loadURL(service.url+'/api/state');const js=code=>win.webContents.executeJavaScript(code,true);
    await js('document.body.innerHTML='+JSON.stringify('<div id="root"></div>'));
    await js(readFileSync(join(folder,'probe.js'),'utf8'));
    const until=async(fn,limit=60000)=>{const start=Date.now();while(Date.now()-start<limit){if(await fn())return;await pause(100);}throw Error('Synthetic condition timed out');};
    const measure=async(label,count=6)=>{
      const samples=[];app.getAppMetrics();
      for(let i=0;i<count;i++){await pause(1000);const processes=app.getAppMetrics().map(m=>({type:m.type,pid:m.pid,cpu:m.cpu.percentCPUUsage,workingSetKiB:m.memory.workingSetSize,privateKiB:m.memory.privateBytes}));samples.push({encoders:await js('window.encoderCount'),processes});if(processes.some(m=>m.type==='Tab'&&m.privateKiB>1024*1024))throw Error('Synthetic renderer exceeds 1 GiB private memory');}
      result.metrics.push({label,samples});checkpoint(label);console.log(JSON.stringify({phase:label,encoders:samples.map(s=>s.encoders)}));
    };
    await js('window.beginBaseline()');await pause(3000);await measure('one-recorder-per-source');await js('window.baselineClose()');await until(()=>js('window.encoderCount===0'));
    await js("window.phaseBegan=Date.now();window.mode('video')");await until(()=>js('window.buffering===true'));await pause(16000);
    const at=Date.now(),window={startedAt:at-8000,endedAt:at+6000,eventStartedAt:at,eventEndedAt:at,basis:'moment'};
    const clip=s.clips.create({title:'Synthetic boundary',scene:'Generated blue setup, red core, green aftermath',participants:[],messages:[],sessionId:'probe',source:'spectator',creator:{id:'fixture'},observedAt:at,audioEligible:true,recordingWindow:window});
    await js('window.send('+JSON.stringify(clip)+')');
    const measurement=measure('overlap-two-recorders-per-source');await pause(1500);
    const merged={...window,endedAt:at+12000,eventEndedAt:at+6000};
    const updated=s.clips.mergePending(clip.id,merged,[]);await js('window.queue.add(['+JSON.stringify(updated)+'])');await measurement;
    await until(()=>s.clips.get(clip.id).video&&s.clips.get(clip.id).voice);
    const saved=s.clips.get(clip.id);assert.ok(saved.videoStartedAt<=merged.startedAt);assert.ok(saved.videoEndedAt>=merged.endedAt);assert.ok(saved.voiceStartedAt<=merged.startedAt);assert.ok(saved.voiceEndedAt>=merged.endedAt);assert.equal(saved.recordingContext.truncatedStart,false);assert.equal(saved.recordingContext.truncatedEnd,false);
    assert.ok(saved.videoEndedAt-saved.videoStartedAt<=45000);
    await js('window.preview('+JSON.stringify(saved)+')');await until(()=>js("!!document.querySelector('.clip-playback video')"));
    const playback=await js(`(async()=>{const el=document.querySelector('.clip-playback video');el.muted=true;await el.play();await new Promise(r=>setTimeout(r,800));const out={time:el.currentTime,width:el.videoWidth};el.pause();return out;})()`);assert.equal(playback.width,width);assert.ok(playback.time>0);
    result.cases.push({name:'boundary-merged-video-and-separated-voice',id:clip.id,videoStartedAt:saved.videoStartedAt,videoEndedAt:saved.videoEndedAt,voiceStartedAt:saved.voiceStartedAt,voiceEndedAt:saved.voiceEndedAt,requested:merged,playback,videoFile:s.clips.file(clip.id,'webm')});checkpoint('boundary-played');
    await js("window.queue.dispose();window.preview(null);window.pending=window.take(Date.now());window.mode('audio')");assert.equal(await js('window.pending'),null);await until(()=>js('window.buffering===true'));assert.equal(await js('window.sharedLive()'),true);
    await pause(500);const audioAt=Date.now(),audioWindow={startedAt:audioAt-8000,endedAt:audioAt+6000,eventStartedAt:audioAt,eventEndedAt:audioAt,basis:'moment'};
    const audioClip=s.clips.create({title:'Synthetic startup audio',scene:'Generated tone',participants:[],messages:[],sessionId:'probe',source:'spectator',creator:{id:'fixture'},observedAt:audioAt,audioEligible:true,recordingWindow:audioWindow});
    await js('window.send('+JSON.stringify(audioClip)+')');await until(()=>s.clips.get(audioClip.id).audio);const audioSaved=s.clips.get(audioClip.id);assert.equal(audioSaved.recordingContext.truncatedStart,true);
    await js('window.preview('+JSON.stringify(audioSaved)+')');await until(()=>js("!!document.querySelector('.clip-playback audio')"));const audioPlayback=await js(`(async()=>{const el=document.querySelector('.clip-playback audio');el.muted=true;await el.play();await new Promise(r=>setTimeout(r,500));const time=el.currentTime;el.pause();return time;})()`);assert.ok(audioPlayback>0);
    result.cases.push({name:'source-switch-cancels-old-startup-audio-marks-missing-pre-context',id:audioClip.id,playbackTime:audioPlayback,context:audioSaved.recordingContext});
    await js("window.queue.dispose();window.preview(null);window.pending=window.take(Date.now());window.mode('none')");assert.equal(await js('window.pending'),null);await until(()=>js('window.buffering===false&&window.encoderCount===0'));assert.equal(await js('window.sharedLive()'),true);
    await js("window.session('probe-2');window.mode('video')");await until(()=>js('window.buffering===true'));await pause(500);
    await js("window.pending=window.take(Date.now());window.mode('other')");assert.equal(await js('window.pending'),null);await until(()=>js('window.buffering===true'));
    const restartAt=Date.now();await js('window.pending=window.take('+restartAt+')');await pause(6200);const restarted=await js('window.pending.then(c=>c&&({sessionId:c.sessionId,startedAt:c.startedAt,endedAt:c.endedAt}))');assert.equal(restarted.sessionId,'probe-2');
    await js("window.mode('none')");await until(()=>js('window.encoderCount===0'));
    result.cases.push({name:'stop-restart-and-picture-source-change-cancel-obsolete-media',...restarted});
    const endedSource=await js('window.endOwnedSource()');assert.equal(endedSource.cancelled,true);assert.equal(endedSource.timeout,false);result.cases.push({name:'actual-owned-video-track-end-settles-pending-selection',...endedSource});checkpoint('source-ended');
    const inspector=new ClipInspector(runtime.clips);
    try{for(const type of ['min','max']){console.log(JSON.stringify({phase:type+'-length-recording'}));const bound=await js('window.bound('+JSON.stringify(type)+')');assert.ok(bound);const bytes=Buffer.from(bound.bytes);const duration=bound.endedAt-bound.startedAt;assert.ok(duration>=1000&&duration<=45000);if(type==='min')assert.ok(duration<2000);else assert.ok(duration>=44000);const decoded=await inspector.inspect(bytes,bound);writeFileSync(join(folder,type+'.webm'),bytes);result.cases.push({name:type+'-length-real-encoder',duration,bytes:bytes.length,decoded});}}finally{await inspector.close();}
    assert.deepEqual(await js('window.errors'),[]);assert.ok(await js('window.encoderMax')<=4);result.maxTotalEncoders=await js('window.encoderMax');await js('window.cleanup()');
    win.destroy();win=null;await service.close();service=null;
    service=await startServer({port:0,dataDir:join(folder,'data'),localSpeech:false,provider});
    for(const id of [clip.id,audioClip.id]){const restored=service.studio.clips.get(id);assert.ok(restored.video||restored.audio);assert.deepEqual(restored.recordingContext,id===clip.id?saved.recordingContext:audioSaved.recordingContext);}
    result.restartPreserved=true;result.passed=true;
  }catch(error){result.error=error?.stack||String(error);checkpoint('failed');if(win&&!win.isDestroyed())result.renderer=await win.webContents.executeJavaScript('({errors:window.errors,buffering:window.buffering,encoders:window.encoderCount})').catch(()=>null);checkpoint('failed-renderer-state');}
  finally{if(win&&!win.isDestroyed())win.destroy();await service?.close();clearTimeout(watchdog);writeFileSync(join(folder,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({folder,passed:result.passed,error:result.error,cases:result.cases,renderer:result.renderer}));app.exit(result.passed?0:1);}
});
