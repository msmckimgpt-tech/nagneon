import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { startServer } from '../server/index.js';
import { CodexProvider } from '../server/codex-provider.js';
import { digest } from '../server/social-runtime-state.js';
const out = 'artifacts/social-live';
mkdirSync(out, { recursive: true });
const report = {
  syntheticInputs: true,
  realProvider: true,
  model: 'gpt-5.6-luna',
  effort: 'none',
  calls: [],
};
const provider = new CodexProvider({
  ...process.env,
  OPENAI_MODEL: report.model,
  OPENAI_REASONING_EFFORT: report.effort,
});
let app;
try {
  report.connection = await provider.check();
  if (!report.connection.configured) throw Error(report.connection.authMessage);
  const react = provider.react.bind(provider);
  provider.react = async (args, signal) => {
    const start = Date.now();
    const r = await react(args, signal);
    report.calls.push({
      kind: args.special.kind,
      ms: Date.now() - start,
      observation: r.observation,
      usage: r.usage,
    });
    writeFileSync(out + '/result.json', JSON.stringify(report, null, 2));
    return r;
  };
  app = await startServer({ port: 0, persist: false, localSpeech: false, provider });
  const s = app.studio;
  clearInterval(s.timer);
  s.settings.mode = 'live';
  let now = Date.now();
  s.now = () => now;
  s.ai.update({ background: true });
  const run = async (target) => {
    const op = { controller: new AbortController(), epoch: s.epoch, social: true };
    s.communityActivity.active = op;
    op.promise = s.communityActivity.run(target, op);
    try {
      await op.promise;
    } finally {
      s.communityActivity.active = null;
      s.busy = false;
    }
  };
  for (let i = 0; i < 2; i++) {
    const t = s.social
      .candidates(s.now())
      .find((t) => t.kind === 'social-birth' && t.raw.communityId === 'guide');
    if (!t) throw Error('birth target absent');
    await run(t);
    now += 31 * 60 * 1000;
  }
  const [author, reader] = s.social.data().residents;
  s.world.change((w) => {
    w.settings.personas.push(author.persona);
    w.audience.members[author.persona.id] = {
      sessions: 1,
      seconds: 0,
      recognized: 0,
      affinity: 0.2,
      peers: {},
      memories: [],
    };
    w.socialWorld.residents[0].admitted = true;
  });
  const target = (kind, resident, source) => ({
    kind,
    id: resident.id,
    viewer: resident.persona,
    revision: digest(kind),
    raw: {
      residentId: resident.id,
      communityId: 'guide',
      topicId: 'practice',
      ...(source ? { source } : {}),
    },
  });
  await run(target('social-daily', author));
  const id = randomUUID();
  s.journal.record(
    {
      id,
      personaId: 'streamer',
      name: '검증방장',
      text: '오늘 퍼즐에서 다른 길을 시도하다 숨겨진 방을 찾았어. 정답보다 내가 시도해본 과정을 이야기하고 싶어.',
      kind: 'streamer',
      time: s.now() - 1000,
    },
    { sessionId: randomUUID(), witnesses: [author.persona.id] },
  );
  const source = s.social.source(
    s.journal.data.entries.find((e) => e.id === id),
    author.persona.id,
  );
  await run(target('social-mention', author, source));
  const thread = s.social.data().threads.find((t) => t.kind === 'mention');
  if (thread)
    await run({
      ...target('social-read', reader, source),
      id: thread.id,
      raw: {
        ...target('social-read', reader, source).raw,
        threadId: thread.id,
        threadHash: digest(thread),
      },
    });
  s.tutorialReady = () => true;
  const balance = s.economy.data.balance;
  s.start();
  report.arrived = s.social.arrive();
  report.samePersona = s.settings.personas.some((p) => p.id === reader.persona.id);
  report.zeroPointCost = s.economy.data.balance === balance;
  report.repeatAdmission = s.social.arrive();
  s.stop();
  report.residents = s.social.data().residents.length;
  report.posts = s.social.list();
  report.receipts = s.social.data().receipts;
  report.passed = report.residents === 2 && report.calls.length >= 4;
  console.log(
    JSON.stringify({
      passed: report.passed,
      calls: report.calls.map((x) => ({ kind: x.kind, ms: x.ms })),
      posts: report.posts.total,
      receipts: report.receipts.length,
    }),
  );
} catch (e) {
  report.passed = false;
  report.error = e.message;
  console.error(e);
  process.exitCode = 1;
} finally {
  await app?.close();
  writeFileSync(out + '/result.json', JSON.stringify(report, null, 2));
}
