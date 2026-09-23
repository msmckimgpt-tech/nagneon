// Synthetic Windows input, real Electron/preload/React/server; no physical mouse claim.
const { app, BrowserWindow, session } = require('electron');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createStudioSession } = require('../desktop/session.cjs');
const { attachNavigationHistory } = require('../desktop/navigation.cjs');
fs.mkdirSync(resolve('artifacts'), { recursive: true });
const out = fs.mkdtempSync(resolve('artifacts/navigation-runtime-'));
app.setPath('userData', join(out, 'profile'));
const report = {
  passed: false,
  synthetic: true,
  physicalMouse: 'NOT_TESTED',
  checks: [],
  errors: [],
};
let service,
  main,
  overlay,
  modelCalls = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function nativeCommand(win, command) {
  const handle = win.getNativeWindowHandle();
  const hwnd =
    handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
  // Post only to the verifier-owned window, never the user's foreground window.
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class NavigationProbe { [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'; if (-not [NavigationProbe]::PostMessage([IntPtr]${hwnd}, 0x0319, [IntPtr]${hwnd}, [IntPtr]${command * 65536})) { exit 1 }`;
  const sent = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(sent.status, 0, sent.stderr || sent.error?.message);
  await pause(150);
}
app.whenReady().then(async () => {
  try {
    assert.equal(process.platform, 'win32');
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')).href);
    service = await startServer({
      port: 0,
      persist: false,
      localSpeech: false,
      provider: {
        status: () => ({ kind: 'codex', configured: false }),
        react: async () => {
          modelCalls++;
          throw Error('Unexpected model call');
        },
      },
    });
    service.studio.ai.update({ background: false });
    const options = {
      show: false,
      width: 1440,
      height: 980,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        contextIsolation: true,
        sandbox: true,
        preload: resolve('desktop/preload.cjs'),
        session: createStudioSession(session, service),
      },
    };
    main = new BrowserWindow(options);
    attachNavigationHistory(main);
    main.webContents.on('console-message', (_e, level, message) => {
      if (level === 3) report.errors.push(message);
    });
    const js = (code) => main.webContents.executeJavaScript(code);
    const until = async (code) => {
      for (let i = 0; i < 150; i++) {
        if (await js(code)) return;
        await pause(40);
      }
      throw Error('Timed out: ' + code);
    };
    const selected = () =>
      js(`document.querySelector('.sidebar nav button.selected')?.getAttribute('data-tutorial')`);
    const expectTab = async (tab) => {
      await until(
        `document.querySelector('[data-tutorial="nav-${tab}"]')?.classList.contains('selected')`,
      );
      await pause(100);
      assert.equal(await selected(), 'nav-' + tab);
    };
    const clickTab = async (tab) => {
      await js(`document.querySelector('[data-tutorial="nav-${tab}"]').click()`);
      await expectTab(tab);
    };
    const move = async (command, tab) => {
      await nativeCommand(main, command);
      await expectTab(tab);
    };
    await main.loadURL(service.url + '/');
    await until(`!!document.querySelector('.welcome-shell')`);
    await js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='튜토리얼 건너뛰기').click()`,
    );
    await expectTab('studio');
    const originalURL = main.webContents.getURL();
    await clickTab('audience');
    await clickTab('community');
    await move(1, 'audience');
    await move(1, 'studio');
    await move(1, 'studio');
    await move(2, 'audience');
    await move(2, 'community');
    await move(2, 'community');
    report.checks.push('WM_APPCOMMAND back/forward: exactly one tab, both boundaries no-op');
    await move(1, 'audience');
    await clickTab('clips');
    await move(2, 'clips');
    await clickTab('clips');
    await move(1, 'audience');
    report.checks.push('new navigation discards forward history; repeated tab adds no entry');
    await js(`document.querySelector('.ai-status-link').click()`);
    await expectTab('ai');
    await move(1, 'audience');
    await move(2, 'ai');
    report.checks.push('AI status entry shares tab history');
    overlay = new BrowserWindow(options);
    await overlay.loadURL(service.url + '/overlay');
    await nativeCommand(overlay, 1);
    await nativeCommand(overlay, 2);
    // Even a misdirected IPC event must not subscribe in the overlay renderer.
    overlay.webContents.send('navigation:history', 'back');
    await expectTab('ai');
    assert.equal(overlay.listenerCount('app-command'), 0);
    report.checks.push('overlay native commands leave main tab unchanged');
    assert.equal(main.webContents.getURL(), originalURL);
    assert.equal(main.webContents.navigationHistory.length(), 1);
    assert.equal(modelCalls, 0);
    assert.deepEqual(report.errors, []);
    report.checks.push(
      'URL and Chromium page history unchanged; zero model calls or renderer errors',
    );
    fs.writeFileSync(join(out, 'navigation.png'), (await main.webContents.capturePage()).toPNG());
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    console.error(error);
  } finally {
    overlay?.destroy();
    main?.destroy();
    await service?.close();
    fs.writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ out, ...report }));
    app.exit(report.passed ? 0 : 1);
  }
});
