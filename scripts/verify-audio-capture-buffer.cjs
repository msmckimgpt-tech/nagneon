// Synthetic audio only: no microphone, desktop capture, playback or provider.
// Exercise the real Chromium queue and production PCM reader under UI stalls.
const { app, BrowserWindow } = require('electron');
const { resolve, join } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { build } = require('esbuild');
const assert = require('node:assert/strict');
const base = resolve('artifacts/audio-capture-buffer-' + Date.now());
mkdirSync(base, { recursive: true });
app.setPath('userData', join(base, 'profile'));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const report = { passed: false, physicalCapture: false, playback: false, provider: false, cases: [] };
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  try {
    const bundle = await build({ entryPoints: ['src/continuous-microphone.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'captureUnderTest' });
    await window.loadURL('data:text/html,<title>Synthetic capture queue</title>');
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text);
    for (const spec of [{ baseline: true, blockMs: 1500, packets: 400 }, { baseline: false, blockMs: 1500, packets: 400 }, { baseline: false, blockMs: 6500, packets: 800 }]) {
      const result = await window.webContents.executeJavaScript('(' + async function run(spec) {
        const original = MediaStreamTrackProcessor;
        if (spec.baseline) globalThis.MediaStreamTrackProcessor = class extends original { constructor(options) { super({ ...options, maxBufferSize: 100 }); } };
        const generator = new MediaStreamTrackGenerator({ kind: 'audio' });
        const chunks = [], errors = [];
        let producer, dispose;
        try {
          dispose = await captureUnderTest.startContinuousMicrophone({ track: generator, onFrames: value => chunks.push(value), onFailure: e => errors.push(e.message) });
          const source = `onmessage=async e=>{const writer=e.data.stream.getWriter();for(let i=0;i<e.data.packets;i++){await writer.write(new AudioData({format:'f32',sampleRate:48000,numberOfFrames:480,numberOfChannels:1,timestamp:i*10000,data:new Float32Array(480).fill((i%40+1)/100)}));await new Promise(r=>setTimeout(r,10));}postMessage('done');};`;
          const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
          producer = new Worker(url); URL.revokeObjectURL(url);
          const produced = new Promise((done, fail) => { producer.onmessage = () => done(); producer.onerror = e => fail(Error(e.message)); });
          producer.postMessage({ stream: generator.writable, packets: spec.packets }, [generator.writable]);
          await new Promise(r => setTimeout(r, 200));
          const started = performance.now(); while (performance.now() - started < spec.blockMs) {}
          await Promise.race([produced, new Promise((_, fail) => setTimeout(() => fail(Error('Synthetic producer timed out')), 15000))]);
          await new Promise(r => setTimeout(r, 150));
          dispose(); dispose = null;
          let contiguous = true, next = 0, samplesCorrect = true;
          for (const chunk of chunks) {
            if (chunk.startFrame !== next) contiguous = false;
            for (let n = 0; n < chunk.samples.length; n++) {
              const packet = Math.floor((chunk.startFrame + n) / 160);
              if (Math.abs(chunk.samples[n] - Math.round((packet % 40 + 1) / 100 * 32767)) > 1) samplesCorrect = false;
            }
            next += chunk.samples.length;
          }
          return { ...spec, frames: next, expectedFrames: spec.packets * 160, contiguous, samplesCorrect, errors };
        } finally { dispose?.(); producer?.terminate(); generator.stop(); globalThis.MediaStreamTrackProcessor = original; }
      }.toString() + ')(' + JSON.stringify(spec) + ')');
      report.cases.push(result);
      if (spec.baseline || spec.blockMs > 5000) {
        assert.ok(result.errors.some(error => error.includes('입력 시간이 이어지지')));
        assert.ok(result.frames < result.expectedFrames);
      } else {
        assert.deepEqual(result.errors, []); assert.equal(result.frames, result.expectedFrames);
        assert.equal(result.contiguous, true); assert.equal(result.samplesCorrect, true);
      }
    }
    report.passed = true;
  } catch (error) { report.error = error.stack; }
  finally { window.destroy(); writeFileSync(join(base, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ base, ...report }, null, 2)); app.exit(report.passed ? 0 : 1); }
});
