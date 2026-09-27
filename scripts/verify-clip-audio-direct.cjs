// Synthetic audio only. No microphone, system capture, playback or provider.
const {app,BrowserWindow}=require('electron');
const {build}=require('esbuild');
const {mkdirSync,writeFileSync}=require('node:fs');
const {resolve,join}=require('node:path');
const assert=require('node:assert/strict');
const dir=resolve('artifacts/clip-audio-direct-'+Date.now());
mkdirSync(dir,{recursive:true});app.setPath('userData',join(dir,'profile'));
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  let win;const result={passed:false,physicalCapture:false,playback:false,provider:false};
  try{
    win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    await win.loadURL('data:text/html,<title>Clip audio direct verification</title>');
    const bundle=await build({entryPoints:['src/clip-audio.ts'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'clipAudioUnderTest'});
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text);
    result.capture=await win.webContents.executeJavaScript('('+async function run(){
      const source=new MediaStreamTrackGenerator({kind:'audio'}),writer=source.writable.getWriter();
      const Context=window.AudioContext;let extraContexts=0;
      window.AudioContext=class extends Context{constructor(...args){super(...args);extraContexts++;}};
      const owned=clipAudioUnderTest.mixClipAudio([new MediaStream([source])]);
      window.AudioContext=Context;
      const reader=new MediaStreamTrackProcessor({track:owned.tracks[0],maxBufferSize:100}).readable.getReader();
      const originalReader=new MediaStreamTrackProcessor({track:source,maxBufferSize:100}).readable.getReader();
      const observed=[],original=[];
      const consume=async(reader,output)=>{for(let i=0;i<50;i++){const {value,done}=await reader.read();if(done)throw Error('Unexpected end');try{const samples=new Float32Array(value.numberOfFrames);value.copyTo(samples,{planeIndex:0,format:'f32-planar'});output.push({timestamp:value.timestamp,channels:value.numberOfChannels,samples:[...samples]});}finally{value.close();}}};
      const reading=Promise.all([consume(reader,observed),consume(originalReader,original)]);
      for(let i=0;i<50;i++){
        const samples=Float32Array.from({length:480},(_,j)=>((i*480+j)%101-50)/128);
        const data=new AudioData({format:'f32-planar',sampleRate:48000,numberOfFrames:480,numberOfChannels:1,timestamp:i*10000,data:samples});
        try{await writer.write(data);}finally{data.close();}
        await new Promise(r=>setTimeout(r,10));
      }
      let deadline;try{await Promise.race([reading,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Synthetic capture timed out')),6000);})]);}finally{clearTimeout(deadline);}
      owned.close();owned.close();
      const after={cloneEnded:owned.tracks[0].readyState==='ended',originalLive:source.readyState==='live'};
      await reader.cancel();await originalReader.cancel();await writer.close();source.stop();
      // Chromium may adjust the generated source clock. Compare the clone to
      // that actual source, not to the requested generator timestamps.
      let matched=0;for(let i=0;i<observed.length;i++){const b=observed[i],a=original[i];if(b.timestamp!==a.timestamp||b.channels!==1||b.samples.length!==480)throw Error('Source timing or channel layout changed');for(let j=0;j<b.samples.length;j++){if(b.samples[j]!==a.samples[j]||b.samples[j]!==((i*480+j)%101-50)/128)throw Error('Native sample changed');matched++;}}
      return {extraContexts,matched,packets:observed.length,sourceTimestampsEqual:true,...after};
    }.toString()+')()');
    assert.equal(result.capture.extraContexts,0);assert.equal(result.capture.matched,24000);assert.equal(result.capture.packets,50);assert.equal(result.capture.sourceTimestampsEqual,true);assert.equal(result.capture.cloneEnded,true);assert.equal(result.capture.originalLive,true);
    result.passed=true;
  }catch(e){result.error=e.stack;}
  finally{writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,dir}));win?.destroy();app.exit(result.passed?0:1);}
});
