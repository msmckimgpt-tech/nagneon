// Actual app hook and physical microphone in an isolated profile. The test
// removes its own captured audio after checking file counts; reports contain
// only metadata, never samples or transcripts.
const { app, BrowserWindow, session } = require('electron');
const { resolve, join, relative } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { rm } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

const durationMs = Number(
  process.argv.find((arg) => arg.startsWith('--duration-ms='))?.split('=')[1] || 30000,
);
const base = resolve('artifacts/continuous-microphone-app-' + Date.now());
mkdirSync(base, { recursive: true });
app.setPath('userData', join(base, 'profile'));
const report = {
  base,
  durationMs,
  passed: false,
  physicalMicrophone: true,
  providerCall: false,
  recordingRetained: false,
};
let service, window, list;
const timeout = setTimeout(() => app.exit(2), durationMs + 60000);
timeout.unref();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')));
    const { SpeechRecoveryStore } = await import(
      pathToFileURL(resolve('server/speech-recovery-store.js'))
    );
    const { createStudioSession } = require(resolve('desktop/session.cjs'));
    service = await startServer({
      port: 0,
      dataDir: join(base, 'data'),
      localSpeech: false,
      provider: {
        status: () => ({ configured: true, kind: 'synthetic' }),
        react: async () => ({
          observation: {
            game: 'synthetic',
            scene: 'isolated microphone check',
            confidence: 1,
            excitement: 0,
            messages: [],
          },
        }),
      },
    });
    list = () => new SpeechRecoveryStore(join(base, 'data', 'speech-recovery')).list();
    const studioSession = createStudioSession(session, service);
    studioSession.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(permission === 'media'),
    );
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: studioSession,
        preload: resolve('desktop/preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    await window.loadURL(service.url);
    const onboardingDeadline = Date.now() + 10000;
    let skipped = false;
    while (Date.now() < onboardingDeadline) {
      report.onboardingButton = await window.webContents.executeJavaScript(
        `(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent?.trim()==='튜토리얼 건너뛰기');if(!button)return {found:false};if(button.disabled)return {found:true,disabled:true};button.click();return {found:true,disabled:false};})()`,
      );
      if (report.onboardingButton.found && !report.onboardingButton.disabled) {
        skipped = true;
        break;
      }
      await pause(200);
    }
    assert.equal(skipped, true, 'isolated onboarding could not be completed');
    await pause(500);
    service.studio.configure({ ...service.studio.settings, mode: 'live', intervalSeconds: 60 });
    service.studio.start();
    const buttonDeadline = Date.now() + 10000;
    while (Date.now() < buttonDeadline) {
      report.micButton = await window.webContents.executeJavaScript(
        `(()=>{const button=document.querySelector('button[title="마이크"]');if(!button)return {found:false};if(button.textContent?.includes('마이크 켜짐'))return {found:true,active:true,text:button.textContent};if(button.disabled)return {found:true,disabled:true,text:button.textContent};button.click();return {found:true,disabled:false,text:button.textContent};})()`,
      );
      if (report.micButton.found && (report.micButton.active || !report.micButton.disabled)) break;
      await pause(200);
    }
    if (!report.micButton?.found)
      report.ui = await window.webContents.executeJavaScript(
        `({text:document.body.innerText.slice(0,1000),buttons:[...document.querySelectorAll('button')].map(button=>({text:button.textContent,title:button.title})).slice(0,30)})`,
      );
    assert.ok(
      report.micButton?.active || report.micButton?.disabled === false,
      'microphone control was unavailable',
    );
    const deadline = Date.now() + 20000;
    let active = false;
    while (Date.now() < deadline) {
      active = (await list()).some((entry) => entry.chunkCount >= 2);
      if (active) break;
      await pause(200);
    }
    if (!active) {
      report.uiAfter = await window.webContents.executeJavaScript(
        `({text:document.body.innerText.slice(-1600),mic:document.querySelector('button[title="마이크"]')?.textContent})`,
      );
      report.studio = {
        running: service.studio.running,
        sessionId: service.studio.sessionId,
        mode: service.studio.settings.mode,
      };
    }
    assert.equal(active, true, 'the production media hook did not connect the microphone');
    await pause(durationMs);
    const entries = await list();
    report.entries = entries.map(({ sessionId, inputEpoch, chunkCount, bytes }) => ({
      sessionId,
      inputEpoch,
      chunkCount,
      bytes,
    }));
    assert.equal(entries.length, 1);
    assert.ok(entries[0].chunkCount >= (durationMs / 1000) * 0.75);
    report.hookConnected = active;
    report.savedSeconds = entries[0].bytes / 32000;
    service.studio.stop();
    await pause(1500);
    const stoppedCount = (await list())[0].chunkCount;
    await pause(1500);
    report.captureStopped = (await list())[0].chunkCount === stoppedCount;
    assert.equal(report.captureStopped, true);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    await service?.close().catch((error) => {
      report.closeError = error.message;
      report.passed = false;
    });
    const captured = resolve(base, 'data', 'speech-recovery');
    const rel = relative(base, captured);
    if (rel === 'data\\speech-recovery' || rel === 'data/speech-recovery') {
      await rm(captured, { recursive: true, force: true });
      report.recordingRetained = false;
    } else {
      report.cleanupError = 'unexpected recovery path';
      report.passed = false;
    }
    clearTimeout(timeout);
    writeFileSync(join(base, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    app.exit(report.passed ? 0 : 1);
  }
});
