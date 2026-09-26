import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import { Settings } from '../server/schema.js';
import { defaults } from '../shared/defaults.js';

const args = { settings: Settings.parse(defaults), history: [], speech: '안녕하세요' };
const observation = {
  game: 'Just Chatting',
  scene: '인사',
  confidence: 1,
  excitement: 0.2,
  messages: [],
  arrival: null,
  viewerChanges: [],
  clipPicks: [],
  transcriptCorrections: [],
  communityVotes: [],
  cultureAnalysis: null,
  positiveMoment: {
    positive: false,
    impact: 0,
    reason: '',
    signature: '',
    supporters: [],
    donations: [],
  },
};
function childProcess() {
  const child = new EventEmitter();
  for (const key of ['stdin', 'stdout', 'stderr']) child[key] = new PassThrough();
  child.kill = () => {
    setTimeout(() => child.emit('close', 1), 10);
    return true;
  };
  return child;
}
async function provider(spawn) {
  const { AntigravityProvider } = await import('../server/antigravity-provider.js');
  return new AntigravityProvider(
    { model: 'gemini-3.8-flash-low' },
    {
      env: {
        PATH: process.env.PATH,
        GEMINI_API_KEY: 'must-not-be-passed',
        OPENAI_API_KEY: 'must-not-be-passed',
      },
      spawn,
    },
  );
}

test('Antigravity returns schema-validated reactions and usage through the account CLI, then removes frames', async () => {
  let directory;
  const p = await provider((_bin, command, options) => {
    directory = options.cwd;
    assert.equal(options.env.GEMINI_API_KEY, undefined);
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    assert.ok(command.includes('--agent'));
    assert.equal(command[command.indexOf('--input-format') + 1], 'stream-json');
    assert.equal(command[command.indexOf('--output-format') + 1], 'stream-json');
    assert.ok(command.includes('--disable-slash-commands'));
    assert.ok(!command.includes('--dangerously-skip-permissions'));
    assert.equal(readFileSync(directory + '/frame-1.png').toString(), 'frame');
    const agent = readFileSync(directory + '/.agents/agents/nagneon-audience.md', 'utf8');
    assert.match(agent, /inheritCustomizations: false/);
    assert.match(agent, /  - finish/);
    const child = childProcess();
    let prompt = '';
    child.stdin.on('data', (b) => (prompt += b));
    child.stdin.on('finish', () => {
      assert.match(prompt, /frame-1.png/);
      assert.match(prompt, /안녕하세요/);
      assert.equal(JSON.parse(prompt).event, 'user');
      child.stdout.end(
        JSON.stringify({
          event: 'result',
          result: {
            status: 'SUCCESS',
            structured_output: observation,
            usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
          },
        }),
      );
      child.emit('close', 0);
    });
    return child;
  });
  p.available = true;
  let usage;
  const result = await p.react({
    ...args,
    image: 'data:image/png;base64,ZnJhbWU=',
    onAiUsage: (u) => (usage = u),
  });
  assert.equal(result.observation.scene, '인사');
  assert.equal(usage.total_tokens, 13);
  assert.equal(existsSync(directory), false);
});

test('Antigravity refuses unsuccessful or malformed responses even with process exit zero', async () => {
  for (const payload of [
    { status: 'ERROR', error: 'sensitive diagnostic' },
    { status: 'SUCCESS', structured_output: { unexpected: 1 } },
    { status: 'SUCCESS', response: 'not json' },
  ]) {
    const p = await provider(() => {
      const child = childProcess();
      child.stdin.on('finish', () => {
        child.stdout.end(JSON.stringify({ event: 'result', result: payload }));
        child.emit('close', 0);
      });
      return child;
    });
    p.available = true;
    await assert.rejects(p.react(args), (error) => !error.message.includes('sensitive diagnostic'));
  }
});

test('Antigravity cancellation waits for exit before frame cleanup', async () => {
  const controller = new AbortController();
  let directory,
    closed = false;
  const p = await provider((_bin, _args, options) => {
    directory = options.cwd;
    const child = childProcess();
    child.kill = () => {
      assert.ok(existsSync(directory));
      setTimeout(() => {
        closed = true;
        child.emit('close', 1);
      }, 25);
      return true;
    };
    child.stdin.on('finish', () => controller.abort());
    return child;
  });
  p.available = true;
  await assert.rejects(p.react(args, controller.signal), /취소/);
  assert.equal(closed, true);
  assert.equal(existsSync(directory), false);
});

test('Antigravity readiness parses Gemini model list and does not expose raw account diagnostics', async () => {
  const p = await provider(() => {
    const child = childProcess();
    setImmediate(() => {
      child.stdout.end(
        'Fetching available models...\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\nclaude-sonnet\tOther\n',
      );
      child.emit('close', 0);
    });
    return child;
  });
  await p.check();
  assert.equal(p.status().configured, true);
  assert.deepEqual(p.status().models, [
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
  ]);
  const missing = await provider(() => {
    const child = childProcess();
    setImmediate(() => child.emit('error', Error('private details')));
    return child;
  });
  await missing.check();
  assert.equal(missing.status().configured, false);
  assert.ok(!missing.status().authMessage.includes('private details'));
});

test(
  'cancelled Antigravity process also terminates descendants that ignore SIGINT',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { AntigravityProvider } = await import('../server/antigravity-provider.js');
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const { resolve, join } = await import('node:path');
    const dir = await mkdtemp(resolve('artifacts/gemini-process-'));
    const marker = join(dir, 'child.pid');
    let descendant;
    t.after(async () => {
      if (descendant)
        try {
          process.kill(descendant, 'SIGKILL');
        } catch {}
      await rm(dir, { recursive: true, force: true });
    });
    const p = new AntigravityProvider(
      {},
      { env: { ...process.env, ANTIGRAVITY_BIN: process.execPath } },
    );
    const controller = new AbortController();
    const childCode =
      "process.on('SIGINT',()=>{});require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)";
    const parentCode = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)},${JSON.stringify(marker)}],{stdio:'ignore'});process.on('SIGINT',()=>process.exit(0));setInterval(()=>{},1000)`;
    const pending = p.run(['-e', parentCode], { signal: controller.signal });
    const rejected = assert.rejects(pending, /취소/);
    for (let i = 0; i < 200; i++) {
      try {
        descendant = Number(await readFile(marker, 'utf8'));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    assert.ok(descendant);
    controller.abort();
    await rejected;
    const alive = () => {
      try {
        process.kill(descendant, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 100 && alive(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(alive(), false, 'cancelled provider left a descendant running');
  },
);
