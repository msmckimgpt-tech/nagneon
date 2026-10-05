import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { SubscriptionVoiceHost } from '../server/subscription-voice-host.js';

const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fake(options = {}) {
  const requests = [],
    replies = [],
    spawned = [];
  let child,
    kills = 0,
    closed = false;
  const spawner = (bin, args, spawnOptions) => {
    spawned.push({ bin, args, options: spawnOptions });
    child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    const finish = () => {
      if (!closed) {
        closed = true;
        child.emit('close', 0, null);
      }
    };
    const send = (message) =>
      child.stdout.emit('data', Buffer.from(JSON.stringify(message) + '\n'));
    child.stdin.write = (data) => {
      const request = JSON.parse(data);
      if (!request.method) {
        replies.push(request);
        return true;
      }
      requests.push(request);
      queueMicrotask(() => {
        if (request.id === undefined || closed) return;
        if (options.hold === request.method) return;
        const respond = (result) => send({ id: request.id, result });
        const disabled = args.flatMap((arg, index) =>
          arg === '--disable' ? [[args[index + 1], false]] : [],
        );
        switch (request.method) {
          case 'initialize':
            if (options.collision)
              send({
                id: request.id,
                method: 'item/commandExecution/requestApproval',
                params: { command: 'synthetic forbidden request' },
              });
            respond({ userAgent: 'synthetic-host' });
            break;
          case 'account/read':
            respond({ account: { type: options.api ? 'apiKey' : 'chatgpt', planType: 'pro' } });
            break;
          case 'account/rateLimits/read':
            if (Object.hasOwn(options, 'limits')) {
              respond(options.limits);
              break;
            }
            respond({
              rateLimits: {
                credits: {
                  hasCredits: !!options.credits,
                  unlimited: false,
                  balance: options.credits ? '10' : '0',
                },
                primary: { usedPercent: options.exhausted ? 100 : 5 },
              },
            });
            break;
          case 'config/read':
            respond({
              config: {
                agents: { enabled: false },
                features: Object.fromEntries(disabled),
                mcp_servers: {
                  'synthetic.tool': {
                    command: 'must never be launched',
                    env: { PRIVATE_VALUE: 'must not be copied' },
                  },
                },
              },
            });
            break;
          case 'thread/start':
            respond({ thread: { id: 'synthetic-thread' }, model: 'gpt-6-sol' });
            break;
          case 'mcpServerStatus/list':
            respond({ data: options.tools ? [{ tools: { execute: {} } }] : [], nextCursor: null });
            break;
          case 'thread/realtime/start':
            send({
              method: 'thread/realtime/started',
              params: { threadId: 'synthetic-thread', version: 'v3' },
            });
            send({
              method: 'thread/realtime/sdp',
              params: { threadId: 'foreign-thread', sdp: 'v=0\r\nforeign' },
            });
            send({ method: 'thread/realtime/sdp', params: { threadId: 'synthetic-thread', sdp } });
            respond({});
            break;
          default:
            respond({});
        }
      });
      return true;
    };
    child.stdin.end = () => {
      if (!options.hangClose) queueMicrotask(finish);
    };
    child.kill = () => {
      kills++;
      queueMicrotask(finish);
      return true;
    };
    return child;
  };
  return {
    requests,
    replies,
    spawned,
    spawner,
    get child() {
      return child;
    },
    get kills() {
      return kills;
    },
  };
}
async function make(t, options = {}) {
  const tempRoot = await realpath(tmpdir());
  assert.equal(await realpath(tempRoot), tempRoot);
  assert.equal((await lstat(tempRoot)).isSymbolicLink(), false);
  const dir = await mkdtemp(join(tempRoot, 'nagneon-voice-host-test-'));
  const verifyOwnedDirectory = async () => {
    assert.equal(dirname(dir), tempRoot);
    assert.match(basename(dir), /^nagneon-voice-host-test-[A-Za-z0-9]{6}$/);
    const info = await lstat(dir);
    assert.equal(info.isDirectory(), true);
    assert.equal(info.isSymbolicLink(), false);
    assert.equal(await realpath(dir), resolve(dir));
  };
  await verifyOwnedDirectory();
  const f = fake(options),
    events = [],
    errors = [];
  const host = new SubscriptionVoiceHost({
    bin: 'synthetic.exe',
    dir,
    spawner: f.spawner,
    env: { OPENAI_API_KEY: 'synthetic-api-key', CODEX_API_KEY: 'synthetic-key', SAFE: 'kept' },
    timeoutMs: 1000,
    closeGraceMs: 10,
    onEvent: (e) => events.push(e),
    onError: (e) => errors.push(e),
  });
  t.after(async () => {
    await host.close();
    await verifyOwnedDirectory();
    await rm(dir, { recursive: true });
  });
  return { host, f, events, errors };
}

