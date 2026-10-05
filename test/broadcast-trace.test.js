import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BroadcastTrace,
  TRACE_MAX_BYTES,
  TRACE_RETENTION_MS,
  TRACE_SEGMENT_BYTES,
} from '../server/broadcast-trace.js';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { defaults } from '../shared/defaults.js';
import { startServer } from '../server/index.js';

const testRoot = resolve('artifacts/broadcast-trace-tests');
function directory(t) {
  mkdirSync(testRoot, { recursive: true });
  const dir = mkdtempSync(join(testRoot, 'run-'));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), testRoot);
    rmSync(dir, { recursive: true });
  });
  return dir;
}
const result = (messages = []) => ({
  observation: {
    game: 'PRIVATE GAME',
    scene: 'PRIVATE SCENE',
    confidence: 0.9,
    excitement: 0.2,
    messages,
  },
  usage: {
    input_tokens: 100,
    cached_input_tokens: 80,
    output_tokens: 20,
    input_tokens_details: { cache_write_tokens: 10 },
  },
});
const chat = (text) => ({ personaId: 'pop', text, kind: 'chat', spoiler: false });
function fixture(t, react) {
  let s;
  t.after(() => s?.close());
  const dir = directory(t);
  let at = 1790600000000;
  const trace = new BroadcastTrace({ dir: join(dir, 'trace'), now: () => at });
  s = new Studio({
    trace,
    settings: {
      ...defaults,
      mode: 'live',
      intervalSeconds: 5,
      lurkRatio: 0,
      slowModeSeconds: 0,
      chatPace: 8,
      autoHighlights: false,
    },
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    random: () => 0.5,
    now: () => at,
    provider: { status: () => ({ configured: true }), react },
  });
  clearInterval(s.timer);
  s.start();
  return { s, trace, dir, now: () => at, advance: (ms) => (at += ms) };
}
const eventsOf = (trace, kind) => trace.snapshot().events.filter((event) => event.kind === kind);
const filesBefore = (dir) =>
  readdirSync(dir).map((name) => ({
    name,
    content: readFileSync(join(dir, name), 'utf8'),
    mtime: statSync(join(dir, name)).mtimeMs,
  }));

