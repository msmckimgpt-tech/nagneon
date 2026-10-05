import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, realpathSync, lstatSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, readdir, lstat, cp } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import WebSocket from 'ws';
import { extractFile } from '@electron/asar';
import { getCurrentFuseWire, FuseV1Options, FuseState } from '@electron/fuses';
import { startServer } from '../server/index.js';
import { WorldData } from '../server/world.js';
import { JournalStore } from '../server/journal-store.js';
import { socialContentHash } from '../server/social-content.js';
import { digest } from '../server/social-runtime-state.js';
import { verifyPackageCapabilities, capabilityFile } from './lib/package-capabilities.mjs';
import {
  artifactPath,
  loopbackUrl,
  backgroundObservation,
  syntheticEnvironment,
  assertDurableInventory,
  unredirectedArtifactRoot,
  assertRestartInventory,
  assertRestartWitness,
  pendingDebuggerPort,
} from './lib/packaged-profile-reader-guards.mjs';

// Actual normal EXE startup; neither Electron-as-Node nor extracted host imports
// are used to accept a package. Source imports above only build/check fixtures.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts');
const option = (name) => {
  const values = process.argv.slice(2).filter((v) => v.startsWith('--' + name + '='));
  assert.ok(values.length <= 1, 'Duplicate option: ' + name);
  return values[0]?.slice(name.length + 3);
};
const prepareOnly = process.argv.includes('--prepare-only');
const hash = async (file) => {
  const value = createHash('sha256');
  for await (const bytes of createReadStream(file)) value.update(bytes);
  return value.digest('hex');
};
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function inventory(folder) {
  const rows = [];
  async function walk(dir) {
    assert.ok(
      (await lstat(dir)).isDirectory() && !(await lstat(dir)).isSymbolicLink(),
      'Linked directory: ' + dir,
    );
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      assert.ok(!entry.isSymbolicLink(), 'Linked artifact: ' + path);
      if (entry.isDirectory()) await walk(path);
      else {
        assert.ok(entry.isFile(), 'Unexpected artifact: ' + path);
        rows.push({
          path: relative(folder, path).replaceAll('\\', '/'),
          bytes: (await lstat(path)).size,
          sha256: await hash(path),
        });
      }
    }
  }
  await walk(folder);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

// Check every existing ancestor, including Windows junctions, before writes.
function ownedPath(path) {
  unredirectedArtifactRoot(artifacts);
  artifactPath(artifacts, path);
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  for (let part = ancestor; ; part = dirname(part)) {
    assert.ok(!lstatSync(part).isSymbolicLink(), 'Artifact ancestor is a link: ' + part);
    if (part === artifacts) break;
    assert.notEqual(part, dirname(part), 'Artifact ancestor escaped');
  }
  assert.equal(
    realpathSync(ancestor).toLowerCase(),
    resolve(ancestor).toLowerCase(),
    'Artifact path is redirected',
  );
  return path;
}

async function deliveredPackage() {
  for (const key of ['folder', 'manifest', 'manifest-sha256', 'exe-sha256', 'asar-sha256'])
    assert.ok(option(key), 'Required explicit option: --' + key);
  const folder = resolve(option('folder')),
    manifestPath = resolve(option('manifest'));
  assert.ok(!(await lstat(folder)).isSymbolicLink(), 'Package folder is linked');
  const manifestSha256 = await hash(manifestPath);
  assert.equal(manifestSha256, option('manifest-sha256').toLowerCase());
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const capabilities = await verifyPackageCapabilities(folder);
  assert.equal(capabilities.exeSha256, option('exe-sha256').toLowerCase());
  assert.equal(capabilities.asarSha256, option('asar-sha256').toLowerCase());
  assert.equal(
    capabilities.appVersion,
    '0.1.18',
    'This qualification covers the reader5 0.1.18 candidate',
  );
  assert.equal(capabilities.profileReader, 5);
  assert.equal(manifest.version, capabilities.appVersion);
  assert.deepEqual(manifest.packageCapabilities, capabilities);
  const before = await inventory(folder);
  const declared = [...manifest.files].sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(before, declared, 'Delivered inventory differs from bound manifest');
  assert.equal(manifest.sourceManifest?.schema, 'backseat.package-sources/1');
  const asar = join(folder, 'resources/app.asar');
  const sourceFiles = manifest.sourceManifest.files;
  assert.ok(sourceFiles.length > 0);
  for (const file of sourceFiles) {
    assert.ok(['archive', 'resource'].includes(file.kind));
    const targetRoot = join(folder, file.kind === 'archive' ? 'archive' : 'resources');
    const target = artifactPath(targetRoot, resolve(targetRoot, file.target));
    const bytes =
      file.kind === 'archive'
        ? extractFile(asar, join(...file.target.split('/')))
        : await readFile(target);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      file.sha256,
      'Delivered source differs: ' + file.source,
    );
  }
  const diagnostic = extractFile(asar, join('desktop', 'background-observation.cjs')).toString(
    'utf8',
  );
  assert.ok(
    diagnostic.includes('--backseat-background-observe-delay-ms') &&
      diagnostic.includes('startupFailure'),
    'Delivered diagnostic support is absent',
  );
  const fuses = await getCurrentFuseWire(join(folder, 'Nagneon.exe'));
  for (const name of [
    'RunAsNode',
    'EnableNodeOptionsEnvironmentVariable',
    'EnableNodeCliInspectArguments',
    'GrantFileProtocolExtraPrivileges',
  ])
    assert.equal(fuses[FuseV1Options[name]], FuseState.DISABLE, 'Disabled fuse: ' + name);
  for (const name of ['EnableEmbeddedAsarIntegrityValidation', 'OnlyLoadAppFromAsar'])
    assert.equal(fuses[FuseV1Options[name]], FuseState.ENABLE, 'Enabled fuse: ' + name);
  assert.deepEqual(
    JSON.parse(JSON.stringify(fuses)),
    manifest.fuses,
    'Delivered fuse wire differs',
  );
  return {
    folder,
    manifestPath,
    manifestSha256,
    capabilities,
    capabilityFileSha256: await hash(join(folder, capabilityFile)),
    fuses,
    before,
    sourceManifestSha256: createHash('sha256')
      .update(JSON.stringify(manifest.sourceManifest))
      .digest('hex'),
    diagnosticSha256: createHash('sha256').update(diagnostic).digest('hex'),
  };
}