test('subscription startup disables every MCP and rejects colliding execution requests', async (t) => {
  const p = await make(t, { collision: true });
  const result = await p.host.start({ sdp });
  assert.equal(result.sdp, sdp);
  assert.equal(result.account.type, 'chatgpt');
  assert.equal(p.f.spawned[0].options.windowsHide, true);
  assert.equal(p.f.spawned[0].options.env.OPENAI_API_KEY, undefined);
  assert.equal(p.f.spawned[0].options.env.CODEX_API_KEY, undefined);
  assert.equal(p.f.spawned[0].options.env.SAFE, 'kept');
  const start = p.f.requests.find((r) => r.method === 'thread/start');
  assert.deepEqual(start.params.config.mcp_servers, { 'synthetic.tool': { enabled: false } });
  assert.equal(start.params.sandbox, 'read-only');
  assert.equal(start.params.ephemeral, true);
  assert.deepEqual(start.params.dynamicTools, []);
  assert.equal(p.f.replies[0].error.code, -32601);
  assert.equal(
    p.f.requests.some((r) => r.method === 'turn/start'),
    false,
  );
  assert.equal(
    p.f.requests.find((r) => r.method === 'thread/realtime/start').params.clientManagedHandoffs,
    true,
  );
  assert.deepEqual(await p.host.close(), { stopped: true, exited: true });
});

for (const [name, options, code] of [
  ['API authentication', { api: true }, 'VOICE_AUTH'],
  ['purchased credit balance', { credits: true }, 'VOICE_ALLOWANCE'],
  ['exhausted included allowance', { exhausted: true }, 'VOICE_ALLOWANCE'],
  ['unexpected callable tools', { tools: true }, 'VOICE_TOOL_RESTRICTION'],
])
  test(`fails closed on ${name} before any realtime start`, async (t) => {
    const p = await make(t, options);
    await assert.rejects(p.host.start({ sdp }), (error) => error.code === code);
    assert.equal(
      p.f.requests.some((r) => r.method === 'thread/realtime/start'),
      false,
    );
    assert.equal(p.host.state, 'stopped');
  });

test('cancellation during initialization closes only the owned child and prevents late startup', async (t) => {
  const p = await make(t, { hold: 'initialize' });
  const controller = new AbortController();
  const start = p.host.start({ sdp, signal: controller.signal });
  const rejected = assert.rejects(start, /중지|취소|종료/);
  while (!p.f.requests.length) await tick();
  controller.abort();
  await rejected;
  assert.equal(
    p.f.requests.some((r) => r.method === 'thread/start'),
    false,
  );
  assert.equal(p.host.state, 'stopped');
});

test('owned child has bounded forced cleanup when stdin close does not finish it', async (t) => {
  const p = await make(t, { hangClose: true });
  await p.host.start({ sdp });
  const result = await p.host.close();
  assert.equal(result.exited, true);
  assert.equal(p.f.kills, 1);
  assert.deepEqual(await p.host.close(), result);
  assert.equal(p.f.kills, 1);
});

test('transport failure closes the session once without exposing raw account diagnostics', async (t) => {
  const p = await make(t);
  await p.host.start({ sdp });
  p.f.child.stderr.emit('data', Buffer.from('synthetic-private-account-diagnostic'));
  const event =
    JSON.stringify({
      method: 'thread/realtime/error',
      params: { threadId: 'synthetic-thread', message: 'synthetic-private-account-diagnostic' },
    }) + '\n';
  p.f.child.stdout.emit('data', Buffer.from(event + event));
  await p.host.close();
  assert.equal(p.errors.length, 1);
  assert.equal(
    JSON.stringify([...p.errors.map((e) => e.message), ...p.events]).includes(
      'synthetic-private-account-diagnostic',
    ),
    false,
  );
  assert.equal(p.host.state, 'stopped');
});

