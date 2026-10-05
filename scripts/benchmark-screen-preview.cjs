// Synthetic decoded video, offscreen display and real MediaRecorder. No devices,
// account calls, visible windows, installed app, or personal recordings.
const { app, BrowserWindow } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { build } = require('esbuild');
const { execFileSync } = require('node:child_process');
function externalProcesses() {
  try {
    const own = new Set(app.getAppMetrics().map((p) => p.pid));
    const raw = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-Process | Where-Object { $_.ProcessName -in @('electron','Nagneon','obs64') } | Select-Object Id,ProcessName | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, encoding: 'utf8' },
    ).trim();
    const parsed = raw ? JSON.parse(raw) : [];
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((p) => !own.has(p.Id));
  } catch (error) {
    return { unavailable: error.message };
  }
}
const folder = resolve('artifacts/screen-preview-benchmark-' + Date.now());
mkdirSync(folder, { recursive: true });
app.setPath('userData', join(folder, 'profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const report = {
  synthetic: true,
  offscreen: true,
  source: '1920x1080 canvas at 15fps',
  gpuUtilization: null,
  gpuLimitation:
    'Electron GPU process CPU is not hardware GPU utilization. External process IDs do not prove stable workload. Display age metrics differ for native and sampled and are not end-to-end latency.',
  runs: [],
};
let win;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => app.exit(2), 300000).unref();
app.whenReady().then(async () => {
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import {startScreenPreview} from './scripts/lib/sampled-screen-preview.ts';import {startVideoPreview} from './src/video-preview.ts';window.startScreenPreview=startScreenPreview;window.startVideoPreview=startVideoPreview;`,
      },
      bundle: true,
      format: 'iife',
      outfile: join(folder, 'preview.js'),
    });
    for (const [round, modes] of [
      [
        1,
        ['native', 'native-managed', 'sampled', 'native-hidden', 'shared-video', 'shared-hidden'],
      ],
      [
        2,
        ['sampled', 'native-hidden', 'shared-video', 'shared-hidden', 'native', 'native-managed'],
      ],
      [
        3,
        ['shared-video', 'shared-hidden', 'native', 'native-managed', 'sampled', 'native-hidden'],
      ],
    ]) {
      for (const mode of modes) {
        win = new BrowserWindow({
          show: false,
          width: 1100,
          height: 760,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            backgroundThrottling: false,
            offscreen: true,
          },
        });
        await win.loadURL(
          'data:text/html,<body style="margin:0;background:black"><div id="preview" style="width:960px;height:540px"></div></body>',
        );
        const js = (code) => win.webContents.executeJavaScript(code, true);
        await js(readFileSync(join(folder, 'preview.js'), 'utf8'));
        await js(`(async()=>{
        window.generated=0;window.displayFrames=0;window.decodedFrames=0;window.analysisSamples=0;window.recordedBytes=0;window.ages=[];window.display=null;
        const source=document.createElement('canvas');source.width=1920;source.height=1080;const ctx=source.getContext('2d');
        const paint=()=>{generated++;ctx.fillStyle=generated%2?'#123':'#234';ctx.fillRect(0,0,1920,1080);ctx.fillStyle='#f93';ctx.fillRect(generated*33%1600,100,300,600);ctx.fillStyle='white';ctx.font='64px sans-serif';ctx.fillText('SYNTHETIC '+generated,80,80);};paint();window.generator=setInterval(paint,1000/15);
        window.audio=new AudioContext();await audio.resume();window.audioDestination=audio.createMediaStreamDestination();const oscillator=audio.createOscillator();oscillator.frequency.value=440;oscillator.connect(audioDestination);oscillator.start();
        window.stream=source.captureStream(15);stream.addTrack(audioDestination.stream.getAudioTracks()[0]);window.capture=document.createElement('video');capture.muted=true;capture.srcObject=stream;await capture.play();
        window.latestDecoded=performance.now();window.sourceMediaTime=0;window.collect=false;
        const decoded=(now,meta)=>{if(collect){decodedFrames++;if(${JSON.stringify(mode)}==='shared-video')displayFrames++;}latestDecoded=now;sourceMediaTime=meta.mediaTime;window.decodedHandle=capture.requestVideoFrameCallback(decoded);};decodedHandle=capture.requestVideoFrameCallback(decoded);
        // Same analysis workload in all variants; preview does not supply analysis.
        const analysis=document.createElement('canvas');analysis.width=960;analysis.height=540;const ac=analysis.getContext('2d');
        window.analyzer=setInterval(()=>{ac.drawImage(capture,0,0,960,540);analysis.toBlob(b=>{if(collect&&b)analysisSamples++;},'image/jpeg',.6);},500);
        window.parts=[];window.recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:900000,audioBitsPerSecond:64000});recorder.ondataavailable=e=>{parts.push(e.data);if(collect)recordedBytes+=e.data.size;};recorder.start(500);
        if(${JSON.stringify(mode)}.startsWith('native')){
          window.display=document.createElement('video');display.muted=true;display.style='width:960px;height:540px';document.querySelector('#preview').append(display);
          if(${JSON.stringify(mode)}==='native'){display.srcObject=stream;await display.play();}else{window.controller=startVideoPreview(display,stream,()=>{});controller.setVisible(true);await new Promise(r=>display.addEventListener('playing',r,{once:true}));}
          const shown=(now,meta)=>{if(collect){displayFrames++;ages.push(Math.max(0,(sourceMediaTime-meta.mediaTime)*1000));}window.displayHandle=display.requestVideoFrameCallback(shown);};displayHandle=display.requestVideoFrameCallback(shown);
        }else if(${JSON.stringify(mode)}.startsWith('sampled')){
          window.display=document.createElement('canvas');display.style='width:960px;height:540px';document.querySelector('#preview').append(display);const dc=display.getContext('2d'),draw=dc.drawImage.bind(dc);dc.drawImage=(...args)=>{draw(...args);if(collect){displayFrames++;ages.push(performance.now()-latestDecoded);}};
          window.controller=startScreenPreview(capture,display,()=>{},{visible:true,width:960});
        }else if(${JSON.stringify(mode)}.startsWith('shared')){
          window.display=capture;capture.style='width:960px;height:540px';document.querySelector('#preview').append(capture);
        }
        window.reset=()=>{displayFrames=decodedFrames=analysisSamples=recordedBytes=0;ages=[];collect=true;if(${JSON.stringify(mode)}==='native-hidden'){display.cancelVideoFrameCallback(displayHandle);controller.setVisible(false);}if(${JSON.stringify(mode)}==='shared-hidden')capture.remove();};
        window.stats=()=>({displayFrames,decodedFrames,analysisSamples,recordedBytes,displayPixels:display?(display.videoWidth||display.width)*(display.videoHeight||display.height):null,ages,live:stream.getVideoTracks()[0].readyState,capturePaused:capture.paused,recordingTracks:recorder.stream.getTracks().map(t=>({kind:t.kind,settings:t.getSettings(),state:t.readyState}))});
        window.finish=async()=>{const done=new Promise(r=>recorder.addEventListener('stop',r,{once:true}));recorder.stop();await done;return new Uint8Array(await new Blob(parts,{type:recorder.mimeType}).arrayBuffer());};
      })()`);
        await pause(1500);
        const externalBefore = externalProcesses(),
          startedAt = new Date().toISOString();
        await js('reset()');
        app.getAppMetrics();
        await pause(8000);
        const processes = app.getAppMetrics().map((p) => ({
          pid: p.pid,
          type: p.type,
          cpuPercent: p.cpu.percentCPUUsage,
          memoryKB: p.memory.workingSetSize,
        }));
        const stats = await js('stats()');
        stats.ageMedianMs =
          stats.ages.sort((a, b) => a - b)[Math.floor(stats.ages.length / 2)] ?? null;
        delete stats.ages;
        report.runs.push({
          round,
          mode,
          durationMs: 8000,
          startedAt,
          endedAt: new Date().toISOString(),
          externalBefore,
          externalAfter: externalProcesses(),
          ...stats,
          processes,
          rendererMemory: await win.webContents.executeJavaScript(
            'performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null',
          ),
        });
        writeFileSync(
          join(folder, `recording-${round}-${mode}.webm`),
          Buffer.from(await js('finish()')),
        );
        win.destroy();
        win = null;
        await pause(500);
      }
    }
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = error.stack;
    console.error(error.stack);
  } finally {
    win?.destroy();
    writeFileSync(join(folder, 'result.json'), JSON.stringify(report, null, 2));
    writeFileSync(
      'artifacts/screen-preview-benchmark-result.json',
      JSON.stringify({ ...report, folder }, null, 2),
    );
    console.log(
      JSON.stringify({
        passed: report.passed,
        folder,
        runs: report.runs.map(
          ({
            mode,
            round,
            displayFrames,
            decodedFrames,
            analysisSamples,
            ageMedianMs,
            processes,
          }) => ({
            mode,
            round,
            displayFrames,
            decodedFrames,
            analysisSamples,
            ageMedianMs,
            processes,
          }),
        ),
      }),
    );
    app.exit(report.passed ? 0 : 1);
  }
});
