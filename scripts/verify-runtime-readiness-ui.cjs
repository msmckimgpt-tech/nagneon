// 설치된 앱/프로필 대신 작은 합성 구성과 독립 Electron 프로필로 재실행을 검증한다.
const { app, BrowserWindow, session } = require('electron');
const { resolve, join, dirname } = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createStudioSession } = require('../desktop/session.cjs');

const out = resolve('artifacts/runtime-readiness-ui');
fs.mkdirSync(out, { recursive: true });
const run = fs.mkdtempSync(join(out, 'run-'));
app.setPath('userData', join(run, 'profile'));
const cache = join(run, 'cache');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const report = {
  passed: false,
  syntheticComponents: true,
  physicalDevices: false,
  modelCalls: false,
  checks: [],
};
let service,
  win,
  releaseCheck,
  downloads = 0;

// 첫 검증 창을 닫아도 두 번째 서버/창 검증이 끝날 때까지 테스트를 유지한다.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')).href);
    const { distributionComponents } = await import(
      pathToFileURL(resolve('scripts/lib/distribution-components.mjs')).href
    );
    const { verifyRuntimeComponent } = await import(
      pathToFileURL(resolve('server/runtime-pack.js')).href
    );
    const paths = [
      'resources/speech/python/python.exe',
      'resources/speech/model/model.bin',
      'resources/speech/microphone-model/model.bin',
      'resources/speech/gpu/library.dll',
    ];
    const components = distributionComponents(
      paths.map((path) => ({ path, bytes: 1, sha256: hash('x') })),
    ).filter((c) => c.id !== 'app');
    for (const component of components) {
      component.archive = {
        format: 'nagneon-runtime-gzip/1',
        bytes: 1,
        sha256: hash('z'),
        url: 'https://example.invalid/' + component.id,
      };
      for (const file of component.files) {
        const target = join(
          cache,
          'installed',
          component.id + '-' + component.contentId.slice(0, 32),
          file.path,
        );
        fs.mkdirSync(dirname(target), { recursive: true });
        fs.writeFileSync(target, 'x');
      }
    }
    const catalog = { format: 'nagneon-runtime-catalog/1', components };
    for (const launch of ['first', 'relaunch']) {
      const gate = new Promise((done) => {
        releaseCheck = done;
      });
      service = await startServer({
        port: 0,
        persist: false,
        localSpeech: false,
        provider: { status: () => ({ kind: 'synthetic', configured: false }) },
        runtime: {
          speech: {},
          sound: {},
          clips: {},
          clipPerception: {},
          components: {
            catalog,
            cache,
            download: () => {
              downloads++;
              throw Error('Offline UI verification must not download');
            },
            verify: async (...args) => {
              await gate;
              return verifyRuntimeComponent(...args);
            },
          },
        },
      });
      win = new BrowserWindow({
        show: false,
        width: 1100,
        height: 980,
        webPreferences: {
          offscreen: true,
          session: createStudioSession(session, service),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const js = (code) => win.webContents.executeJavaScript(code);
      const until = async (code) => {
        for (let i = 0; i < 150; i++) {
          if (await js(code)) return;
          await new Promise((done) => setTimeout(done, 50));
        }
        throw Error('UI did not reach: ' + code);
      };
      const click = async (label) => {
        assert.equal(
          await js(
            `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) return false; b.click(); return true; })()`,
          ),
          true,
          label,
        );
      };
      await win.loadURL(service.url);
      await until(`!!document.querySelector('.welcome-shell')`);
      await click('다음');
      await click('다음');
      await click('직접 조작하며 배우기');
      await until(`!!document.querySelector('.app-shell')`);
      await until(`document.body.innerText.includes('나중에 계속하기')`);
      await click('나중에 계속하기');
      assert.equal(downloads, 0);
      assert.equal(
        await js(
          `!![...document.querySelectorAll('main > details')].find(d => d.querySelector('summary')?.textContent.startsWith('추가 구성'))`,
        ),
        false,
      );
      report.checks.push(
        launch + ': startup stays responsive during verification without an install banner',
      );
      await js(`document.querySelector('[data-tutorial="settings"]').click()`);
      await until(`!!document.querySelector('#settings-tab-connection')`);
      await js(`document.querySelector('#settings-tab-connection').click()`);
      const card = `([...document.querySelectorAll('#settings-panel-connection details')].find(d => d.querySelector('summary')?.textContent.startsWith('추가 구성')))`;
      await until(`!!${card}`);
      assert.deepEqual(
        await js(`[...${card}.querySelectorAll('.speech-ready span')].map(s => s.textContent)`),
        ['설치 확인 중', '설치 확인 중', '설치 확인 중', '설치 확인 중'],
      );
      assert.ok(
        (
          await js(
            `[...${card}.querySelectorAll('button')].map(b => ({text: b.textContent, disabled: b.disabled}))`,
          )
        ).every((b) => b.disabled && b.text.includes('설치 확인 중')),
      );
      assert.equal(await js(`!!${card}.querySelector('progress')`), false);
      assert.equal(await js(`${card}.textContent.includes('진행 중인 설치 취소')`), false);
      report.checks.push(
        launch + ': settings distinguish checking from installation and unknown download size',
      );
      releaseCheck();
      await until(
        `[...${card}.querySelectorAll('.speech-ready span')].every(s => s.textContent === '준비됨')`,
      );
      const buttons = await js(
        `[...${card}.querySelectorAll('button')].map(b => ({text: b.textContent.trim(), disabled: b.disabled}))`,
      );
      assert.equal(buttons.length, 3);
      assert.ok(
        buttons.every((b) => b.disabled && b.text.endsWith('준비됨') && !b.text.includes('0 MB')),
      );
      assert.equal(downloads, 0);
      await js(`${card}.open = true; ${card}.scrollIntoView({block: 'center'}); true`);
      await new Promise((done) => setTimeout(done, 150));
      fs.writeFileSync(
        join(out, launch + '-ready.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      win.setSize(420, 900);
      await new Promise((done) => setTimeout(done, 200));
      assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
      fs.writeFileSync(
        join(out, launch + '-ready-mobile.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      report.checks.push(
        launch +
          ': four installed components and all preparation actions show ready; 420px layout does not overflow',
      );
      win.destroy();
      win = null;
      await service.close();
      service = null;
    }
    report.downloads = downloads;
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    process.exitCode = 1;
  } finally {
    releaseCheck?.();
    win?.destroy();
    await service?.close();
    fs.writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    app.exit(report.passed ? 0 : 1);
  }
});