function person(id, name) {
  return {
    id,
    name,
    color: '#8bcdd2',
    role: 'viewer',
    enabled: true,
    system: false,
    personality: '함께 퍼즐을 탐험하는 합성 관객',
    values: '스스로 발견하는 즐거움',
    expertise: 0.4,
    sociability: 0.6,
  };
}
async function fixture(output, name, { long = false, sourced = false, stale = false } = {}) {
  const path = ownedPath(join(output, 'fixtures', name)),
    data = join(path, 'data');
  await mkdir(data, { recursive: true });
  let calls = 0,
    service;
  try {
    service = await startServer({
      port: 0,
      dataDir: data,
      localSpeech: false,
      provider: {
        check: () => {},
        status: () => ({ configured: false }),
        react: async () => {
          calls++;
          throw Error('Unexpected fixture model call');
        },
      },
    });
    clearInterval(service.studio.timer);
    service.studio.timer = null;
    const s = service.studio,
      now = Date.now() - 10000;
    const author = {
      id: randomUUID(),
      communityId: 'guide',
      persona: person('synthetic_author', '퍼즐산책'),
      joinedAt: now - 2000,
      admitted: false,
    };
    const reader = {
      id: randomUUID(),
      communityId: 'guide',
      persona: person('synthetic_reader', '별먼지'),
      joinedAt: now - 2000,
      admitted: false,
    };
    const record = (text) => {
      const message = {
        id: randomUUID(),
        time: now,
        personaId: 'streamer',
        name: '합성 스트리머',
        kind: 'streamer',
        text,
        transcription: { source: 'microphone' },
      };
      s.journal.record(message, {
        sessionId: randomUUID(),
        witnesses: [author.persona.id, 'momo'],
        title: '합성 퍼즐 방송',
      });
      return s.journal.data.entries.find((e) => e.id === message.id);
    };
    const short = record('오늘 합성 퍼즐 문을 열었어요');
    const shortIndex = await readFile(join(data, 'conversation-journal-index.json'));
    const target = long ? record('가'.repeat(3999) + '끝') : short;
    if (long) assert.equal(target.text.length, 4000);
    const world = structuredClone(s.world.snapshot());
    Object.assign(world.settings, {
      title: '합성 저장 검증',
      mode: 'rehearsal',
      webSearch: false,
      communityActivityEnabled: false,
      cultureDomains: [],
      communityCulture: '',
      memesEnabled: false,
      clipBufferEnabled: false,
      autoHighlights: false,
      discovery: { ...world.settings.discovery, enabled: false },
    });
    world.settings.personas.push(author.persona);
    world.audience.members[author.persona.id] = {
      sessions: 1,
      seconds: 60,
      recognized: 1,
      affinity: 0.6,
      peers: {},
      memories: ['합성 기억'],
      joinedAt: now,
      note: '합성 관객 메모',
      aliases: ['합성 옛이름'],
      origin: { path: 'community', key: 'guide', label: '합성 유입' },
    };
    world.economy.balance = 137;
    world.economy.wallets[author.persona.id] = {
      balance: 100,
      refillAt: now,
      lastDonationAt: 0,
      paidUntil: 0,
    };
    world.socialWorld.residents.push(author, reader);
    const ref = s.social.source(short, author.persona.id);
    assert.ok(ref, 'Witness source fixture');
    const mention = {
      id: randomUUID(),
      communityId: 'guide',
      topicId: 'puzzle',
      residentId: author.id,
      kind: 'mention',
      title: '함께 본 퍼즐',
      text: '방송에서 문을 연 순간을 봤어요',
      at: now + 1,
      source: ref,
    };
    world.socialWorld.threads.push(mention);
    world.socialWorld.receipts.push({
      id: randomUUID(),
      residentId: reader.id,
      threadId: mention.id,
      threadHash: socialContentHash(mention),
      deliveredHash: digest({ id: mention.id, title: mention.title, text: mention.text }),
      operationId: randomUUID(),
      receivedAt: mention.at + 1,
      receivedLiveSequence: 0,
      eligibleFromLiveSequence: 1,
      interested: true,
      source: ref,
    });
    let thread;
    if (sourced) {
      const first = {
        id: randomUUID(),
        residentId: reader.id,
        name: reader.persona.name,
        text: '합성 업데이트 소식 봤어요',
        parentId: null,
        at: now + 1101,
      };
      thread = {
        id: randomUUID(),
        communityId: 'guide',
        topicId: 'puzzle',
        residentId: author.id,
        kind: 'daily',
        title: '새 퍼즐 소식',
        text: '업데이트 이야기를 나눠요',
        at: now + 1100,
        source: null,
        trendFact: {
          id: 'steam-news:123:456',
          evidenceKind: 'synthetic',
          sourceUrl: 'https://store.steampowered.com/news/app/123/view/456',
          headline: '합성 퍼즐 게임 업데이트',
          publishedAt: now - 100,
          observedAt: now,
          expiresAt: now + 3600000,
          tags: ['퍼즐', '업데이트'],
          metrics: [
            {
              kind: 'concurrent-players',
              scope: 'game',
              value: 42,
              sourceUrl:
                'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=123',
              observedAt: now,
            },
          ],
        },
        comments: [
          first,
          {
            id: randomUUID(),
            residentId: author.id,
            name: author.persona.name,
            text: '다음에 같이 이야기해요',
            parentId: first.id,
            at: now + 1102,
          },
        ],
        votes: [reader.id, 'streamer'],
        attachments: [],
        activityReads: [{ residentId: reader.id, revision: 'a'.repeat(64), at: now + 1103 }],
      };
      world.socialWorld.threads.push(thread);
    }
    s.world.change((next) => Object.assign(next, WorldData.parse(world)));
    assert.equal(s.social.validReceipt(s.social.data().receipts[0]), true);
    const ai = structuredClone(s.ai.data);
    const expected = {
      world: structuredClone(s.world.data),
      journal: structuredClone(s.journal.data),
      targetId: target.id,
      threadId: thread?.id,
    };
    await service.close();
    service = undefined;
    await save(join(data, 'clips.json'), []);
    await save(join(data, 'onboarding.json'), {
      version: 1,
      status: 'completed',
      completedAt: now,
    });
    await save(join(data, 'provider-choice.json'), { kind: 'openai' });
    await save(join(data, 'native-audio.json'), {
      mode: 'local',
      transport: 'subscription',
      consent: false,
    });
    ai.policy.paused = true;
    ai.policy.background = false;
    for (const key of Object.keys(ai.policy.features)) ai.policy.features[key] = false;
    await save(join(data, 'ai-control.json'), ai);
    await writeFile(
      join(data, 'missions.json'),
      '{"version":1,"synthetic":"unrelated durable sidecar"}\n',
    );
    // Keep a deliberately shorter valid backup beside the authoritative primary.
    await writeFile(join(data, 'conversation-journal-index.json.bak.1'), shortIndex);
    if (stale)
      await save(join(data, 'profile-format.json'), { minReader: 4, minAppVersion: '0.1.18' });
    // Genuine saves may leave fewer generations after unchanged saves become
    // no-ops. Seed three valid, distinct synthetic recovery points explicitly.
    for (let generation = 1; generation <= 3; generation++) {
      const backup = structuredClone(expected.world);
      backup.settings.title = '합성 이전 저장 세대 ' + generation;
      if (sourced && generation === 1)
        backup.socialWorld.threads = backup.socialWorld.threads.filter((t) => !t.trendFact);
      await save(join(data, 'world.json.bak.' + generation), WorldData.parse(backup));
    }
    assertRestartWitness(await inventory(data));
    assert.equal(calls, 0);
    expected.floor = long ? 5 : sourced ? 4 : 2;
    await save(join(path, 'expected.json'), expected);
    await save(join(path, 'inventory.json'), await inventory(data));
    return { path, expected };
  } finally {
    await service?.close();
  }
}

