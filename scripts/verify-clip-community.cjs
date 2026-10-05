// Run: node scripts/verify-clip-community.cjs
// Uses a fresh, hidden Electron profile and synthetic sources. Never captures
// a real screen/microphone, opens an account, or contacts a model provider.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(require('electron'), [__filename], {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: 'inherit',
    timeout: 120000,
  });
  if (child.error) console.error(child.error);
  process.exit(child.status ?? 1);
}
const { app, BrowserWindow, session } = require('electron');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts', 'clip-community-native-' + Date.now());
fs.mkdirSync(out, { recursive: true });
const profile = path.join(out, 'profile');
fs.mkdirSync(profile);
app.setPath('userData', profile);
app.commandLine.appendSwitch('backseat-profile', profile);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
let win;
const result = {
  synthetic: true,
  physicalDevices: false,
  realAccount: false,
  profile,
  checks: [],
  screenshots: [],
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (source) => win.webContents.executeJavaScript(source, true);
async function until(source) {
  const deadline = Date.now() + 10000;
  while (!(await evaluate(source))) {
    if (Date.now() > deadline) throw Error('Timed out: ' + source);
    await delay(40);
  }
}
function checked(name) {
  result.checks.push(name);
}
const timeout = setTimeout(() => {
  fs.writeFileSync(path.join(out, 'timeout.json'), JSON.stringify(result, null, 2));
  app.exit(1);
}, 90000);
app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    await build({
      entryPoints: [path.join(__dirname, 'verify-clip-community-renderer.tsx')],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      outfile: path.join(out, 'fixture.js'),
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      logLevel: 'silent',
    });
    fs.writeFileSync(
      path.join(out, 'index.html'),
      `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'none'"><link rel="stylesheet" href="fixture.css"><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#141723;color:#ececf4;font:14px/1.5 system-ui,sans-serif;--border:#303443}button,input,textarea{font:inherit}button{color:inherit;cursor:pointer}input,textarea{background:#202434;border:1px solid #303443;color:inherit;padding:10px;border-radius:8px}.panel{max-width:1100px;margin:auto}.panel-heading{display:flex;justify-content:space-between}.secondary,.text-button{background:transparent;color:inherit;border:1px solid #303443;border-radius:8px;padding:8px 12px}.muted{opacity:.7}@media(max-width:600px){body{padding:10px}}</style><title>합성 커뮤니티 검증</title><div id="root"></div><script src="fixture.js"></script></html>`,
    );
    win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadFile(path.join(out, 'index.html'));
    await until("window.fixture?.ready && document.querySelector('[role=switch]')");
    await evaluate(
      "document.querySelector('details').open=true; document.querySelector('[role=switch]').focus();",
    );
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await until(
      "window.fixture.preferences.enabled===false && document.querySelector('[role=switch]').getAttribute('aria-checked')==='false'",
    );
    assert.deepEqual(await evaluate('window.fixture.preferences.mutedTopics'), ['quiet']);
    checked('Space toggles master switch and preserves child preferences');
    await evaluate(
      "window.fixture.failNext=true; document.querySelector('[role=switch]').focus();",
    );
    // Chromium's native button Enter activation includes the character event.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await until('window.fixture.errors.length===1');
    assert.equal(
      await evaluate("document.querySelector('[role=switch]').getAttribute('aria-checked')"),
      'false',
    );
    checked('Enter reaches PATCH; failed persistence leaves switch unchanged');
    const before = await evaluate('window.fixture.patches.length');
    await evaluate(
      "window.fixture.holdNext=true; const button=document.querySelector('[role=switch]'); button.click(); button.click();",
    );
    await until("document.querySelector('[role=switch]').disabled");
    assert.equal(await evaluate('window.fixture.patches.length'), before + 1);
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.community-settings button')].every(button=>button.disabled)",
      ),
      true,
    );
    await evaluate('window.fixture.release()');
    await until(
      "window.fixture.preferences.enabled===true && !document.querySelector('[role=switch]').disabled",
    );
    checked('Duplicate clicks produce one pending write; busy disables all setting writes');
    await evaluate("document.querySelector('.community-topic-chips button').click()");
    await until("window.fixture.preferences.mutedTopics.includes('practice')");
    checked('Topic chip writes the existing mutedTopics preference');
    for (const [width, height] of [
      [1280, 900],
      [960, 720],
      [480, 800],
    ]) {
      win.setContentSize(width, height);
      await delay(100);
      const layout =
        await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      clipped:[...document.querySelectorAll('.community-switch-row,.community-topic-chips button')].some(el=>{const r=el.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}),
      minSwitch:Math.min(...[...document.querySelectorAll('[role=switch]')].map(el=>el.getBoundingClientRect().height))})`);
      assert.ok(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout));
      assert.equal(layout.clipped, false);
      assert.ok(layout.minSwitch >= 44);
      const screenshot = path.join(out, `settings-${width}x${height}.png`);
      fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      result.screenshots.push(screenshot);
      checked(`Settings geometry ${width}x${height}`);
    }
    await evaluate("document.querySelector('.social-post').click()");
    await until("document.querySelector('.social-discussion img')");
    assert.equal(await evaluate("document.querySelectorAll('input[type=file]').length"), 0);
    assert.equal(
      await evaluate("document.querySelector('.social-discussion img').alt"),
      '기존 주민 그림.png',
    );
    assert.equal(await evaluate("!!document.querySelector('.social-discussion textarea')"), true);
    checked(
      'Actual community detail renders legacy attachment and text reply, with no upload control',
    );
    const audio = await evaluate('window.fixture.audio()');
    fs.writeFileSync(path.join(out, 'base-game.webm'), Buffer.from(audio.baseBytes, 'base64'));
    fs.writeFileSync(
      path.join(out, 'voice-microphone.webm'),
      Buffer.from(audio.voiceBytes, 'base64'),
    );
    delete audio.baseBytes;
    delete audio.voiceBytes;
    result.audio = audio;
    checked(
      'Real Electron MediaRecorder preserves 440Hz game audio after analyser stop, separately from 880Hz voice',
    );
    result.ok = true;
  })
  .catch((error) => {
    result.ok = false;
    result.error = error.stack || String(error);
    console.error(result.error);
  })
  .finally(() => {
    clearTimeout(timeout);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ output: out, ...result }, null, 2));
    win?.destroy();
    app.exit(result.ok ? 0 : 1);
  });
