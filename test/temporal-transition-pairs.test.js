import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TemporalFrames } from '../src/temporal-frames.ts';
import { Frame } from '../server/schema.js';
import { Studio } from '../server/studio.js';
import { Audience } from '../server/audience.js';
import { OpenAIProvider } from '../server/provider.js';
import { defaults } from '../shared/defaults.js';
import { VIDEO_MAX_FRAMES, VIDEO_SAMPLE_MS, VIDEO_WINDOW_MS } from '../shared/temporal-policy.js';

const base = 100000;
const image = (index) =>
  'data:image/png;base64,' + Buffer.from('synthetic-frame-' + index).toString('base64');
const at = (index) => base + index * VIDEO_SAMPLE_MS;
function capture(
  changes = new Map([
    [5, 0.9],
    [23, 0.8],
  ]),
  sessionId = randomUUID(),
) {
  const ring = new TemporalFrames();
  ring.reset(sessionId, randomUUID());
  for (let index = 0; index <= 32; index++)
    ring.add(image(index), at(index), changes.get(index) ?? 0.001);
  return ring;
}
function assertPair(frames, transition) {
  assert.ok(
    frames.some((frame) => frame.at === at(transition - 1)),
    'missing predecessor for transition ' + transition,
  );
  assert.ok(
    frames.some((frame) => frame.at === at(transition)),
    'missing changed image for transition ' + transition,
  );
}
function assertBudget(frames) {
  assert.equal(frames.length, VIDEO_MAX_FRAMES);
  assert.equal(frames[0].at, base);
  assert.equal(frames.at(-1).at, base + VIDEO_WINDOW_MS);
  assert.equal(new Set(frames.map((frame) => frame.at)).size, frames.length);
  for (let index = 1; index < frames.length; index++)
    assert.ok(frames[index].at > frames[index - 1].at);
  for (const frame of frames) assert.equal(frame.image, image((frame.at - base) / VIDEO_SAMPLE_MS));
}

test('two priority changes survive in a busy sixteen-second window instead of only the first pair', () => {
  const ring = capture();
  assert.equal(ring.samples.length, 33);
  const window = ring.window(base + VIDEO_WINDOW_MS);
  assertBudget(window.frames);
  assertPair(window.frames, 5);
  assertPair(window.frames, 23);
});

test('priority pairs fit the same budget at all distinct positions, including overlaps and endpoints', () => {
  for (let first = 1; first <= 32; first++) {
    for (let second = 1; second <= 32; second++) {
      if (first === second) continue;
      const ring = capture(
        new Map([
          [first, 0.9],
          [second, 0.8],
        ]),
      );
      const window = ring.window(base + VIDEO_WINDOW_MS);
      assertBudget(window.frames);
      assertPair(window.frames, first);
      assertPair(window.frames, second);
    }
  }
});

test('equal change scores retain chronological priority and quiet input keeps endpoints and gaps', () => {
  const tied = capture(
    new Map([
      [5, 0.8],
      [8, 0.8],
      [23, 0.8],
    ]),
  ).window(base + VIDEO_WINDOW_MS);
  assertBudget(tied.frames);
  assertPair(tied.frames, 5);
  assertPair(tied.frames, 8);
  const quiet = capture(new Map()).window(base + VIDEO_WINDOW_MS);
  assertBudget(quiet.frames);
});

function studioFixture(t) {
  let now = base;
  const requests = [];
  const payloads = [];
  const preparer = new OpenAIProvider(
    { OPENAI_MODEL: 'synthetic-frame-preparation', OPENAI_REASONING_EFFORT: 'low' },
    () => assert.fail('Request preparation must not call any external provider'),
  );
  const studio = new Studio({
    settings: { ...defaults, mode: 'live', intervalSeconds: 5, lurkRatio: 0, slowModeSeconds: 0 },
    audience: new Audience(
      undefined,
      () => {},
      () => 0.5,
    ),
    random: () => 0.5,
    now: () => now,
    provider: {
      status: () => ({ configured: true, kind: 'fixture' }),
      react: async (args) => {
        requests.push(args);
        payloads.push(preparer.payload(args));
        return {
          observation: {
            game: 'Synthetic',
            scene: '합성 화면 변화',
            confidence: 0.8,
            excitement: 0,
            messages: [],
          },
        };
      },
    },
  });
  clearInterval(studio.timer);
  studio.start();
  t.after(() => studio.close());
  return {
    studio,
    requests,
    payloads,
    setNow: (value) => {
      now = value;
    },
  };
}

function preparedImages(payload) {
  return payload.input[0].content
    .filter((part) => part.type === 'input_image')
    .map((part) => part.image_url);
}

test('Studio and actual payload preparation preserve both pairs in one ordered model request', async (t) => {
  const fixture = studioFixture(t);
  const ring = capture(undefined, fixture.studio.sessionId);
  fixture.setNow(base + VIDEO_WINDOW_MS);
  const window = ring.window(base + VIDEO_WINDOW_MS);
  const result = await fixture.studio.react(Frame.parse({ video: window }));
  assert.equal(result.ok, true);
  assert.equal(fixture.requests.length, 1);
  assertBudget(fixture.requests[0].frames);
  assertPair(fixture.requests[0].frames, 5);
  assertPair(fixture.requests[0].frames, 23);
  assert.deepEqual(
    preparedImages(fixture.payloads[0]),
    window.frames.map((frame) => frame.image),
  );
  const data = JSON.parse(fixture.payloads[0].input[0].content[0].text);
  assert.deepEqual(
    data.screenTimeline.frames.map((frame) => frame.capturedAt),
    window.frames.map((frame) => frame.at),
  );
  assert.deepEqual(
    data.screenTimeline.frames.map((frame) => frame.index),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  ring.acknowledge(window);
  assert.equal(ring.through, at(32));
});

test('priority selection cannot expose pre-entry images to a viewer arriving between the changes', async (t) => {
  const fixture = studioFixture(t);
  const ring = capture(undefined, fixture.studio.sessionId);
  fixture.setNow(at(21) + 250);
  fixture.studio.audience.setPresence('new', 'away', at(21));
  fixture.studio.audience.setPresence('new', 'active', at(21) + 250);
  fixture.setNow(base + VIDEO_WINDOW_MS);
  const result = await fixture.studio.react(
    Frame.parse({ video: ring.window(base + VIDEO_WINDOW_MS) }),
  );
  assert.equal(result.ok, true);
  assert.equal(fixture.requests.length, 1);
  const delivered = fixture.requests[0].frames;
  assert.ok(delivered.every((frame) => frame.at >= at(21) + 250));
  assertPair(delivered, 23);
  assert.equal(
    delivered.some((frame) => frame.at === at(5)),
    false,
  );
  assert.deepEqual(
    preparedImages(fixture.payloads[0]),
    delivered.map((frame) => frame.image),
  );
});