function pages(port, timeout) {
  return new Promise((done, fail) => {
    const request = get({ hostname: '127.0.0.1', port, path: '/json/list' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1000000) request.destroy(Error('Debugger discovery exceeded bound'));
      });
      response.on('error', fail);
      response.on('end', () => {
        try {
          assert.equal(response.statusCode, 200);
          const value = JSON.parse(body);
          assert.ok(Array.isArray(value));
          done(value);
        } catch (error) {
          fail(error);
        }
      });
    });
    const timer = setTimeout(() => request.destroy(Error('Debugger discovery deadline')), timeout);
    request.once('close', () => clearTimeout(timer));
    request.once('error', fail);
  });
}

function cdp(socket, processState) {
  let serial = 0;
  const pending = new Map();
  const reject = (error) => {
    for (const item of pending.values()) item.fail(error);
    pending.clear();
  };
  socket.on('message', (bytes) => {
    let value;
    try {
      value = JSON.parse(bytes.toString());
    } catch {
      reject(Error('Malformed debugger response'));
      return;
    }
    const item = pending.get(value.id);
    if (!item) return;
    pending.delete(value.id);
    if (value.error) item.fail(Error(value.error.message));
    else item.done(value.result);
  });
  socket.on('error', reject);
  socket.on('close', () => reject(Error('Debugger closed')));
  processState.onExit = () => reject(Error('Native process exited'));
  return {
    call(method, params, timeout) {
      assert.ok(
        !processState.exited && socket.readyState === WebSocket.OPEN,
        'Native process/target is no longer active',
      );
      return new Promise((done, fail) => {
        const id = ++serial;
        const finish = (callback) => (value) => {
          clearTimeout(timer);
          pending.delete(id);
          callback(value);
        };
        const timer = setTimeout(
          () => finish(fail)(Error('Debugger deadline: ' + method)),
          timeout,
        );
        pending.set(id, { done: finish(done), fail: finish(fail) });
        socket.send(JSON.stringify({ id, method, params }), (error) => {
          if (error) pending.get(id)?.fail(error);
        });
      });
    },
    close() {
      reject(Error('Debugger disposed'));
      socket.close();
    },
  };
}

