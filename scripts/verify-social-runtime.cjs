const { app, BrowserWindow } = require('electron');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
const root = resolve(__dirname, '..'),
  out = join(root, 'artifacts', 'social-ui');
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
    await click('방송 밖 이야기');
    await until("!!document.querySelector('.community-sections')");
    assert.equal(
      await js(
        "document.querySelectorAll('.sidebar button').length===0 || ![...document.querySelectorAll('.sidebar button')].some(b=>b.textContent.trim()==='바깥 커뮤니티')",
      ),
      true,
    );
    await click('바깥 커뮤니티');
    await until("document.querySelectorAll('.social-post').length===3");
    report.checks.push(
      'existing tab contains both sections; real server runtime-generated fixture posts rendered',
    );
    const beforeNavigation = JSON.stringify(s.world.data);
    await click('AI 대시보드');
    await until(
      "document.querySelector('.ai-dashboard')?.textContent.includes('게시글 저장 완료')",
    );
    assert.equal(
      await js(
        "document.querySelector('.ai-dashboard').textContent.includes('바깥 커뮤니티 · 방송 이야기')",
      ),
      true,
    );
    await js(
      "[...document.querySelectorAll('.ai-dashboard table')].at(-1)?.scrollIntoView({block:'end'})",
    );
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(out, 'dashboard.png'), (await win.webContents.capturePage()).toPNG());
    report.screenshots.push('dashboard.png');
    await click('바깥 커뮤니티 · 방송 이야기 결과 위치 열기');
    await until(
      "document.querySelector('[aria-label=\"바깥 커뮤니티\"]')?.getAttribute('aria-pressed')==='true'",
    );
    await until("document.querySelectorAll('.social-post').length===3");
    assert.equal(JSON.stringify(s.world.data), beforeNavigation);
    await click('AI 대시보드');
    await until("!!document.querySelector('.ai-dashboard')");
    await click('방송 커뮤니티');
    await until(
      "document.querySelector('[aria-label=\"방송 커뮤니티\"]')?.getAttribute('aria-pressed')==='true'",
    );
    await click('AI 대시보드');
    await until("!!document.querySelector('.ai-dashboard')");
    await click('바깥 커뮤니티 · 글 3개');
    await until("document.querySelectorAll('.social-post').length===3");
    report.checks.push(
      'dashboard distinguishes saved posts and opens the correct community section without AI calls',
    );

    assert.equal(
      await js("document.querySelectorAll('.social-post.social-viewer-post').length"),
      2,
    );
    assert.equal(
      await js("document.querySelectorAll('.social-post .social-viewer-badge').length"),
      2,
    );
    assert.equal(await js("document.querySelectorAll('.social-community-list button').length"), 6);
    assert.equal(
      s.settings.personas.some((p) => p.id === outsider.persona.id),
      false,
    );
    writeFileSync(join(out, 'residents.png'), (await win.webContents.capturePage()).toPNG());
    report.screenshots.push('residents.png');
    await js(
      "[...document.querySelectorAll('.social-community-list button')].find(b=>b.textContent.includes('자유난장')).click()",
    );
    await until("document.querySelectorAll('.social-post').length===1");
    assert.equal(
      await js("document.querySelectorAll('.social-post .social-viewer-badge').length"),
      0,
    );
    await click('전체 이야기');
    await until("document.querySelectorAll('.social-post').length===3");
    report.checks.push(
      'five communities include unaffiliated resident posts; only real audience authors have badges',
    );
    const before = JSON.stringify(s.world.data);
    await js("document.querySelector('.social-search input[type=checkbox]').click()");
    await until("document.querySelector('.social-empty')?.textContent.includes('현재 검색·필터')");
    await click('전체 이야기 보기');
    await until("document.querySelectorAll('.social-post').length===3");
    assert.equal(JSON.stringify(s.world.data), before);
    report.checks.push(
      'empty filtered list explains the filter and restores all posts without mutation',
    );
    await click('내 이야기 찾기');
    await until("document.querySelectorAll('.social-post').length===1");
    assert.equal(JSON.stringify(s.world.data), before);
    report.checks.push('ego search is read-only');
    await js("document.querySelector('.social-post').click()");
    await until("!!document.querySelector('.social-detail')");
    assert.equal(
      await js("document.querySelectorAll('.social-detail .social-viewer-badge').length"),
      1,
    );
    const originalRoster = [...s.settings.personas];
    s.world.change((w) => {
      w.settings.personas = w.settings.personas.filter((p) => p.id !== resident.persona.id);
    });
    s.publish();
    await until(
      "document.querySelector('.social-detail') && !document.querySelector('.social-detail .social-viewer-badge')",
    );
    s.world.change((w) => {
      w.settings.personas = originalRoster;
    });
    s.publish();
    await until("!!document.querySelector('.social-detail .social-viewer-badge')");
    report.checks.push('author highlight follows roster changes without reopening the page');
    await click('북마크');
    await until(
      "!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='북마크 해제')",
    );
    assert.equal(s.social.data().preferences.bookmarks.length, 1);
    report.checks.push('bookmark persists through PATCH');
    writeFileSync(join(out, 'desktop.png'), (await win.webContents.capturePage()).toPNG());
    report.screenshots.push('desktop.png');
    await click('← 글 목록');
    await js("document.querySelector('.social-settings').open=true");
    await js("document.querySelector('.social-settings input').click()");
    await until("document.querySelector('.social-settings summary').textContent.includes('OFF')");
    assert.equal(s.social.enabled(), false);
    report.checks.push('OFF reaches authoritative runtime');
    win.setSize(520, 820);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
    writeFileSync(join(out, 'narrow.png'), (await win.webContents.capturePage()).toPNG());
    report.screenshots.push('narrow.png');
    assert.ok(
      await js(
        "parseFloat(getComputedStyle(document.querySelector('.community-sections button')).fontSize)>10",
      ),
    );
    report.checks.push('520px layout with readable internal tabs and without horizontal overflow');
    await click('방송 커뮤니티');
    await until("!!document.querySelector('.community-gallery')");
    report.checks.push('existing gallery remains reachable');
    report.passed = true;
    save();
    console.log(JSON.stringify(report));
  } catch (e) {
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
