// Real production display, capture sampler and clip buffers; synthetic pixels
// and 440/880Hz tracks only. All windows stay offscreen and hidden. Native
// visibility events are simulated, not a physical Windows minimize acceptance.
const { app, BrowserWindow, ipcMain } = require('electron');
const { join, resolve } = require('node:path');
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { build, stop: stopBuild } = require('esbuild');
const assert = require('node:assert/strict');
const { attachPreviewVisibility } = require('../desktop/preview-visibility.cjs');
const base = resolve('artifacts/screen-preview-qa-' + Date.now());
mkdirSync(base, { recursive: true });
app.setPath('userData', join(base, 'profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const report = {
  base,
  passed: false,
  synthetic: true,
  physicalDevices: false,
  visibleWindows: false,
  nativeVisibilitySimulated: true,
  checks: [],
  layouts: [],
  errors: [],
};
let win;
setTimeout(() => app.exit(2), 100000).unref();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'tsx',
        contents: `
    import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
    import {ScreenPreview} from './src/ScreenPreview';import {useClipBuffer} from './src/useClipBuffer';
    import {prepareCapture,releaseCapture} from './src/capture-preparation';
    import {startTemporalCapture} from './src/temporal-capture';import {TemporalFrames} from './src/temporal-frames';
    import './src/style.css';
    window.errors=[];window.paintCount=0;window.displayPlays=0;window.displayPauses=0;window.sources=[];window.buffers=[];
    window.displayTimers=new Set();window.displayListeners=new Set();window.displayObservers=new Set();
    const timeout=window.setTimeout.bind(window),cancel=window.clearTimeout.bind(window);
    window.setTimeout=(fn,ms,...args)=>{if(ms===1000&&fn.name==='tick'){let id=timeout(()=>{displayTimers.delete(id);fn(...args);},ms);displayTimers.add(id);return id;}return timeout(fn,ms,...args);};
    window.clearTimeout=id=>{displayTimers.delete(id);cancel(id);};
    const add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);
    document.addEventListener=(name,fn,...args)=>{if(name==='visibilitychange')displayListeners.add(fn);return add(name,fn,...args);};
    document.removeEventListener=(name,fn,...args)=>{if(name==='visibilitychange')displayListeners.delete(fn);return remove(name,fn,...args);};
    const Observer=window.IntersectionObserver;window.IntersectionObserver=class extends Observer{constructor(...args){super(...args);displayObservers.add(this);}disconnect(){displayObservers.delete(this);super.disconnect();}};
    const originalPlay=HTMLMediaElement.prototype.play,originalPause=HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play=function(){if(this.closest('.preview'))displayPlays++;return originalPlay.call(this);};
    HTMLMediaElement.prototype.pause=function(){if(this.closest('.preview'))displayPauses++;return originalPause.call(this);};
    const audio=new AudioContext();await audio.resume();
    function tone(hz){const destination=audio.createMediaStreamDestination(),osc=audio.createOscillator();osc.frequency.value=hz;osc.connect(destination);osc.start();return destination.stream;}
    const microphone=tone(880),system=tone(440);window.microphone=microphone;
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');window.color='#d02030';
    const paint=setInterval(()=>{paintCount++;ctx.fillStyle=color;ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.fillText('SYNTHETIC '+paintCount,20,20);},1000/15);
    const ring=new TemporalFrames();window.ring=ring;
    function Probe(){
      const [source,setSource]=useState(null),[shown,setShown]=useState(true),[running,setRunning]=useState(true),[session,setSession]=useState('preview-qa');
      window.toggleShown=setShown;window.running=setRunning;window.session=setSession;
      const clips=useClipBuffer(running?source?.stream||null:null,running?microphone:null,running,session,running?system:null,e=>errors.push(e));window.clipBuffering=clips.buffering;window.takeAt=clips.takeAt;
      useEffect(()=>{if(!source||!running)return;ring.reset(session,source.id);return startTemporalCapture(source.video,ring,e=>errors.push(e.message));},[source,running,session]);
      window.select=async()=>{const previous=window.selected;const stream=new MediaStream([...canvas.captureStream(15).getVideoTracks(),...system.getAudioTracks().map(t=>t.clone())]);sources.push(stream);const prepared=await prepareCapture({acquire:async()=>stream,signal:new AbortController().signal,onPhase:()=>{}});const next={...prepared,id:crypto.randomUUID()};window.selected=next;setSource(next);if(previous)releaseCapture(previous);};
      window.stop=()=>{setRunning(false);setSource(null);if(window.selected){releaseCapture(window.selected);window.selected=null;}};
      window.shutdown=async()=>{window.stop();clearInterval(paint);microphone.getTracks().forEach(t=>t.stop());system.getTracks().forEach(t=>t.stop());await audio.close();};
      window.getClip=async(at)=>{const clip=await clips.takeAt(at);return clip?{kind:clip.kind,startedAt:clip.startedAt,endedAt:clip.endedAt,hasAudio:clip.hasAudio,base:new Uint8Array(await clip.blob.arrayBuffer()),voice:clip.voice?new Uint8Array(await clip.voice.blob.arrayBuffer()):null}:null;};
      return <div className="app-shell"><main><section className="panel"><h1>합성 미리보기 검증</h1>{shown&&<div className={'preview '+(source?'has-video':'')}><ScreenPreview source={source?.stream||null}/>{source&&<div className="preview-caption"><span className="dot green"/>화면 연결됨</div>}</div>}</section></main></div>;
    }
    const root=createRoot(document.getElementById('root'));window.root=root;root.render(<React.StrictMode><Probe/></React.StrictMode>);
  `,
      },
      bundle: true,
      format: 'esm',
      target: 'chrome130',
      outfile: join(base, 'probe.js'),
    });
    writeFileSync(
      join(base, 'index.html'),
      '<html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="probe.css"><div id="root"></div><script type="module" src="probe.js"></script></html>',
    );
    stopBuild();
    writeFileSync(
      join(base, 'probe-preload.cjs'),
      readFileSync('desktop/preload.cjs', 'utf8') +
        '\ncontextBridge.exposeInMainWorld("previewProbe",{listenerCount:()=>ipcRenderer.listenerCount("preview:visible")});\n',
    );
    win = new BrowserWindow({
      show: false,
      width: 1260,
      height: 900,
      webPreferences: {
        preload: join(base, 'probe-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
        offscreen: true,
      },
    });
    let visible = true,
      minimized = false;
    const visibilityWindow = {
      webContents: win.webContents,
      isDestroyed: () => win.isDestroyed(),
      isVisible: () => visible,
      isMinimized: () => minimized,
      on: win.on.bind(win),
      once: win.once.bind(win),
      removeListener: win.removeListener.bind(win),
    };
    const nativeListenerBaseline = {
      hide: win.listenerCount('hide'),
      minimize: win.listenerCount('minimize'),
    };
    attachPreviewVisibility({ main: visibilityWindow, ipcMain });
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 3) report.errors.push(e.message);
    });
    await win.loadFile(join(base, 'index.html'));
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const until = async (code, limit = 7000) => {
      const at = Date.now();
      while (Date.now() - at < limit) {
        if (await js(code)) return;
        await pause(60);
      }
      throw Error('Preview QA timeout: ' + code);
    };
    await until('typeof select==="function"');
    await js('select()');
    await until('document.querySelector(".preview video")?.videoWidth===640&&clipBuffering');
    await until('document.querySelector(".preview-state")?.textContent==="선택한 화면 미리보기"');
    assert.equal(await js('displayTimers.size'), 1);
    assert.equal(await js('displayListeners.size'), 1);
    assert.equal(await js('displayObservers.size'), 1);
    assert.equal(await js('previewProbe.listenerCount()'), 1);
    const initial = await js(
      '({plays:displayPlays,at:selected.video.currentTime,samples:ring.samples.length})',
    );
    await pause(700);
    assert.equal(await js('displayPlays'), initial.plays);
    report.checks.push(
      'source is connected once; normal updates do not replay the display or alter analysis',
    );
    const pick = Date.now();
    minimized = true;
    win.emit('minimize');
    await until(
      'document.querySelector(".preview video").paused&&document.querySelector(".preview video").srcObject===null',
    );
    assert.match(await js('document.querySelector(".preview-state").textContent'), /일시정지/);
    assert.equal(await js('displayTimers.size'), 0);
    const before = await js('({at:selected.video.currentTime,samples:ring.samples.length})');
    await pause(2100);
    const after = await js(
      '({at:selected.video.currentTime,samples:ring.samples.length,buffering:clipBuffering,tracks:selected.stream.getTracks().every(t=>t.readyState==="live")})',
    );
    assert.ok(after.at > before.at + 1.5);
    assert.ok(after.samples >= before.samples + 3);
    assert.equal(after.buffering, true);
    assert.equal(after.tracks, true);
    report.checks.push(
      'simulated minimize detaches only display while analysis sampling and clip buffering continue',
    );
    await js('color="#2050d0"');
    minimized = false;
    win.emit('restore');
    await until(
      'document.querySelector(".preview video")?.srcObject===selected.stream&&!document.querySelector(".preview video").paused',
    );
    await until(
      `(()=>{const v=document.querySelector('.preview video'),c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(v,0,0,1,1);return ctx.getImageData(0,0,1,1).data[2]>150;})()`,
    );
    report.checks.push(
      'restore immediately shows the latest blue source rather than the old red frame',
    );
    await js(
      'Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"))',
    );
    await until('document.querySelector(".preview video").srcObject===null');
    await js('delete document.hidden;document.dispatchEvent(new Event("visibilitychange"))');
    await until('document.querySelector(".preview video").srcObject===selected.stream');
    report.checks.push('document visibility resumes the independent display with one timer');
    await until(
      'document.querySelector(".preview-state").textContent==="선택한 화면 미리보기"&&!document.querySelector(".preview video").paused',
    );
    await js('document.querySelector(".preview video").pause()');
    await until('document.querySelector(".preview-state").textContent.includes("마지막 화면")');
    assert.equal(await js('selected.stream.getTracks().every(t=>t.readyState==="live")'), true);
    report.checks.push('a frozen display is labelled last frame while capture remains connected');
    visible = false;
    win.emit('hide');
    await until('document.querySelector(".preview video").srcObject===null');
    visible = true;
    win.emit('show');
    await until('document.querySelector(".preview video").srcObject===selected.stream');
    await js('document.querySelector(".preview").style.marginTop="1400px"');
    await until('document.querySelector(".preview video").srcObject===null');
    await js('document.querySelector(".preview").style.marginTop="0"');
    await until('document.querySelector(".preview video").srcObject===selected.stream');
    report.checks.push('hide/show and real viewport intersection pause and resume display');
    await js('window.oldDisplay=document.querySelector(".preview video");toggleShown(false)');
    await until('!document.querySelector(".preview video")');
    assert.equal(
      await js(
        'oldDisplay.paused&&oldDisplay.srcObject===null&&selected.stream.getTracks().every(t=>t.readyState==="live")',
      ),
      true,
    );
    assert.equal(
      await js(
        'displayTimers.size+displayListeners.size+displayObservers.size+previewProbe.listenerCount()',
      ),
      0,
    );
    await js('toggleShown(true)');
    await until('document.querySelector(".preview video")?.srcObject===selected.stream');
    report.checks.push(
      'tab unmount releases its player and remount resumes without ending capture',
    );
    await js('window.oldSource=selected.stream;color="#d02030";select()');
    await until(
      'oldSource.getTracks().every(t=>t.readyState==="ended")&&document.querySelector(".preview video").srcObject===selected.stream',
    );
    report.checks.push(
      'source replacement releases the old owned tracks and attaches one new display',
    );
    // Use the second source, whose clip segment will contain activity before and
    // after hiding the display; no recorder is stopped by the visibility gate.
    const at = Date.now();
    visible = false;
    win.emit('hide');
    await until('document.querySelector(".preview video").srcObject===null');
    await pause(1200);
    const clip = await js(`getClip(${at})`);
    assert.ok(clip && clip.hasAudio && clip.voice && clip.endedAt > at + 500);
    writeFileSync(join(base, 'hidden-video.webm'), Buffer.from(clip.base));
    writeFileSync(join(base, 'hidden-microphone.webm'), Buffer.from(clip.voice));
    report.clip = {
      startedAt: clip.startedAt,
      pickedAt: at,
      endedAt: clip.endedAt,
      hasAudio: clip.hasAudio,
      voice: true,
    };
    report.checks.push(
      'completed clip includes picture, system audio and separate microphone with context after the hidden-state pick',
    );
    visible = true;
    win.emit('show');
    await until('document.querySelector(".preview video").srcObject===selected.stream');
    for (const [width, height] of [
      [1260, 900],
      [420, 850],
    ]) {
      win.setSize(width, height);
      await pause(300);
      report.layouts.push(
        await js(
          `(()=>{const p=document.querySelector('.preview'),s=document.querySelector('.preview-state'),b=p.getBoundingClientRect(),t=s.getBoundingClientRect();return {width:innerWidth,height:innerHeight,previewWidth:b.width,statusWithin:t.left>=b.left&&t.right<=b.right&&t.top>=b.top&&t.bottom<=b.bottom};})()`,
        ),
      );
      writeFileSync(
        join(base, `preview-${width}.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
      assert.equal(report.layouts.at(-1).statusWithin, true);
    }
    await js('stop()');
    await until('sources.every(s=>s.getTracks().every(t=>t.readyState==="ended"))&&!clipBuffering');
    assert.equal(
      await js(
        'displayTimers.size+displayListeners.size+displayObservers.size+previewProbe.listenerCount()',
      ),
      0,
    );
    await js('running(true);session("preview-qa-next");select()');
    await until(
      'clipBuffering&&document.querySelector(".preview video")?.srcObject===selected.stream',
    );
    report.checks.push(
      'broadcast stop/restart clears tracks and starts a new analysis/recording generation',
    );
    await js('shutdown().then(()=>root.unmount())');
    await until('sources.every(s=>s.getTracks().every(t=>t.readyState==="ended"))');
    report.rendererCleanup = await js(
      '({timers:displayTimers.size,listeners:displayListeners.size,observers:displayObservers.size,ipcListeners:previewProbe.listenerCount()})',
    );
    assert.deepEqual(report.rendererCleanup, {
      timers: 0,
      listeners: 0,
      observers: 0,
      ipcListeners: 0,
    });
    report.nativeListenerBaseline = nativeListenerBaseline;
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    console.error(error.stack);
  } finally {
    if (win && !win.isDestroyed()) {
      const closed = new Promise((resolve) => win.once('closed', () => resolve(true)));
      win.destroy();
      report.closedObserved = await Promise.race([closed, pause(3000).then(() => false)]);
      if (!report.closedObserved) {
        report.passed = false;
        report.error = 'Native closed event was not observed';
      }
    }
    report.mainCleanup = {
      hideListeners: win?.listenerCount('hide'),
      minimizeListeners: win?.listenerCount('minimize'),
    };
    if (
      report.nativeListenerBaseline &&
      (report.mainCleanup.hideListeners !== report.nativeListenerBaseline.hide ||
        report.mainCleanup.minimizeListeners !== report.nativeListenerBaseline.minimize)
    ) {
      report.passed = false;
      report.error = 'Native display visibility listeners were not released';
    }
    writeFileSync(join(base, 'result.json'), JSON.stringify(report, null, 2));
    writeFileSync('artifacts/screen-preview-qa-result.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    app.exit(report.passed ? 0 : 1);
  }
});
