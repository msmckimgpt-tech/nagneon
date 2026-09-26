// Isolated Electron renderer smoke with synthetic JEV transport only.
const { app, BrowserWindow, session } = require('electron');
const { createStudioSession } = require('../desktop/session.cjs');
const { resolve, join } = require('node:path');
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const out = resolve(
  process.env.JEV_SMOKE_OUT || join(process.env.TMPDIR || '.', 'jev-settings-' + Date.now()),
);
mkdirSync(out, { recursive: true });
app.setPath('userData', join(out, 'profile'));
app.on('window-all-closed', () => {});
const report = { passed: false, synthetic: true, checks: [], calls: [] };
let service,
  win,
  holdNext = false,
  abortDelayMs = 0,
  nextStatus = 0,
  started;
const save = () => writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2));
const watchdog = setTimeout(() => {
  report.error = 'timeout';
  save();
  app.exit(2);
}, 90000);
app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')));
    const provider = {
      model: 'synthetic',
      status: () => ({ kind: 'codex', configured: true, model: 'synthetic', effort: 'low' }),
      react: async () => ({ observation: { messages: [] } }),
    };
    const options = {
      port: 0,
      dataDir: join(out, 'data'),
      localSpeech: false,
      provider,
      decisionFetchImpl: async (url, init) => {
        report.calls.push({
          url,
          model: JSON.parse(init.body).model,
          authorization: init.headers.Authorization === 'Bearer synthetic-key',
        });
        if (nextStatus) {
          const status = nextStatus;
          nextStatus = 0;
          return { ok: false, status, json: async () => ({ detail: 'private upstream detail' }) };
        }
        if (holdNext) {
          holdNext = false;
          const delay = abortDelayMs;
          abortDelayMs = 0;
          started();
          return new Promise((_, reject) =>
            init.signal.addEventListener(
              'abort',
              () => setTimeout(() => reject(init.signal.reason), delay),
              { once: true },
            ),
          );
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: JSON.parse(init.body).model,
            answers: { relevant: { type: 'noul', noul: 0.9 } },
            usage: { input_tokens: 10, output_tokens: 2 },
          }),
        };
      },
    };
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (code) => {
      const end = Date.now() + 12000;
      while (Date.now() < end) {
        if (await js(code)) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw Error('Timed out: ' + code);
    };
    const click = async (text) => {
      const query = `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`;
      await until(`!!(${query})`);
      await js(`(${query}).click()`);
    };
    const choose = async (label, value) => {
      await js(
        `(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');const setter=Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
    };
    const holdKeySaveResponse = async () => {
      await js(
        `(()=>{const previous=window.fetch;window.__holdKeySave=true;window.__releaseKeySave=undefined;window.fetch=(...args)=>{const [url,options]=args;if(window.__holdKeySave&&String(url).endsWith('/api/decision/key')&&options?.method==='POST'){window.__holdKeySave=false;return previous(...args).then(response=>new Promise(resolve=>{window.__releaseKeySave=()=>{window.fetch=previous;resolve(response)}}));}return previous(...args);};return true})()`,
      );
    };
    const start = async () => {
      service = await startServer(options);
      await fetch(service.url + '/api/onboarding', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + service.accessToken,
          'Content-Type': 'application/json',
          'X-Backseat-Client': 'studio',
        },
        body: JSON.stringify({ skip: true }),
      });
      win = new BrowserWindow({
        width: 1100,
        height: 1100,
        show: false,
        webPreferences: {
          session: createStudioSession(session, service),
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false,
        },
      });
      await win.loadURL(service.url);
      await until(`!!document.querySelector('[data-tutorial="settings"]')`);
      await js(`document.querySelector('[data-tutorial="settings"]').click()`);
      await until(`!!document.getElementById('settings-tab-connection')`);
      await js(`document.getElementById('settings-tab-connection').click()`);
      await until(`!!document.querySelector('[aria-label="JEV 판단 모드"]')`);
    };
    await start();
    assert.equal(service.studio.decision.snapshot().mode, 'off');
    assert.equal(service.studio.decision.snapshot().configured, false);
    assert.equal(report.calls.length, 0);
    report.checks.push('initial off and no-key state');
    await choose('JEV 판단 모드', 'shadow');
    await js(`document.querySelector('.decision-panel > label.set-check input').click()`);
    await click('JEV 설정 적용');
    await until(`document.body.textContent.includes('JEV 설정이 적용되었습니다')`);
    assert.equal(service.studio.decision.snapshot().mode, 'shadow');
    await choose('JEV API 키', 'synthetic-key');
    await click('JEV 키 연결');
    await until(`document.querySelector('[aria-label="JEV API 키"]').value===''`);
    assert.equal(service.studio.decision.snapshot().configured, true);
    assert.equal(report.calls.length, 0);
    await click('JEV 연결 확인 · 1회 사용');
    await until(`document.body.textContent.includes('JEV 응답 확인됨')`);
    assert.equal(await js(`document.body.textContent.includes('$0.000000420')`), true);
    assert.equal(report.calls.length, 1);
    assert.equal(report.calls[0].authorization, true);
    report.checks.push('key is cleared, synthetic probe only, usage recorded');
    await js(
      `window.backseat={openDecisionKeyConsole:(provider)=>{window.__decisionConsoleProvider=provider;window.__decisionConsoleOpened=(window.__decisionConsoleOpened||0)+1;return Promise.resolve()}};true`,
    );
    await js(`document.querySelector('.decision-panel a').click()`);
    assert.equal(await js(`window.__decisionConsoleOpened`), 1);
    // Let the compositor paint the asserted UI before capturing the evidence.
    await new Promise((resolve) => setTimeout(resolve, 250));
    writeFileSync(join(out, 'settings.png'), (await win.webContents.capturePage()).toPNG());
    await js(
      `(()=>{const panel=document.querySelector('#settings-panel-connection');panel.scrollTop=panel.scrollHeight;return panel.scrollTop})()`,
    );
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Let the compositor paint the asserted UI before capturing the evidence.
    await new Promise((resolve) => setTimeout(resolve, 250));
    writeFileSync(join(out, 'settings-bottom.png'), (await win.webContents.capturePage()).toPNG());
    await choose('JEV 모델', 'jev-latest');
    holdNext = true;
    const begun = new Promise((resolve) => {
      started = resolve;
    });
    const active = service.studio.decision.advise('reaction-check', {
      state: '합성 요청',
      questions: { relevant: { type: 'noul', instructions: '합성 판단 확인' } },
    });
    await begun;
    service.studio.busy = true;
    service.studio.publish();
    await until(`document.querySelector('[aria-label="JEV 판단 모드"]').disabled`);
    assert.equal(await js(`document.querySelector('[aria-label="JEV API 키"]').disabled`), true);
    await click('JEV 바로 끄기');
    assert.equal((await active).kind, 'abstain');
    assert.equal(service.studio.decision.snapshot().mode, 'off');
    assert.equal(service.studio.decision.snapshot().model, 'jev-1.13.0');
    service.studio.busy = false;
    service.studio.publish();
    report.checks.push(
      'locked controls retain immediate off, ignore unsaved model draft, and cancel a synthetic request',
    );
    await until(`!document.querySelector('[aria-label="JEV 판단 모드"]').disabled`);
    await choose('JEV 판단 모드', 'shadow');
    await click('JEV 설정 적용');
    await until(`document.querySelector('[aria-label="JEV 판단 모드"]').value==='shadow'`);
    await choose('JEV 모델', 'jev-latest');
    holdNext = true;
    abortDelayMs = 250;
    const uiProbeBegan = new Promise((resolve) => {
      started = resolve;
    });
    await click('JEV 연결 확인 · 1회 사용');
    await uiProbeBegan;
    await until(`document.querySelector('[aria-label="JEV 판단 모드"]').disabled`);
    assert.equal(
      await js(
        `![...document.querySelectorAll('.decision-panel button')].find(b=>b.textContent.trim()==='JEV 바로 끄기').disabled`,
      ),
      true,
    );
    const beforeStop = service.studio.decision.revision;
    await js(
      `(()=>{const button=[...document.querySelectorAll('.decision-panel button')].find(b=>b.textContent.trim()==='JEV 바로 끄기');button.click();button.click();})()`,
    );
    await until(
      `document.querySelector('.decision-panel').textContent.includes('JEV 판단을 껐습니다.')`,
    );
    await until(`!document.querySelector('[aria-label="JEV 판단 모드"]').disabled`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(service.studio.decision.revision, beforeStop + 1);
    assert.equal(service.studio.decision.snapshot().mode, 'off');
    assert.equal(service.studio.decision.snapshot().model, 'jev-1.13.0');
    assert.equal(await js(`document.querySelector('[aria-label="JEV 모델"]').value`), 'jev-1.13.0');
    assert.equal(
      await js(
        `document.querySelector('.decision-panel').textContent.includes('연결 확인을 마쳤습니다.')`,
      ),
      false,
    );
    report.checks.push(
      'held UI probe is interrupted once and stale completion cannot replace stop feedback or saved model',
    );
    holdNext = true;
    abortDelayMs = 250;
    const offModeProbeBegan = new Promise((resolve) => {
      started = resolve;
    });
    await click('JEV 연결 확인 · 1회 사용');
    await offModeProbeBegan;
    await until(`document.querySelector('[aria-label="JEV 판단 모드"]').disabled`);
    assert.equal(
      await js(
        `!![...document.querySelectorAll('.decision-panel button')].find(b=>b.textContent.trim()==='JEV 바로 끄기'&&!b.disabled)`,
      ),
      true,
    );
    await click('JEV 바로 끄기');
    await until(
      `document.querySelector('.decision-panel').textContent.includes('JEV 판단을 껐습니다.')`,
    );
    await until(`!document.querySelector('[aria-label="JEV 판단 모드"]').disabled`);
    assert.equal(service.studio.decision.snapshot().mode, 'off');
    assert.equal(
      await js(
        `document.querySelector('.decision-panel').textContent.includes('연결 확인을 마쳤습니다.')`,
      ),
      false,
    );
    report.checks.push('held UI probe can be stopped while global mode is already off');
    await choose('JEV 판단 모드', 'shadow');
    await choose('JEV 모델', 'jev-latest');
    await js(
      `(()=>{const original=window.fetch;window.__holdApply=true;window.fetch=(...args)=>{const [url,options]=args;if(window.__holdApply&&String(url).endsWith('/api/decision')&&options?.method==='PUT'){window.__holdApply=false;return original(...args).then(response=>new Promise(resolve=>{window.__releaseApply=()=>resolve(response)}));}return original(...args);};return true})()`,
    );
    await click('JEV 설정 적용');
    await until(
      `document.querySelector('.decision-panel .account-summary p').textContent.includes('jev-latest')`,
    );
    assert.equal(await js(`!!window.__releaseApply`), true);
    await click('JEV 바로 끄기');
    await until(
      `document.querySelector('.decision-panel').textContent.includes('JEV 판단을 껐습니다.')`,
    );
    await js(`window.__releaseApply();true`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(await js(`document.querySelector('[aria-label="JEV 판단 모드"]').value`), 'off');
    assert.equal(
      await js(
        `document.querySelector('.decision-panel').textContent.includes('JEV 설정이 적용되었습니다.')`,
      ),
      false,
    );
    assert.equal(service.studio.decision.snapshot().mode, 'off');
    assert.equal(service.studio.decision.snapshot().model, 'jev-latest');
    report.checks.push(
      'late ordinary save response cannot replace stop feedback or restore stale draft',
    );
    await choose('JEV 판단 모드', 'shadow');
    await click('JEV 설정 적용');
    await until(
      `document.querySelector('.decision-panel').textContent.includes('JEV 설정이 적용되었습니다.')`,
    );
    await choose('JEV API 키', 'synthetic-key-second');
    await holdKeySaveResponse();
    await click('JEV 키 연결');
    await until(`!!window.__releaseKeySave`);
    await click('JEV 바로 끄기');
    await until(
      `document.querySelector('.decision-panel').textContent.includes('JEV 판단을 껐습니다.')`,
    );
    await js(`window.__releaseKeySave();true`);
    await until(`document.querySelector('[aria-label="JEV API 키"]').value===''`);
    assert.equal(
      await js(
        `document.querySelector('.decision-panel').textContent.includes('JEV 키 설정이 변경되었습니다.')`,
      ),
      false,
    );
    report.checks.push(
      'successful delayed key save clears its submitted password without stale feedback after stop',
    );
    await choose('JEV 판단 모드', 'shadow');
    await click('JEV 설정 적용');
    await until(
      `document.querySelector('.decision-panel').textContent.includes('JEV 설정이 적용되었습니다.')`,
    );
    await choose('JEV API 키', 'synthetic-key-third');
    await holdKeySaveResponse();
    await click('JEV 키 연결');
    await until(`!!window.__releaseKeySave`);
    await click('JEV 바로 끄기');
    await until(
      `document.querySelector('.decision-panel').textContent.includes('JEV 판단을 껐습니다.')`,
    );
    await choose('JEV API 키', 'newer-unsent-draft');
    await js(`window.__releaseKeySave();true`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      await js(`document.querySelector('[aria-label="JEV API 키"]').value`),
      'newer-unsent-draft',
    );
    report.checks.push('old key response leaves a newer unrelated unsent draft untouched');
    const beforeProviderChange = report.calls.length;
    await choose('JEV 제공처', 'openrouter');
    await choose('JEV 모델', 'jev-1.13.0');
    assert.equal(await js(`document.querySelector('[aria-label="JEV API 키"]').value`), '');
    assert.equal(await js(`document.querySelector('[aria-label="JEV API 키"]').disabled`), true);
    assert.equal(
      await js(`document.querySelector('[aria-label="JEV 제공처"]').value`),
      'openrouter',
    );
    assert.equal(
      await js(`document.querySelector('.decision-panel a').href`),
      'https://openrouter.ai/settings/keys',
    );
    await js(`document.querySelector('.decision-panel a').click()`);
    assert.equal(await js(`window.__decisionConsoleProvider`), 'openrouter');
    assert.equal(report.calls.length, beforeProviderChange);
    await click('JEV 설정 적용');
    await until(
      `document.querySelector('.decision-panel .account-summary p').textContent.includes('OpenRouter')`,
    );
    assert.equal(service.studio.decision.snapshot().provider, 'openrouter');
    assert.equal(service.studio.decision.snapshot().mode, 'off');
    assert.equal(service.studio.decision.snapshot().acknowledgeTransfer, false);
    assert.equal(service.studio.decision.snapshot().configured, false);
    await until(`!document.querySelector('[aria-label="JEV API 키"]').disabled`);
    await choose('JEV API 키', 'synthetic-key');
    await click('JEV 키 연결');
    await until(`document.querySelector('[aria-label="JEV API 키"]').value===''`);
    assert.equal(report.calls.length, beforeProviderChange);
    await choose('JEV 판단 모드', 'shadow');
    await js(`document.querySelector('.decision-panel > label.set-check input').click()`);
    await click('JEV 설정 적용');
    await until(`document.querySelector('[aria-label="JEV 판단 모드"]').value==='shadow'`);
    await click('JEV 연결 확인 · 1회 사용');
    await until(`document.body.textContent.includes('JEV 응답 확인됨')`);
    assert.equal(report.calls.at(-1).url, 'https://openrouter.ai/api/v1/systemone');
    assert.equal(report.calls.at(-1).model, 'jev-1.13');
    const beforeOrdinaryFailure = report.calls.length;
    nextStatus = 402;
    const ordinary = await service.studio.decision.advise('reaction-check', {
      state: '합성 일반 판단',
      questions: { relevant: { type: 'noul', instructions: '합성 연결 확인' } },
    });
    assert.equal(ordinary.reason, 'credits');
    assert.equal(report.calls.length, beforeOrdinaryFailure + 1);
    assert.equal(service.studio.decision.snapshot().probe.outcome, 'connected');
    await until(`document.body.textContent.includes('크레딧 또는 잔액이 부족해요')`);
    assert.equal(
      await js(
        `document.querySelector('.decision-panel .account-summary b').textContent.includes('JEV 응답 확인됨')`,
      ),
      false,
    );
    assert.equal(await js(`document.body.textContent.includes('private upstream detail')`), false);
    nextStatus = 402;
    await click('JEV 연결 확인 · 1회 사용');
    await until(`document.body.textContent.includes('크레딧 또는 잔액이 부족해요')`);
    assert.equal(await js(`document.body.textContent.includes('private upstream detail')`), false);
    report.checks.push(
      'saved OpenRouter selection gates keys, routes System One, opens fixed link, and sanitizes HTTP 402',
    );
    await click('JEV 바로 끄기');
    await until(`document.querySelector('[aria-label="JEV 판단 모드"]').value==='off'`);
    win.destroy();
    await service.close();
    await start();
    assert.equal(service.studio.decision.snapshot().mode, 'off');
    assert.equal(service.studio.decision.snapshot().configured, false);
    assert.equal(service.studio.decision.snapshot().last, null);
    report.checks.push('restart retains config but never key or probe');
    assert.equal(JSON.stringify(report).includes('synthetic-key'), false);
    assert.equal(
      readFileSync(join(out, 'data/decision.json'), 'utf8').includes('synthetic-key'),
      false,
    );
    win.destroy();
    await service.close();
    let retainedCiphertext = true;
    options.decisionKeyStore = {
      load: () => ({
        key: '',
        status: 'none',
        error: '저장된 JEV 키를 복원하지 못했습니다. 키를 다시 연결하세요.',
        present: retainedCiphertext,
      }),
      clear: () => {
        retainedCiphertext = false;
      },
    };
    await start();
    await until(`document.body.textContent.includes('키 복원 확인 필요')`);
    assert.equal(
      await js(
        `!![...document.querySelectorAll('.decision-panel button')].find(b=>b.textContent.trim()==='JEV 키 제거'&&!b.disabled)`,
      ),
      true,
    );
    await click('JEV 키 제거');
    await until(
      `document.querySelector('.decision-panel .account-summary b').textContent.includes('키 없음')`,
    );
    assert.equal(retainedCiphertext, false);
    assert.equal(service.studio.decision.snapshot().storedKeyPresent, false);
    report.checks.push('undecryptable saved key remains removable in settings');
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    report.dom =
      win && !win.isDestroyed()
        ? await win.webContents
            .executeJavaScript('document.body.innerText.slice(0,1200)')
            .catch(() => null)
        : null;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await service?.close();
    clearTimeout(watchdog);
    save();
    console.log(JSON.stringify({ out, ...report }));
    app.exit(report.passed ? 0 : 1);
  }
});
