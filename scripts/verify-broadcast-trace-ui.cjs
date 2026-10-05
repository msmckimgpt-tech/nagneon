// Isolated real Electron renderer + authenticated local server. Synthetic input only.
const { app, BrowserWindow, session } = require('electron');
const { resolve, join } = require('node:path');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const base = resolve('artifacts/broadcast-trace-ui-' + Date.now());
mkdirSync(base, { recursive: true });
app.setPath('userData', join(base, 'profile'));
const report = {
  passed: false,
  synthetic: true,
  physicalDevices: false,
  externalModelCalls: 0,
  checks: [],
  base,
};
let service, win;
const save = () => writeFileSync(join(base, 'result.json'), JSON.stringify(report, null, 2));
const mark = (text) => {
  report.checks.push(text);
  save();
  console.log(text);
};
setTimeout(() => {
  report.error = 'UI watchdog';
  save();
  app.exit(2);
}, 60000).unref();
app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')));
    const { defaults } = await import(pathToFileURL(resolve('shared/defaults.js')));
    const { Audience } = await import(pathToFileURL(resolve('server/audience.js')));
    const { Settings } = await import(pathToFileURL(resolve('server/schema.js')));
    const { createStudioSession } = require(resolve('desktop/session.cjs'));
    const dataDir = join(base, 'data');
    mkdirSync(dataDir, { recursive: true });
    // Existing-profile fixture retains the synthetic roster. A fresh profile
    // intentionally starts with only a manager until audience discovery.
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify(defaults));
    const priorAudience = new Audience(
      undefined,
      () => {},
      () => 0.5,
    );
    priorAudience.start(Settings.parse(defaults), Date.now() - 10000);
    writeFileSync(join(dataDir, 'audience.json'), JSON.stringify(priorAudience.data));
    service = await startServer({
      port: 0,
      persist: true,
      localSpeech: false,
      dataDir,
      provider: {
        status: () => ({ configured: true }),
        react: async () => ({
          observation: {
            game: '합성 퍼즐',
            scene: '합성 시험',
            confidence: 0.9,
            excitement: 0.2,
            messages: [
              { personaId: 'pop', text: '합성 화면 표시 확인', kind: 'chat', spoiler: false },
            ],
          },
        }),
      },
    });
    const s = service.studio;
    clearInterval(s.timer);
    s.configure({
      ...s.settings,
      mode: 'live',
      lurkRatio: 0,
      communityActivityEnabled: false,
      autoHighlights: false,
      slowModeSeconds: 0,
      chatPace: 8,
    });
    win = new BrowserWindow({
      width: 1280,
      height: 850,
      show: false,
      webPreferences: {
        session: createStudioSession(session, service),
        sandbox: true,
        contextIsolation: true,
        offscreen: true,
        backgroundThrottling: false,
      },
    });
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
      report.deniedPermissionRequests = (report.deniedPermissionRequests || 0) + 1;
      callback(false);
    });
    win.webContents.session.setPermissionCheckHandler(() => false);
    await win.loadURL(service.url);
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const until = async (code) => {
      for (let i = 0; i < 160; i++) {
        if (await js(code)) return;
        await new Promise((done) => setTimeout(done, 50));
      }
      throw Error('UI deadline: ' + code);
    };
    const click = async (text) => {
      const selector =
        'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()===' +
        JSON.stringify(text) +
        '&&!b.disabled)';
      await until('!!(' + selector + ')');
      await js('(' + selector + ').click()');
    };
    await until('!!document.querySelector(".chat-scroll")');
    // Keep the fixture's unrelated observation timer from calling the model.
    await js(
      'window.fixtureFetch=window.fetch;window.fetch=(url,...args)=>String(url).endsWith("/api/react")?Promise.resolve(new Response(JSON.stringify({skipped:"fixture-no-input"}),{headers:{"Content-Type":"application/json"}})):fixtureFetch(url,...args);void 0',
    );
    s.start();
    s.audience.setPresence('pop', 'active', Date.now());
    s.receiveSpeech({ id: randomUUID(), sessionId: s.sessionId, text: '합성 입력 확인' });
    report.reaction = await s.react({});
    report.diagnostics = s.reactions.snapshot(s.queue);
    report.fixtureMode = s.settings.mode;
    assert.equal(s.queue.length, 1);
    s.queue[0].due = Date.now();
    s.pump();
    const message = s.messages.find((m) => m.text === '합성 화면 표시 확인');
    assert.ok(message);
    await until('document.querySelectorAll(".chat-scroll .chat-line").length>=2');
    for (let i = 0; i < 160 && !s.trace.snapshot().events.some((e) => e.kind === 'rendered'); i++)
      await new Promise((done) => setTimeout(done, 50));
    assert.ok(
      s.trace
        .snapshot()
        .events.some(
          (e) => e.kind === 'rendered' && e.message === s.trace.identity('message', message.id),
        ),
    );
    mark('real chat renderer acknowledges a published synthetic reply');
    await click('매니저');
    await until('!!document.querySelector(".reaction-diagnostics")');
    await js('document.querySelector(".reaction-diagnostics").open=true');
    await until('document.querySelector(".reaction-diagnostics").innerText.includes("모델 호출")');
    const downloaded = new Promise((done, fail) => {
      const timeout = setTimeout(() => fail(Error('Download deadline')), 8000);
      win.webContents.session.once('will-download', (_event, item) => {
        const file = join(base, item.getFilename());
        item.setSavePath(file);
        item.once('done', (_event, state) => {
          clearTimeout(timeout);
          state === 'completed' ? done(file) : fail(Error('Download ' + state));
        });
      });
    });
    await js(
      `document.querySelector('a[href="/api/diagnostics/broadcast-trace?download=true"]').click()`,
    );
    const file = await downloaded,
      data = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(data.enabled, true);
    assert.equal(data.error, '');
    assert.ok(data.events.some((e) => e.kind === 'rendered'));
    assert.equal(JSON.stringify(data).includes('합성 입력 확인'), false);
    assert.equal(JSON.stringify(data).includes('합성 화면 표시 확인'), false);
    report.download = file;
    mark('Korean download action saves authenticated content-free persistent metadata');
    const before = s.trace.snapshot().events.length;
    await js('fetch("/api/diagnostics/broadcast-trace").then(r=>r.json())');
    assert.equal(s.trace.snapshot().events.length, before);
    mark('reading the diagnostic export does not generate new events');
    s.trace.append = () => {
      throw Error('synthetic disk failure');
    };
    s.trace.lifecycle('service', 'started');
    await click('새로 확인');
    await until(
      'document.querySelector(".reaction-diagnostics [role=alert]")?.textContent.includes("진단 저장")',
    );
    assert.equal(s.running, true);
    mark('recording failure appears in diagnostics while the broadcast continues');
    await js('document.querySelector(".reaction-diagnostics").scrollIntoView({block:"center"})');
    await js('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    writeFileSync(join(base, 'diagnostics.png'), (await win.webContents.capturePage()).toPNG());
    s.stop();
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    if (win && !win.isDestroyed()) {
      writeFileSync(join(base, 'failure.png'), (await win.webContents.capturePage()).toPNG());
      writeFileSync(
        join(base, 'failure-page.txt'),
        await win.webContents
          .executeJavaScript('document.body.innerText')
          .catch(() => 'Unavailable'),
      );
    }
  } finally {
    win?.destroy();
    await service?.close();
    save();
    writeFileSync('artifacts/broadcast-trace-ui-result.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    app.exit(report.passed ? 0 : 1);
  }
});
