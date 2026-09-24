// Isolated synthetic providers; real HTTP/SSE/React renderer. Never opens an account or user profile.
const { app, BrowserWindow, session } = require('electron');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createStudioSession } = require('../desktop/session.cjs');
const out = resolve('artifacts/ai-pricing/renderer');
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', join(out, 'profile'));
let service, win;
const checks = [],
  errors = [];
app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')).href);
    let calls = 0,
      kind = 'codex';
    let usage = { input_tokens: 100000, cached_input_tokens: 20000, output_tokens: 10000 };
    const backend = {
      model: 'gpt-6-sol',
      base: 'https://api.openai.com/v1',
      status: () => ({ kind, configured: true, model: backend.model }),
      react: async () => {
        calls++;
        return { observation: { messages: [{ personaId: 'probe', text: '합성 응답' }] }, usage };
      },
    };
    service = await startServer({ port: 0, persist: false, localSpeech: false, provider: backend });
    service.studio.ai.update({ background: false });
    const headers = {
      Authorization: 'Bearer ' + service.accessToken,
      'X-Backseat-Client': 'studio',
      'Content-Type': 'application/json',
    };
    const post = async (path, body) => {
      const response = await fetch(service.url + '/api/' + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 200, path);
    };
    await post('onboarding', { skip: true });
    win = new BrowserWindow({
      width: 1440,
      height: 1000,
      show: false,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        session: createStudioSession(session, service),
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.webContents.on('console-message', (_event, level, message) => {
      if (level === 3) errors.push(message);
    });
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (code) => {
      for (let i = 0; i < 200; i++) {
        if (await js(code)) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw Error('Timed out: ' + code);
    };
    const click = async (label) => {
      assert.equal(
        await js(
          `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true;})()`,
        ),
        true,
        label,
      );
    };
    const shot = async (name) => {
      await new Promise((r) => setTimeout(r, 250));
      fs.writeFileSync(join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
    };
    await win.loadURL(service.url);
    await until(`!!document.querySelector('.app-shell')`);
    await click('AI 대시보드');
    await until(`!!document.querySelector('.ai-cost-summary')`);
    assert.equal(calls, 0);
    assert.match(await js(`document.querySelector('.ai-cost-summary').innerText`), /\$0\.0000/);
    checks.push('empty period is zero with no model invocation');

    await post('connection/probe', {});
    await until(
      `document.querySelector('.ai-cost-summary').innerText.includes('구독 사용량의 API 단가 환산') && document.querySelector('.ai-cost-summary').innerText.includes('$0.3040')`,
    );
    assert.equal(service.studio.ai.snapshot().usage.today.probe.priced, 0);
    assert.match(
      await js(`document.querySelector('.ai-cost-summary').innerText`),
      /실제 청구액 아님/,
    );
    await shot('subscription-reference');
    checks.push('Codex usage shows automatic numeric reference range, not API billing');

    kind = 'openai';
    usage = {
      input_tokens: 100000,
      output_tokens: 10000,
      input_tokens_details: { cached_tokens: 20000, cache_write_tokens: 30000 },
    };
    await post('connection/probe', {});
    await until(`document.querySelector('.ai-cost-summary').innerText.includes('$0.2790')`);
    let totals = service.studio.ai.snapshot().usage.today.probe;
    assert.equal(totals.priced, 1);
    assert.equal(totals.referencePriced, 1);
    checks.push('official API and Codex reference totals remain separate in mixed usage');

    backend.model = 'custom-ui-model';
    backend.base = 'https://synthetic.invalid/v1';
    await post('connection/probe', {});
    await until(`document.querySelector('.ai-dashboard').innerText.includes('단가 설정 필요')`);
    await click('단가·계산 기준 보기');
    await until(`document.querySelector('#ai-cost-rates').open`);
    await js(
      `(()=>{const select=document.querySelector('[aria-label="최근 요청의 연결·모델"]');select.value=[...select.options].find(o=>o.textContent.includes('custom-ui-model')).value;select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await until(`document.querySelectorAll('.ai-rate-fields input')[1].value==='custom-ui-model'`);
    await js(
      `(()=>{const inputs=document.querySelectorAll('.ai-rate-fields input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;['1','0.1','5'].forEach((value,index)=>{setter.call(inputs[index+2],value);inputs[index+2].dispatchEvent(new Event('input',{bubbles:true}));});})()`,
    );
    await click('단가 저장');
    await until(`document.querySelector('.ai-cost-summary').innerText.includes('$0.4110')`);
    totals = service.studio.ai.snapshot().usage.today.probe;
    assert.equal(totals.priced, 2);
    assert.deepEqual(Object.keys(service.studio.ai.data.policy.rates[0]).sort(), ['cached', 'connection', 'input', 'model', 'output']);
    assert.equal(calls, 3);
    checks.push(
      'selecting a recorded connection/model and saving rates backfills the prior request without a new call',
    );

    await click('최근 7일');
    await until(`document.querySelector('.ai-cost-summary').innerText.includes('$0.4110')`);
    await click('이번 방송');
    await until(
      `document.querySelector('.ai-cost-summary').innerText.includes('선택한 기간에 요청이 없습니다')`,
    );
    await click('오늘');
    await until(`document.querySelector('.ai-cost-summary').innerText.includes('$0.4110')`);
    checks.push('today/week/session period selection updates cost totals');

    await js(
      `document.querySelector('#ai-cost-rates').open=false;document.querySelector('.ai-dashboard').scrollIntoView({block:'start'});`,
    );
    for (const width of [1440, 1000, 850, 420]) {
      win.setSize(width, 1000);
      await shot('cost-' + width);
      assert.equal(
        await js('document.documentElement.scrollWidth<=innerWidth'),
        true,
        'page overflow ' + width,
      );
      assert.equal(
        await js(
          `(()=>{const v=document.querySelector('.ai-cost-value');return v.scrollWidth<=v.clientWidth+1;})()`,
        ),
        true,
        'cost value overflow ' + width,
      );
    }
    checks.push('1440/1000/850/420 layouts do not clip the cost value or overflow the page');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      join(out, 'result.json'),
      JSON.stringify({ passed: true, synthetic: true, checks, errors }, null, 2),
    );
    console.log(JSON.stringify({ passed: true, checks }));
  } catch (error) {
    fs.writeFileSync(
      join(out, 'result.json'),
      JSON.stringify(
        { passed: false, synthetic: true, checks, error: error.stack, errors },
        null,
        2,
      ),
    );
    console.error(error);
    process.exitCode = 1;
  } finally {
    win?.destroy();
    await service?.close();
    app.exit(process.exitCode || 0);
  }
});
