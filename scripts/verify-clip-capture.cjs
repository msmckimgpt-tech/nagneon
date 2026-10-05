// Real Electron encoders and server/decoder; only generated pixels and tones.
// No desktop/microphone acquisition, real account, or visible window.
const {app,BrowserWindow,session}=require('electron');
const {join,resolve}=require('node:path');
const {mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const {createStudioSession}=require('../desktop/session.cjs');
const folder=resolve('artifacts/clip-capture-'+Date.now());mkdirSync(folder,{recursive:true});
app.setPath('userData',join(folder,'profile'));app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.on('window-all-closed',()=>{});
let win,service;const result={passed:false,synthetic:true,physicalDevices:false,modelCalls:0,cases:[],console:[]};
const watchdog=setTimeout(()=>app.exit(2),110000);watchdog.unref();
app.whenReady().then(async()=>{
  try{
    const {build}=require('esbuild');
    await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
      import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
      import {useClipBuffer} from './src/useClipBuffer';import {ClipUploads} from './src/clip-uploads';
      import {createSeparatedClipSources} from './src/clip-source';
      import {ClipMedia} from './src/ClipMedia';
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
      const ctx=canvas.getContext('2d');let frame=0;const timer=setInterval(()=>{ctx.fillStyle=frame++%2?'red':'blue';ctx.fillRect(0,0,320,180);},100);
      const screen=canvas.captureStream(10),context=new AudioContext();void context.resume();
      function tone(hz){const out=context.createMediaStreamDestination(),osc=context.createOscillator();osc.frequency.value=hz;osc.connect(out);osc.start();return out.stream;}
      const mic=tone(880),system=tone(440);window.errors=[];
      try{const source=createSeparatedClipSources(screen,mic,system);window.sourceInfo=source?{base:source.base.kind,voice:!!source.voice}:null;source?.close();}catch(e){window.sourceInfo={error:e.message};}
      try{const clock={set:setTimeout};clock.set(()=>{},1);window.clockReceiver='ok';}catch(e){window.clockReceiver=e.message;}
      function Probe(){const [mode,setMode]=useState('video'),[preview,setPreview]=useState(null);window.mode=setMode;window.preview=setPreview;
        const clip=useClipBuffer(mode==='video'?screen:null,mic,true,'probe',mode==='video'?system:null,message=>window.errors.push(message));
        window.buffering=clip.buffering;window.take=clip.takeAt;
        useEffect(()=>()=>{clearInterval(timer);screen.getTracks().forEach(t=>t.stop());mic.getTracks().forEach(t=>t.stop());system.getTracks().forEach(t=>t.stop());void context.close();},[]);
        return <div>synthetic{preview&&<ClipMedia clip={preview}/>}</div>;
      }
      window.send=async candidate=>{const queue=new ClipUploads({sessionId:'probe',takeAt:window.take,allowed:()=>true,onError:e=>window.errors.push(e)});window.queue=queue;queue.add([candidate]);};
      createRoot(document.getElementById('root')).render(<Probe/>);
    `},bundle:true,format:'iife',target:'chrome130',outfile:join(folder,'probe.js')});
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')));
    service=await startServer({port:0,dataDir:join(folder,'data'),localSpeech:false,runtime:{clips:{python:process.env.BACKSEAT_PYTHON,worker:resolve('scripts/clip_inspector.py')}},provider:{status:()=>({configured:false}),react:async()=>{throw Error('Model forbidden');}}});
    const s=service.studio;s.running=true;s.sessionId='probe';s.settings.clipBufferEnabled=true;s.settings.autoHighlights=true;
    const studioSession=createStudioSession(session,service);
    win=new BrowserWindow({show:false,webPreferences:{session:studioSession,sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)result.console.push(event.message);});
    await win.loadURL(service.url);
    await win.webContents.executeJavaScript('document.body.innerHTML='+JSON.stringify('<div id="root"></div>'));
    const source=readFileSync(join(folder,'probe.js'),'utf8');
    await win.webContents.executeJavaScript(source,true);
    const js=code=>win.webContents.executeJavaScript(code,true);
    const until=async(fn,limit=25000)=>{const at=Date.now();while(Date.now()-at<limit){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Clip condition timed out');};
    for(const kind of ['video','audio']){
      if(kind==='audio'){await js("window.queue.dispose();window.preview(null);window.mode('audio')");await new Promise(r=>setTimeout(r,500));}
      await until(()=>js('window.buffering===true'));await new Promise(r=>setTimeout(r,1500));
      const at=Date.now(),clip=s.clips.create({title:'Synthetic '+kind,scene:'Generated colors and tones',participants:[],messages:[],sessionId:'probe',source:'spectator',creator:{id:'fixture',name:'시험',reason:'합성'},observedAt:at,audioEligible:true});
      await js('window.send('+JSON.stringify(clip)+')');
      await until(()=>s.clips.get(clip.id)[kind]&&(kind!=='video'||s.clips.get(clip.id).voice));
      assert.deepEqual(await js('window.errors'),[]);
      await js('window.preview('+JSON.stringify(s.clips.get(clip.id))+')');
      await until(()=>js(`!!document.querySelector('.clip-playback ${kind}')`));
      const playback=await js(`(async()=>{const el=document.querySelector('.clip-playback ${kind}');el.muted=true;await el.play();await new Promise(r=>setTimeout(r,900));const voice=document.querySelector('.clip-playback audio[hidden]');const r={time:el.currentTime,width:el.videoWidth||0,voiceTime:voice?.currentTime};if(voice){document.querySelector('.clip-playback button').click();await new Promise(r=>setTimeout(r,100));r.voicePaused=voice.paused;r.videoStillPlaying=!el.paused;}el.pause();return r;})()`);
      assert.ok(playback.time>0);if(kind==='video')assert.equal(playback.width,320);
      if(kind==='video'){assert.ok(playback.voiceTime>0);assert.equal(playback.voicePaused,true);assert.equal(playback.videoStillPlaying,true);}
      result.cases.push({kind,id:clip.id,voice:!!s.clips.get(clip.id).voice,playback});
    }
    win.destroy();win=null;await service.close();
    service=await startServer({port:0,dataDir:join(folder,'data'),localSpeech:false,provider:{status:()=>({configured:false})}});
    for(const entry of result.cases){const saved=service.studio.clips.get(entry.id);assert.equal(saved[entry.kind],true);assert.equal(!!saved.voice,entry.voice);const response=await fetch(service.url+`/api/clips/${entry.id}/media/${entry.kind}`,{headers:{Authorization:'Bearer '+service.accessToken,Range:'bytes=0-31'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,32);}
    result.restartPreserved=true;result.passed=true;
  }catch(e){result.error=e.stack;if(win&&!win.isDestroyed())result.renderer=await win.webContents.executeJavaScript('({buffering:window.buffering,errors:window.errors,source:window.sourceInfo,clockReceiver:window.clockReceiver,body:document.body.innerText.slice(0,200)})').catch(()=>null);}
  finally{if(win&&!win.isDestroyed())win.destroy();await service?.close();writeFileSync(join(folder,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({folder,...result}));app.exit(result.passed?0:1);}
});