test('real studio path joins speech, witnessed memory, generation, admission, publication and renderer receipt without source content', async (t) => {
  const f = fixture(t, async () => result([chat('PRIVATE REPLY')]));
  const { s, trace } = f;
  assert.equal(trace.snapshot().events[0].kind, 'session-start');
  const old = s.publishMessage(s.prepareMessage('pop', 'PRIVATE 무지개열쇠 좋아'), {
    witnesses: ['pop'],
  });
  s.journal.pin(old.id, true);
  // A later visit retrieves the journal entry instead of injecting it as current history.
  f.advance(5000);
  for (const member of Object.values(s.audience.data.members)) member.joinedAt = f.now();
  f.advance(500);
  const id = randomUUID();
  const receipt = s.receiveSpeech({
    id,
    sessionId: s.sessionId,
    source: 'microphone',
    text: '무지개열쇠 어디에 쓸까?',
    capture: { startedAt: f.now() - 400, endedAt: f.now() - 100 },
  });
  assert.equal(
    s.receiveSpeech({
      id,
      sessionId: s.sessionId,
      source: 'microphone',
      text: '무지개열쇠 어디에 쓸까?',
      capture: { startedAt: f.now() - 400, endedAt: f.now() - 100 },
    }).duplicate,
    true,
  );
  await s.react({});
  f.advance(2000);
  s.pump();
  const delivered = s.messages.find((m) => m.text === 'PRIVATE REPLY');
  assert.ok(delivered);
  trace.rendered(s.sessionId, [delivered.id], f.now() - 1);
  assert.equal(eventsOf(trace, 'rendered').length, 0, 'pre-publication receipt is not accepted');
  f.advance(20);
  trace.rendered(randomUUID(), [delivered.id], f.now());
  assert.equal(eventsOf(trace, 'rendered').length, 0, 'wrong session is not accepted');
  trace.rendered(s.sessionId, [delivered.id], f.now());
  trace.rendered(s.sessionId, [delivered.id], f.now());
  const all = trace.snapshot();
  assert.equal(all.error, '');
  assert.equal(all.invalidRecords, 0);
  assert.equal(all.readError, false);
  const one = (kind) => {
    const matches = all.events.filter((e) => e.kind === kind);
    assert.equal(matches.length, 1, kind);
    return matches[0];
  };
  const input = one('input'),
    request = one('request'),
    model = one('model-result'),
    queued = one('queued'),
    published = one('published'),
    rendered = one('rendered');
  assert.equal(input.input, trace.identity('input', id));
  assert.equal(input.message, trace.identity('message', receipt.messageId));
  assert.ok(all.events.some((e) => e.kind === 'journaled' && e.message === input.message));
  assert.equal(input.timingBasis, 'capture-clock');
  assert.deepEqual(request.related, [input.input]);
  assert.equal(model.request, request.request);
  assert.equal(queued.request, request.request);
  assert.equal(published.delivery, queued.delivery);
  assert.equal(rendered.message, published.message);
  assert.deepEqual(model.usage, { input: 100, cached: 80, output: 20, total: 120, cacheWrite: 10 });
  assert.equal(model.attempts.length, 1);
  const context = one('request-context');
  const owner = context.viewers.find((v) => v.id === trace.identity('viewer', 'pop'));
  assert.equal(owner.heard, true);
  assert.ok(
    owner.memories.some(
      (m) =>
        m.source === trace.identity('message', old.id) &&
        m.witnessed &&
        m.experience === 'own-words',
    ),
  );
  assert.ok(
    context.viewers
      .filter((v) => v.id !== owner.id)
      .every((v) => !v.memories.some((m) => m.source === trace.identity('message', old.id))),
  );
  const finalReaction = all.events.filter((e) => e.kind === 'reaction').at(-1);
  assert.equal(finalReaction.metrics.delivered, 1);
  assert.equal(finalReaction.metrics.pending, 0);
  for (const privateValue of [
    'PRIVATE',
    '무지개열쇠',
    old.id,
    id,
    delivered.id,
    s.sessionId,
    '"pop"',
    'personaId',
    '"text":',
    '"salt":',
    'data:image',
  ])
    assert.equal(JSON.stringify(all).includes(privateValue), false, privateValue);
  assert.equal('diagnosticId' in delivered, false);
});

test('persistent history survives restart and 120-row reset; delayed old completion keeps its original session', async (t) => {
  let release,
    slow = false;
  const f = fixture(t, () => (slow ? new Promise((done) => (release = done)) : result()));
  for (let i = 0; i < 125; i++) {
    f.advance(6000);
    await f.s.react({ speech: 'synthetic ' + i });
  }
  assert.equal(f.s.reactions.rows.length, 120);
  assert.equal(eventsOf(f.trace, 'request').length, 125);
  slow = true;
  f.advance(6000);
  const oldSession = f.trace.identity('session', f.s.sessionId),
    pending = f.s.react({ speech: 'pending' });
  f.s.stop();
  f.s.start();
  release(result());
  await pending;
  const last = eventsOf(f.trace, 'request-finished').at(-1);
  assert.equal(last.session, oldSession);
  assert.equal(last.state, 'stopped');
  assert.equal(f.s.reactions.rows.length, 0);
  f.s.stop();
  const prior = f.trace.snapshot();
  const restarted = new BroadcastTrace({ dir: f.trace.dir, now: f.now });
  assert.equal(
    restarted.identity('session', f.s.sessionId),
    f.trace.identity('session', f.s.sessionId),
  );
  assert.deepEqual(restarted.snapshot().events, prior.events);
  assert.equal(eventsOf(restarted, 'request').length, 126);
  const before = filesBefore(f.trace.dir);
  restarted.snapshot();
  restarted.snapshot();
  assert.deepEqual(
    filesBefore(f.trace.dir),
    before,
    'read-only export does not rewrite or prune files',
  );
});

