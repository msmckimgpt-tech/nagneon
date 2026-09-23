import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { get } from 'node:http';

const option = (name) =>
  process.argv.find((value) => value.startsWith('--' + name + '='))?.slice(name.length + 3);
const legacy = process.argv.includes('--legacy');
const debugPort = Number(option('debug-port') || 0);
assert.ok(Number.isInteger(debugPort) && debugPort >= 0 && debugPort <= 65535);
// Chromium owns this isolated debugger listener and can assign a Fetch-blocked
// port. Use HTTP only for debugger discovery; product renderer fetch stays intact.
const debuggerPages = (port) => new Promise((done, fail) => {
  const request = get({ hostname: '127.0.0.1', port, path: '/json/list' }, response => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; });
    response.on('error', fail);
    response.on('end', () => {
      try {
        assert.equal(response.statusCode, 200);
        const pages = JSON.parse(body);
        assert.ok(Array.isArray(pages));
        done(pages);
      } catch (error) { fail(error); }
    });
  });
  request.setTimeout(5000, () => request.destroy(Error('Debugger discovery timed out')));
  request.on('error', fail);
});
const folder = resolve(
  option('folder') || JSON.parse(await readFile('artifacts/latest-package.json', 'utf8')).folder,
);
await mkdir('artifacts/packaged-ui', { recursive: true });
const output = await mkdtemp(resolve('artifacts/packaged-ui/run-'));
const profile = resolve(option('profile') || join(output, 'profile'));
// This verifier operates on its own fixtures, never a registered user profile.
assert.ok(
  profile.startsWith(resolve('artifacts') + '\\'),
  'Profile must be inside this worktree artifacts',
);
await mkdir(profile, { recursive: true });
await unlink(join(profile, 'DevToolsActivePort')).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
const report = {
  folder,
  profile,
  output,
  synthetic: true,
  deviceCapture: false,
  modelCall: false,
  passed: false,
  checks: [],
};
const logs = [];
const spawnedAt = Date.now();
const child = spawn(
  join(folder, 'Nagneon.exe'),
  ['--backseat-profile=' + profile, '--remote-debugging-port=' + debugPort],
  { cwd: folder, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } },
);
report.pid = child.pid;
report.lifecycle = { spawnedAt };
child.stdout.on('data', (bytes) => logs.push(bytes));
child.stderr.on('data', (bytes) => logs.push(bytes));
let exited = false;
child.once('exit', (code, signal) => {
  report.lifecycle.processExit = { at: Date.now(), code, signal };
});
const closed = once(child, 'close').then(([code]) => {
  exited = true;
  report.exitCode = code;
  report.lifecycle.pipesClosedAt = Date.now();
});
// Exercise the Windows title-bar close path. CDP Browser.close can time out
// without acknowledging shutdown; it is not evidence of a normal user close.
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
async function closeNativeWindow() {
  const attempt = { requestedAt: Date.now() };
  (report.lifecycle.closeAttempts ||= []).push(attempt);
  const expectedExe = psQuote(join(folder, 'Nagneon.exe'));
  const expectedProfile = psQuote('--backseat-profile=' + profile);
  const script = [
    "$ErrorActionPreference='Stop'",
    "$p=Get-Process -Id " + child.pid,
    "$info=Get-CimInstance Win32_Process -Filter 'ProcessId=" + child.pid + "'",
    "if($info.ExecutablePath -ne " + expectedExe + " -or $info.ParentProcessId -ne " + process.pid + " -or -not $info.CommandLine.Contains(" + expectedProfile + ")) { throw 'Test app ownership differs' }",
    "if(([DateTimeOffset]$p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() -lt " + (spawnedAt - 2000) + ") { throw 'Test app creation time differs' }",
    "if(-not $p.CloseMainWindow()) { throw 'Test app did not accept normal window close' }",
  ].join('; ');
  await new Promise((done, fail) => {
    const closer = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let error = '';
    closer.stderr.on('data', bytes => { error += bytes; });
    closer.once('error', fail);
    closer.once('close', code => code === 0 ? done() : fail(Error('Normal window close failed: ' + error)));
  });
  report.closeMethod = 'owned Windows process CloseMainWindow';
  attempt.acceptedAt = Date.now();
}
let socket,
  serial = 0;
