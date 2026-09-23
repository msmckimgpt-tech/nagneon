const { app, BrowserWindow } = require('electron');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
const root = resolve(__dirname, '..'),
  out = join(root, 'artifacts', 'community-scroll');
mkdirSync(out, { recursive: true });
app.setPath('userData', join(out, 'electron-profile'));
const report = { synthetic: true, checks: [], screenshots: [] };
let service, win;
const save = () => writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2));
(async () => {
  try {
    await app.whenReady();
    const { startServer } = await import(pathToFileURL(join(root, 'server/index.js')));
    const { digest } = await import(pathToFileURL(join(root, 'server/social-runtime-state.js')));
    const result = (messages = []) => ({
      observation: { game: '일상', scene: '', confidence: 0.8, excitement: 0.2, messages },
      usage: { total_tokens: 1 },
    });
    service = await startServer({
      port: 0,
      persist: false,
      localSpeech: false,
      provider: {
        status: () => ({ configured: true }),
        react: async (a) =>
          result([
            {
              personaId: a.settings.personas[0].id,
              text:
                a.special.kind === 'social-mention'
                  ? '검증방장 님의 퍼즐 이야기, 돌아가는 길도 나쁘지 않더라.'
                  : '오늘은 목표 없이 구석구석 걸어봤다. 작은 길을 발견해서 기분 좋았어.',
              kind: 'chat',
              spoiler: false,
            },
          ]),
      },
    });
    const s = service.studio;
    clearInterval(s.timer);
    s.settings.mode = 'live';
    s.settings.streamer = '검증방장';
    const resident = {
      id: randomUUID(),
      communityId: 'indie',
      persona: {
        id: 'fixture-viewer',
        name: '느린산책',
        personality: '탐험을 좋아함',
        values: '발견',
        sociability: 0.5,
        expertise: 0.5,
        color: '#8bcdd2',
        role: 'viewer',
        enabled: true,
        system: false,
      },
      joinedAt: Date.now() - 10000,
      admitted: true,
    };
    s.world.change((w) => {
      w.settings.personas.push(resident.persona);
      w.audience.members[resident.persona.id] = {
        sessions: 1,
        seconds: 0,
        recognized: 0,
        affinity: 0.2,
        peers: {},
        memories: [],
      };
      w.socialWorld.residents.push(resident);
    });
    const outsider = {
      ...structuredClone(resident),
      id: randomUUID(),
      communityId: 'banter',
      admitted: false,
      persona: { ...resident.persona, id: 'fixture-resident', name: '구석뻘글러' },
    };
    s.world.change((w) => w.socialWorld.residents.push(outsider));
    const ordinary = s.social
      .candidates(s.now())
      .find((t) => t.kind === 'social-daily' && t.id === outsider.id);
    const ordinaryOp = { controller: new AbortController(), epoch: s.epoch, social: true };
    s.communityActivity.active = ordinaryOp;
    ordinaryOp.promise = s.communityActivity.run(ordinary, ordinaryOp);
    await ordinaryOp.promise;
    s.communityActivity.active = null;
    s.busy = false;
    const sourceId = randomUUID();
    s.journal.record(
      {
        id: sourceId,
        personaId: 'streamer',
        name: '검증방장',
        text: '오늘 퍼즐에서 돌아가는 길을 발견했어.',
        kind: 'streamer',
        time: Date.now() - 1000,
      },
      { sessionId: randomUUID(), witnesses: [resident.persona.id] },
    );
    for (const kind of ['social-daily', 'social-mention']) {
      const target = {
        kind,
        id: resident.id,
        viewer: resident.persona,
        revision: digest(kind),
        raw: {
          residentId: resident.id,
          communityId: 'indie',
          topicId: 'explore',
          ...(kind === 'social-mention'
            ? { source: s.social.source(s.journal.data.entries[0], resident.persona.id) }
            : {}),
        },
      };
      const op = { controller: new AbortController(), epoch: s.epoch, social: true };
      s.communityActivity.active = op;
      op.promise = s.communityActivity.run(target, op);
      await op.promise;
      s.communityActivity.active = null;
      s.busy = false;
    }
    s.world.change((w) => {
      const template = w.socialWorld.threads[0];
      w.socialWorld.threads = Array.from({ length: 45 }, (_, i) => ({
        ...template,
        kind: 'daily',
        source: null,
        id: randomUUID(),
        title: '목록 위치 시험 ' + i,
        text: i % 2 ? '짧은 글입니다.' : '긴 이야기를 읽습니다.\n'.repeat(35),
        at: Date.now() - i * 100,
      }));
      w.audience.posts = Array.from({ length: 30 }, (_, i) => ({
        id: randomUUID(),
        title: '방송 목록 ' + i,
        text: '긴 방송 이야기입니다.\n'.repeat(40),
        name: '검증주민',
        personaId: resident.persona.id,
        time: Date.now() - i * 1000,
        kind: 'ai',
        category: i % 2 ? '후기' : '자유',
        comments: [],
        votes: [],
      }));
    });
    const headers = {
      Authorization: 'Bearer ' + service.accessToken,
      'Content-Type': 'application/json',
      'X-Backseat-Client': 'studio',
    };
    await fetch(service.url + '/api/onboarding', {
      method: 'POST',
      headers,
      body: JSON.stringify({ skip: true }),
    });
    await fetch(service.url + '/api/tutorial', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'skip' }),
    });
    win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: [service.url + '/*'] },
      (details, cb) => cb({ requestHeaders: { ...details.requestHeaders, ...headers } }),
    );
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (code) => {
      const end = Date.now() + 10000;
      while (!(await js(code))) {
        if (Date.now() > end) throw Error('UI timeout: ' + code);
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    const click = async (label) =>
      js(
        `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}));if(!b)throw Error('button missing');b.click();})()`,
      );
    await win.loadURL(service.url);
    await until("!!document.querySelector('.app-shell')");
    const settle = () => new Promise((r) => setTimeout(r, 180));
    const top = () => js('document.scrollingElement.scrollTop');
    const position = (selector) =>
      js(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top`);
    const near = (a, b, label) => assert.ok(Math.abs(a - b) < 3, `${label}: ${a} != ${b}`);
    for (const width of [1280, 520]) {
      win.setSize(width, 820);
      await click('방송 밖 이야기');
      await click('바깥 커뮤니티');
      await until("document.querySelectorAll('.social-post').length===30");
      await js(
        "(()=>{const b=document.querySelectorAll('.social-post')[18];b.scrollIntoView({block:'center'});b.focus({preventScroll:true});})()",
      );
      await settle();
      const listTop = await top();
      // A late result in a hidden section must not scroll the visible one.
      await js("document.querySelector('.gallery-table td button').click()");
      await settle();
      near(await top(), listTop, 'hidden section cannot move visible reading position');
      await js("document.querySelector('.gallery-detail .text-button').click()");
      await settle();
      near(await top(), listTop, 'hidden return cannot move visible reading position');
      await js("document.querySelectorAll('.social-post')[18].click()");
      await until("!!document.querySelector('.social-detail')");
      await settle();
      near(await position('.social-detail'), 16, 'detail starts in viewport');
      await js('window.scrollBy(0,350)');
      await click('← 글 목록');
      await settle();
      near(await top(), listTop, 'back restores list scroll');
      assert.equal(
        await js(
          "document.activeElement.dataset.readingId===document.querySelectorAll('.social-post')[18].dataset.readingId",
        ),
        true,
      );
      await js(
        "(()=>{const b=document.querySelectorAll('.social-post')[19] ;b.scrollIntoView({block:'center'});b.focus({preventScroll:true});})()",
      );
      await settle();
      const shortListTop = await top();
      await js("document.querySelectorAll('.social-post')[19] .click()");
      await until("!!document.querySelector('.social-detail')");
      await settle();
      near(await position('.social-detail'), 16, 'detail starts in viewport');
      await js('window.scrollBy(0,350)');
      await click('← 글 목록');
      await settle();
      near(await top(), shortListTop, 'back restores list scroll');
      assert.equal(
        await js(
          "document.activeElement.dataset.readingId===document.querySelectorAll('.social-post')[19] .dataset.readingId",
        ),
        true,
      );
      await js("document.querySelectorAll('.social-post')[29].click()");
      await until("!!document.querySelector('.social-detail')");
      await settle();
      const openTitle = await js("document.querySelector('.social-detail h3').textContent");
      const openTop = await top();
      const newId = randomUUID();
      s.world.change((w) => {
        w.socialWorld.threads.unshift({
          ...w.socialWorld.threads[0],
          id: newId,
          at: Date.now(),
          title: '새로 온 이야기',
        });
        w.socialWorld.revision++;
      });
      s.publish();
      await settle();
      assert.equal(
        await js("document.querySelector('.social-detail h3')?.textContent"),
        openTitle,
        'new posts do not close a detail that moved to another page',
      );
      near(await top(), openTop, 'detail refresh preserves reading position');
      s.world.change((w) => {
        w.socialWorld.threads = w.socialWorld.threads.filter((p) => p.id !== newId);
        w.socialWorld.revision++;
      });
      s.publish();
      await settle();
      await click('← 글 목록');
      await settle();
      await js("document.querySelector('.social-community-list').scrollIntoView({block:'center'})");
      await settle();
      const tabsTop = await position('.social-community-list');
      await js("document.querySelectorAll('.social-community-list button')[1].click()");
      await until("!!document.querySelector('.social-empty')");
      await settle();
      near(
        await position('.social-community-list'),
        tabsTop,
        'empty community keeps tabs in place',
      );
      await click('전체 이야기');
      await until("document.querySelectorAll('.social-post').length===30");
      await settle();
      near(
        await position('.social-community-list'),
        tabsTop,
        'return community keeps tabs in place',
      );
      await click('전체 이야기');
      await settle();
      await js('window.scrollBy(0,120)');
      const afterNoop = await top();
      s.publish();
      await settle();
      near(await top(), afterNoop, 'same tab does not schedule a later jump');
      await js("document.querySelector('.social-pages button:last-child').click()");
      await until("document.querySelectorAll('.social-post').length===15");
      await settle();
      const pageTop = await top();
      s.world.change((w) => {
        w.socialWorld.revision++;
      });
      s.publish();
      await settle();
      assert.equal(
        await js("document.querySelectorAll('.social-post').length"),
        15,
        'refresh retains current page',
      );
      near(await top(), pageTop, 'refresh retains scroll');
      await js("document.querySelector('.social-pages button').click()");
      await until("document.querySelectorAll('.social-post').length===30");
      await js("document.querySelector('.community-sections').scrollIntoView({block:'start'})");
      await settle();
      const sectionTop = await position('.community-sections');
      await click('방송 커뮤니티');
      await settle();
      near(await position('.community-sections'), sectionTop, 'section switch retains tabs');
      await js(
        "(()=>{const b=document.querySelectorAll('.gallery-table td button')[13];b.scrollIntoView({block:'center'});b.focus({preventScroll:true});})()",
      );
      await settle();
      const galleryTop = await top();
      await js("document.querySelectorAll('.gallery-table td button')[13].click()");
      await until("!!document.querySelector('.gallery-detail')");
      await settle();
      near(await position('.gallery-detail'), 16, 'gallery detail starts in viewport');
      await click('← 목록으로');
      await settle();
      near(await top(), galleryTop, 'gallery back restores list');
      report.checks.push(
        `${width}px: long and short posts, detail entry, return position/focus, empty community tabs, pagination refresh, section switch and gallery return`,
      );
      report.screenshots.push(`scroll-${width}.png`);
      writeFileSync(
        join(out, `scroll-${width}.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
    report.passed = true;
    save();
    console.log(JSON.stringify(report));
  } catch (e) {
    if (win) {
      report.geometry = await win.webContents.executeJavaScript(
        `({y:scrollY,max:document.scrollingElement.scrollHeight-innerHeight, height:innerHeight, nodes:[...document.querySelectorAll('.social-detail,.community-reading-content')].map(e=>({cls:e.className,top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,display:getComputedStyle(e).display})), ancestors:(()=>{const a=[];let p=document.querySelector('.social-detail');while(p){a.push({tag:p.tagName,cls:p.className,overflow:getComputedStyle(p).overflowY,top:p.scrollTop,height:p.clientHeight,scroll:p.scrollHeight});p=p.parentElement;}return a;})()})`,
      );
    }
    report.passed = false;
    report.error = e.stack;
    save();
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    win?.destroy();
    await service?.close();
    app.exit(process.exitCode || 0);
  }
})();