const rendererExpression = (expected, mutate) => `
(async()=>{
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),7000);
  const rows=[];
  async function request(path,method='GET',body){
    const response=await fetch(path,{method,signal:controller.signal,headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json(); rows.push({path,method,status:response.status});
    if(response.status!==200)throw Error('Synthetic API failed: '+path+' '+response.status);
    return value;
  }
  try{
    const stateBefore=await request('/api/state');
    const aiBefore=await request('/api/ai');
    const before=await request('/api/journal?limit=40');
    const socialBefore=${expected.threadId ? `await request('/api/social/threads/${expected.threadId}')` : 'null'};
    const pin=${mutate ? `await request('/api/journal/${expected.targetId}/pin','POST',{pinned:true})` : 'null'};
    const after=await request('/api/journal?limit=40');
    const settings=${mutate ? `await request('/api/settings','PUT',{...stateBefore.settings,title:${JSON.stringify('합성 저장 변경 ' + expected.targetId)}})` : 'null'};
    const stateAfter=await request('/api/state');
    const aiAfter=await request('/api/ai');
    const socialAfter=${expected.threadId ? `await request('/api/social/threads/${expected.threadId}')` : 'null'};
    return {rows,stateBefore,stateAfter,aiBefore,aiAfter,before,after,pin,settings,socialBefore,socialAfter,documentTitle:document.title,displayedVersion:document.querySelector('[aria-label="앱 버전"]')?.textContent};
  }finally{clearTimeout(timer);}
})()`;

