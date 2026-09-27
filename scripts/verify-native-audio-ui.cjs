// Isolated subscription settings check. No microphone, screen or model call.
const { app, BrowserWindow, session } = require('electron');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createStudioSession } = require('../desktop/session.cjs');

const out = resolve('artifacts/remote-native-audio/ui');
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', join(out, 'profile'));
let service,
  win,
  finishing = false;
const result = { syntheticAudience: true, physicalDevice: false, paidCalls: 0, checks: [] };
async function finish(code = 0) {
  if (finishing) return;
  finishing = true;
  await service?.close();
  win?.destroy();
  app.exit(code);
}
app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')).href);
    service = await startServer({
      port: 0,
      dataDir: join(out, 'data'),
      provider: {
        model: 'synthetic-ui',
        status: () => ({ kind: 'codex', configured: true, model: 'synthetic-ui' }),
        react: async () => {
          throw Error('UI check must not invoke an audience model.');
        },
      },
    });
    service.studio.ai.update({ background: false });
    service.nativeAudio.configure({ mode: 'remote', transport: 'subscription', consent: false });
    const headers = {
      Authorization: 'Bearer ' + service.accessToken,
      'X-Backseat-Client': 'studio',
      'Content-Type': 'application/json',
    };
    await fetch(service.url + '/api/onboarding', {
      method: 'POST',
      headers,
      body: JSON.stringify({ skip: true }),
    });
    win = new BrowserWindow({
      width: 1100,
      height: 900,
      show: false,
      title: 'Nagneon 원격 음성 검증 · 격리 프로필',
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        session: createStudioSession(session, service),
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.on('page-title-updated', (event) => event.preventDefault());
    win.on('close', () => {
      void finish();
    });
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (code) => {
      for (let i = 0; i < 150; i++) {
        if (await js(code)) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw Error('UI condition not reached');
    };
    await win.loadURL(service.url);
    await until(`!!document.querySelector('.app-shell')`);
    await js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='AI 대시보드');if(!b)throw Error('dashboard button');b.click();})()`,
    );
    await until(`!!document.querySelector('[aria-label="모델 연결 시험 화면으로 이동"]')`);
    await js(`document.querySelector('[aria-label="모델 연결 시험 화면으로 이동"]').click()`);
    await until(`!!document.querySelector('[aria-label="마이크 원음 이해"]')`);
    assert.equal(
      await js(`document.querySelector('[aria-label="원음 이해용 OpenAI API 키"]')===null`),
      true,
    );
    assert.equal(
      await js(`document.querySelector('[aria-label="음성 전달 방식"]').value`),
      'remote',
    );
    assert.equal(
      await js(`document.querySelector('[aria-label="마이크 원음 이해"] button').disabled`),
      true,
    );
    assert.equal(service.nativeAudio.snapshot().consent, false);
    result.checks.push(
      'subscription mode; no API key input; no automatic consent; apply disabled before consent; no connection',
    );
    {
      for (const width of [1100, 850, 420]) {
        win.setSize(width, 900);
        await new Promise((r) => setTimeout(r, 150));
        assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
        fs.writeFileSync(
          join(out, 'settings-' + width + '.png'),
          (await win.webContents.capturePage()).toPNG(),
        );
      }
      service.nativeAudio.configure({ mode: 'remote', transport: 'subscription', consent: true });
      service.studio.settings.mode = 'live';
      service.studio.publish();
      await js(`document.querySelector('[aria-label="방송 설정 창 닫기"]').click()`);
      await js(
        `window.micRequestCount=0;void Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{window.micRequestCount++;throw new DOMException('Synthetic permission denial','NotAllowedError');}})`,
      );
      await js(
        `(()=>{const button=[...document.querySelectorAll('nav button')].find(b=>b.textContent.trim()==='방송실');if(!button)throw Error('studio navigation');button.click();})()`,
      );
      await until(`!!document.querySelector('[data-tutorial="start"]')`);
      await new Promise((r) => setTimeout(r, 200));
      await js(`document.querySelector('[data-tutorial="start"]').click()`);
      await until(`window.micRequestCount===1`);
      assert.equal(service.studio.running, true);
      await js(`document.querySelector('[data-tutorial="start"]').click()`);
      await until(
        `document.querySelector('[data-tutorial="start"]').textContent.includes('방송 시작')`,
      );
      assert.equal(service.studio.running, false);
      assert.equal(await js('window.micRequestCount'), 1);
      result.checks.push(
        'one broadcast click requests subscription microphone; stop cancels it; physical permission remains denied',
      );
      result.passed = true;
      fs.writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
      await finish();
      return;
    }
  } catch (error) {
    result.passed = false;
    result.error = error.message;
    fs.writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
    console.error(error.message);
    await finish(1);
  }
});
