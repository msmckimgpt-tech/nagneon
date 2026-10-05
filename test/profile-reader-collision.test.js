import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { startServer } from '../server/index.js';
import { WorldData } from '../server/world.js';
import { JsonStore } from '../server/storage.js';
import {
  readProfileFormat,
  requiredProfileFormat,
  PROFILE_READER,
} from '../server/profile-capabilities.js';
import { socialContentHash } from '../server/social-content.js';
import { digest } from '../server/social-runtime-state.js';

const trendFloor = { minReader: 4, minAppVersion: '0.1.18' };
const longFloor = { minReader: 5, minAppVersion: '0.1.18' };
const fact = () => ({
  id: 'steam-news:123:456',
  evidenceKind: 'synthetic',
  sourceUrl: 'https://store.steampowered.com/news/app/123/view/456',
  headline: '합성 퍼즐 게임 업데이트',
  publishedAt: 900,
  observedAt: 1000,
  expiresAt: 2000,
  tags: ['퍼즐', '업데이트'],
  metrics: [
    {
      kind: 'concurrent-players',
      scope: 'game',
      value: 42,
      sourceUrl:
        'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=123',
      observedAt: 1000,
    },
  ],
});
const person = (id, name) => ({
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
});
function worldWithFact(world) {
  const result = structuredClone(world);
  const author = {
    id: randomUUID(),
    communityId: 'guide',
    persona: person('synthetic_author', '퍼즐산책'),
    joinedAt: 800,
    admitted: false,
  };
  const reader = {
    id: randomUUID(),
    communityId: 'guide',
    persona: person('synthetic_reader', '별먼지'),
    joinedAt: 800,
    admitted: false,
  };
  const first = {
    id: randomUUID(),
    residentId: reader.id,
    name: reader.persona.name,
    text: '합성 업데이트 소식 봤어요',
    parentId: null,
    at: 1101,
  };
  const thread = {
    id: randomUUID(),
    communityId: 'guide',
    topicId: 'puzzle',
    residentId: author.id,
    kind: 'daily',
    title: '새 퍼즐 소식',
    text: '업데이트 이야기를 나눠요',
    at: 1100,
    source: null,
    trendFact: fact(),
    comments: [
      first,
      {
        id: randomUUID(),
        residentId: author.id,
        name: author.persona.name,
        text: '다음에 같이 이야기해요',
        parentId: first.id,
        at: 1102,
      },
    ],
    votes: [reader.id, 'streamer'],
    attachments: [],
    activityReads: [{ residentId: reader.id, revision: 'a'.repeat(64), at: 1103 }],
  };
  result.socialWorld.residents.push(author, reader);
  result.socialWorld.threads.push(thread);
  return result;
}
async function fixture(t) {
  mkdirSync('artifacts', { recursive: true });
  const dir = mkdtempSync(resolve('artifacts/profile-collision-'));
  let service,
    modelCalls = 0;
  const options = {
    port: 0,
    dataDir: dir,
    localSpeech: false,
    provider: {
      check: () => {},
      status: () => ({ configured: false }),
      react: async () => {
        modelCalls++;
        assert.fail('Unexpected model call');
      },
    },
  };
  const open = async () => {
    assert.equal(service, undefined);
    service = await startServer(options);
    clearInterval(service.studio.timer);
    return service;
  };
  const close = async () => {
    const current = service;
    service = undefined;
    await current?.close();
  };
  t.after(close);
  await open();
  const initialWorld = structuredClone(service.studio.world.data);
  await close();
  return { dir, options, open, close, initialWorld, modelCalls: () => modelCalls };
}
const json = (dir, name) => JSON.parse(readFileSync(join(dir, name + '.json'), 'utf8'));
const write = (dir, name, value) => writeFileSync(join(dir, name + '.json'), JSON.stringify(value));
function inventory(dir) {
  const records = [];
  const walk = (root) => {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const file = join(root, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile())
        records.push([
          relative(dir, file),
          createHash('sha256').update(readFileSync(file)).digest('hex'),
        ]);
    }
  };
  walk(dir);
  return records.sort((a, b) => a[0].localeCompare(b[0]));
}
function remember(journal, text) {
  const message = {
    id: randomUUID(),
    time: 1000000,
    personaId: 'streamer',
    name: '합성 스트리머',
    kind: 'streamer',
    text,
    transcription: { source: 'microphone' },
  };
  journal.record(message, { sessionId: randomUUID(), witnesses: ['momo'], title: '합성 방송' });
  return message;
}

test('long originals require reader5 so a trend-only reader4 cannot accept the same profile', async (t) => {
  const f = await fixture(t),
    s = await f.open();
  const original = remember(s.studio.journal, '가'.repeat(3999) + '끝');
  assert.deepEqual(readProfileFormat(f.dir), longFloor);
  assert.ok(PROFILE_READER >= longFloor.minReader);
  const expected = structuredClone(s.studio.journal.data);
  await f.close();
  const restarted = await f.open();
  assert.deepEqual(restarted.studio.journal.data, expected);
  assert.equal(
    restarted.studio.journal.data.entries.find((e) => e.id === original.id).text,
    original.text,
  );
  assert.equal(f.modelCalls(), 0);
});

