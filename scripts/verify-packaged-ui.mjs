import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const option = (name) =>
  process.argv.find((value) => value.startsWith('--' + name + '='))?.slice(name.length + 3);
const legacy = process.argv.includes('--legacy');
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
const child = spawn(
  join(folder, 'Nagneon.exe'),
  ['--backseat-profile=' + profile, '--remote-debugging-port=0'],
  { cwd: folder, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } },
);
report.pid = child.pid;
child.stdout.on('data', (bytes) => logs.push(bytes));
child.stderr.on('data', (bytes) => logs.push(bytes));
let exited = false;
const closed = once(child, 'close').then(([code]) => {
  exited = true;
  report.exitCode = code;
});
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
    if (await evaluate(`Boolean(${expression})`)) return;
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
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
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
  const changed = await evaluate(
    `(async()=>{const s=await (await fetch('/api/state')).json();const r=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({...s.settings,mode:'rehearsal'})});return r.status;})()`,
  );
  assert.equal(changed, 200);
  await until("document.body.innerText.includes('리허설 시작')");
  await click('리허설 시작');
  await until("document.body.innerText.includes('방송 종료')");
  await click('방송 종료');
  await until("document.body.innerText.includes('리허설 시작')");
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
  await Promise.race([call('Browser.close'), closed]);
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
  if (!exited && socket?.readyState === WebSocket.OPEN) await call('Browser.close').catch(() => {});
  socket?.close();
  await writeFile(join(output, 'native.log'), Buffer.concat(logs));
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