const pending = new Map();
const call = (method, params = {}) =>
  new Promise((done, fail) => {
    const id = ++serial,
      timer = setTimeout(() => {
        pending.delete(id);
        fail(Error('CDP timeout: ' + method));
      }, 10000);
    pending.set(id, {
      done: (value) => {
        clearTimeout(timer);
        done(value);
      },
      fail: (error) => {
        clearTimeout(timer);
        fail(error);
      },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result.value;
};
async function until(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`(async()=>Boolean(${expression}))()`)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('UI did not become ready: ' + expression);
}
const click = async (text) =>
  assert.equal(
    await evaluate(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`,
    ),
    true,
    text,
  );
try {
  let port;
  for (let i = 0; i < 150; i++) {
    if (exited) throw Error('Packaged app exited before debugger endpoint');
    try {
      port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      if (port) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(port, 'Fresh isolated debugger endpoint');
  let page;
  for (let i = 0; i < 150; i++) {
    const pages = await debuggerPages(port);
    page = pages.find((p) => p.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(p.url));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page, 'Actual packaged application page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.on('message', (bytes) => {
    const value = JSON.parse(bytes);
    if (!value.id) return;
    const item = pending.get(value.id);
    if (!item) return;
    pending.delete(value.id);
    if (value.error) item.fail(Error(value.error.message));
    else item.done(value.result);
  });
  await until("document.querySelector('.welcome-shell')||document.querySelector('.app-shell')");
  assert.match(await evaluate('document.title'), /Nagneon/);
  report.checks.push('actual packaged renderer loads');
  assert.equal(await evaluate('typeof window.backseat.onPanic'), legacy ? 'function' : 'undefined');
  report.checks.push(
    legacy
      ? 'legacy preload baseline confirmed'
      : 'removed panic API is absent from packaged preload',
  );
  if (await evaluate("!!document.querySelector('.welcome-shell')")) {
    await click('다음');
    await until("document.querySelector('.welcome-intro')?.textContent.includes('어떤 채팅창')");
    await click('다음');
    await until("document.querySelector('.welcome-intro')?.textContent.includes('인사할 준비')");
    await click('직접 조작하며 배우기');
    await until("!!document.querySelector('.app-shell')");
  }
  if (
    await evaluate(
      "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='나중에 계속하기')",
    )
  )
    await click('나중에 계속하기');
  if (!legacy)
    assert.equal(await evaluate("document.body.innerText.includes('방송 놀이터')"), false);
  const seed = option('seed'),
    expected = option('expect');
  if (seed) {
    const result = await evaluate(
      `(async()=>{const s=await(await fetch('/api/state')).json();const a=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({...s.settings,title:${JSON.stringify(seed)}})});const b=await fetch('/api/community/lore',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({text:${JSON.stringify(seed)},days:30})});return [a.status,b.status];})()`,
    );
    assert.deepEqual(result, [200, 200]);
    report.checks.push('synthetic title and shared memory saved by delivered routes');
  }
  if (expected) {
    const preserved = await evaluate(
      `(async()=>{const s=await(await fetch('/api/state')).json();return s.settings.title===${JSON.stringify(expected)}&&s.audience.lore.some(m=>m.text===${JSON.stringify(expected)});})()`,
    );
    assert.equal(preserved, true);
    report.checks.push('previous title and shared memory survive update or restart');
  }
  if (process.argv.includes('--routing')) {
    await evaluate(`document.querySelector('button[title="방송 설정"]').click()`);
    await click('연결·사용량');
    await evaluate(`[...document.querySelectorAll('details')].find(e=>e.querySelector('summary')?.textContent==='역할별 모델 라우팅').open=true`);
    await click('연결 추가');
    await until(`document.querySelector('[aria-label="연결 2 모델"]')`);
    await evaluate(`(()=>{const e=document.querySelector('[aria-label="연결 2 모델"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'gpt-6-astra');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(`(()=>{const e=document.querySelector('[aria-label="일반 대화 모델"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,e.options[e.options.length-1].value);e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await click('역할별 경로 저장');
    await until(`document.body.textContent.includes('역할별 경로를 저장했습니다.')`);
    assert.equal(await evaluate(`fetch('/api/state').then(r=>r.json()).then(s=>s.providerChoice.routing.config.connections.length===2&&!!s.providerChoice.routing.config.routes.chat)`),true);
    await click('닫기');
    report.checks.push('delivered routing editor registers custom model and persists role selection');
  }
  if (process.argv.includes('--routing-expect')) {
    assert.equal(await evaluate(`fetch('/api/state').then(r=>r.json()).then(s=>s.providerChoice.routing.config.connections.length===2&&!!s.providerChoice.routing.config.routes.chat)`),true);
    report.checks.push('routing configuration survives installed restart');
  }
  if (process.argv.includes('--single-provider')) {
    assert.equal(await evaluate(`fetch('/api/connection/provider',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({kind:'codex'})}).then(r=>r.status)`),200);
    report.checks.push('single provider restored before compatibility rollback');
  }
  if (process.argv.includes('--social')) {
    await click('방송 밖 이야기');await until("!!document.querySelector('.community-sections')");
    await click('바깥 커뮤니티');await until("!!document.querySelector('.outside-community .social-settings')");
    assert.equal(await evaluate("document.querySelectorAll('.social-community-list button').length"),5);
    const prefs=await evaluate("fetch('/api/social/communities').then(r=>r.json()).then(d=>d.preferences)");
    assert.equal(prefs.enabled,true);assert.equal(prefs.arrivalsEnabled,true);
    const before=await readFile(join(profile,'data/world.json'),'utf8');
    await click('내 이야기 찾기');await until("!document.querySelector('.social-search button').disabled");
    assert.equal(await readFile(join(profile,'data/world.json'),'utf8'),before);
    await writeFile(join(output,'social.png'),Buffer.from((await call('Page.captureScreenshot')).data,'base64'));
    report.checks.push('delivered four communities, default ON and pure ego search');
    await click('방송 커뮤니티');await until("!!document.querySelector('.community-gallery')");
    await click('방송실');
  }
  const changed = await evaluate(
    `(async()=>{const s=await (await fetch('/api/state')).json();const r=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({...s.settings,mode:'rehearsal'})});return r.status;})()`,
  );
  assert.equal(changed, 200);
  const enabledButton = (label) =>
    `[...document.querySelectorAll('button')].some(b=>!b.disabled&&b.textContent.trim()===${JSON.stringify(label)})`;
  await until(enabledButton('리허설 시작'));
  await click('리허설 시작');
  await until(enabledButton('방송 종료'));
  await click('방송 종료');
  await until(enabledButton('리허설 시작'));
  await until("await fetch('/api/state').then(r=>r.json()).then(s=>s.running===false)");
  assert.equal(
    await evaluate(
      "(async()=>{const s=await (await fetch('/api/state')).json();return s.running;})()",
    ),
    false,
  );
  report.checks.push('rehearsal starts and normal stop returns to idle');
  await writeFile(
    join(output, 'studio.png'),
    Buffer.from((await call('Page.captureScreenshot')).data, 'base64'),
  );
  report.checks.push('onboarding, navigation and packaged UI captured');
  await closeNativeWindow();
  await Promise.race([
    closed,
    new Promise((_, fail) => setTimeout(() => fail(Error('App failed normal close')), 15000)),
  ]);
  assert.equal(report.exitCode, 0);
  report.checks.push('normal app close completes');
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  if (!exited) await closeNativeWindow().catch(error => { report.cleanupError = error.message; });
  socket?.close();
  await writeFile(join(output, 'native.log'), Buffer.concat(logs));
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