test('a previously emitted ambiguous reader4 long journal is protected during startup without a new utterance', async (t) => {
  const f = await fixture(t),
    s = await f.open();
  remember(s.studio.journal, '기'.repeat(3999) + '끝');
  const expected = structuredClone(s.studio.journal.data);
  await f.close();
  write(f.dir, 'profile-format', trendFloor);
  const index = readFileSync(join(f.dir, 'conversation-journal-index.json'));
  const restarted = await f.open();
  assert.deepEqual(readProfileFormat(f.dir), longFloor);
  assert.deepEqual(restarted.studio.journal.data, expected);
  assert.deepEqual(readFileSync(join(f.dir, 'conversation-journal-index.json')), index);
});

test('reader4 source metadata, replies, recommendations and an unrelated durable file survive a world write and restart', async (t) => {
  const f = await fixture(t),
    expected = worldWithFact(f.initialWorld);
  const thread = expected.socialWorld.threads[0],
    contentHash = socialContentHash(thread);
  write(f.dir, 'world', expected);
  write(f.dir, 'clips', []);
  write(f.dir, 'profile-format', trendFloor);
  const unrelated = '{"version":1,"synthetic":"unrelated durable state"}';
  writeFileSync(join(f.dir, 'unrelated-test-sidecar.json'), unrelated);
  const s = await f.open();
  assert.deepEqual(s.studio.world.data.socialWorld, expected.socialWorld);
  s.studio.world.change((w) => {
    w.autonomy.broadcastSeconds += 1;
  });
  await f.close();
  const restarted = await f.open();
  assert.deepEqual(restarted.studio.world.data.socialWorld, expected.socialWorld);
  assert.equal(socialContentHash(restarted.studio.world.data.socialWorld.threads[0]), contentHash);
  assert.equal(readFileSync(join(f.dir, 'unrelated-test-sidecar.json'), 'utf8'), unrelated);
  assert.deepEqual(readProfileFormat(f.dir), trendFloor);
  assert.equal(f.modelCalls(), 0);
});

test('a compatible primary with source metadata is opened directly without selecting a different valid backup', async (t) => {
  const f = await fixture(t),
    expected = worldWithFact(f.initialWorld);
  write(f.dir, 'world', expected);
  writeFileSync(join(f.dir, 'world.json.bak.1'), JSON.stringify(f.initialWorld));
  write(f.dir, 'clips', []);
  write(f.dir, 'profile-format', trendFloor);
  const primary = readFileSync(join(f.dir, 'world.json'));
  const s = await f.open();
  assert.deepEqual(s.studio.world.data.socialWorld, expected.socialWorld);
  assert.deepEqual(readFileSync(join(f.dir, 'world.json')), primary);
});

test('all world, clip and journal requirements are checked even when the world already requires reader4', async (t) => {
  const f = await fixture(t),
    s = await f.open();
  remember(s.studio.journal, '모'.repeat(3999) + '끝');
  const journal = structuredClone(s.studio.journal.data);
  await f.close();
  const world = worldWithFact(json(f.dir, 'world'));
  write(f.dir, 'world', world);
  write(f.dir, 'profile-format', trendFloor);
  const restarted = await f.open();
  assert.deepEqual(readProfileFormat(f.dir), longFloor);
  assert.deepEqual(restarted.studio.journal.data, journal);
  assert.deepEqual(restarted.studio.world.data.socialWorld, world.socialWorld);
  assert.deepEqual(requiredProfileFormat('world', world), trendFloor);
});

test('a source metadata write raises the floor only after materializing a validated clip primary', async (t) => {
  const f = await fixture(t),
    s = await f.open();
  assert.equal(existsSync(join(f.dir, 'clips.json')), false);
  const expected = worldWithFact(s.studio.world.data);
  s.studio.world.change((w) => {
    w.socialWorld = expected.socialWorld;
  });
  assert.deepEqual(readProfileFormat(f.dir), trendFloor);
  assert.deepEqual(json(f.dir, 'clips'), []);
  await f.close();
  assert.deepEqual((await f.open()).studio.world.data.socialWorld, expected.socialWorld);
});

