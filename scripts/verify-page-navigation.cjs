// Isolated detailed-navigation regression; run after npm run build.
// Real Electron/preload/server, only synthetic records and window-owned inputs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(require('electron'), [__filename], {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 240000,
  });
  if (child.error) console.error(child.error);
  process.exit(child.status ?? 1);
}
const { app, BrowserWindow, session, net, ipcMain } = require('electron');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { createStudioSession } = require('../desktop/session.cjs');
const { attachNavigationHistory } = require('../desktop/navigation.cjs');
const root = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(root, 'artifacts', 'page-navigation-'));
app.setPath('userData', path.join(out, 'profile'));
app.commandLine.appendSwitch('backseat-profile', path.join(out, 'profile'));
app.disableHardwareAcceleration();
ipcMain.handle('account:status', () => ({ status: 'idle' }));
ipcMain.handle('storage:status', () => ({
  profile: path.join(out, 'profile'),
  defaultProfile: path.join(out, 'profile'),
  isolated: true,
}));
ipcMain.handle('capture:sources', () => [
  { id: 'screen:qa', name: '합성 QA 화면', kind: 'screen', thumbnail: '' },
]);
ipcMain.handle('capture:previews', () => []);
ipcMain.handle('capture:select', () => {
  throw Error('QA must not capture');
});
const report = {
  passed: false,
  synthetic: true,
  physicalMouse: 'NOT_TESTED',
  devices: 'NOT_USED',
  account: 'NOT_USED',
  checks: [],
  screenshots: [],
  errors: [],
};
let service,
  main,
  before,
  overlay,
  calls = 0;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const watchdog = setTimeout(() => {
  fs.writeFileSync(path.join(out, 'timeout.json'), JSON.stringify(report, null, 2));
  app.exit(2);
}, 220000);
app.on('window-all-closed', () => {});
async function nativeCommand(win, direction) {
  const handle = win.getNativeWindowHandle();
  const hwnd =
    handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
  const command = direction === 'back' ? 1 : 2;
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class PageNavigationProbe { [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'; if (-not [PageNavigationProbe]::PostMessage([IntPtr]${hwnd}, 0x0319, [IntPtr]${hwnd}, [IntPtr]${command * 65536})) { exit 1 }`;
  const sent = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(sent.status, 0, sent.stderr || sent.error?.message);
  await pause(100);
}
async function screenshot(win, name) {
  // DOM assertions can finish before the offscreen compositor paints the new page.
  await win.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  await pause(150);
  const file = path.join(out, name + '.png');
  fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
  report.screenshots.push(file);
}
function wav() {
  const samples = 8000,
    buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF');
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}
app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(path.join(root, 'server/index.js')).href);
    service = await startServer({
      port: 0,
      dataDir: path.join(out, 'data'),
      localSpeech: false,
      provider: {
        status: () => ({ kind: 'codex', configured: false }),
        react: async () => {
          calls++;
          throw Error('Unexpected model call');
        },
      },
    });
    const s = service.studio;
    s.ai.update({ background: false, paused: true });
    clearInterval(s.timer);
    const residentId = randomUUID();
    const persona = structuredClone(
      s.settings.personas.find((p) => !p.system) || s.settings.personas[0],
    );
    const postIds = Array.from({ length: 40 }, () => randomUUID());
    const socialIds = Array.from({ length: 45 }, () => randomUUID());
    const factTime = Date.now() - 60000;
    const syntheticFact = {
      id: 'navigation-synthetic-fact',
      evidenceKind: 'synthetic',
      sourceUrl: 'https://store.steampowered.com/news/app/570/view/123',
      headline: '실제 최신 소식이 아닌 합성 탐색 검증 근거',
      publishedAt: factTime - 1000,
      observedAt: factTime,
      expiresAt: factTime + 3600000,
      tags: ['합성 게임'],
      metrics: [
        {
          kind: 'concurrent-players',
          scope: 'game',
          value: 12345,
          sourceUrl:
            'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=570',
          observedAt: factTime,
        },
      ],
    };
    s.world.change((w) => {
      w.socialWorld.residents.push({
        id: residentId,
        communityId: 'indie',
        persona: { ...persona, id: 'qa-resident', name: '검증주민', system: false },
        joinedAt: Date.now() - 100000,
        admitted: false,
      });
      w.socialWorld.threads = socialIds.map((id, i) => ({
        id,
        communityId: 'indie',
        topicId: 'explore',
        residentId,
        kind: 'daily',
        title: '합성 바깥 이야기 ' + i,
        text: '독립 QA용 합성 이야기입니다.\n'.repeat(12),
        at: Date.now() - i * 1000,
        source: null,
        comments: [],
        votes: [],
        attachments: [],
        ...(i === 30 ? { trendFact: syntheticFact } : {}),
      }));
      w.audience.posts = postIds.map((id, i) => ({
        id,
        title: '합성 방송 이야기 ' + i,
        text: '독립 QA용 긴 방송 이야기입니다.\n'.repeat(25),
        name: '검증주민',
        personaId: persona.id,
        time: Date.now() - i * 1000,
        kind: 'ai',
        category: i % 2 ? '후기' : '자유',
        comments: [],
        votes: [],
      }));
    });
    const clip = s.clips.create({
      title: '합성 핫클립 A',
      scene: '미디어 탐색용 합성 기록',
      game: 'QA 게임',
      participants: [],
      messages: [],
      source: 'manual',
      sessionId: randomUUID(),
    });
    s.clips.change((rows) => {
      const row = rows.find((c) => c.id === clip.id);
      row.audio = true;
      row.hasAudio = true;
      row.audioEligible = true;
      row.audioStartedAt = Date.now() - 1000;
      row.audioEndedAt = Date.now();
    });
    s.clips.writeMedia(clip.id, 'webm', wav());
    const headers = {
      Authorization: 'Bearer ' + service.accessToken,
      'Content-Type': 'application/json',
      'X-Backseat-Client': 'studio',
    };
    for (const [endpoint, body] of [
      ['onboarding', { skip: true }],
      ['tutorial', { action: 'skip' }],
    ]) {
      const response = await fetch(service.url + '/api/' + endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      assert.equal(response.ok, true);
    }
    const options = {
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        preload: path.join(root, 'desktop/preload.cjs'),
        session: createStudioSession(session, service),
      },
    };
    main = new BrowserWindow(options);
    attachNavigationHistory(main);
    main.webContents.on('console-message', (_e, level, message) => {
      if (level === 3 && !message.includes('Autofill')) report.errors.push(message);
    });
    const js = (code) => main.webContents.executeJavaScript(code, true);
    const until = async (code) => {
      const end = Date.now() + 12000;
      while (!(await js(code))) {
        if (Date.now() > end) throw Error('Timed out: ' + code);
        await pause(40);
      }
    };
    const hash = () => js('location.hash');
    const click = async (selector) => {
      await until(`!!document.querySelector(${JSON.stringify(selector)})`);
      await js(
        `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus({preventScroll:true});el.click();})()`,
      );
      await pause(100);
    };
    const button = async (text) => {
      const expr = `[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)})&&b.getClientRects().length)`;
      await until(`!!(${expr})`);
      await js(`(()=>{const el=${expr};el.focus({preventScroll:true});el.click();})()`);
      await pause(100);
    };
    const route = async (expected) => {
      await until(`location.hash===${JSON.stringify(expected)}`);
      await pause(120);
      assert.equal(await hash(), expected);
    };
    const move = async (direction, expected) => {
      await nativeCommand(main, direction);
      await route(expected);
    };
    const key = async (keyCode, modifiers = []) => {
      main.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      main.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await pause(100);
    };
    const input = async (selector, text) => {
      await js(
        `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await pause(120);
    };
    const top = () => js('document.scrollingElement.scrollTop');
    const near = (a, b, label) => assert.ok(Math.abs(a - b) < 4, `${label}: ${a} versus ${b}`);
    await main.loadURL(service.url);
    await until(`!!document.querySelector('.app-shell')`);
    await route('#/studio');
    await click('[data-tutorial="nav-audience"]');
    await click('[data-tutorial="nav-community"]');
    await button('바깥 커뮤니티');
    await route('#/community/outside');
    const hiddenHash = await hash();
    await js("document.querySelector('.gallery-table td button').click()");
    assert.equal(await hash(), hiddenHash);
    await until(`document.querySelectorAll('.social-post').length===30`);
    await js(`document.querySelectorAll('.social-community-list button')[3].click()`);
    await route('#/community/outside?community=indie');
    for (let i = 0; i < 3; i++) {
      await move('back', '#/community/outside');
      await move('forward', '#/community/outside?community=indie');
    }
    report.checks.push(
      'native back/forward repeats restore nested community selections exactly once',
    );
    await input('[aria-label="커뮤니티 글 검색"]', '바깥');
    await button('검색');
    const searchRoute = await hash();
    assert.ok(searchRoute.includes('q='));
    await click('.social-pages button:last-child');
    await until(`document.querySelectorAll('.social-post').length===15`);
    const outsideListRoute = await hash();
    assert.ok(outsideListRoute.includes('page=1'));
    await move('back', searchRoute);
    await until(`document.querySelectorAll('.social-post').length===30`);
    await move('forward', outsideListRoute);
    await until(`document.querySelectorAll('.social-post').length===15`);
    report.checks.push('outside submitted search and paging share one history step per action');
    await click('.social-post');
    const outsideDetail = await hash();
    assert.ok(outsideDetail.includes('post='));
    await until(`!!document.querySelector('.social-detail')`);
    await screenshot(main, 'after-outside-detail-1280');
    await move('back', outsideListRoute);
    await move('forward', outsideDetail);
    main.webContents.reload();
    await until(`!!document.querySelector('.social-detail')`);
    await route(outsideDetail);
    report.checks.push('outside post detail survives native history and refresh');
    await until(`!!document.querySelector('.community-fact')`);
    const factCard = await js(`({
      text:document.querySelector('.community-fact').textContent,
      href:document.querySelector('.community-fact a').href,
      times:[...document.querySelectorAll('.community-fact time')].map(t=>t.dateTime),
      input:document.querySelector('.community-fact-input').textContent
    })`);
    assert.equal(factCard.href, syntheticFact.sourceUrl);
    assert.ok(factCard.text.includes('합성 입력에 대한 가상 반응'));
    assert.ok(factCard.text.includes('이슈 화제 규모: 미관측'));
    assert.ok(factCard.text.includes('가상 인물의 개인 의견'));
    for (const time of [
      syntheticFact.publishedAt,
      syntheticFact.observedAt,
      syntheticFact.expiresAt,
    ])
      assert.ok(factCard.times.includes(new Date(time).toISOString()));
    assert.ok(factCard.input.includes('사실 입력 미연결'));
    const format = JSON.parse(fs.readFileSync(path.join(out, 'data/profile-format.json'), 'utf8'));
    assert.equal(format.minReader, 4);
    assert.deepEqual(s.world.data.socialWorld.threads[30].trendFact, syntheticFact);
    main.setContentSize(390, 844);
    await pause(180);
    const factLayout = await js(`({width:innerWidth,
      left:document.querySelector('.community-fact').getBoundingClientRect().left,
      right:document.querySelector('.community-fact').getBoundingClientRect().right,
      scroll:document.documentElement.scrollWidth})`);
    assert.ok(
      factLayout.left >= 0 && factLayout.right <= factLayout.width + 2,
      JSON.stringify(factLayout),
    );
    assert.ok(factLayout.scroll <= factLayout.width + 2, JSON.stringify(factLayout));
    await screenshot(main, 'after-synthetic-fact-detail-390');
    main.setSize(1280, 900);
    report.checks.push(
      'synthetic fact provenance, exact timestamps and unobserved issue popularity survive native detail history and reload; Reader4 and 390px layout remain valid',
    );
    await main.loadURL(service.url + '/#/community/broadcast');
    await until(`!!document.querySelector('.gallery-table td button')`);
    await button('후기');
    const filtered = await hash();
    assert.ok(filtered.includes('filter='));
    await js(
      `(()=>{const el=document.querySelectorAll('.gallery-table td button')[12];el.scrollIntoView({block:'center'});el.focus({preventScroll:true});})()`,
    );
    await pause(200);
    const galleryTop = await top();
    const selectedPost = await js(`document.activeElement.dataset.readingId`);
    await js('document.activeElement.click()');
    await until(`!!document.querySelector('.gallery-detail')`);
    const galleryDetail = await hash();
    assert.equal(await js(`document.querySelector('.gallery-table-wrap').hidden`), true);
    near(await top(), 0, 'detail opens at top');
    assert.equal(await js("document.querySelector('.gallery-toolbar').getClientRects().length"), 0);
    assert.equal(
      await js("document.querySelector('.gallery-table-wrap').getClientRects().length"),
      0,
    );
    assert.equal(await js('document.activeElement.hasAttribute("data-page-title")'), true);
    await screenshot(main, 'after-gallery-detail-1280');
    await move('back', filtered);
    await until(`document.activeElement.dataset.readingId===${JSON.stringify(selectedPost)}`);
    near(await top(), galleryTop, 'back restores list scroll');
    await move('forward', galleryDetail);
    await button('← 목록으로');
    await route(filtered);
    near(await top(), galleryTop, 'list action restores scroll');
    await main.loadURL(service.url + '/' + galleryDetail);
    await until(`!!document.querySelector('.gallery-detail')`);
    main.webContents.reload();
    await until(`!!document.querySelector('.gallery-detail')`);
    await route(galleryDetail);
    report.checks.push(
      'gallery filter/post direct URL and refresh; list/detail separation; heading focus and list scroll/focus restoration',
    );
    await button('← 목록으로');
    await button('글쓰기');
    assert.ok((await hash()).includes('write=1'));
    await button('취소');
    assert.ok(!(await hash()).includes('write=1'));
    report.checks.push('gallery write/cancel route returns to filtered list');
    await click('[data-tutorial="nav-clips"]');
    await click('.clip-card');
    const clipRoute = await hash();
    await until(`!!document.querySelector('.clip-detail')`);
    assert.equal(await js(`!!document.querySelector('.clip-grid')`), false);
    await screenshot(main, 'after-clip-detail-1280');
    await move('back', '#/clips');
    await move('forward', clipRoute);
    main.webContents.reload();
    await until(`!!document.querySelector('.clip-detail')`);
    await route(clipRoute);
    await main.loadURL(service.url + '/' + clipRoute);
    await until(`!!document.querySelector('.clip-detail')`);
    await button('← 핫클립 목록');
    await route('#/clips');
    report.checks.push('clip detail native history/direct URL/refresh and explicit return to list');
    await click('[data-tutorial="settings"]');
    await route('#/clips?settings=broadcast');
    const titleSelector = '#settings-panel-broadcast input[maxlength="100"]';
    const savedTitle = s.settings.title;
    await input(titleSelector, '저장하지 않은 합성 제목');
    await click('#settings-tab-mood');
    await route('#/clips?settings=mood');
    await move('back', '#/clips?settings=broadcast');
    assert.equal(
      await js(`document.querySelector(${JSON.stringify(titleSelector)}).value`),
      '저장하지 않은 합성 제목',
    );
    await move('back', '#/clips');
    await move('forward', '#/clips?settings=broadcast');
    assert.equal(
      await js(`document.querySelector(${JSON.stringify(titleSelector)}).value`),
      '저장하지 않은 합성 제목',
    );
    assert.equal(s.settings.title, savedTitle);
    assert.equal(await js(`document.getElementById('root').hasAttribute('inert')`), true);
    await click('#settings-tab-broadcast');
    await key('Right');
    await route('#/clips?settings=mood');
    assert.equal(await js('document.activeElement.id'), 'settings-tab-mood');
    await click('#settings-tab-media');
    await js(`document.querySelector('.settings-body').scrollTop=300`);
    await pause(100);
    const settingsTop = await js(`document.querySelector('.settings-body').scrollTop`);
    await click('#settings-tab-games');
    await move('back', '#/clips?settings=media');
    near(
      await js(`document.querySelector('.settings-body').scrollTop`),
      settingsTop,
      'settings tab scroll',
    );
    await screenshot(main, 'after-settings-media-1280');
    await button('취소·닫기');
    await route('#/clips');
    assert.equal(await js(`document.getElementById('root').hasAttribute('inert')`), false);
    await click('[data-tutorial="settings"]');
    assert.equal(
      await js(`document.querySelector(${JSON.stringify(titleSelector)}).value`),
      savedTitle,
    );
    await key('Escape');
    await route('#/clips');
    assert.equal(await js('document.activeElement.dataset.tutorial'), 'settings');
    report.checks.push(
      'settings draft survives tab/back/forward but cancel/Escape discards; no implicit save; category keyboard and scroll restoration',
    );
    await click('[data-tutorial="settings"]');
    await input(titleSelector, '저장한 합성 제목');
    await button('설정 저장');
    await route('#/clips');
    assert.equal(s.settings.title, '저장한 합성 제목');
    await click('[data-tutorial="settings"]');
    assert.equal(
      await js(`document.querySelector(${JSON.stringify(titleSelector)}).value`),
      '저장한 합성 제목',
    );
    await button('취소·닫기');
    await route('#/clips');
    await main.loadURL(service.url + '/#/manager?settings=games');
    await until(`!!document.querySelector('.settings-dialog')`);
    await route('#/manager?settings=games');
    await button('취소·닫기');
    await route('#/manager');
    report.checks.push(
      'settings explicit save updates isolated server; direct settings deep-link cancel stays on background page',
    );
    await button('받은 후원');
    const donationHash = await hash();
    await until(`!!document.querySelector('.donation-history')`);
    await nativeCommand(main, 'forward');
    assert.equal(await hash(), donationHash);
    await nativeCommand(main, 'back');
    await until(`!document.querySelector('[role="dialog"]')`);
    assert.equal(await hash(), donationHash);
    report.checks.push('temporary modal consumes back; forward cannot move inert background');
    await click('[data-tutorial="nav-studio"]');
    await button('화면 선택');
    await until("!!document.querySelector('.source-modal')");
    const captureHash = await hash();
    await nativeCommand(main, 'back');
    await until("!document.querySelector('[role=dialog]')");
    assert.equal(await hash(), captureHash);
    report.checks.push('synthetic screen picker back cancels without capturing or changing page');
    await click('[data-tutorial="nav-community"]');
    await click('[data-tutorial="nav-ai"]');
    await key('Left', ['alt']);
    await route('#/community/broadcast');
    await key('Right', ['alt']);
    await route('#/ai');
    // Chromium DOM side input plus paired Electron notification must not double-step.
    if (!main.webContents.debugger.isAttached()) main.webContents.debugger.attach('1.3');
    for (const type of ['mousePressed', 'mouseReleased'])
      await main.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type,
        x: 600,
        y: 90,
        button: 'back',
        buttons: type === 'mouseReleased' ? 0 : 8,
        clickCount: 1,
      });
    main.emit('app-command', {}, 'browser-backward');
    await route('#/community/broadcast');
    report.checks.push(
      'Alt+Left/Right and paired Chromium/native mouse events share route history without double-step',
    );
    // Data refresh must not snap a user reading position back to the last route restore.
    await until(`!!document.querySelector('.gallery-table td button')`);
    await js('document.scrollingElement.scrollTop=350');
    await pause(150);
    const readingTop = await top();
    s.publish();
    await pause(500);
    near(await top(), readingTop, 'live data refresh preserves scroll');
    await click('[data-tutorial="nav-ai"]');
    near(await top(), 0, 'new tab starts at top');
    await move('back', '#/community/broadcast');
    near(await top(), readingTop, 'cross-tab back restores scroll');
    report.checks.push('new top-level page starts at top; history restores previous page scroll');
    main.setSize(520, 740);
    await pause(180);
    await click('.gallery-table td button');
    await until(`!!document.querySelector('.gallery-detail')`);
    await screenshot(main, 'after-gallery-detail-520');
    assert.ok(
      await js("document.querySelector('.gallery-detail').getBoundingClientRect().top<innerHeight"),
    );
    const dims = await js(
      `({width:innerWidth,scroll:document.documentElement.scrollWidth,heading:document.querySelector('[data-page-title]').getBoundingClientRect().top})`,
    );
    assert.ok(dims.scroll <= dims.width + 2, JSON.stringify(dims));
    await click('[data-tutorial="settings"]');
    await click('#settings-tab-connection');
    await screenshot(main, 'after-settings-connection-520');
    for (let i = 0; i < 18; i++) {
      await key('Tab');
      assert.equal(
        await js(`document.querySelector('[role="dialog"]').contains(document.activeElement)`),
        true,
      );
    }
    await key('Tab', ['shift']);
    assert.equal(
      await js(`document.querySelector('[role="dialog"]').contains(document.activeElement)`),
      true,
    );
    await key('Escape');
    report.checks.push(
      '520x740 small window, no page overflow, Tab/Shift+Tab focus containment and Escape return',
    );
    overlay = new BrowserWindow(options);
    await overlay.loadURL(service.url + '/overlay');
    const mainRoute = await hash();
    await nativeCommand(overlay, 'back');
    await nativeCommand(overlay, 'forward');
    overlay.webContents.send('navigation:history', 'back');
    await pause(100);
    assert.equal(await hash(), mainRoute);
    assert.equal(overlay.listenerCount('app-command'), 0);
    report.checks.push('overlay stays outside main navigation');
    // Build the baseline renderer from committed source for comparable BEFORE images.
    const baseline = path.join(out, 'baseline');
    fs.mkdirSync(baseline);
    // The first navigation commit's parent remains the comparison baseline after commit.
    const introduced = spawnSync(
      'git',
      ['log', '--diff-filter=A', '--format=%H', '-1', '--', 'src/PageNavigation.tsx'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(introduced.status, 0);
    const baselineRef =
      process.env.NAGNEON_NAVIGATION_BASELINE ||
      (introduced.stdout.trim() ? introduced.stdout.trim() + '^' : 'HEAD');
    const resolved = spawnSync('git', ['rev-parse', baselineRef], { cwd: root, encoding: 'utf8' });
    assert.equal(resolved.status, 0);
    report.baselineRevision = resolved.stdout.trim();
    const archive = path.join(baseline, 'source.tar');
    const packed = spawnSync(
      'git',
      [
        'archive',
        '--format=tar',
        '--output=' + archive,
        baselineRef,
        'src',
        'shared',
        'public',
        'server',
      ],
      { cwd: root, timeout: 30000 },
    );
    assert.equal(packed.status, 0, packed.stderr?.toString());
    const extracted = spawnSync('tar.exe', ['-xf', archive, '-C', baseline], {
      windowsHide: true,
      timeout: 30000,
    });
    assert.equal(extracted.status, 0, extracted.stderr?.toString());
    fs.copyFileSync(path.join(root, 'package.json'), path.join(baseline, 'package.json'));
    await require('esbuild').build({
      entryPoints: [path.join(baseline, 'src/main.tsx')],
      bundle: true,
      outfile: path.join(baseline, 'bundle.js'),
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      loader: { '.svg': 'dataurl' },
      logLevel: 'silent',
    });
    const baselineSession = session.fromPartition('page-navigation-before-' + randomUUID());
    baselineSession.protocol.handle('http', (request) => {
      const url = new URL(request.url);
      if (
        url.origin === new URL(service.url).origin &&
        /\/assets\/.*\.(js|css)$/.test(url.pathname)
      ) {
        const extension = url.pathname.endsWith('.css') ? 'css' : 'js';
        return new Response(fs.readFileSync(path.join(baseline, 'bundle.' + extension)), {
          headers: { 'Content-Type': extension === 'css' ? 'text/css' : 'text/javascript' },
        });
      }
      const h = new Headers(request.headers);
      if (request.url.startsWith(service.url + '/'))
        h.set('Authorization', 'Bearer ' + service.accessToken);
      return net.fetch(new Request(request, { headers: h }), {
        bypassCustomProtocolHandlers: true,
      });
    });
    before = new BrowserWindow({
      ...options,
      width: 1280,
      height: 900,
      webPreferences: { ...options.webPreferences, session: baselineSession },
    });
    await before.loadURL(service.url);
    const beforeJs = (code) => before.webContents.executeJavaScript(code, true);
    const beforeUntil = async (code) => {
      for (let i = 0; i < 250; i++) {
        if (await beforeJs(code)) return;
        await pause(40);
      }
      throw Error('Baseline UI timeout: ' + code);
    };
    await beforeUntil(`!!document.querySelector('[data-tutorial="nav-community"]')`);
    await beforeJs(`document.querySelector('[data-tutorial="nav-community"]').click()`);
    await beforeUntil(`!!document.querySelector('.gallery-table td button')`);
    await beforeJs(`document.querySelector('.gallery-table td button').click()`);
    await screenshot(before, 'before-gallery-inline-detail-1280');
    assert.equal(await beforeJs(`document.querySelector('.gallery-table-wrap').hidden`), false);
    await beforeJs(`document.querySelector('[data-tutorial="nav-clips"]').click()`);
    await beforeUntil(`!!document.querySelector('.clip-card')`);
    await beforeJs(`document.querySelector('.clip-card').click()`);
    await beforeUntil(`!!document.querySelector('.clip-detail')`);
    await screenshot(before, 'before-clip-inline-detail-1280');
    report.checks.push(
      'comparable committed-baseline before screenshots show list and inline detail together',
    );
    assert.equal(calls, 0);
    assert.deepEqual(report.errors, []);
    report.checks.push('zero model calls and zero renderer console errors');
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    console.error(error);
    if (main && !main.isDestroyed()) await screenshot(main, 'failure');
  } finally {
    clearTimeout(watchdog);
    before?.destroy();
    overlay?.destroy();
    main?.destroy();
    await service?.close();
    fs.writeFileSync(
      path.join(out, 'result.json'),
      JSON.stringify({ ...report, modelCalls: calls }, null, 2),
    );
    console.log(JSON.stringify({ out, ...report, modelCalls: calls }));
    app.exit(report.passed ? 0 : 1);
  }
});