for (const [name, limits] of [
  ['null metadata', null],
  ['null keyed bucket', { rateLimitsByLimitId: { synthetic: null } }],
  ['missing window', { rateLimits: { credits: { hasCredits: false, unlimited: false, balance: '0' } } }],
  ['string usage', { rateLimits: { credits: { hasCredits: false, unlimited: false, balance: '0' }, primary: { usedPercent: '5' } } }],
  ['ordinary usage false', { ordinaryUsageAllowed: false, rateLimits: { credits: { hasCredits: false, unlimited: false, balance: '0' }, primary: { usedPercent: 5 } } }],
  ['ordinary usage null', { ordinaryUsageAllowed: null, rateLimits: { credits: { hasCredits: false, unlimited: false, balance: '0' }, primary: { usedPercent: 5 } } }],
  ['reached included limit', { rateLimits: { credits: { hasCredits: false, unlimited: false, balance: '0' }, primary: { usedPercent: 5 }, rateLimitReachedType: 'rate_limit_reached' } }],
  ['reached spend control', { rateLimits: { credits: { hasCredits: false, unlimited: false, balance: '0' }, primary: { usedPercent: 5 }, spendControlReached: true } }],
])
  test(`real host startup refuses ${name} before threads and closes normally`, async (t) => {
    const p = await make(t, { limits });
    await assert.rejects(p.host.start({ sdp }), { code: 'VOICE_ALLOWANCE' });
    assert.deepEqual(p.f.requests.map((request) => request.method), [
      'initialize', 'initialized', 'account/read', 'account/rateLimits/read',
    ]);
    assert.equal(p.f.kills, 0);
    assert.deepEqual(p.host.exitResult, { code: 0, signal: null });
    assert.equal(p.host.pending.size, 0);
    assert.equal(p.host.closed, true);
    assert.equal(p.host.state, 'stopped');
  });

for (const frame of [null, [], 'synthetic-private-frame', 4, false])
  test(`nonobject JSON frame ${JSON.stringify(frame)} closes through VOICE_PROTOCOL`, async (t) => {
    const p = await make(t, { hold: 'synthetic/pending' });
    await p.host.start({ sdp });
    const pending = p.host.rpc('synthetic/pending').catch((error) => error);
    assert.doesNotThrow(() => p.f.child.stdout.emit('data', Buffer.from(JSON.stringify(frame) + '\n')));
    const outcome = await pending;
    assert.equal(outcome.code, 'VOICE_PROTOCOL');
    await p.host.close();
    assert.equal(p.errors.length, 1);
    assert.equal(p.errors[0].code, 'VOICE_PROTOCOL');
    assert.equal(JSON.stringify([...p.errors.map((error) => error.message), ...p.events]).includes('synthetic-private-frame'), false);
    assert.equal(p.host.pending.size, 0);
    assert.equal(p.f.kills, 0);
    assert.deepEqual(p.host.exitResult, { code: 0, signal: null });
  });

test('a generic null RPC result remains valid and does not fail the transport', async (t) => {
  const p = await make(t, { hold: 'synthetic/null-result' });
  await p.host.start({ sdp });
  const result = p.host.rpc('synthetic/null-result');
  const request = p.f.requests.at(-1);
  p.f.child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result: null }) + '\n'));
  assert.equal(await result, null);
  assert.equal(p.host.state, 'connected');
  assert.equal(p.errors.length, 0);
  assert.equal(p.host.pending.size, 0);
});

for (const frame of [
  { method: 'thread/realtime/sdp' },
  { method: 'thread/realtime/sdp', params: null },
  { method: 'thread/realtime/sdp', params: {} },
  { method: 'thread/realtime/started', params: {} },
  { method: 'thread/realtime/error', params: {} },
])
  test(`preparing host ignores unaddressed ${JSON.stringify(frame)} notification`, async (t) => {
    const p = await make(t, { hold: 'initialize' });
    const starting = p.host.start({ sdp });
    const settled = starting.then((result) => ({ result }), (error) => ({ error }));
    while (!p.f.requests.length) await tick();
    assert.equal(p.host.state, 'preparing');
    assert.equal(p.host.threadId, undefined);
    const initialize = p.f.requests[0];
    const pending = p.host.pending.get(initialize.id);
    assert.doesNotThrow(() => p.f.child.stdout.emit('data', Buffer.from(JSON.stringify(frame) + '\n')));
    assert.equal(p.host.pending.size, 1);
    assert.equal(p.host.pending.get(initialize.id), pending);
    assert.equal(p.host.closed, false);
    assert.equal(p.events.length, 0);
    assert.deepEqual(p.f.requests.map((request) => request.method), ['initialize']);
    p.f.child.stdout.emit('data', Buffer.from(JSON.stringify({ id: initialize.id, result: { userAgent: 'synthetic-host' } }) + '\n'));
    const outcome = await settled;
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.result.sdp, sdp);
    assert.equal(p.host.state, 'connected');
    assert.equal(p.errors.length, 0);
    assert.equal(p.host.pending.size, 0);
    await p.host.close();
    assert.equal(p.f.kills, 0);
    assert.deepEqual(p.host.exitResult, { code: 0, signal: null });
  });
