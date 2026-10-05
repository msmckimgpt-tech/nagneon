// Isolated Electron renderer and local server; no user profile, network model or devices.
const { app, BrowserWindow, session } = require('electron');
const { resolve, join } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const base = resolve('artifacts/culture-status-ui-' + Date.now());
mkdirSync(base, { recursive: true });
app.setPath('userData', join(base, 'profile'));
const report = {
  base,
  passed: false,
  synthetic: true,
  physicalDevices: false,
  modelCalls: 0,
  checks: [],
};
const save = () => writeFileSync(join(base, 'result.json'), JSON.stringify(report, null, 2));
let service, win;
setTimeout(() => {
  report.error = 'UI watchdog';
  save();
  app.exit(2);
}, 45000).unref();
app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')));
    const { defaults } = await import(pathToFileURL(resolve('shared/defaults.js')));
    const { createStudioSession } = require(resolve('desktop/session.cjs'));
    const now = Date.now(),
      dataDir = join(base, 'data');
    mkdirSync(dataDir, { recursive: true });
    const pattern = {
      meaning: '작은 선택을 장난스럽게 과장',
      situation: '가벼운 잡담',
      avoid: '명시적으로 중단한 농담',
    };
    const source = (name, extra = {}) => ({
      origin: `https://${name}.example.org`,
      nextAt: now + 3600000,
      checkedAt: now,
      analyzedAt: now,
      error: '',
      analysis: { tendencies: '합성 표본', patterns: [pattern] },
      ...extra,
    });
    const sources = [
      source('ready'),
      source('empty', { analysis: { tendencies: '활용할 근거 없음', patterns: [] } }),
      source('stale', { analyzedAt: now - 8 * 86400000 }),
      source('failed', { error: '공개 자료 수집·분석을 완료하지 못했습니다.' }),
      source('waiting', { analyzedAt: 0, checkedAt: 0, analysis: null }),
    ];
    writeFileSync(
      join(dataDir, 'settings.json'),
      JSON.stringify({
        ...defaults,
        cultureDomains: sources.map((s) => s.origin),
        communityActivityEnabled: false,
      }),
    );
    writeFileSync(
      join(dataDir, 'culture-learning.json'),
      JSON.stringify({ version: 1, sources, uses: [] }),
    );
    service = await startServer({
      port: 0,
      dataDir,
      localSpeech: false,
      provider: {
        status: () => ({ configured: false }),
        react: () => {
          report.modelCalls++;
          throw Error('No model calls in UI verification');
        },
      },
    });
    clearInterval(service.studio.timer);
    assert.deepEqual(
      service.studio.culture.snapshot().sources.map((s) => s.status),
      ['ready', 'no-patterns', 'stale', 'unavailable', 'uncollected'],
    );
    win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        session: createStudioSession(session, service),
        sandbox: true,
        contextIsolation: true,
        offscreen: true,
        backgroundThrottling: false,
      },
    });
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    win.webContents.session.setPermissionCheckHandler(() => false);
    await win.loadURL(service.url);
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const until = async (code) => {
      for (let i = 0; i < 120; i++) {
        if (await js(code)) return;
        await new Promise((done) => setTimeout(done, 50));
      }
      throw Error('UI deadline: ' + code);
    };
    await until('!!document.querySelector(".chat-scroll")');
    await js(
      'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="방송 설정").click()',
    );
    await until('!!document.querySelector("#settings-tab-mood")');
    await js('document.querySelector("#settings-tab-mood").click()');
    await until(
      'document.querySelector("#settings-panel-mood")?.textContent.includes("ready.example.org")',
    );
    const rows = await js(
      'Array.from(document.querySelectorAll("#settings-panel-mood p")).map(p=>p.textContent).filter(t=>/^https:/.test(t))',
    );
    const expected = [
      '참고 패턴 1개',
      '활용할 패턴 없음',
      '다시 확인이 필요한 참고자료',
      '공개 자료 수집·분석을 완료하지 못했습니다.',
      '분석 대기',
    ];
    assert.equal(rows.length, 5);
    sources.forEach((source, index) => {
      const row = rows.find((t) => t.startsWith(source.origin));
      assert.ok(row?.includes(expected[index]), row);
      if (index !== 0) assert.ok(!row.includes('참고 패턴'));
      assert.equal(row.includes('마지막 분석:'), source.analyzedAt > 0);
    });
    report.rows = rows;
    report.checks.push(
      'persisted empty, stale, failed and pending analyses remain distinct from usable patterns in the settings renderer',
    );
    assert.equal(report.modelCalls, 0);
    report.checks.push('opening settings performs no model call or device capture');
    await js('document.querySelector("#settings-panel-mood").scrollTop=600');
    writeFileSync(join(base, 'culture-status.png'), (await win.webContents.capturePage()).toPNG());
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
  } finally {
    win?.destroy();
    await service?.close();
    save();
    console.log(JSON.stringify(report));
    app.exit(report.passed ? 0 : 1);
  }
});
