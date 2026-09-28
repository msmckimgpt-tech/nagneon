// Real Electron renderer and authenticated server; synthetic chat, no devices or model calls.
const { app, BrowserWindow, session } = require('electron');
const { resolve, join } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const base = resolve('artifacts/chat-history-ui-' + Date.now());
mkdirSync(base, { recursive: true });
app.setPath('userData', join(base, 'profile'));
const report = {
  passed: false,
  syntheticChat: true,
  physicalDevices: false,
  modelCalls: 0,
  checks: [],
  base,
};
let service, win;
const save = () => writeFileSync(join(base, 'result.json'), JSON.stringify(report, null, 2));
const mark = (message) => {
  report.checks.push(message);
  save();
  console.log(message);
};
setTimeout(() => {
  report.error = 'UI watchdog';
  save();
  app.exit(2);
}, 90000).unref();
app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')));
    const { createStudioSession } = require('../desktop/session.cjs');
    service = await startServer({
      port: 0,
      persist: false,
      dataDir: join(base, 'data'),
      localSpeech: false,
      provider: {
        status: () => ({ configured: true }),
        react: async () => {
          report.modelCalls++;
          throw Error('Unexpected model');
        },
      },
    });
    const s = service.studio;
    clearInterval(s.timer);
    s.configure({ ...s.settings, mode: 'live', communityActivityEnabled: false });
    win = new BrowserWindow({
      width: 1280,
      height: 850,
      show: false,
      webPreferences: {
        session: createStudioSession(session, service),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    await win.loadURL(service.url);
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const pause = (ms) => new Promise((done) => setTimeout(done, ms));
    const until = async (code) => {
      const at = Date.now();
      while (Date.now() - at < 8000) {
        if (await js(code)) return;
        await pause(40);
      }
      throw Error('UI deadline: ' + code);
    };
    const button = async (label) => {
      const condition = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
      await until(`!!(${condition})`);
      await js(`(${condition}).click()`);
    };
    const frames = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const count = (n) =>
      until(`document.querySelectorAll('.chat-scroll .chat-line').length===${n}`);
    const scrollTop = async () => {
      await js(`document.querySelector('.chat-scroll').scrollTop=0`);
      await frames();
      assert.equal(
        await js(`document.querySelector('.chat-scroll').scrollTop`),
        0,
        'manual scrolling must not be undone by React updates',
      );
    };
    const anchor = () =>
      js(
        `(()=>{const p=document.querySelector('.chat-scroll'),t=p.getBoundingClientRect().top,e=Array.from(p.querySelectorAll('[data-message-id]')).find(e=>e.getBoundingClientRect().bottom>t);return {id:e.dataset.messageId,offset:e.getBoundingClientRect().top-t};})()`,
      );
    const offset = (id) =>
      js(
        `(()=>{const p=document.querySelector('.chat-scroll'),e=Array.from(p.querySelectorAll('[data-message-id]')).find(e=>e.dataset.messageId===${JSON.stringify(id)});return e.getBoundingClientRect().top-p.getBoundingClientRect().top;})()`,
      );
    await button('튜토리얼 건너뛰기');
    await until("!!document.querySelector('.chat-scroll')");
    // The chat-only fixture has no scene input. Keep the renderer's unrelated
    // idle observation loop from invoking even the throwing provider stub.
    await js(
      `window.fixtureFetch=window.fetch;window.fetch=(url,...args)=>String(url).endsWith('/api/react')?Promise.resolve(new Response(JSON.stringify({skipped:'fixture-no-input'}),{headers:{'Content-Type':'application/json'}})):fixtureFetch(url,...args);void 0`,
    );
    s.start();
    const all = [];
    for (let i = 0; i < 605; i++)
      all.push(
        s.publishMessage(s.prepareMessage('momo', '기록 확인용 합성 채팅 ' + i), {
          publishState: false,
        }),
      );
    s.publish();
    await count(100);
    await frames();
    assert.equal(
      await js(`document.querySelector('.chat-scroll .chat-line').dataset.messageId`),
      all[505].id,
    );
    assert.equal(
      await js(
        `(()=>{const p=document.querySelector('.chat-scroll');return p.scrollHeight-p.scrollTop-p.clientHeight<2})()`,
      ),
      true,
    );
    mark('latest 100 initially displayed at the bottom');
    await scrollTop();
    const first = await anchor();
    await button('이전 채팅 더보기');
    await count(200);
    await frames();
    assert.ok(
      Math.abs((await offset(first.id)) - first.offset) < 2,
      'prepend keeps the visible row position',
    );
    assert.equal(
      await js(`document.querySelector('.chat-scroll .chat-line').dataset.messageId`),
      all[405].id,
    );
    mark('older page keeps the same visible row within two pixels');
    const reading = await anchor();
    report.beforeArrival = {
      reading,
      pane: await js(
        `(()=>{const p=document.querySelector('.chat-scroll');return {top:p.scrollTop,height:p.scrollHeight,client:p.clientHeight}})()`,
      ),
    };
    const fresh = s.addMessage('momo', '읽는 중 도착한 새 채팅');
    await count(201);
    await frames();
    report.afterArrival = {
      offset: await offset(reading.id),
      pane: await js(
        `(()=>{const p=document.querySelector('.chat-scroll');return {top:p.scrollTop,height:p.scrollHeight,client:p.clientHeight}})()`,
      ),
    };
    save();
    assert.ok(Math.abs((await offset(reading.id)) - reading.offset) < 2);
    await until(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='새 채팅 보기 ↓')`,
    );
    await button('새 채팅 보기 ↓');
    await frames();
    assert.equal(
      await js(
        `(()=>{const p=document.querySelector('.chat-scroll');return p.scrollHeight-p.scrollTop-p.clientHeight<2})()`,
      ),
      true,
    );
    s.addMessage('momo', '최신 채팅 자동 따라가기');
    await count(202);
    await frames();
    assert.equal(
      await js(
        `(()=>{const p=document.querySelector('.chat-scroll');return p.scrollHeight-p.scrollTop-p.clientHeight<2})()`,
      ),
      true,
    );
    mark('new chat preserves reading position; jump resumes automatic following');
    await scrollTop();
    await js(
      `window.originalFetch=window.fetch;window.fetch=(url,...args)=>String(url).includes('/api/chat/history?')?Promise.resolve(new Response(JSON.stringify({error:'합성 연결 실패'}),{status:503,headers:{'Content-Type':'application/json'}})):originalFetch(url,...args);void 0`,
    );
    await button('이전 채팅 더보기');
    await until(
      `document.querySelector('.chat-history-controls [role=alert]')?.textContent==='합성 연결 실패'`,
    );
    await js('window.fetch=originalFetch;void 0');
    await button('이전 채팅 더보기');
    await count(302);
    for (const size of [402, 502, 602, 607]) {
      await scrollTop();
      await button('이전 채팅 더보기');
      await count(size);
    }
    const ids = await js(
      `Array.from(document.querySelectorAll('.chat-scroll .chat-line')).map(e=>e.dataset.messageId)`,
    );
    assert.equal(ids[0], all[0].id);
    assert.equal(ids[605], fresh.id);
    assert.equal(new Set(ids).size, 607);
    await until(`!document.querySelector('.chat-history-controls button')`);
    mark(
      'retry recovers and paging crosses 500 all the way to the retained beginning without duplicates',
    );
    await scrollTop();
    await frames();
    writeFileSync(join(base, 'history.png'), (await win.webContents.capturePage()).toPNG());
    const remove = all[0].id;
    await js(
      `Array.from(document.querySelectorAll('.chat-scroll .chat-line')).find(e=>e.dataset.messageId===${JSON.stringify(remove)}).querySelector('.delete-message').click()`,
    );
    await count(100);
    assert.equal(
      s.journal.data.entries.some((m) => m.id === remove),
      false,
    );
    await button('이전 채팅 더보기');
    await count(200);
    await js(`document.querySelector('button[aria-label="채팅 비우기"]').click()`);
    await count(0);
    const cleared = s.chatHistory.page({
      sessionId: s.sessionId,
      revision: s.chatHistory.revision,
    });
    assert.equal(cleared.messages.length, 0);
    mark(
      'deletion invalidates cached history and clear does not resurrect older retained memories',
    );
    for (let i = 0; i < 120; i++)
      s.publishMessage(s.prepareMessage('momo', '교체 전 ' + i), { publishState: false });
    s.publish();
    await count(100);
    await scrollTop();
    await js(
      `window.fetch=(url,...args)=>String(url).includes('/api/chat/history?')?originalFetch(url,...args).then(r=>new Promise(done=>window.releaseOldHistory=()=>done(r))):originalFetch(url,...args);void 0`,
    );
    await button('이전 채팅 더보기');
    await until("typeof releaseOldHistory==='function'");
    s.stop();
    s.start();
    const newSession = s.addMessage('momo', '새 방송 하나');
    await count(1);
    await js('releaseOldHistory();window.fetch=originalFetch;void 0');
    await frames();
    await pause(100);
    assert.deepEqual(
      await js(
        `Array.from(document.querySelectorAll('.chat-scroll .chat-line')).map(e=>e.dataset.messageId)`,
      ),
      [newSession.id],
    );
    mark('a late previous-session page cannot reappear after starting a new broadcast');
    s.stop();
    s.configure({ ...s.settings, mode: 'rehearsal' });
    s.start();
    const oldest = s.addMessage(s.settings.managerId, '긴 화면 목록 첫 채팅');
    await count(1);
    for (let batch = 0; batch < 10; batch++) {
      for (let i = 0; i < 500; i++)
        s.publishMessage(s.prepareMessage(s.settings.managerId, `긴 화면 목록 ${batch}-${i}`), {
          publishState: false,
        });
      s.publish();
      await count(Math.min(4500, 1 + (batch + 1) * 500));
    }
    assert.equal(
      await js(`document.querySelector('.chat-scroll .chat-line').dataset.messageId`),
      oldest.id,
    );
    const latest = s.messages.at(-1);
    await button('새 채팅 보기 ↓');
    await count(100);
    await frames();
    assert.equal(
      await js(
        `Array.from(document.querySelectorAll('.chat-scroll .chat-line')).at(-1).dataset.messageId`,
      ),
      latest.id,
    );
    assert.equal(
      await js(
        `(()=>{const p=document.querySelector('.chat-scroll');return p.scrollHeight-p.scrollTop-p.clientHeight<2})()`,
      ),
      true,
    );
    mark(
      'more than 5000 arrivals keep at most 4500 rendered rows and the latest-chat action restores the live window',
    );
    s.stop();
    assert.equal(report.modelCalls, 0);
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
    writeFileSync('artifacts/chat-history-ui-result.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    app.exit(report.passed ? 0 : 1);
  }
});
