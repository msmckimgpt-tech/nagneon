// Frame-only physical microphone check. Ambient samples stay in memory and are
// never written to the artifact directory or sent to an AI provider.
const { app, BrowserWindow, session } = require('electron');
const { resolve, join } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

const durationMs = Number(
  process.argv.find((arg) => arg.startsWith('--duration-ms='))?.split('=')[1] || 120000,
);
const base = resolve('artifacts/continuous-microphone-native-' + Date.now());
mkdirSync(base, { recursive: true });
app.setPath('userData', join(base, 'profile'));
app.on('window-all-closed', () => {});
const report = {
  base,
  passed: false,
  durationMs,
  physicalMicrophone: true,
  recordedAudio: false,
  providerCall: false,
};
let service, window;
const timeout = setTimeout(() => app.exit(2), durationMs + 60000);
timeout.unref();
app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')));
    const { createStudioSession } = require(resolve('desktop/session.cjs'));
    service = await startServer({
      port: 0,
      dataDir: join(base, 'data'),
      localSpeech: false,
      provider: { status: () => ({ configured: false }) },
    });
    const studioSession = createStudioSession(session, service);
    studioSession.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(permission === 'media'),
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
    report.start = await window.webContents.executeJavaScript(
      `(async()=>{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      const clone=stream.getAudioTracks()[0].clone(),processor=new MediaStreamTrackProcessor({track:clone});
      const reader=processor.readable.getReader();
      const stats={frames:0,packets:0,nonzeroPackets:0,firstWall:0,lastWall:0,maxWallGapMs:0,maxTimestampGapUs:0,lastTimestampEnd:null,format:null,sampleRate:0,channels:0,error:null};
      void(async()=>{try{while(true){const {value,done}=await reader.read();if(done)break;
        try{
          if(!stats.format){stats.format=value.format;stats.sampleRate=value.sampleRate;stats.channels=value.numberOfChannels;}
          if(stats.lastTimestampEnd!==null)stats.maxTimestampGapUs=Math.max(stats.maxTimestampGapUs,Math.abs(value.timestamp-stats.lastTimestampEnd));
          stats.lastTimestampEnd=value.timestamp+value.numberOfFrames/value.sampleRate*1000000;
          const now=Date.now();if(stats.lastWall)stats.maxWallGapMs=Math.max(stats.maxWallGapMs,now-stats.lastWall);
          if(!stats.firstWall)stats.firstWall=now;stats.lastWall=now;
          const mono=new Float32Array(value.numberOfFrames);value.copyTo(mono,{planeIndex:0,format:'f32-planar'});
          if(mono.some(sample=>sample!==0))stats.nonzeroPackets++;
          stats.frames+=value.numberOfFrames;stats.packets++;
        }finally{value.close();}
      }}catch(error){stats.error=String(error);}})();
      window.__nativeMic={stream,clone,reader,stats};
      return {track:stream.getAudioTracks().map(track=>({label:track.label,readyState:track.readyState}))};
    })()`,
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    report.end = await window.webContents.executeJavaScript(
      `(async()=>{
      const {stream,clone,reader,stats}=window.__nativeMic;
      clone.stop();await reader.cancel();stream.getTracks().forEach(track=>track.stop());
      return {...stats,tracksEnded:stream.getTracks().every(track=>track.readyState==='ended')};
    })()`,
      true,
    );
    assert.equal(report.start.track.length, 1);
    assert.equal(report.start.track[0].readyState, 'live');
    assert.equal(report.end.error, null);
    assert.equal(report.end.tracksEnded, true);
    assert.ok(report.end.packets > 0);
    assert.ok(report.end.maxTimestampGapUs <= 5000);
    assert.ok(report.end.frames >= (durationMs / 1000) * report.end.sampleRate * 0.98);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    await service?.close().catch((error) => {
      report.closeError = error.message;
      report.passed = false;
    });
    clearTimeout(timeout);
    writeFileSync(join(base, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    app.exit(report.passed ? 0 : 1);
  }
});
