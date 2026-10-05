// Passive Windows loopback probe. Video is the isolated fixture window, never
// the user's desktop. System audio samples remain in memory and are discarded.
const { app, BrowserWindow, session } = require('electron');
const { resolve, join } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { build } = require('esbuild');

const durationMs = Number(
  process.argv.find((arg) => arg.startsWith('--duration-ms='))?.split('=')[1] || 10000,
);
const base = resolve('artifacts/system-loopback-native-' + Date.now());
mkdirSync(base, { recursive: true });
app.setPath('userData', join(base, 'profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const report = {
  base,
  passed: false,
  durationMs,
  capturedUserScreen: false,
  storedAudio: false,
  providerCall: false,
};
let service, window, fixture;
const watchdog = setTimeout(() => app.exit(2), durationMs + 60000);
watchdog.unref();

app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')));
    const { createStudioSession } = require(resolve('desktop/session.cjs'));
    service = await startServer({
      port: 0,
      persist: false,
      localSpeech: false,
      provider: { status: () => ({ configured: false }) },
    });
    fixture = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, sandbox: true },
    });
    await fixture.loadURL(
      'data:text/html,%3Ctitle%3ENagneon%20loopback%20fixture%3C%2Ftitle%3E%3Cbody%3EIsolated%20capture%20fixture%3C%2Fbody%3E',
    );
    const studioSession = createStudioSession(session, service);
    studioSession.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(permission === 'media' || permission === 'display-capture'),
    );
    studioSession.setDisplayMediaRequestHandler((_request, callback) =>
      callback({ video: fixture.webContents.mainFrame, audio: 'loopback' }),
    );
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: studioSession,
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    await window.loadURL(service.url);
    const bundle = await build({
      entryPoints: [resolve('src/clip-source.ts')], bundle: true, platform: 'browser',
      format: 'iife', globalName: 'NagneonClipSource', write: false, logLevel: 'silent',
    });
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text +
      '\nwindow.__clipSource=NagneonClipSource.createSeparatedClipSources; true;');
    report.start = await window.webContents.executeJavaScript(
      `(async()=>{
      const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
      const audio=stream.getAudioTracks()[0],stats={frames:0,packets:0,nonzeroPackets:0,format:null,sampleRate:0,error:null};
      const clips=window.__clipSource(stream,null,null);
      if(!clips?.base?.hasAudio||clips.base.kind!=='video')throw Error('product clip source omitted system audio');
      const mime=clips.base.mimeType;
      const recorder=new MediaRecorder(clips.base.stream,clips.base.recorderOptions),pieces=[];recorder.ondataavailable=event=>{if(event.data.size)pieces.push(event.data);};recorder.start(1000);
      let clone=null,reader=null;
      if(audio){clone=audio.clone();reader=new MediaStreamTrackProcessor({track:clone}).readable.getReader();
        void(async()=>{try{while(true){const {value,done}=await reader.read();if(done)break;
          try{stats.format??=value.format;stats.sampleRate=value.sampleRate;const samples=new Float32Array(value.numberOfFrames);
            value.copyTo(samples,{planeIndex:0,format:'f32-planar'});if(samples.some(sample=>sample!==0))stats.nonzeroPackets++;
            stats.frames+=value.numberOfFrames;stats.packets++;
          }finally{value.close();}
        }}catch(error){stats.error=String(error);}})();}
      window.__loopback={stream,clone,reader,stats,recorder,pieces,mime,clips};
      return {audioTracks:stream.getAudioTracks().map(track=>({label:track.label,readyState:track.readyState})),videoTracks:stream.getVideoTracks().length,clipSourceKind:clips.base.kind,clipHasAudio:clips.base.hasAudio};
    })()`,
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    report.end = await window.webContents.executeJavaScript(
      `(async()=>{
      const {stream,clone,reader,stats,recorder,pieces,mime,clips}=window.__loopback;
      const ended=new Promise(resolve=>{recorder.onstop=resolve;});recorder.stop();await ended;
      const blob=new Blob(pieces,{type:mime}),url=URL.createObjectURL(blob);
      const video=document.createElement('video');video.src=url;video.playsInline=true;
      const context=new AudioContext(),source=context.createMediaElementSource(video),analyser=context.createAnalyser(),mute=context.createGain();
      analyser.fftSize=1024;mute.gain.value=0;source.connect(analyser);analyser.connect(mute);mute.connect(context.destination);
      await context.resume();await video.play();
      const samples=new Float32Array(analyser.fftSize);let decodedPeak=0;
      for(let i=0;i<30;i++){await new Promise(resolve=>setTimeout(resolve,50));analyser.getFloatTimeDomainData(samples);
        for(const sample of samples)decodedPeak=Math.max(decodedPeak,Math.abs(sample));}
      video.pause();source.disconnect();analyser.disconnect();mute.disconnect();await context.close();URL.revokeObjectURL(url);
      clips.close();clone?.stop();await reader?.cancel();stream.getTracks().forEach(track=>track.stop());
      return {...stats,clip:{bytes:blob.size,mime,decodedPeak},tracksEnded:stream.getTracks().every(track=>track.readyState==='ended')};
    })()`,
      true,
    );
    assert.equal(report.start.videoTracks, 1);
    assert.equal(report.start.audioTracks.length, 1);
    assert.equal(report.start.clipSourceKind, 'video');
    assert.equal(report.start.clipHasAudio, true);
    assert.equal(report.end.error, null);
    assert.equal(report.end.tracksEnded, true);
    assert.ok(report.end.frames > 0);
    assert.ok(report.end.nonzeroPackets > 0);
    assert.ok(report.end.clip.bytes > 0);
    assert.ok(report.end.clip.decodedPeak > 0.00001);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    if (fixture && !fixture.isDestroyed()) fixture.destroy();
    await service?.close().catch((error) => {
      report.closeError = error.message;
      report.passed = false;
    });
    clearTimeout(watchdog);
    writeFileSync(join(base, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    app.exit(report.passed ? 0 : 1);
  }
});