test('invalid source metadata and chronology cannot recover a stale world or mutate any persistent file', async (t) => {
  const f = await fixture(t),
    original = worldWithFact(f.initialWorld);
  for (const mutate of [
    (d) => {
      d.sourceUrl = 'https://example.invalid/news/123';
    },
    (d) => {
      d.sourceUrl += '#fragment';
    },
    (d) => {
      d.sourceUrl = 'https://secret@store.steampowered.com/news/app/123/view/456';
    },
    (d) => {
      d.publishedAt = 1001;
    },
    (d) => {
      d.expiresAt = 1000;
    },
    (d) => {
      d.metrics[0].scope = 'topic';
    },
    (d) => {
      d.metrics[0].observedAt = 1001;
    },
    (d) => {
      d.newUnknownField = 'must not be silently removed';
    },
    (d) => {
      d.observedAt = 1101;
      d.expiresAt = 2000;
    },
  ]) {
    const invalid = structuredClone(original);
    mutate(invalid.socialWorld.threads[0].trendFact);
    write(f.dir, 'world', invalid);
    write(f.dir, 'clips', []);
    write(f.dir, 'profile-format', trendFloor);
    writeFileSync(join(f.dir, 'world.json.bak.1'), JSON.stringify(f.initialWorld));
    const before = inventory(f.dir);
    await assert.rejects(startServer(f.options));
    assert.deepEqual(inventory(f.dir), before);
    assert.equal(existsSync(join(f.dir, '.nagneon-writer')), false);
  }
  const mention = structuredClone(original);
  mention.socialWorld.threads[0].kind = 'mention';
  mention.socialWorld.threads[0].source = {
    id: randomUUID(),
    hash: 'a'.repeat(64),
    at: 1000,
    witnessId: 'synthetic_author',
  };
  assert.equal(WorldData.safeParse(mention).success, false);
});

test('startup does not promote a long profile before other existing stores have passed validation', async (t) => {
  const f = await fixture(t),
    s = await f.open();
  remember(s.studio.journal, '나'.repeat(3999) + '끝');
  await f.close();
  write(f.dir, 'profile-format', trendFloor);
  write(f.dir, 'native-audio', { unsupported: 'invalid existing store' });
  const before = inventory(f.dir);
  await assert.rejects(startServer(f.options));
  assert.deepEqual(inventory(f.dir), before);
});

test('a failed source-metadata floor write cannot commit a new world or change its in-memory state', async (t) => {
  const f = await fixture(t),
    s = await f.open(),
    initial = structuredClone(s.studio.world.data);
  const source = worldWithFact(initial),
    before = readFileSync(join(f.dir, 'world.json'));
  const save = JsonStore.prototype.save;
  JsonStore.prototype.save = function (value) {
    if (this.file === join(f.dir, 'profile-format.json'))
      throw Error('synthetic marker disk failure');
    return save.call(this, value);
  };
  try {
    assert.throws(
      () =>
        s.studio.world.change((w) => {
          w.socialWorld = source.socialWorld;
        }),
      /synthetic marker disk failure/,
    );
  } finally {
    JsonStore.prototype.save = save;
  }
  assert.deepEqual(s.studio.world.data, initial);
  assert.deepEqual(readFileSync(join(f.dir, 'world.json')), before);
  assert.deepEqual(readProfileFormat(f.dir), { minReader: 2, minAppVersion: '0.1.7' });
});

test('an already higher journal floor stays monotone when source metadata is saved later', async (t) => {
  const f = await fixture(t),
    s = await f.open();
  remember(s.studio.journal, '빛'.repeat(3999) + '끝');
  const source = worldWithFact(s.studio.world.data);
  s.studio.world.change((w) => {
    w.socialWorld = source.socialWorld;
  });
  assert.deepEqual(readProfileFormat(f.dir), longFloor);
  await f.close();
  assert.deepEqual((await f.open()).studio.world.data.socialWorld, source.socialWorld);
});

test('a source-metadata profile also preserves witnessed journal links and private social-reading receipts', async (t) => {
  const f = await fixture(t),
    service = await f.open(),
    s = service.studio;
  const mixed = worldWithFact(s.world.data),
    [author, reader] = mixed.socialWorld.residents;
  const message = {
    id: randomUUID(),
    time: Date.now() - 10000,
    personaId: 'streamer',
    name: '합성 스트리머',
    kind: 'streamer',
    text: '오늘 합성 퍼즐 문을 열었어요',
  };
  s.journal.record(message, {
    sessionId: randomUUID(),
    witnesses: [author.persona.id],
    title: '합성 방송',
  });
  const ref = s.social.source(
    s.journal.data.entries.find((e) => e.id === message.id),
    author.persona.id,
  );
  const mention = {
    id: randomUUID(),
    communityId: 'guide',
    topicId: 'puzzle',
    residentId: author.id,
    kind: 'mention',
    title: '함께 본 퍼즐',
    text: '방송에서 문을 연 순간을 봤어요',
    at: message.time + 1,
    source: ref,
  };
  mixed.socialWorld.threads.push(mention);
  const receipt = {
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
  };
  mixed.socialWorld.receipts.push(receipt);
  s.world.change((w) => {
    w.socialWorld = mixed.socialWorld;
  });
  assert.equal(s.social.validReceipt(s.social.data().receipts[0]), true);
  const journal = structuredClone(s.journal.data),
    balance = s.economy.data.balance;
  await f.close();
  const restarted = (await f.open()).studio;
  assert.deepEqual(restarted.social.data().receipts, [receipt]);
  assert.equal(restarted.social.validReceipt(restarted.social.data().receipts[0]), true);
  assert.deepEqual(restarted.journal.data, journal);
  assert.equal(restarted.economy.data.balance, balance);
  assert.deepEqual(restarted.social.data().threads[0].trendFact, fact());
});