test('all roster members and witnesses are paged, including waiting viewers and more than 60 personas', (t) => {
  const dir = directory(t),
    trace = new BroadcastTrace({ dir, now: () => 1790600000000 });
  const ids = Array.from({ length: 270 }, (_, i) => 'viewer-' + i);
  const settings = { personas: ids.map((id) => ({ id, enabled: true })) };
  const audience = {
    presence: Object.fromEntries(ids.map((id, i) => [id, i % 2 ? 'waiting' : 'lurking'])),
    data: { members: {} },
  };
  const sessionId = randomUUID();
  trace.session(sessionId, true);
  trace.observePresence(sessionId, settings, audience);
  trace.observePresence(sessionId, settings, audience);
  const pages = eventsOf(trace, 'presence');
  assert.equal(pages.length, 9);
  assert.equal(pages.flatMap((e) => e.viewers).length, 270);
  assert.equal(pages[0].viewers[1].presence, 'waiting');
  assert.deepEqual(
    pages.map((e) => e.part),
    Array.from({ length: 9 }, (_, index) => ({ index, count: 9 })),
  );
  trace.savedMessage(sessionId, { id: 'private-source', personaId: ids[0], kind: 'chat' }, ids);
  assert.equal(eventsOf(trace, 'journaled').flatMap((e) => e.witnesses).length, 270);
  trace.requested(
    { sessionId, audience, journal: { data: { entries: [] } } },
    1,
    {
      witnesses: ids,
      personalContext: {
        viewerContext: Object.fromEntries(ids.map((id) => [id, { recollections: [] }])),
      },
    },
    ids,
    undefined,
  );
  assert.equal(eventsOf(trace, 'request-context').flatMap((e) => e.viewers).length, 270);
  assert.equal(eventsOf(trace, 'request').flatMap((e) => e.related).length, 270);
  assert.equal(trace.status().error, '');
});

test('unknown content is rejected and storage failure cannot stop accepted studio output', async (t) => {
  const f = fixture(t, async () => result([chat('still delivered')]));
  f.trace.append = () => {
    throw Error('PRIVATE DISK PATH');
  };
  f.s.receiveSpeech({ id: randomUUID(), sessionId: f.s.sessionId, text: 'continue' });
  await f.s.react({});
  f.advance(2000);
  f.s.pump();
  assert.ok(f.s.messages.some((m) => m.text === 'still delivered'));
  assert.match(f.trace.status().error, /진단 저장/);
  assert.ok(f.trace.status().failedRecords > 0);
  assert.equal(JSON.stringify(f.trace.snapshot()).includes('PRIVATE DISK PATH'), false);
  const other = new BroadcastTrace({ dir: join(f.dir, 'strict') });
  assert.equal(other.record({ session: null, kind: 'lifecycle', text: 'PRIVATE' }), false);
  assert.equal(existsSync(other.dir), false, 'unknown raw content must fail before touching disk');
  const disabled = new BroadcastTrace();
  disabled.session('private', true);
  disabled.requested({}, 1, {}, [], 0);
  assert.equal(disabled.requests.size, 0);
  assert.equal(disabled.snapshot().enabled, false);
});