async function nativeRun(pkg, output, profile, expected, { mutate = false, failurePattern } = {}) {
  ownedPath(profile);
  ownedPath(output);
  assert.ok(existsSync(join(profile, 'data')), 'Precreated data is required');
  assert.ok(!existsSync(join(profile, 'DevToolsActivePort')), 'Debugger endpoint must be fresh');
  assert.ok(!existsSync(join(profile, 'data', '.nagneon-writer')), 'Profile writer must be free');
  await mkdir(output, { recursive: true });
  await mkdir(ownedPath(join(profile, 'temp')), { recursive: true });
  const record = {
    profile,
    synthetic: true,
    passed: false,
    acceptanceScope:
      'native transport and lifecycle only; semantic acceptance is in the outer case',
    lifecycle: { spawnedAt: Date.now() },
    checks: [],
    notTested: [
      'user-installation',
      'real-account',
      'physical-devices',
      'missions',
      'Steam-sale-acceptance',
    ],
  };
  const state = { exited: false, closed: false },
    stdout = [],
    stderr = [],
    decoder = new StringDecoder('utf8');
  let stdoutText = '',
    socket,
    debuggerClient,
    failure;
  let terminalEvidence = Promise.resolve();
  const started = performance.now(),
    deadline = started + 45000;
  const remaining = () => {
    assert.ok(!state.exited, 'Native process exited before observation');
    const value = deadline - performance.now();
    assert.ok(value > 0, 'Native observation deadline exceeded');
    return value;
  };
  const args = [
    '--backseat-profile=' + profile,
    '--backseat-background-observe',
    '--backseat-background-observe-delay-ms=10000',
    '--remote-debugging-port=0',
  ];
  const child = spawn(join(pkg.folder, 'Nagneon.exe'), args, {
    cwd: pkg.folder,
    windowsHide: true,
    env: syntheticEnvironment(process.env, profile),
  });
  record.lifecycle.pid = child.pid;
  record.lifecycle.owner = {
    parentPid: process.pid,
    executable: child.spawnfile,
    args,
    profile,
    newProfile: true,
  };
  let processError;
  child.on('error', (error) => {
    processError = error;
  });
  child.stdout.on('data', (bytes) => {
    stdout.push(bytes);
    stdoutText += decoder.write(bytes);
  });
  child.stderr.on('data', (bytes) => stderr.push(bytes));
  child.once('exit', (code, signal) => {
    state.exited = true;
    record.lifecycle.exit = { at: Date.now(), code, signal };
    state.onExit?.();
  });
  child.once('close', (code, signal) => {
    state.closed = true;
    stdoutText += decoder.end();
    record.lifecycle.close = { at: Date.now(), code, signal };
    terminalEvidence = Promise.all([
      writeFile(join(output, 'terminal-stdout.log'), Buffer.concat(stdout)),
      writeFile(join(output, 'terminal-stderr.log'), Buffer.concat(stderr)),
      save(join(output, 'terminal-lifecycle.json'), record.lifecycle),
    ]).catch((error) => {
      record.evidenceFailure = error.message;
      process.exitCode = 1;
      console.error('Terminal lifecycle evidence failed:', error.message);
    });
  });
  try {
    if (failurePattern) {
      while (!state.closed && performance.now() < deadline && !processError) await pause(50);
      assert.ok(state.closed, 'Rejected startup did not close within observation deadline');
      if (processError) throw processError;
      record.observation = backgroundObservation(stdoutText, {
        profile,
        version: pkg.capabilities.appVersion,
        failure: true,
      });
      assert.match(
        Buffer.concat(stderr).toString('utf8'),
        failurePattern,
        'Expected rejection reason is absent from stderr',
      );
      assert.ok(
        !stdoutText.includes('"passed":true'),
        'Rejected startup emitted positive readiness',
      );
      record.checks.push('explicit startup failure JSON and expected stderr');
    } else {
      let port;
      while (!port) {
        remaining();
        if (processError) throw processError;
        try {
          const path = join(profile, 'DevToolsActivePort');
          assert.ok(!lstatSync(path).isSymbolicLink());
          const text = await readFile(path, 'utf8'),
            first = text.split(/\r?\n/)[0];
          assert.match(first, /^\d+$/);
          port = Number(first);
          assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
        } catch (error) {
          if (!pendingDebuggerPort(error)) throw error;
          (record.debugDiscoveryRetries ||= []).push({
            at: Date.now(),
            code: error.code,
            message: error.message,
          });
        }
        if (!port) await pause(Math.min(50, remaining()));
      }
      record.debugPort = port;
      let page;
      while (!page) {
        const targets = await pages(port, Math.min(1500, remaining()));
        page = targets.find(
          (p) => p.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url),
        );
        if (!page) await pause(Math.min(50, remaining()));
      }
      record.pageUrl = loopbackUrl(page.url);
      const socketUrl = loopbackUrl(page.webSocketDebuggerUrl, {
        protocol: 'ws:',
        port,
        debuggerSocket: true,
      });
      const connectTimeout = Math.min(2000, remaining());
      socket = new WebSocket(socketUrl);
      await new Promise((done, fail) => {
        const timer = setTimeout(() => {
          socket.close();
          fail(Error('Debugger connect deadline'));
        }, connectTimeout);
        socket.once('open', () => {
          clearTimeout(timer);
          done();
        });
        socket.once('error', (error) => {
          clearTimeout(timer);
          fail(error);
        });
        socket.once('close', () => {
          clearTimeout(timer);
          fail(Error('Debugger closed before connect'));
        });
      });
      debuggerClient = cdp(socket, state);
      const writer = json(join(profile, 'data', '.nagneon-writer', 'owner.json'));
      assert.equal(writer.pid, child.pid, 'Native writer belongs to the spawned process');
      assert.match(writer.nonce, /^[a-f0-9-]{36}$/);
      assert.ok(
        Date.parse(writer.at) >= record.lifecycle.spawnedAt - 2000 &&
          Date.parse(writer.at) <= Date.now(),
        'Native writer creation time differs',
      );
      record.writer = writer;
      while (
        !stdoutText
          .split(/\r?\n/)
          .some(
            (line) =>
              line.startsWith('{') && line.includes('background-observation') && line.endsWith('}'),
          )
      ) {
        remaining();
        await pause(30);
      }
      record.readyObservedAt = Date.now();
      record.observation = backgroundObservation(stdoutText, {
        profile,
        version: pkg.capabilities.appVersion,
      });
      const value = await debuggerClient.call(
        'Runtime.evaluate',
        {
          expression: rendererExpression(expected, mutate),
          awaitPromise: true,
          returnByValue: true,
        },
        Math.min(8000, remaining()),
      );
      assert.ok(!value.exceptionDetails, JSON.stringify(value.exceptionDetails));
      assert.ok(value.result?.value, 'Renderer API result is absent');
      record.api = value.result.value;
      record.checks.push('single renderer evaluation of delivered authenticated API');
    }
  } catch (error) {
    failure = error;
    record.failure = { stage: 'observation', message: error.message };
  }
  // The diagnostic owns its automatic graceful quit. A functional timeout is
  // never cleared by late exit and never authorizes a second process or kill.
  const drainDeadline = performance.now() + 30000;
  while (!state.closed && performance.now() < drainDeadline) await pause(50);
  if (!state.closed && debuggerClient && !state.exited) {
    record.lifecycle.closeAttempt = {
      at: Date.now(),
      method: 'same owned CDP target Page.close',
      writerNonce: record.writer?.nonce,
    };
    try {
      const current = json(join(profile, 'data', '.nagneon-writer', 'owner.json'));
      assert.equal(current.pid, child.pid);
      assert.equal(current.nonce, record.writer?.nonce);
      await debuggerClient.call('Page.close', {}, 1500);
      record.lifecycle.closeAttempt.acknowledged = true;
    } catch (error) {
      record.lifecycle.closeAttempt.error = error.message;
    }
    const lateDeadline = performance.now() + 10000;
    while (!state.closed && performance.now() < lateDeadline) await pause(50);
  }
  debuggerClient?.close();
  if (!debuggerClient && socket) socket.close();
  try {
    assert.ok(
      state.exited && state.closed,
      'Native process or inherited pipes remain live; do not restart this profile',
    );
    assert.equal(record.lifecycle.exit.code, 0);
    assert.equal(record.lifecycle.exit.signal, null);
    assert.equal(record.lifecycle.close.code, 0);
    assert.equal(record.lifecycle.close.signal, null);
    assert.ok(!existsSync(join(profile, 'data', '.nagneon-writer')), 'Native writer lease remains');
    assert.ok(!processError, processError?.message);
    record.observation = backgroundObservation(stdoutText, {
      profile,
      version: pkg.capabilities.appVersion,
      failure: !!failurePattern,
    });
    record.checks.push('exit0, stdio close and writer release observed separately');
  } catch (error) {
    failure ||= error;
    record.failure ||= { stage: 'lifecycle', message: error.message };
  }
  // Preserve complete separated streams only after terminal drain. If still
  // live, later data also appends to separate evidence through this same handle.
  await writeFile(join(output, 'stdout.log'), Buffer.concat(stdout));
  await writeFile(join(output, 'stderr.log'), Buffer.concat(stderr));
  if (state.closed) await terminalEvidence;
  if (record.evidenceFailure) {
    failure ||= Error(record.evidenceFailure);
    record.failure ||= { stage: 'evidence', message: record.evidenceFailure };
  }
  record.passed = !failure;
  await save(join(output, 'result.json'), record);
  if (failure) throw Object.assign(failure, { nativeResult: record });
  return record;
}

