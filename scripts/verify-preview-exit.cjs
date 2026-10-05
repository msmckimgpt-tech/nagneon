// Compare the pre-change native player ownership with the production display
// controller under the same synthetic video/audio recording and offscreen exit.
const { app, BrowserWindow, ipcMain } = require('electron');
const { resolve, join } = require('node:path');
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { attachPreviewVisibility } = require('../desktop/preview-visibility.cjs');
const baseline = process.argv.includes('--baseline');
const base = resolve(
  'artifacts/preview-exit-' + (baseline ? 'baseline-' : 'candidate-') + Date.now(),
);
mkdirSync(base, { recursive: true });
app.setPath('userData', join(base, 'profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const report = {
  base,
  pid: process.pid,
  baseline,
  synthetic: true,
  physicalDevices: false,
  offscreen: true,
  passed: false,
};
let win;
setTimeout(() => app.exit(2), 25000).unref();
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
        offscreen: true,
      },
    });
    report.nativeListenerBaseline = {
      hide: win.listenerCount('hide'),
      minimize: win.listenerCount('minimize'),
    };
    if (!baseline) attachPreviewVisibility({ main: win, ipcMain });
    await win.loadURL(
      'data:text/html,<video muted playsinline style="width:640px;height:360px"></video>',
    );
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const code = ts.transpileModule(readFileSync('src/video-preview.ts', 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    await js(
      `(()=>{const exports={};${code};window.startVideoPreview=exports.startVideoPreview;})()`,
    );
    const result = await js(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');let frame=0;
    const paint=setInterval(()=>{ctx.fillStyle=frame++%2?'red':'blue';ctx.fillRect(0,0,640,360);},1000/15);
    const audio=new AudioContext();await audio.resume();const out=audio.createMediaStreamDestination(),osc=audio.createOscillator();osc.frequency.value=440;osc.connect(out);osc.start();
    const stream=new MediaStream([...canvas.captureStream(15).getVideoTracks(),...out.stream.getAudioTracks()]);
    const capture=document.createElement('video');capture.muted=true;capture.srcObject=stream;await capture.play();const preview=document.querySelector('video');
    let controller,bytes=0;if(${baseline}){preview.srcObject=stream;await preview.play();}else{controller=startVideoPreview(preview,stream,()=>{});controller.setVisible(true);await new Promise(r=>preview.addEventListener('playing',r,{once:true}));}
    const recorder=new MediaRecorder(new MediaStream(stream.getTracks().map(t=>t.clone())),{mimeType:'video/webm;codecs=vp8,opus'});recorder.ondataavailable=e=>bytes+=e.data.size;recorder.start(500);
    await new Promise(r=>setTimeout(r,2200));const before=capture.currentTime;if(controller)controller.setVisible(false);
    await new Promise(r=>setTimeout(r,1200));const advanced=capture.currentTime-before;
    const stopped=new Promise(r=>recorder.addEventListener('stop',r,{once:true}));recorder.stop();await stopped;recorder.stream.getTracks().forEach(t=>t.stop());
    controller?.stop();preview.pause();preview.srcObject=null;capture.pause();capture.srcObject=null;clearInterval(paint);stream.getTracks().forEach(t=>t.stop());await audio.close();
    return {recordedBytes:bytes,captureAdvancedWhileHidden:advanced,displayDetached:preview.srcObject===null,sharedTracksEnded:stream.getTracks().every(t=>t.readyState==='ended'),audioState:audio.state};
  })()`);
    assert.ok(result.recordedBytes > 1000);
    assert.ok(result.captureAdvancedWhileHidden > 0.8);
    assert.equal(result.displayDetached, true);
    assert.equal(result.sharedTracksEnded, true);
    assert.equal(result.audioState, 'closed');
    report.result = result;
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    console.error(error.stack);
  } finally {
    if (win && !win.isDestroyed()) {
      const closed = new Promise((resolve) => win.once('closed', () => resolve(true)));
      win.destroy();
      report.closedObserved = await Promise.race([
        closed,
        new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);
      if (!report.closedObserved) report.passed = false;
    }
    report.windowDestroyed = win?.isDestroyed();
    report.nativeListenerAfter = {
      hide: win?.listenerCount('hide'),
      minimize: win?.listenerCount('minimize'),
    };
    if (
      JSON.stringify(report.nativeListenerBaseline) !== JSON.stringify(report.nativeListenerAfter)
    )
      report.passed = false;
    writeFileSync(join(base, 'result.json'), JSON.stringify(report, null, 2));
    writeFileSync(
      'artifacts/preview-exit-' + (baseline ? 'baseline' : 'candidate') + '-result.json',
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    app.exit(report.passed ? 0 : 1);
  }
});
