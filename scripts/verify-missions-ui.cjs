// Owned hidden Electron renderer and authenticated loopback server. Everything
// is synthetic; no user profile, real AI account or physical capture device is used.
const { app, BrowserWindow, session, ipcMain } = require('electron');
const { createStudioSession } = require('../desktop/session.cjs');
const { attachNavigationHistory } = require('../desktop/navigation.cjs');
const { spawn } = require('node:child_process');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const base = resolve('artifacts/mission-ui-' + Date.now());
mkdirSync(base, { recursive: true });
app.setPath('userData', join(base, 'profile'));
const report = {
  base,
  passed: false,
  syntheticModel: true,
  nativeDevices: false,
  realAccount: false,
  checks: [],
  errors: [],
};
let service,
  win,
  now = Date.now(),
  nextActions = [],
  replySpeech = '',
  replyConsumed = false,
  releaseResponse,
  releaseRequest;
ipcMain.handle('account:status', () => ({ status: 'idle' }));
ipcMain.handle('capture:sources', () => [
  { id: 'screen:synthetic', name: '합성 미션·미리보기 화면', kind: 'screen', thumbnail: '' },
]);
ipcMain.handle('capture:previews', () => []);
ipcMain.handle('capture:select', () => {});
ipcMain.handle('storage:status', () => ({
  profile: join(base, 'profile'),
  defaultProfile: join(base, 'profile'),
  isolated: true,
}));
app.on('window-all-closed', () => {});
setTimeout(() => app.exit(2), 180000).unref();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (code) => win.webContents.executeJavaScript(code, true);
async function until(code, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await js(code)) return;
    await pause(30);
  }
  throw Error('UI timeout: ' + code);
}
async function button(text, twice = false) {
  const find = `Array.from(document.querySelectorAll('.mission-panel button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`;
  await until(`!!(${find})`);
  await js(`{const b=${find};b.click();${twice ? 'b.click();' : ''}}`);
}
// One owned helper keeps Windows message delivery real without repeatedly
// starting PowerShell and compiling the same interop type under concurrent QA.
let nativeProbe,
  nativeSequence = 0,
  nativeOutput = '',
  nativeErrors = '';