test('retention removes only owned expired segments and enforces the 16 MiB limit on disk and export', (t) => {
  const dir = directory(t);
  let at = 1790600000000;
  const trace = new BroadcastTrace({ dir, now: () => at });
  trace.session('one', true);
  const old = trace.current,
    header = trace.header;
  const unmanaged = join(dir, 'trace-0000000000001-' + randomUUID() + '.jsonl');
  writeFileSync(unmanaged, '{"foreign":true}\n');
  writeFileSync(join(dir, 'user-notes.txt'), 'PRIVATE NOTES');
  at += TRACE_RETENTION_MS + 1;
  const expired = trace.snapshot();
  assert.equal(expired.events.length, 0);
  assert.equal(existsSync(old), true, 'download is read-only');
  trace.session('two', true);
  assert.equal(existsSync(old), false);
  for (let i = 0; i < 66; i++) {
    const name = join(dir, 'trace-' + String(at - 1000 + i) + '-' + randomUUID() + '.jsonl');
    writeFileSync(name, header + '\n'.repeat(TRACE_SEGMENT_BYTES - Buffer.byteLength(header)));
  }
  at += 86400000;
  trace.session('three', true);
  const ownedBytes = trace
    .files()
    .filter((file) => file.owned)
    .reduce((n, file) => n + file.size, 0);
  assert.ok(ownedBytes <= TRACE_MAX_BYTES, String(ownedBytes));
  const exported = trace.snapshot();
  assert.ok(exported.bytes <= TRACE_MAX_BYTES);
  assert.equal(exported.error, '');
  assert.equal(exported.unmanagedFiles, 1);
  assert.equal(readFileSync(unmanaged, 'utf8'), '{"foreign":true}\n');
  assert.equal(readFileSync(join(dir, 'user-notes.txt'), 'utf8'), 'PRIVATE NOTES');
});

test('partial tail, oversized record and private extra fields are counted without exporting content', (t) => {
  const trace = new BroadcastTrace({ dir: directory(t), now: () => 1790600000000 });
  trace.session('session', true);
  const source = trace.snapshot().events[0];
  appendFileSync(
    trace.current,
    JSON.stringify({ ...source, text: 'PRIVATE' }) + '\n' + 'x'.repeat(65537) + '\n{"unfinished":',
  );
  const before = filesBefore(trace.dir),
    exported = trace.snapshot();
  assert.equal(exported.events.length, 1);
  assert.equal(exported.invalidRecords, 3);
  assert.equal(JSON.stringify(exported).includes('PRIVATE'), false);
  assert.deepEqual(filesBefore(trace.dir), before);
  trace.session('new', true);
  assert.ok(
    trace.status().error,
    'external mutation stops append instead of extending an unverified segment',
  );
});

test('missing or corrupt correlation keys preserve existing files and never silently re-key history', (t) => {
  for (const mode of ['missing', 'corrupt']) {
    const base = directory(t),
      trace = new BroadcastTrace({ dir: join(base, 'trace') });
    trace.session('original', true);
    const key = join(trace.dir, 'correlation.json');
    if (mode === 'missing') unlinkSync(key);
    else writeFileSync(key, '{"salt":"PRIVATE-broken"}');
    const before = filesBefore(trace.dir),
      next = new BroadcastTrace({ dir: trace.dir });
    assert.ok(next.status().error);
    next.session('new', true);
    next.snapshot();
    assert.deepEqual(filesBefore(trace.dir), before);
  }
});