function assertJournal(actual, expected) {
  assert.deepEqual(actual, expected, 'Originals, IDs, order, witnesses and transcription differ');
}
function assertApi(record, expected, mutate) {
  const a = record.api;
  assert.match(a.documentTitle, /Nagneon/);
  assert.equal(a.displayedVersion, '0.1.18');
  const expectedAfter = structuredClone(expected.journal);
  if (mutate) {
    expectedAfter.revision++;
    expectedAfter.entries.find((e) => e.id === expected.targetId).pinned = true;
    assert.deepEqual(a.pin, { ok: true });
  }
  assertJournal(a.before.entries, [...expected.journal.entries].reverse());
  assert.equal(a.before.revision, expected.journal.revision);
  assert.equal(a.before.total, expected.journal.entries.length);
  assertJournal(a.after.entries, [...expectedAfter.entries].reverse());
  assert.equal(a.after.revision, expectedAfter.revision);
  assert.equal(a.after.total, expectedAfter.entries.length);
  assert.equal(a.stateBefore.running, false);
  assert.equal(a.stateAfter.running, false);
  assert.equal(a.stateBefore.provider.configured, false);
  assert.equal(a.stateAfter.provider.configured, false);
  for (const ai of [a.aiBefore, a.aiAfter]) {
    assert.deepEqual(ai.active, []);
    assert.deepEqual(ai.recent, []);
    assert.equal(ai.policy.paused, true);
    assert.deepEqual(
      ai.usage,
      { today: {}, week: {}, session: {} },
      'AI usage ledger is not empty',
    );
  }
  if (mutate) assert.equal(a.settings.settings.title, '합성 저장 변경 ' + expected.targetId);
  assert.equal(
    a.stateAfter.settings.title,
    mutate ? '합성 저장 변경 ' + expected.targetId : expected.world.settings.title,
  );
  if (expected.threadId) {
    const thread = expected.world.socialWorld.threads.find((t) => t.id === expected.threadId);
    assert.deepEqual(
      a.socialBefore,
      a.socialAfter,
      'API source projection changed during ordinary writes',
    );
    assert.deepEqual(a.socialAfter.externalFact, thread.trendFact);
    assert.equal(a.socialAfter.recommendationCount, 2);
    assert.equal(a.socialAfter.recommended, true);
    assert.equal(a.socialAfter.comments.length, 2);
    assert.deepEqual(
      a.socialAfter.comments.map((c) => [c.id, c.parentId, c.text]),
      thread.comments.map((c) => [c.id, c.parentId, c.text]),
    );
  }
  return expectedAfter;
}

