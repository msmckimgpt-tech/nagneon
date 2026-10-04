import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../server/storage.js';
import { startServer } from '../server/index.js';
import { WorldData } from '../server/world.js';
import { randomUUID } from 'node:crypto';

function directory(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'nagneon-backup-retention-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  return dir;
}
const canonical = value => Buffer.from(JSON.stringify(value, null, 2));
const options = overrides => ({
  validate: value => {
    assert.equal(typeof value.generation, 'number');
    return { generation: value.generation, text: value.text || '' };
  },
  initial: () => ({ generation: 0, text: '' }),
  skipUnchanged: true,
  ...overrides,
});
const read = file => fs.readFileSync(file);
const generations = file => [file, file + '.bak.1', file + '.bak.2', file + '.bak.3'].map(read);

test('opt-in unchanged saves preserve distinct recovery generations without any disk writes', t => {
  const file = join(directory(t), 'world.json');
  const store = new JsonStore(file, options());
  for (const generation of [1, 2, 3, 4]) store.save({ generation, text: '관객 기억 🍿' });
  const before = generations(file);
  const writes = new JsonStore(file, options({ fs: Object.fromEntries(
    ['mkdirSync', 'openSync', 'writeSync', 'fsyncSync', 'renameSync', 'copyFileSync', 'unlinkSync'].map(name =>
      [name, () => { throw new Error('unchanged save attempted ' + name); }]),
  ) }));
  const current = writes.load();
  for (let index = 0; index < 12; index++) {
    const result = writes.save(current);
    result.generation = 99;
  }
  assert.deepEqual(generations(file), before);
  assert.deepEqual(writes.load(), current);
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('no-op policy remains opt-in and is a strict boolean', t => {
  const file = join(directory(t), 'ordinary.json');
  const store = new JsonStore(file, options({ skipUnchanged: false }));
  store.save({ generation: 1 });
  store.save({ generation: 1 });
  assert.deepEqual(read(file + '.bak.1'), read(file));
  assert.throws(() => new JsonStore(file, options({ skipUnchanged: 'true' })), /boolean/);
});

test('unchanged fresh primary does not promise or heal a duplicate backup', t => {
  const file = join(directory(t), 'world.json');
  const store = new JsonStore(file, options());
  store.save({ generation: 1 });
  store.save({ generation: 1 });
  assert.equal(fs.existsSync(file + '.bak.1'), false);
  fs.writeFileSync(file + '.bak.1', 'broken backup');
  store.save({ generation: 1 });
  assert.equal(read(file + '.bak.1').toString(), 'broken backup');
});

test('validate before no-op, normalize caller data and isolate mutable results', t => {
  const file = join(directory(t), 'world.json');
  const store = new JsonStore(file, options());
  store.save({ generation: 2 });
  const before = read(file);
  assert.throws(() => store.save({ generation: '2' }));
  const output = store.save({ generation: 2, extra: 'discarded' });
  assert.deepEqual(output, { generation: 2, text: '' });
  output.text = 'mutated';
  assert.deepEqual(read(file), before);
  assert.equal(fs.existsSync(file + '.bak.1'), false);
});

test('in-place caller edits, external edits and noncanonical primary still commit real changes', t => {
  const file = join(directory(t), 'world.json');
  const store = new JsonStore(file, options());
  const caller = { generation: 1 };
  store.save(caller);
  caller.generation = 2;
  store.save(caller);
  assert.equal(JSON.parse(read(file + '.bak.1')).generation, 1);
  fs.writeFileSync(file, canonical({ generation: 7, text: 'external' }));
  store.save(caller);
  assert.equal(JSON.parse(read(file + '.bak.1')).generation, 7);
  const noncanonical = '{"generation":2,"text":""}\n';
  fs.writeFileSync(file, noncanonical);
  store.save(caller);
  assert.deepEqual(read(file), canonical({ generation: 2, text: '' }));
  assert.equal(read(file + '.bak.1').toString(), noncanonical);
});

test('missing primary is restored even when cached caller value is unchanged', t => {
  const file = join(directory(t), 'world.json');
  const store = new JsonStore(file, options());
  store.save({ generation: 1 });
  fs.unlinkSync(file);
  store.save({ generation: 1 });
  assert.deepEqual(read(file), canonical({ generation: 1, text: '' }));
});

test('corrupt primary is preserved and cannot become an unchanged cache hit', t => {
  const dir = directory(t), file = join(dir, 'world.json');
  const store = new JsonStore(file, options());
  store.save({ generation: 1 });
  fs.writeFileSync(file, '{broken');
  store.save({ generation: 1 });
  const preserved = fs.readdirSync(dir).filter(name => name.startsWith('world.json.corrupt-'));
  assert.equal(preserved.length, 1);
  assert.equal(read(join(dir, preserved[0])).toString(), '{broken');
  assert.equal(fs.existsSync(file + '.bak.1'), false);
  assert.equal(JSON.parse(read(file)).generation, 1);
});

test('pending corrupt preservation takes priority even after external restoration', t => {
  const dir = directory(t), file = join(dir, 'world.json');
  const store = new JsonStore(file, options());
  store.save({ generation: 1 });
  store.save({ generation: 2 });
  fs.writeFileSync(file, '{broken');
  const restored = new JsonStore(file, options());
  const recovered = restored.load();
  fs.writeFileSync(file, canonical(recovered));
  restored.save(recovered);
  const preserved = fs.readdirSync(dir).filter(name => name.startsWith('world.json.corrupt-'));
  assert.equal(preserved.length, 1);
  assert.deepEqual(read(join(dir, preserved[0])), canonical(recovered));
  assert.equal(restored._preserveCorrupt, false);
});

test('byte comparison does not silently retain malformed UTF-8 that decodes identically', t => {
  const file = join(directory(t), 'world.json');
  const value = { generation: 1, text: '�' };
  const bytes = canonical(value);
  const at = bytes.indexOf(Buffer.from('�'));
  const malformed = Buffer.concat([bytes.subarray(0, at), Buffer.from([0xff]), bytes.subarray(at + 3)]);
  assert.equal(malformed.toString('utf8'), bytes.toString('utf8'));
  fs.writeFileSync(file, malformed);
  const store = new JsonStore(file, options());
  store.save(store.load());
  assert.deepEqual(read(file), bytes);
  assert.deepEqual(read(file + '.bak.1'), malformed);
});

test('unreadable primary fails before temp writes or backup mutation', t => {
  const file = join(directory(t), 'world.json');
  new JsonStore(file, options()).save({ generation: 1 });
  const before = read(file);
  const store = new JsonStore(file, options({ fs: {
    readFileSync: () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); },
    mkdirSync: () => { assert.fail('must not write after failed equality read'); },
  } }));
  assert.throws(() => store.save({ generation: 1 }), /저장 파일을 읽을 수 없습니다/);
  assert.deepEqual(read(file), before);
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('changed save preserves atomic failure behavior and prior recovery generations', t => {
  const file = join(directory(t), 'world.json');
  const store = new JsonStore(file, options());
  for (const generation of [1, 2, 3, 4]) store.save({ generation });
  const before = generations(file);
  const failing = new JsonStore(file, options({ fs: {
    writeSync: () => { throw new Error('disk full'); },
  } }));
  assert.throws(() => failing.save({ generation: 5 }), /disk full/);
  assert.deepEqual(generations(file), before);
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('orphan temp follows the normal successful save cleanup path', t => {
  const file = join(directory(t), 'world.json');
  const store = new JsonStore(file, options());
  store.save({ generation: 1 });
  fs.writeFileSync(file + '.tmp', 'interrupted write');
  store.save({ generation: 1 });
  assert.equal(fs.existsSync(file + '.tmp'), false);
  assert.deepEqual(read(file + '.bak.1'), read(file));
});

test('idle stop persists in-place audience memory edits rather than comparing mutable cache', async t => {
  const dir = directory(t);
  const service = await startServer({
    port: 0, dataDir: dir, localSpeech: false,
    provider: { status: () => ({ configured: true }) },
  });
  t.after(() => service.close());
  const id = service.studio.settings.personas[0].id;
  service.studio.audience.data.members[id] = {
    sessions: 2, seconds: 17, recognized: 3, affinity: 0.4, peers: {}, memories: [],
  };
  await service.studio.stop();
  assert.equal(JSON.parse(read(join(dir, 'world.json'))).audience.members[id].recognized, 3);
  service.studio.audience.data.members[id].recognized = 9;
  await service.studio.stop();
  const value = JSON.parse(read(join(dir, 'world.json')));
  assert.equal(value.audience.members[id].recognized, 9);
  assert.equal(value.audience.members[id].affinity, 0.4);
});

test('actual server idle stop/close/restart preserve prior world bytes and changed title rotates once', async t => {
  const dir = directory(t);
  const provider = {
    status: () => ({ configured: true }),
    react: async () => { assert.fail('idle durability test must not invoke a model'); },
  };
  const launch = () => startServer({ port: 0, dataDir: dir, localSpeech: false, provider });
  let service = await launch();
  t.after(async () => service?.close());
  for (const title of ['방송 A', '방송 B', '방송 C', '방송 D'])
    service.studio.configure({ ...service.studio.settings, title });
  const file = join(dir, 'world.json'), before = generations(file);
  for (let index = 0; index < 3; index++) {
    await service.studio.stop();
    await service.close();
    service = null;
    assert.deepEqual(generations(file), before);
    service = await launch();
  }
  service.studio.configure({ ...service.studio.settings, title: '실제 변경 E' });
  const changed = generations(file);
  assert.equal(JSON.parse(changed[0]).settings.title, '실제 변경 E');
  assert.deepEqual(changed.slice(1), before.slice(0, 3));
  await service.close();
  service = null;
  assert.deepEqual(generations(file), changed);
});

test('capability floor is raised before an exact-byte world no-op', async t => {
  const dir = directory(t);
  const service = await startServer({
    port: 0, dataDir: dir, localSpeech: false,
    provider: { status: () => ({ configured: true }) },
  });
  t.after(() => service.close());
  const post = service.studio.community.post({ title: '함께 본 방송', text: '합성 관객들의 기억' });
  for (const title of ['A', 'B', 'C']) service.studio.configure({ ...service.studio.settings, title });
  const file = join(dir, 'world.json');
  const expanded = structuredClone(service.studio.world.snapshot());
  expanded.audience.posts.find(row => row.id === post.id).activityReads =
    Array.from({ length: 151 }, (_, index) => ({ viewerId: 'reader_' + index, revision: 'a'.repeat(64), at: 1000 }));
  const validated = WorldData.parse(expanded);
  fs.writeFileSync(file, canonical(validated));
  const before = generations(file);
  assert.equal(JSON.parse(read(join(dir, 'profile-format.json'))).minReader, 2);
  service.studio.world.change(next => Object.assign(next, validated));
  assert.equal(JSON.parse(read(join(dir, 'profile-format.json'))).minReader, 3);
  assert.deepEqual(generations(file), before);
});

test('future or malformed marker rejects unchanged world before provider or durable writes', async t => {
  const dir = directory(t), file = join(dir, 'world.json');
  const first = await startServer({ port: 0, dataDir: dir, localSpeech: false,
    provider: { status: () => ({ configured: true }) } });
  for (const title of ['A', 'B', 'C']) first.studio.configure({ ...first.studio.settings, title });
  await first.close();
  const before = generations(file), marker = join(dir, 'profile-format.json');
  let calls = 0;
  for (const value of [canonical({ minReader: 99, minAppVersion: '0.1.18' }), Buffer.from('{broken marker')]) {
    fs.writeFileSync(marker, value);
    await assert.rejects(startServer({ port: 0, dataDir: dir, localSpeech: false,
      provider: { check: () => { calls++; }, status: () => ({ configured: true }) } }), /프로필|버전/);
    assert.deepEqual(generations(file), before);
    assert.deepEqual(read(marker), value);
  }
  assert.equal(calls, 0);
});

test('actual journal wiring retrieves legacy viewer words and reevaluates selected manager role', async t => {
  const dir = directory(t);
  const service = await startServer({
    port: 0, dataDir: dir, localSpeech: false,
    provider: { status: () => ({ configured: true }), react: () => assert.fail('No model calls') },
  });
  t.after(() => service.close());
  const studio = service.studio, journal = studio.journal;
  studio.world.change(next => next.settings.personas.push({
    ...next.settings.personas[0], id: 'legacy_viewer', role: 'viewer', name: '합성 관객',
  }));
  const viewer = studio.settings.personas.find(p => p.role === 'viewer' && p.id !== studio.settings.managerId);
  const manager = studio.settings.managerId, sessionId = randomUUID();
  const record = (text, personaId, time) => {
    const id = randomUUID();
    journal.record({ id, text, personaId, name: personaId, time, fictional: false },
      { sessionId, witnesses: ['observer'], title: '합성 이전 방송' });
    return id;
  };
  const question = record('야식 뭐 먹을래?', 'streamer', 1000);
  const answer = record('저는 떡볶이요', viewer.id, 1001);
  const notice = record('채팅창 공지를 참고해요', manager, 1002);
  for (let index = 0; index < 40; index++) record('산책 이야기 ' + index, 'streamer', 1003 + index);
  const originals = structuredClone(journal.data);
  let quotes = journal.recall('observer', '야식');
  assert.ok(quotes.some(e => e.sourceId === question));
  assert.ok(quotes.some(e => e.sourceId === answer));
  assert.ok(!quotes.some(e => e.sourceId === notice));
  assert.equal(quotes.find(e => e.sourceId === answer).kind, undefined);
  studio.configure({ ...studio.settings, managerId: viewer.id });
  quotes = journal.recall('observer', '야식');
  assert.ok(!quotes.some(e => e.sourceId === answer), 'new selected manager is excluded immediately');
  assert.ok(!quotes.some(e => e.sourceId === notice), 'role manager remains excluded');
  assert.deepEqual(journal.data, originals);
});