const nativeRequests = new Map();
function startNativeProbe() {
  const executable = join(
    process.env.SystemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MissionNavigationProbe { [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'; while (($line = [Console]::ReadLine()) -ne $null) { try { $request = ConvertFrom-Json -InputObject $line -ErrorAction Stop; $handle = [IntPtr]([long]$request.hwnd); $ok = [MissionNavigationProbe]::PostMessage($handle, 0x0319, $handle, [IntPtr]([long]$request.command * 65536)); [Console]::WriteLine((@{id=$request.id;ok=$ok} | ConvertTo-Json -Compress)); } catch { [Console]::WriteLine((@{id=$request.id;ok=$false} | ConvertTo-Json -Compress)); } }`;
  nativeProbe = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  report.nativeProbe = { pid: nativeProbe.pid, executable, startedAt: new Date().toISOString() };
  const fail = (error) => {
    for (const request of nativeRequests.values()) request.reject(error);
    nativeRequests.clear();
  };
  nativeProbe.on('error', fail);
  nativeProbe.on('exit', (code) =>
    fail(Error('Native navigation helper exited ' + code + ' ' + nativeErrors)),
  );
  nativeProbe.stdin.on('error', fail);
  nativeProbe.stderr.on('data', (data) => {
    nativeErrors = (nativeErrors + data.toString()).slice(-4000);
  });
  nativeProbe.stdout.on('data', (data) => {
    nativeOutput += data.toString();
    let end;
    while ((end = nativeOutput.indexOf('\n')) >= 0) {
      const line = nativeOutput.slice(0, end).trim();
      nativeOutput = nativeOutput.slice(end + 1);
      if (!line) continue;
      try {
        const reply = JSON.parse(line),
          request = nativeRequests.get(reply.id);
        if (request) {
          nativeRequests.delete(reply.id);
          request.resolve(reply);
        }
      } catch (error) {
        fail(error);
      }
    }
  });
}
async function nativeHistory(direction) {
  const handle = win.getNativeWindowHandle();
  const hwnd =
    handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
  const id = ++nativeSequence;
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      nativeRequests.delete(id);
      reject(Error('Native navigation message timeout ' + nativeErrors));
    }, 15000);
    nativeRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    nativeProbe.stdin.write(
      JSON.stringify({ id, hwnd, command: direction === 'back' ? 1 : 2 }) + '\n',
    );
  });
  assert.equal(reply.ok, true, 'Windows must accept the owned-window navigation message');
}
async function post(path, body = {}, method = 'POST') {
  const r = await fetch(service.url + '/api/' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + service.accessToken,
      'X-Backseat-Client': 'studio',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
const payload = (values) => ({
  kind: 'propose',
  personaId: 'momo',
  templateId: 'one-attempt',
  target: 60,
  amount: 20,
  missionId: null,
  reason: '재시작 없는 한 판을 보고 싶어서',
  ...values,
});
async function react(actions, text) {
  now += 20000;
  nextActions = actions;
  replySpeech = text;
  replyConsumed = false;
  assert.equal(
    (await post('speech', { sessionId: service.studio.sessionId, id: randomUUID(), text })).status,
    200,
  );
  // The renderer also polls /react. HTTP 200 with skipped:interval/busy is
  // admission deferral, not completion. Keep this synthetic response pending
  // until one actual model request consumes this exact speech, then settles.
  const started = Date.now();
  while ((!replyConsumed || service.studio.busy) && Date.now() - started < 10000) {
    if (!service.studio.busy && !replyConsumed) {
      now += 20000;
      assert.equal((await post('react', {})).status, 200);
    }
    await pause(30);
  }
  assert.equal(replyConsumed, true, 'synthetic speech must reach one admitted request');
  assert.equal(service.studio.busy, false);
  nextActions = [];
  replySpeech = '';
  service.studio.publish();
  await until(`!!document.querySelector('.mission-panel')`);
}
async function screenshot(name) {
  await js(
    `document.querySelector('.mission-panel').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  await pause(100);
  writeFileSync(join(base, name), (await win.webContents.capturePage()).toPNG());
}
async function open(width = 860) {
  const uiSession = createStudioSession(session, service);
  uiSession.webRequest.onBeforeRequest(
    { urls: [service.url + '/api/missions'] },
    (_details, callback) => {
      if (report.holdRequest)
        releaseRequest = () => {
          releaseRequest = null;
          callback({});
        };
      else callback({});
    },
  );
  uiSession.webRequest.onHeadersReceived(
    { urls: [service.url + '/api/missions'] },
    (_details, callback) => {
      if (report.holdResponse)
        releaseResponse = () => {
          releaseResponse = null;
          callback({});
        };
      else callback({});
    },
  );
  win = new BrowserWindow({
    width,
    height: 960,
    show: false,
    webPreferences: {
      session: uiSession,
      preload: resolve('desktop/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(width, 960);
  attachNavigationHistory(win);
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') report.errors.push(e.message);
  });
  await win.loadURL(service.url);
  await until(`!!document.querySelector('.app-shell')`);
  await js(`(()=>{window.qaUnexpectedMicrophone=0;
    navigator.mediaDevices.enumerateDevices=async()=>[];
    navigator.mediaDevices.getUserMedia=async()=>{qaUnexpectedMicrophone++;throw new DOMException('Synthetic mission QA forbids physical microphone access','NotAllowedError');};})()`);
}
async function fresh() {
  now += 600000;
  assert.equal((await post('stop')).status, 200);
  assert.equal((await post('start')).status, 200);
}
app.whenReady().then(async () => {
  try {
    startNativeProbe();
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')));
    const { Settings, Observation } = await import(pathToFileURL(resolve('server/schema.js')));
    const { defaults } = await import(pathToFileURL(resolve('shared/defaults.js')));
    const provider = {
      status: () => ({
        configured: true,
        kind: 'codex',
        model: 'Synthetic mission acceptance',
        effort: 'low',
      }),
      react: async (args) => {
        const matching = !replyConsumed && replySpeech && args.speech === replySpeech;
        if (matching) replyConsumed = true;
        return {
          observation: Observation.parse({
            game: '합성 게임',
            scene: '공유한 합성 도전 장면',
            confidence: 0.9,
            excitement: 0.2,
            messages: [],
            missionActions: matching ? structuredClone(nextActions) : [],
          }),
        };
      },
    };
    const start = async () => {
      service = await startServer({
        port: 0,
        dataDir: join(base, 'data'),
        localSpeech: false,
        provider,
        soundWorker: {
          prepare: async () => true,
          close() {},
          analyze: async () => {
            report.soundAnalyses = (report.soundAnalyses || 0) + 1;
            return {
              durationSeconds: 4,
              volumeDb: -25,
              balance: 0,
              silent: true,
              classes: [],
              systemSpeech: '',
              language: 'ko',
              source: 'system-output',
              caveat: 'Synthetic mission preview acceptance',
            };
          },
        },
      });
      clearInterval(service.studio.timer);
      // Keep this synthetic profile off the subscription transport. Screen audio
      // is handled only by the injected analyzer. No microphone controls are used.
      service.nativeAudio.configure({ mode: 'local', transport: 'subscription', consent: false });
      service.studio.now = () => now;
      service.studio.missions.board.clock = () => now;
      service.studio.audience.random = () => 0.5;
    };
    await start();
    service.studio.world.change((d) => {
      d.settings = Settings.parse({
        ...defaults,
        mode: 'live',
        category: 'gaming',
        lurkRatio: 0,
        communityActivityEnabled: false,
        slowModeSeconds: 0,
        chatPace: 8,
      });
      for (const p of d.settings.personas)
        d.audience.members[p.id] = {
          sessions: 1,
          seconds: 300,
          recognized: 0,
          affinity: 0.5,
          peers: {},
          memories: [],
        };
    });
    assert.equal((await post('onboarding', { skip: true })).status, 200);
    await open();
    assert.equal((await post('start')).status, 200);
    await react([payload({})], '합성 미션을 보고 싶어요');
    const missionId = service.studio.missions.board.data.campaigns.at(-1).id;
    await until(
      `document.querySelector('.mission-panel').textContent.includes('예치 20/60미션점')`,
    );
    await screenshot('proposal-860.png');
    await react(
      [
        payload({
          kind: 'join',
          personaId: 'gg',
          missionId,
          templateId: null,
          target: null,
          amount: 15,
          reason: '결과보다 긴장감이 재밌어서',
        }),
      ],
      '다른 의견도 말해봐',
    );
    await until(
      `document.querySelector('.mission-panel').textContent.includes('예치 35/60미션점')`,
    );
    assert.equal(service.studio.state().missions.campaigns.at(-1).supporterCount, 2);
    await react(
      [
        payload({
          kind: 'join',
          personaId: 'pop',
          missionId,
          templateId: null,
          target: null,
          amount: 40,
          reason: '한 번의 선택이 궁금해서',
        }),
      ],
      '천천히 한 판 할게',
    );
    await until(
      `document.querySelector('.mission-panel').textContent.includes('예치 60/60미션점')`,
    );
    assert.equal(
      service.studio.missions.board.data.campaigns.at(-1).contributions.at(-1).amount,
      25,
    );
    win.setContentSize(390, 844);
    await pause(100);
    await screenshot('ready-390.png');
    const readyLayout = await js(
      `(()=>{const p=document.querySelector('.mission-panel'),r=p.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,overflow:p.scrollWidth-p.clientWidth};})()`,
    );
    assert.equal(readyLayout.width, 390);
    assert.ok(readyLayout.left >= 0 && readyLayout.right <= 391 && readyLayout.overflow <= 1);
    assert.equal(
      await js(
        `!!Array.from(document.querySelectorAll('.mission-panel button')).find(b=>b.textContent.trim()==='이 조건 수락')`,
      ),
      true,
    );
    win.setContentSize(860, 960);
    const P = service.studio.economy.data.balance;
    await button('이 조건 수락', true);
    await until(`document.querySelector('.mission-panel').textContent.includes('진행 중')`);
    assert.equal(service.studio.missions.board.data.campaigns.at(-1).status, 'accepted');
    await react(
      [
        payload({
          kind: 'suggest-complete',
          personaId: 'momo',
          missionId,
          templateId: null,
          target: null,
          amount: null,
          reason: '한 번의 합성 도전이 끝난 후보 장면',
        }),
      ],
      '재시작 없이 한 번 도전했어',
    );
    await until(
      `document.querySelector('.mission-panel').textContent.includes('완료 확인 기다림')`,
    );
    assert.equal(
      service.studio.missions.board.data.ledger.filter((e) => e.kind === 'consume').length,
      0,
    );
    report.holdResponse = true;
    await button('조건을 지켰어요 · 예치 소비', true);
    const waited = Date.now();
    while (!releaseResponse && Date.now() - waited < 10000) await pause(30);
    assert.equal(typeof releaseResponse, 'function');
    assert.equal(
      service.studio.missions.board.data.ledger.filter((e) => e.kind === 'consume').length,
      3,
    );
    report.holdResponse = false;
    releaseResponse();
    await until(
      `document.querySelector('.mission-panel').textContent.includes('완료 · 예치 소비')`,
    );
    assert.equal(service.studio.economy.data.balance, P);
    await screenshot('completed-860.png');
    report.checks.push(
      'proposal, partial pledge, clipped final contribution, server supporter count, explicit acceptance, AI candidate and one confirmed consumption under double clicks and held response',
    );
    win.setContentSize(390, 844);
    await pause(150);
    await js(`document.querySelector('.mission-panel').scrollIntoView({block:'start'})`);
    const layout = await js(
      `(()=>{const p=document.querySelector('.mission-panel'),r=p.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,overflow:p.scrollWidth-p.clientWidth};})()`,
    );
    assert.equal(layout.width, 390);
    assert.ok(
      layout.left >= 0 && layout.right <= 391 && layout.overflow <= 1,
      JSON.stringify(layout),
    );
    await screenshot('completed-390.png');
    report.checks.push(
      '390px and 860px mission panel has visible terms and actions without panel horizontal overflow',
    );
    win.setContentSize(860, 960);
    // Tab navigation and closing condition details must never settle a mission.
    await fresh();
    await react([payload({ templateId: 'no-items', target: 40 })], '아이템 없이 해볼까');
    const old = service.studio.missions.board.data.campaigns.at(-1);
    const previousPledges = old.contributions[0].amount;
    await until(`!!document.querySelector('.mission-revision')`);
    await js(`document.querySelector('.mission-revision').open=true`);
    await js(
      `{const s=document.querySelector('select[aria-label="새 미션 조건"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,'boss-clear');s.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
    await button('예치 반환 후 새 조건 제안');
    await until(`document.querySelector('.mission-panel').textContent.includes('조건 v2')`);
    const revised = service.studio.missions.board.data.campaigns.at(-1);
    assert.notEqual(revised.id, old.id);
    assert.equal(revised.contributions.length, 0);
    assert.equal(
      service.studio.missions.board.data.ledger
        .filter((e) => e.kind === 'release' && e.missionId === old.id)
        .reduce((s, e) => s + e.amount, 0),
      previousPledges,
    );
    const beforeNavigation = JSON.stringify(service.studio.missions.board.data);
    await js(
      `document.querySelectorAll('.mission-panel details').forEach(d=>d.open=false);Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='나의 관객').click()`,
    );
    await until(`!document.querySelector('.mission-panel')`);
    await js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='방송실').click()`,
    );
    await until(`!!document.querySelector('.mission-panel')`);
    assert.equal(JSON.stringify(service.studio.missions.board.data), beforeNavigation);
    await nativeHistory('back');
    await until(
      `!document.querySelector('.mission-panel') && !!document.querySelector('[data-tutorial="nav-audience"].selected')`,
    );
    assert.equal(JSON.stringify(service.studio.missions.board.data), beforeNavigation);
    await nativeHistory('forward');
    await until(
      `!!document.querySelector('.mission-panel') && !!document.querySelector('[data-tutorial="nav-studio"].selected')`,
    );
    assert.equal(JSON.stringify(service.studio.missions.board.data), beforeNavigation);
    report.checks.push(
      'native window back/forward preserves mission version, holds and ledger without duplicate settlement',
    );
    await button('거절 · 예치 반환');
    await until(`document.querySelector('.mission-panel').textContent.includes('거절 · 반환')`);
    const count = service.studio.missions.board.data.campaigns.length;
    await react(
      [payload({ personaId: 'gg', templateId: 'boss-clear', target: 200 })],
      '같은 조건을 더 모아서 다시 요구하지 마',
    );
    assert.equal(service.studio.missions.board.data.campaigns.length, count);
    await screenshot('revised-rejected-860.png');
    report.checks.push(
      'revision releases old holds and requires fresh agreement; closing details and leaving/returning to studio preserve state; refusal blocks larger re-proposal',
    );
    await fresh();
    await react([payload({ target: 40 })], '만료 반환 합성 확인');
    const expired = service.studio.missions.board.data.campaigns.at(-1);
    now = expired.fundingDeadline;
    service.studio.missions.tick();
    await until(
      `document.querySelector('.mission-panel').textContent.includes('기한 종료 · 반환')`,
    );
    assert.equal(
      service.studio.missions.board.data.ledger.filter(
        (e) => e.kind === 'release' && e.missionId === expired.id,
      ).length,
      1,
    );
    report.checks.push('funding expiry releases each pledge exactly once in the displayed state');
    await fresh();
    await react([payload({ target: 20 })], '중단 반환 합성 확인');
    await button('이 조건 수락');
    await until(`document.querySelector('.mission-panel').textContent.includes('진행 중')`);
    const stopped = service.studio.missions.board.data.campaigns.at(-1);
    await button('미션 전체 중지');
    await until(`document.querySelector('.mission-panel').textContent.includes('미션 제안 켜기')`);
    assert.equal(
      service.studio.missions.board.data.campaigns.find((m) => m.id === stopped.id).status,
      'cancelled',
    );
    assert.equal(
      service.studio.missions.board.data.ledger.filter(
        (e) => e.kind === 'release' && e.missionId === stopped.id,
      ).length,
      1,
    );
    const disabled = JSON.stringify(service.studio.missions.board.data);
    await react(
      [
        payload({ personaId: 'gg', templateId: 'no-items' }),
        payload({
          kind: 'join',
          personaId: 'pop',
          missionId: stopped.id,
          templateId: null,
          target: null,
          amount: 20,
        }),
      ],
      '중지된 동안 새로운 제안과 예치를 차단하는 합성 확인',
    );
    service.studio.missions.tick();
    assert.equal(JSON.stringify(service.studio.missions.board.data), disabled);
    assert.equal(service.studio.economy.data.balance, P);
    await screenshot('globally-stopped-860.png');
    await button('미션 제안 켜기');
    report.checks.push(
      'global stop releases accepted mission exactly once and blocks fresh proposals and pledges without altering P; explicit re-enable permits a fresh request',
    );
    // A click queued on the network before expiry must receive a refusal and
    // the renderer must show the server's latest refunded state, not retry it.
    await fresh();
    await react([payload({ target: 20 })], '상태 변경 요청 거절 합성 확인');
    const stale = service.studio.missions.board.data.campaigns.at(-1);
    report.holdRequest = true;
    await button('이 조건 수락');
    const heldAt = Date.now();
    while (!releaseRequest && Date.now() - heldAt < 10000) await pause(30);
    assert.equal(typeof releaseRequest, 'function');
    now = stale.fundingDeadline;
    report.holdRequest = false;
    releaseRequest();
    await until(
      `document.querySelector('.mission-panel [role="alert"]')?.textContent.includes('유효한 미션') && document.querySelector('.mission-panel').textContent.includes('기한 종료 · 반환')`,
    );
    assert.equal(
      service.studio.missions.board.data.campaigns.find((m) => m.id === stale.id).status,
      'expired',
    );
    assert.equal(
      service.studio.missions.board.data.ledger.filter(
        (e) => e.kind === 'release' && e.missionId === stale.id,
      ).length,
      1,
    );
    assert.equal(service.studio.economy.data.balance, P);
    await screenshot('stale-refused-860.png');
    report.checks.push(
      'a delayed acceptance at the exact deadline is refused; persisted refund and freshly published UI agree without implicit retry',
    );
    await fresh();
    await react([payload({ target: 20 })], '재시작 반환 합성 확인');
    await button('이 조건 수락');
    const pending = JSON.stringify(service.studio.missions.board.data),
      pendingId = service.studio.missions.board.data.campaigns.at(-1).id;
    win.destroy();
    win = null;
    await service.close();
    service = null;
    // Restore only our synthetic pre-shutdown pending snapshot to model a crash.
    writeFileSync(join(base, 'data', 'missions.json'), pending);
    await start();
    await open(860);
    await until(`document.querySelector('.mission-panel').textContent.includes('앱 재시작으로')`);
    assert.equal(
      service.studio.missions.board.data.ledger.filter(
        (e) => e.kind === 'release' && e.missionId === pendingId,
      ).length,
      1,
    );
    const recovered = JSON.stringify(service.studio.missions.board.data);
    win.destroy();
    win = null;
    await service.close();
    service = null;
    await start();
    await open(860);
    assert.equal(JSON.stringify(service.studio.missions.board.data), recovered);
    assert.equal(
      service.studio.missions.board.data.campaigns.find((m) => m.id === missionId).status,
      'completed',
    );
    assert.equal(service.studio.economy.data.balance, P);
    await screenshot('restored-860.png');
    report.checks.push(
      'synthetic pending crash snapshot recovers once across two real service restarts while completed consumption survives',
    );
    report.profileFormat = JSON.parse(
      readFileSync(join(base, 'data', 'profile-format.json'), 'utf8'),
    );
    assert.equal(report.profileFormat.minReader, 2);
    // Deadline tests advance the mission clock. Real media timestamps must use
    // the server's real clock too; keep the independent mission clock frozen.
    service.studio.now = Date.now;
    assert.equal(
      (await post('settings', { ...service.studio.settings, clipBufferEnabled: true }, 'PUT'))
        .status,
      200,
    );
    assert.equal((await post('start')).status, 200);
    const finances = () =>
      JSON.stringify({
        campaigns: service.studio.missions.board.data.campaigns,
        ledger: service.studio.missions.board.data.ledger,
        wallets: service.studio.missions.board.data.wallets,
        P: service.studio.economy.data.balance,
      });
    const beforePreview = finances();
    await js(`(async()=>{
      window.scrollTo(0,0);window.qaAnalysisSamples=0;window.qaRecorders=[];window.qaRecorderEvents=[];
      window.qaAnalysisVideos=new Set();window.qaPreviewObservers=new Set();window.qaVisibilityListeners=new Set();
      const Observer=IntersectionObserver;window.IntersectionObserver=class extends Observer{
        constructor(...args){super(...args);qaPreviewObservers.add(this);}
        disconnect(){qaPreviewObservers.delete(this);return super.disconnect();}
      };
      const add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);
      document.addEventListener=(type,listener,...args)=>{if(type==='visibilitychange')qaVisibilityListeners.add(listener);return add(type,listener,...args);};
      document.removeEventListener=(type,listener,...args)=>{if(type==='visibilitychange')qaVisibilityListeners.delete(listener);return remove(type,listener,...args);};
      const trackState=s=>s.getTracks().map(t=>({kind:t.kind,state:t.readyState,muted:t.muted}));
      window.qaCaptureState=()=>({
        tracks:window.qaStream?trackState(qaStream):[],samples:qaAnalysisSamples,
        audioState:window.qaAudio?.state,
        recorders:qaRecorders.map(r=>({state:r.state,mime:r.mimeType,tracks:trackState(r.stream)})),
        events:qaRecorderEvents,
        alerts:[...document.querySelectorAll('[role="alert"],.error,.toast')].map(e=>e.textContent)
      });
      window.qaClipRecorders=()=>qaRecorders.filter(r=>r.stream.getVideoTracks().length>0);
      window.qaRecordingContinues=()=>qaStream.getTracks().every(t=>t.readyState==='live')&&
        qaClipRecorders().some(r=>r.state==='recording'&&r.stream.getTracks().every(t=>t.readyState==='live'));
      const draw=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
        const result=draw.call(this,image,...args);
        if(image instanceof HTMLVideoElement&&!image.isConnected){qaAnalysisSamples++;qaAnalysisVideos.add(image);}
        return result;
      };
      const Native=MediaRecorder;window.MediaRecorder=class extends Native{
        constructor(...args){super(...args);this.qaId=qaRecorders.length;qaRecorders.push(this);
          for(const type of ['start','stop','error','dataavailable'])this.addEventListener(type,e=>{
            if(qaRecorderEvents.length<100)qaRecorderEvents.push({id:this.qaId,type,at:performance.now(),
              state:this.state,error:e.error?{name:e.error.name,message:e.error.message}:undefined,
              bytes:e.data?.size,tracks:trackState(this.stream)});
          });
        }
        stop(){qaRecorderEvents.push({id:this.qaId,type:'stop-called',at:performance.now(),stack:new Error().stack});return super.stop();}
      };
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      let frame=0;window.qaPaint=setInterval(()=>{const c=canvas.getContext('2d');
        c.fillStyle='#234';c.fillRect(0,0,640,360);c.fillStyle='white';c.fillRect(frame++%640,20,30,30);},50);
      window.qaAudio=new AudioContext();await qaAudio.resume();
      const out=qaAudio.createMediaStreamDestination(),tone=qaAudio.createOscillator();
      tone.frequency.value=440;tone.connect(out);tone.start();
      navigator.mediaDevices.getDisplayMedia=async()=>{
        window.qaStream=canvas.captureStream(15);qaStream.addTrack(out.stream.getAudioTracks()[0].clone());
        return qaStream;
      };
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='게임 화면 연결').click();
    })()`);
    await until(`!!document.querySelector('.source-card[aria-label="합성 미션·미리보기 화면"]')`);
    await js(
      `document.querySelector('.source-card[aria-label="합성 미션·미리보기 화면"]').click()`,
    );
    await until(
      `document.querySelector('.preview video')?.srcObject===qaStream && qaAnalysisSamples>0 && qaRecordingContinues()`,
    );
    const beforeHide = await js('qaAnalysisSamples');
    // Main keeps its display player attached on native visibility events.
    // Test mission/media preservation without importing preview-visibility.
    win.emit('hide');
    await until(
      `document.querySelector('.preview video')?.srcObject===qaStream && qaAnalysisSamples>${beforeHide + 2}`,
    );
    assert.equal(await js(`qaRecordingContinues()`), true);
    win.emit('show');
    await until(`document.querySelector('.preview video')?.srcObject===qaStream`);
    const beforeTab = await js('qaAnalysisSamples');
    await js(
      `window.qaDisplay=document.querySelector('.preview video');[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='나의 관객').click()`,
    );
    await until(
      `!!document.querySelector('[data-tutorial="nav-audience"].selected') && !qaDisplay.isConnected && qaDisplay.srcObject===qaStream && qaAnalysisSamples>${beforeTab + 2}`,
    );
    assert.equal(finances(), beforePreview);
    report.previewAfterTab = await js(`({
      tracks:qaStream.getTracks().map(t=>({kind:t.kind,state:t.readyState})),
      recorders:qaRecorders.map(r=>r.state),
      samples:qaAnalysisSamples,
      alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)
    })`);
    await until(`qaRecordingContinues()`, 2000);
    await nativeHistory('back');
    await until(
      `!!document.querySelector('[data-tutorial="nav-studio"].selected') && document.querySelector('.preview video')?.srcObject===qaStream && !!document.querySelector('.mission-panel')`,
    );
    assert.equal(finances(), beforePreview);
    assert.ok(
      await js(
        `document.querySelector('.mission-help').textContent.includes('현금 가치·구매·환전이 없어요')`,
      ),
    );
    for (let cycle = 0; cycle < 2; cycle++) {
      const sampled = await js('qaAnalysisSamples');
      win.emit('minimize');
      await until(
        `document.querySelector('.preview video')?.srcObject===qaStream && qaAnalysisSamples>${sampled + 2}`,
      );
      assert.equal(await js('qaRecordingContinues()'), true);
      win.emit('restore');
      await until(`document.querySelector('.preview video')?.srcObject===qaStream`);
      const beforeAway = await js('qaAnalysisSamples');
      await js(
        `window.qaDisplay=document.querySelector('.preview video');[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='나의 관객').click()`,
      );
      await until(
        `!!document.querySelector('[data-tutorial="nav-audience"].selected') && !qaDisplay.isConnected && qaDisplay.srcObject===qaStream && qaAnalysisSamples>${beforeAway + 2}`,
      );
      assert.equal(await js('qaRecordingContinues()'), true);
      assert.equal(finances(), beforePreview);
      assert.deepEqual(
        await js('({observers:qaPreviewObservers.size,listeners:qaVisibilityListeners.size})'),
        { observers: 0, listeners: 0 },
      );
      await nativeHistory('back');
      await until(
        `!!document.querySelector('[data-tutorial="nav-studio"].selected') && document.querySelector('.preview video')?.srcObject===qaStream && !!document.querySelector('.mission-panel')`,
      );
      assert.equal(finances(), beforePreview);
      assert.equal(
        await js(
          "qaClipRecorders().filter(r=>r.state==='recording').length<=2 && qaAnalysisVideos.size===1 && qaPreviewObservers.size===0 && qaVisibilityListeners.size===0",
        ),
        true,
      );
    }
    report.captureBeforeStop = await js('qaCaptureState()');
    report.videoChunks = await js(`qaRecorderEvents.filter(e=>e.type==='dataavailable'&&
      e.bytes>0&&qaRecorders[e.id].stream.getVideoTracks().length>0).map(e=>e.bytes)`);
    assert.ok(
      report.videoChunks.length >= 2,
      'independent video recorder must encode multiple chunks',
    );
    assert.equal(report.captureBeforeStop.audioState, 'running');
    assert.ok(
      report.soundAnalyses >= 2,
      'multiple real-timestamp sound chunks must reach the synthetic analyzer',
    );
    assert.equal(
      report.captureBeforeStop.events.some((e) => e.type === 'error'),
      false,
    );
    assert.deepEqual(report.captureBeforeStop.alerts, []);
    assert.equal((await post('stop')).status, 200);
    await until(
      `qaStream.getTracks().every(t=>t.readyState==='ended')&&qaRecorders.every(r=>r.state==='inactive')`,
    );
    assert.equal(finances(), beforePreview);
    assert.deepEqual(
      await js('({observers:qaPreviewObservers.size,listeners:qaVisibilityListeners.size})'),
      { observers: 0, listeners: 0 },
    );
    report.nativeVisibilityEventsSimulated = true;
    report.previewVisibilityFeature = 'not included; main display-player behavior preserved';
    report.analysisSamples = await js('qaAnalysisSamples');
    assert.equal(await js('qaUnexpectedMicrophone'), 0);
    await js('clearInterval(qaPaint);qaAudio.close()');
    report.checks.push(
      'mission ledger and app P survive simulated native visibility events and repeated native tab back; main display-player behavior is preserved, independent video recording, frame sampling and accepted sound analysis continue until explicit stop without accumulating analysis players or recorders',
    );
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    console.error(error.stack);
    if (win && !win.isDestroyed()) {
      report.captureFailure = await js('window.qaCaptureState?.()');
      writeFileSync(join(base, 'failure-dom.txt'), await js('document.body.innerText'));
      writeFileSync(join(base, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    }
  } finally {
    if (nativeProbe && nativeProbe.exitCode === null) nativeProbe.stdin.end();
    if (releaseRequest) releaseRequest();
    if (releaseResponse) releaseResponse();
    if (win && !win.isDestroyed()) win.destroy();
    if (service) await service.close();
    writeFileSync(join(base, 'result.json'), JSON.stringify(report, null, 2));
    writeFileSync(resolve('artifacts/mission-ui.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        passed: report.passed,
        base,
        checks: report.checks,
        error: report.error,
        captureFailure: report.captureFailure,
        videoChunks: report.videoChunks,
        soundAnalyses: report.soundAnalyses,
      }),
    );
    app.exit(report.passed ? 0 : 1);
  }
});