async function positive(pkg, output, seed, name) {
  const dir = ownedPath(join(output, 'cases', name)),
    profile = join(dir, 'profile'),
    data = join(profile, 'data');
  await mkdir(dir, { recursive: true });
  await cp(join(seed.path, 'data'), data, { recursive: true, errorOnExist: true, force: false });
  const initialInventory = await inventory(data);
  await save(join(dir, 'before.json'), initialInventory);
  const first = await nativeRun(pkg, join(dir, 'first'), profile, seed.expected, { mutate: true });
  const expectedJournal = assertApi(first, seed.expected, true);
  const expectedWorld = structuredClone(seed.expected.world);
  expectedWorld.settings.title = '합성 저장 변경 ' + seed.expected.targetId;
  assert.deepEqual(
    WorldData.parse(json(join(data, 'world.json'))),
    expectedWorld,
    'Source world changed outside the requested title',
  );
  assertJournal(new JournalStore(data).load(), expectedJournal);
  assert.deepEqual(json(join(data, 'profile-format.json')), {
    minReader: seed.expected.floor,
    minAppVersion: '0.1.18',
  });
  assert.equal(
    await readFile(join(data, 'missions.json'), 'utf8'),
    await readFile(join(seed.path, 'data', 'missions.json'), 'utf8'),
  );
  const firstInventory = await inventory(data);
  const desktopOrigin = json(join(data, 'desktop-origin.json'));
  assert.deepEqual(
    desktopOrigin,
    { version: 1, port: Number(new URL(first.pageUrl).port) },
    'Desktop origin does not match the actual native renderer',
  );
  const originRow = firstInventory.find((row) => row.path === 'desktop-origin.json');
  assert.ok(originRow && originRow.bytes <= 1024);
  // Only these normal commit/backups/diagnostic paths may change. Other durable
  // stores, sidecars, original chunks and input backups retain their hashes.
  assertDurableInventory(
    initialInventory,
    firstInventory,
    Object.values(json(join(data, 'conversation-journal-index.json')).chunks),
    originRow,
  );
  await save(join(dir, 'after-first.json'), firstInventory);
  const backupWitness = assertRestartWitness(firstInventory);
  await save(join(dir, 'restart-backup-witness.json'), backupWitness);
  const restarted = { ...seed.expected, world: expectedWorld, journal: expectedJournal };
  // Chromium rotates its endpoint at normal exit. Preserve the old file as
  // evidence and move it only after the exact process closed and writer freed.
  const endpoint = join(profile, 'DevToolsActivePort');
  if (existsSync(endpoint)) {
    const { rename } = await import('node:fs/promises');
    await rename(endpoint, join(dir, 'first-DevToolsActivePort'));
  }
  const second = await nativeRun(pkg, join(dir, 'restart'), profile, restarted);
  assertApi(second, restarted, false);
  assert.deepEqual(WorldData.parse(json(join(data, 'world.json'))), expectedWorld);
  assertJournal(new JournalStore(data).load(), expectedJournal);
  const secondInventory = await inventory(data);
  assertRestartInventory(firstInventory, secondInventory);
  await save(join(dir, 'after-restart.json'), secondInventory);
  return {
    name,
    passed: true,
    first: first.lifecycle,
    restart: second.lifecycle,
    backupRotation:
      'zero world backup rotations; primary, all three backup generations and every other existing durable hash unchanged',
    checks: [
      'actual GET→pin POST→GET',
      'actual settings PUT',
      'source world otherwise preserved',
      'native read-only restart preserves originals and every existing durable hash without backup rotation',
    ],
  };
}

async function negative(pkg, output, seed, name, mutate, failurePattern) {
  const dir = ownedPath(join(output, 'cases', name)),
    profile = join(dir, 'profile'),
    data = join(profile, 'data');
  await mkdir(dir, { recursive: true });
  await cp(join(seed.path, 'data'), data, { recursive: true, errorOnExist: true, force: false });
  await mutate(data);
  const before = await inventory(data);
  await save(join(dir, 'before.json'), before);
  const observed = await nativeRun(pkg, join(dir, 'native'), profile, seed.expected, {
    failurePattern,
  });
  const after = await inventory(data);
  await save(join(dir, 'after.json'), after);
  assert.deepEqual(after, before, 'Rejected startup changed durable bytes');
  return {
    name,
    passed: true,
    lifecycle: observed.lifecycle,
    checks: [
      'explicit startup rejection',
      'known stderr',
      'no positive ready',
      'all durable input hashes preserved',
    ],
  };
}

unredirectedArtifactRoot(artifacts);
await mkdir(artifacts, { recursive: true });
const outputOption = option('output');
if (outputOption) {
  ownedPath(resolve(outputOption));
  assert.ok(!existsSync(resolve(outputOption)), 'Output must be new');
}
const output = outputOption
  ? resolve(outputOption)
  : await mkdtemp(join(artifacts, 'packaged-profile-reader-'));