test('directory junctions are refused and do not permit append or retention outside the selected directory', (t) => {
  const dir = directory(t),
    outside = join(dir, 'outside'),
    alias = join(dir, 'alias');
  mkdirSync(outside);
  writeFileSync(join(outside, 'keep.txt'), 'keep');
  symlinkSync(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const trace = new BroadcastTrace({ dir: alias });
  assert.ok(trace.status().error);
  trace.session('session', true);
  assert.equal(trace.snapshot().readError, true);
  assert.deepEqual(readdirSync(outside), ['keep.txt']);
  assert.ok(lstatSync(alias).isSymbolicLink());
  rmSync(alias);
});

test('key backup and temporary paths are checked before reading or creating correlation files', (t) => {
  const base = directory(t),
    traceDir = join(base, 'trace'),
    outside = join(base, 'outside');
  mkdirSync(traceDir);
  mkdirSync(outside);
  writeFileSync(join(outside, 'keep.txt'), 'preserve');
  const alias = join(traceDir, 'correlation.json.bak.1');
  symlinkSync(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const trace = new BroadcastTrace({ dir: traceDir });
  assert.ok(trace.status().error);
  trace.session('one', true);
  assert.equal(existsSync(join(traceDir, 'correlation.json')), false);
  assert.deepEqual(readdirSync(outside), ['keep.txt']);
  rmSync(alias);
  writeFileSync(join(traceDir, 'correlation.json.tmp'), ' '.repeat(4097));
  const oversized = new BroadcastTrace({ dir: traceDir });
  assert.ok(oversized.status().error);
  oversized.session('two', true);
  assert.equal(statSync(join(traceDir, 'correlation.json.tmp')).size, 4097);
  assert.equal(existsSync(join(traceDir, 'correlation.json')), false);
});

test('intermediate start state is not assigned to a broadcast before its roster is ready', (t) => {
  const trace = new BroadcastTrace({ dir: directory(t) });
  const settings = { personas: [{ id: 'member', enabled: true }] };
  const audience = { presence: { member: 'away' }, data: { members: {} } };
  trace.observePresence('not-yet-started', settings, audience);
  assert.equal(trace.snapshot().events.length, 0);
  trace.session('actual', true);
  trace.observePresence('actual', settings, audience);
  trace.observePresence('different', settings, audience);
  assert.equal(eventsOf(trace, 'presence').length, 1);
  assert.equal(eventsOf(trace, 'presence')[0].session, trace.identity('session', 'actual'));
});

test('process sequence preserves ordering when the wall clock moves backwards; renderer clocks remain validated', (t) => {
  let at = 1790600000000;
  const trace = new BroadcastTrace({ dir: directory(t), now: () => at });
  trace.session('first', true);
  at -= 5000;
  trace.session('first', false);
  assert.deepEqual(
    trace.snapshot().events.map((e) => e.kind),
    ['session-start', 'session-stop'],
  );
  assert.deepEqual(
    trace.snapshot().events.map((e) => e.sequence),
    [1, 2],
  );
  const state = {
    sessionId: 'first',
    audience: { presence: {} },
    journal: { data: { entries: [] } },
  };
  trace.requested(state, 1, { witnesses: [], personalContext: { viewerContext: {} } }, [], null);
  const queued = { diagnosticId: 1, personaId: 'x', kind: 'chat', due: at };
  trace.queued(queued);
  trace.publishedMessage(queued, { id: 'message', personaId: 'x', kind: 'chat' });
  trace.rendered('first', ['message'], NaN);
  trace.rendered('first', ['message'], at + 20000);
  assert.equal(eventsOf(trace, 'rendered').length, 0);
  trace.rendered('first', ['message'], at);
  assert.equal(eventsOf(trace, 'rendered').length, 1);
});

test('HTTP flow export is authenticated, uncached and read-only across shutdown and restart', async (t) => {
  let service;
  t.after(() => service?.close());
  const dir = directory(t);
  let calls = 0;
  const options = {
    port: 0,
    persist: true,
    dataDir: join(dir, 'data'),
    localSpeech: false,
    provider: {
      status: () => ({ configured: true }),
      react: async () => {
        calls++;
        return result();
      },
    },
  };
  service = await startServer(options);
  const url = service.url + '/api/diagnostics/broadcast-trace?download=true';
  assert.equal((await fetch(url)).status, 401);
  const trace = service.studio.trace,
    before = filesBefore(trace.dir);
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + service.accessToken },
  });
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('content-disposition'),
    /attachment.*nagneon-broadcast-trace.json/,
  );
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.enabled, true);
  assert.equal(body.error, '');
  assert.ok(
    body.events.some(
      (e) => e.component === 'service' && e.operation === 'startup' && e.phase === 'completed',
    ),
  );
  assert.deepEqual(filesBefore(trace.dir), before);
  assert.equal(calls, 0);
  await service.close();
  const shutdown = trace.snapshot().events.filter((e) => e.operation === 'shutdown');
  assert.ok(shutdown.some((e) => e.component === 'service' && e.phase === 'completed'));
  for (const component of ['requests', 'studio', 'speech', 'sound', 'http'])
    assert.ok(
      shutdown.some(
        (e) => e.component === component && e.phase === 'completed' && e.durationMs >= 0,
      ),
      component,
    );
  service = await startServer(options);
  assert.ok(
    service.studio.trace
      .snapshot()
      .events.some((e) => e.operation === 'shutdown' && e.phase === 'completed'),
  );
  assert.equal(calls, 0);
});
