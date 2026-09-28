// Synthetic style comparison through the already selected official subscription
// model. No native profile, device, user conversation or production state is read.
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { CodexProvider } from '../server/codex-provider.js';
import { format } from '../server/provider.js';
import { broadcastChatInstructions } from '../server/broadcast-chat.js';
import { communityWritingInstructions } from '../server/community-writing.js';
import { Studio } from '../server/studio.js';
import { defaults } from '../shared/defaults.js';

const option = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const model = option('model'),
  effort = option('effort'),
  ref = option('baseline');
if (!model || !effort || !ref)
  throw Error(
    'Specify --model, --effort and --baseline from verified settings/source. No automatic fallback.',
  );
const base = resolve(option('out') || `artifacts/broadcast-behavior-${Date.now()}`);
await mkdir(base, { recursive: true });
for (const file of ['broadcast-chat', 'community-writing']) {
  const contents = execFileSync('git', ['show', `${ref}:server/${file}.js`], {
    encoding: 'utf8',
    windowsHide: true,
  });
  await writeFile(join(base, `baseline-${file}.mjs`), contents);
}
const prior = await import(pathToFileURL(join(base, 'baseline-broadcast-chat.mjs')));
const priorCommunity = await import(pathToFileURL(join(base, 'baseline-community-writing.mjs')));
const provider = new CodexProvider({
  ...process.env,
  OPENAI_MODEL: model,
  OPENAI_REASONING_EFFORT: effort,
});
const currentSchema = structuredClone(format.schema),
  oldSchema = structuredClone(format.schema);
delete oldSchema.properties.messages.items.properties.intent;
delete oldSchema.properties.messages.items.properties.donationFollowup;
oldSchema.properties.messages.items.required = oldSchema.properties.messages.items.required.filter(
  (k) => !['intent', 'donationFollowup'].includes(k),
);
const scenarios = [
  {
    id: 'shared-joke',
    history: [
      ['streamer', '이 좁은 길은 눈 감고도 건너겠다.'],
      ['streamer', '어 떨어졌네.'],
    ],
    speech: '길이 나를 밀었다니까ㅋㅋ',
  },
  {
    id: 'stable-taste',
    history: [['pop', '나는 작고 수수한 방패가 좋아.']],
    speech: '팝콘도둑, 저 화려한 큰 방패가 더 마음에 들지 않아?',
  },
  {
    id: 'clear-boundary',
    history: [['pop', '지도는 보고 길 잃은 거 맞지ㅋㅋ']],
    speech: '길 잃은 얘기는 이제 그만 해. 설명 좀 읽을게.',
  },
  {
    id: 'community',
    history: [],
    speech: '',
    special: {
      kind: 'gallery-comment',
      post: {
        id: '11111111-1111-4111-8111-111111111111',
        title: '방패는 작을수록 편한 듯',
        text: '큰 방패 들면 앞이 안 보여서 작은 걸로 바꿈.',
        comments: [],
      },
      instruction: '읽은 글에 짧게 댓글을 남기거나 조용히 읽는다. 반드시 댓글을 달 필요는 없다.',
    },
  },
];
const report = {
  base,
  model,
  effort,
  baseline: ref,
  synthetic: true,
  devices: false,
  userData: false,
  schemaCompatibility:
    'Baseline variants use the old message schema; all other code and inputs are fixed.',
  naturalness: 'NOT_TESTED_BY_USERS',
  results: [],
};
const originalPayload = provider.payload.bind(provider);
try {
  await provider.check();
  if (!provider.status().configured) throw Error(provider.status().authMessage);
  for (const scenario of scenarios) {
    let at = Date.now() - 120000,
      captured;
    const studio = new Studio({
      settings: {
        ...defaults,
        mode: 'live',
        category: 'just-chatting',
        lurkRatio: 0,
        chatPace: 3,
        pointsEnabled: false,
      },
      now: () => at,
      random: () => 0.5,
      provider: {
        status: () => ({ configured: true }),
        react: async (args) => {
          captured = structuredClone(
            Object.fromEntries(
              Object.entries(args).filter(([, value]) => typeof value !== 'function'),
            ),
          );
          return {
            observation: { game: '', scene: '', confidence: 0, excitement: 0, messages: [] },
          };
        },
      },
    });
    clearInterval(studio.timer);
    studio.start();
    for (const [id, text] of scenario.history) {
      at += 3000;
      studio.addMessage(id, text, id === 'streamer' ? 'streamer' : 'chat');
    }
    at += 6000;
    try {
      await studio.react({ speech: scenario.speech || '게시글을 읽는다' });
      // Community uses its own request shape, without live viewerContext or
      // ambient candidates. Keep the same one reader in all three variants.
      if (scenario.special)
        captured = {
          offStream: true,
          speech: '',
          special: scenario.special,
          history: [],
          previous: null,
          settings: {
            ...defaults,
            mode: 'live',
            chatPace: 3,
            webSearch: false,
            personas: defaults.personas.filter((p) => p.id === 'pop'),
          },
        };
    } finally {
      studio.close();
    }
    for (const variant of ['baseline', 'casual-only', 'behavior']) {
      format.schema = variant === 'behavior' ? currentSchema : oldSchema;
      provider.payload = (args) => {
        const payload = originalPayload(args);
        if (variant !== 'behavior') {
          payload.instructions = payload.instructions.replace(
            broadcastChatInstructions,
            prior.broadcastChatInstructions,
          );
          const current = communityWritingInstructions(args.special, args.settings.personas);
          if (current)
            payload.instructions = payload.instructions.replace(
              current,
              priorCommunity.communityWritingInstructions(args.special, args.settings.personas),
            );
          if (variant === 'casual-only')
            payload.instructions +=
              '\n이번 비교에서는 짧고 편한 반말을 사용한다. 응답 내용과 역할은 기존 지침을 따른다.';
        }
        return payload;
      };
      const payload = provider.payload(captured);
      const began = Date.now();
      const result = await provider.react(captured, new AbortController().signal);
      const entry = {
        scenario: scenario.id,
        variant,
        ms: Date.now() - began,
        usage: result.usage,
        promptBytes: Buffer.byteLength(payload.instructions + JSON.stringify(payload.input)),
        inputSha256: createHash('sha256').update(JSON.stringify(captured)).digest('hex'),
        observation: result.observation,
        validSpeakers: result.observation.messages.every((m) =>
          captured.settings.personas.some((p) => p.id === m.personaId),
        ),
      };
      report.results.push(entry);
      await writeFile(join(base, 'result.json'), JSON.stringify(report, null, 2));
      console.log(
        JSON.stringify({
          scenario: entry.scenario,
          variant,
          ms: entry.ms,
          messages: entry.observation.messages,
        }),
      );
    }
  }
  report.completed = true;
} catch (error) {
  report.completed = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  format.schema = currentSchema;
  await writeFile(join(base, 'result.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      completed: report.completed,
      results: report.results.length,
      base,
      error: report.error,
    }),
  );
}
