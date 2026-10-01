// Actual hidden renderer and authenticated product API; replayed synthetic
// response and virtual clock. No subscription model, account or physical device.
const { app, BrowserWindow, session } = require('electron');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const base = join(root, 'artifacts', 'direct-question-ui-' + Date.now());
mkdirSync(base, { recursive: true });
app.setPath('userData', join(base, 'profile'));
const report = {
  base,
  passed: false,
  modelCalls: 0,
  syntheticReplay: true,
  virtualClock: true,
  installedExe: false,
  physicalUI: false,
};
let service,
  win,
  closing = false,
  clock = Date.now(),
  replays = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function close() {
  if (closing) return;
  closing = true;
  report.ownedPids = app.getAppMetrics().map((m) => m.pid);
  if (win && !win.isDestroyed()) win.destroy();
  if (service) {
    service.studio.ai.update({ paused: true });
    service.studio.stop();
    await service.close();
  }
  report.normalCleanup = true;
  writeFileSync(join(base, 'result.json'), JSON.stringify(report, null, 2));
  writeFileSync(
    join(root, 'artifacts', 'direct-question-ui-result.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  app.exit(report.passed ? 0 : 1);
}
app.on('window-all-closed', () => {});
app.on('before-quit', (event) => {
  if (!closing) {
    event.preventDefault();
    void close();
  }
});
app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(join(root, 'server/index.js')));
    const { seedMetAudience } = await import(
      pathToFileURL(join(root, 'test/helpers/met-audience.js'))
    );
    const text = '오른쪽으로 이동했어요.';
    service = await startServer({
      port: 0,
      dataDir: join(base, 'data'),
      localSpeech: false,
      provider: {
        status: () => ({ configured: true }),
        react: async (args) => {
          assert.equal(++replays, 1);
          report.input = {
            frames: args.frames.length,
            speech: args.speech,
            directQuestion: args.viewerContext.pop.directQuestion,
          };
          clock += 20844;
          return {
            observation: {
              game: 'Synthetic',
              scene: '흰 네모가 오른쪽으로 이동했다.',
              confidence: 0.99,
              excitement: 0.1,
              messages: [
                {
                  personaId: 'pop',
                  text,
                  kind: 'chat',
                  spoiler: false,
                  intent: 'reply',
                  replyTo: null,
                },
              ],
            },
          };
        },
      },
    });
    const s = service.studio;
    clearInterval(s.timer);
    s.now = () => clock;
    s.reactions.now = () => clock;
    seedMetAudience(s);
    s.world.change((data) => {
      data.settings.personas = data.settings.personas.filter(
        (p) => p.id === 'pop' || p.id === data.settings.managerId,
      );
    });
    s.audience.random = () => 0;
    s.ai.update({
      paused: true,
      background: false,
      features: Object.fromEntries(Object.keys(s.ai.data.policy.features).map((k) => [k, false])),
    });
    s.configure({
      ...s.settings,
      mode: 'live',
      lurkRatio: 0,
      slowModeSeconds: 0,
      communityActivityEnabled: false,
      memesEnabled: false,
      discovery: { ...s.settings.discovery, enabled: false },
    });
    const post = async (route, body) => {
      const res = await fetch(service.url + '/api/' + route, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + service.accessToken,
          'X-Backseat-Client': 'studio',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 200);
      return res.json();
    };
    await post('onboarding', { skip: true });
    await post('tutorial', { action: 'skip' });
    await post('start', {});
    const at = clock + 1000;
    clock = at + 100;
    const speech =
      s.settings.personas.find((p) => p.id === 'pop').name +
      '님, 흰 네모가 방금 어느 쪽으로 이동했나요?';
    const frame = (word) => 'data:image/png;base64,' + Buffer.from(word).toString('base64');
    s.ai.update({ paused: false, features: { reaction: true } });
    const result = await post('react', {
      speech,
      video: {
        sessionId: s.sessionId,
        sourceId: randomUUID(),
        frames: [
          { image: frame('left'), at: at - 500 },
          { image: frame('middle'), at: at - 250 },
          { image: frame('right'), at },
        ],
      },
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(s.queue[0].replySourceId, s.messages[0].id);
    s.pump();
    assert.equal(s.messages.filter((m) => m.kind === 'chat').length, 1);
    report.diagnostics = s.reactions.snapshot(s.queue);
    assert.equal(report.diagnostics.summary.delivered, 1);
    s.ai.update({ paused: true });
    const { createStudioSession } = require(join(root, 'desktop/session.cjs'));
    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 980,
      webPreferences: {
        session: createStudioSession(session, service),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    await win.loadURL(service.url);
    const deadline = Date.now() + 10000;
    let body = '';
    while (Date.now() < deadline) {
      body = await win.webContents.executeJavaScript('document.body.innerText');
      if (body.includes(text)) break;
      await pause(100);
    }
    assert.ok(body.includes(text), 'Actual renderer must display the replayed answer');
    assert.ok(body.includes(speech), 'Current question must remain visible');
    report.rendererAnswerVisible = true;
    report.rendererQuestionVisible = true;
    report.backendChats = s.messages.filter((m) => m.kind === 'chat');
    report.syntheticProviderReplays = replays;
    report.virtualLatencyMs = 20844;
    writeFileSync(join(base, 'answer.png'), (await win.webContents.capturePage()).toPNG());
    report.passed = true;
  } catch (e) {
    report.error = e.stack;
    process.exitCode = 1;
  } finally {
    await close();
  }
});