ownedPath(output);
await mkdir(output, { recursive: true });
const report = {
  schema: 'nagneon.packaged-profile-reader-proof/1',
  output,
  synthetic: true,
  passed: false,
  nativeExecuted: false,
  modelCall: false,
  physicalDeviceAccess: false,
  checks: [],
  notTested: [
    'user-installation/update/rollback',
    'real-account',
    'physical-devices',
    'mission-runtime',
    'source-UI',
    'Steam-sale-acceptance',
  ],
};
report.harnessFiles = await Promise.all(
  [
    'scripts/verify-packaged-profile-reader.mjs',
    'scripts/lib/packaged-profile-reader-guards.mjs',
    'test/packaged-profile-reader.test.js',
    'docs/PROFILE-READER-PACKAGE-QUALIFICATION.md',
  ].map(async (path) => ({ path, sha256: await hash(join(root, path)) })),
);
let pkg;
try {
  pkg = prepareOnly ? null : await deliveredPackage();
  if (pkg) {
    report.package = pkg;
    await save(join(output, 'package-before.json'), pkg);
  }
  const seeds = {
    source: await fixture(output, 'source', { sourced: true }),
    journal: await fixture(output, 'journal', { long: true }),
    stale: await fixture(output, 'stale', { long: true, stale: true }),
    composite: await fixture(output, 'composite', { long: true, sourced: true, stale: true }),
  };
  report.fixtureOnlyPassed = true;
  if (!prepareOnly) {
    assert.equal(process.platform, 'win32', 'Actual Windows EXE qualification requires Windows');
    report.nativeExecuted = true;
    for (const [name, seed] of Object.entries(seeds)) {
      console.log('Native synthetic case:', name);
      report.checks.push(await positive(pkg, output, seed, name));
    }
    const newer = /이 프로필은 다른 버전의 앱이 필요합니다/;
    report.checks.push(
      await negative(
        pkg,
        output,
        seeds.composite,
        'minReader6',
        (data) =>
          save(join(data, 'profile-format.json'), { minReader: 6, minAppVersion: '0.1.18' }),
        newer,
      ),
    );
    report.checks.push(
      await negative(
        pkg,
        output,
        seeds.composite,
        'minApp019',
        (data) =>
          save(join(data, 'profile-format.json'), { minReader: 5, minAppVersion: '0.1.19' }),
        newer,
      ),
    );
    report.checks.push(
      await negative(
        pkg,
        output,
        seeds.composite,
        'invalidProvenance',
        (data) => {
          const world = json(join(data, 'world.json'));
          world.socialWorld.threads.find((t) => t.trendFact).trendFact.sourceUrl =
            'https://example.com/unverified';
          return save(join(data, 'world.json'), world);
        },
        /기본 저장 파일을 자동 복구할 수 없습니다/,
      ),
    );
    report.checks.push(
      await negative(
        pkg,
        output,
        seeds.composite,
        'otherCorruptStore',
        (data) => save(join(data, 'native-audio.json'), { mode: 'unsupported-synthetic' }),
        /기본 저장 파일이 손상되었고 사용할 수 있는 백업이 없습니다/,
      ),
    );
    assert.deepEqual(
      await inventory(pkg.folder),
      pkg.before,
      'Immutable delivered package changed during qualification',
    );
    assert.equal(await hash(pkg.manifestPath), pkg.manifestSha256);
    report.passed = true;
  }
} catch (error) {
  report.failure = {
    message: error.message,
    stack: error.stack,
    ...(error.nativeResult ? { nativeResult: error.nativeResult } : {}),
  };
  process.exitCode = 1;
} finally {
  report.harnessFilesAfter = await Promise.all(
    report.harnessFiles.map(async (file) => ({
      path: file.path,
      sha256: await hash(join(root, file.path)),
    })),
  );
  try {
    assert.deepEqual(
      report.harnessFilesAfter,
      report.harnessFiles,
      'Harness sources changed during qualification',
    );
  } catch (error) {
    report.passed = false;
    report.harnessVerificationFailure = error.message;
    process.exitCode = 1;
  }
  if (pkg) {
    try {
      const after = await inventory(pkg.folder);
      await save(join(output, 'package-after.json'), after);
      assert.deepEqual(after, pkg.before, 'Immutable delivered package changed');
      assert.equal(await hash(pkg.manifestPath), pkg.manifestSha256);
      report.packageUnchanged = true;
    } catch (error) {
      report.passed = false;
      report.packageVerificationFailure = error.message;
      process.exitCode = 1;
    }
  }
  await save(join(output, 'result.json'), report);
  console.log(
    JSON.stringify({
      output,
      passed: report.passed,
      fixtureOnlyPassed: report.fixtureOnlyPassed,
      nativeExecuted: report.nativeExecuted,
      failure: report.failure?.message,
    }),
  );
}
