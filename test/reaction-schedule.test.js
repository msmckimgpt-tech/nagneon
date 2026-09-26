import test from 'node:test';
import assert from 'node:assert/strict';
import { startReactionSchedule } from '../src/reaction-schedule.ts';

const turn = () => new Promise((resolve) => setImmediate(resolve));
function fixture(t, { react = async () => ({ ok: true }), flushSpeech, pending = 0 } = {}) {
  let at = 100000,
    timer,
    nextPoll = Infinity,
    interval = 0,
    speech = pending;
  const state = {
    running: true,
    sessionId: 'session',
    busy: false,
    settings: { intervalSeconds: 5 },
  };
  const requests = [],
    results = [],
    deliveries = [],
    speechErrors = [],
    reactionErrors = [];
  const loop = startReactionSchedule(
    {
      sessionId: state.sessionId,
      current: () => state,
      flushSpeech: async (delivered) => {
        deliveries.push(at);
        if (flushSpeech) return flushSpeech(delivered);
        while (speech) {
          speech--;
          delivered();
        }
      },
      react: async (current) => {
        requests.push(at);
        return react(current);
      },
      onResult: (result) => results.push(result),
      onSpeechError: (error) => speechErrors.push(error),
      onReactionError: (error) => reactionErrors.push(error),
    },
    {
      now: () => at,
      schedule: (fn, ms) => {
        timer = fn;
        interval = ms;
        nextPoll = at + ms;
        return 1;
      },
      cancel: () => {
        nextPoll = Infinity;
      },
    },
  );
  t.after(() => loop.dispose());
  return {
    state,
    requests,
    results,
    deliveries,
    speechErrors,
    reactionErrors,
    loop,
    say: async () => {
      speech++;
      loop.wake();
      await turn();
    },
    advance: async (ms) => {
      const until = at + ms;
      while (nextPoll <= until) {
        at = nextPoll;
        nextPoll += interval;
        timer();
        await turn();
      }
      at = until;
      await turn();
    },
  };
}

test('polling starts a due reaction within 250ms without shortening the configured interval', async (t) => {
  const f = fixture(t);
  await turn();
  assert.deepEqual(f.requests, [100000]);
  await f.advance(4999);
  assert.deepEqual(f.requests, [100000]);
  await f.advance(1);
  assert.deepEqual(f.requests, [100000, 105000]);
  await f.advance(5000);
  assert.deepEqual(f.requests, [100000, 105000, 110000]);
});

test('newly delivered speech wakes immediately while successful cadence still limits idle requests', async (t) => {
  const f = fixture(t);
  await turn();
  await f.advance(10);
  await f.say();
  assert.deepEqual(f.requests, [100000, 100010]);
  await f.advance(4990);
  assert.deepEqual(f.requests, [100000, 100010]);
  await f.advance(250);
  assert.deepEqual(f.requests, [100000, 100010, 105250]);
});

test('pending unanswered speech and ambient deadlines cannot bypass skipped-reaction retry backoff', async (t) => {
  const f = fixture(t, { pending: 1, react: async () => ({ skipped: 'busy' }) });
  f.state.ambient = { nextConversationAt: 100000 };
  await turn();
  await f.advance(500);
  await f.say();
  await f.advance(999);
  assert.deepEqual(f.requests, [100000]);
  await f.advance(1);
  assert.deepEqual(f.requests, [100000, 101500]);
  await f.advance(1500);
  assert.deepEqual(f.requests, [100000, 101500, 103000]);
});

test('failed requests retain a 1500ms retry floor even with unanswered speech', async (t) => {
  const error = new Error('connection lost'),
    f = fixture(t, {
      pending: 1,
      react: async () => {
        throw error;
      },
    });
  await turn();
  await f.advance(1499);
  assert.deepEqual(f.requests, [100000]);
  assert.deepEqual(f.reactionErrors, [error]);
  await f.advance(1);
  assert.deepEqual(f.requests, [100000, 101500]);
});

test('speech delivery failures retain their retry floor while a new accepted delivery wakes the reaction', async (t) => {
  let attempts = 0;
  const error = new Error('speech connection lost');
  const f = fixture(t, {
    flushSpeech: async (delivered) => {
      if (++attempts === 1) throw error;
      if (attempts === 2) delivered();
    },
  });
  await turn();
  await f.advance(500);
  await f.say();
  await f.advance(999);
  assert.deepEqual(f.deliveries, [100000]);
  assert.deepEqual(f.speechErrors, [error]);
  assert.deepEqual(f.requests, [100000]);
  await f.advance(1);
  assert.deepEqual(f.deliveries, [100000, 101500]);
  assert.deepEqual(f.requests, [100000, 101500]);
});

test('a slow speech delivery cannot block due viewing or start an overlapping delivery', async (t) => {
  let release;
  const f = fixture(t, {
    flushSpeech: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await f.advance(500);
  assert.deepEqual(f.deliveries, [100000]);
  assert.deepEqual(f.requests, [100250]);
  release();
  await turn();
  assert.deepEqual(f.requests, [100250]);
});

test('each ambient deadline wakes within 250ms and is consumed once despite delayed state refresh', async (t) => {
  const f = fixture(t);
  await turn();
  f.state.ambient = { nextConversationAt: 100100 };
  await f.advance(250);
  assert.deepEqual(f.requests, [100000, 100250]);
  await f.advance(1000);
  assert.deepEqual(f.requests, [100000, 100250]);
  f.state.ambient.nextConversationAt = 101300;
  await f.advance(250);
  assert.deepEqual(f.requests, [100000, 100250, 101500]);
});

test('busy state blocks reactions while speech continues delivering and only one request can run', async (t) => {
  let release;
  const f = fixture(t, {
    react: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await turn();
  await f.advance(10);
  await f.say();
  await f.advance(2000);
  assert.deepEqual(f.requests, [100000]);
  release({ ok: true });
  await turn();
  f.state.busy = true;
  await f.advance(250);
  assert.deepEqual(f.requests, [100000]);
  f.state.busy = false;
  await f.advance(250);
  assert.deepEqual(f.requests, [100000, 102500]);
  release({ ok: true });
  await turn();
  await f.advance(250);
  assert.deepEqual(f.requests, [100000, 102500]);
});

test('successful interval is measured from request start rather than slow response completion', async (t) => {
  let release;
  const f = fixture(t, {
    react: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await turn();
  await f.advance(4000);
  release({ ok: true });
  await turn();
  await f.advance(999);
  assert.deepEqual(f.requests, [100000]);
  await f.advance(1);
  assert.deepEqual(f.requests, [100000, 105000]);
  release({ ok: true });
  await turn();
});

test('dispose suppresses late result callbacks and every future wake', async (t) => {
  let release;
  const f = fixture(t, {
    react: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await turn();
  f.loop.dispose();
  release({ ok: true });
  await turn();
  f.loop.wake();
  await f.advance(10000);
  assert.deepEqual(f.requests, [100000]);
  assert.deepEqual(f.results, []);
});

test('session replacement during delivery cannot launch a reaction for the old session', async (t) => {
  let release;
  const f = fixture(t, {
    flushSpeech: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  f.state.sessionId = 'new-session';
  release();
  await turn();
  await f.advance(10000);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.results, []);
});

test('session replacement suppresses late reaction errors', async (t) => {
  let reject;
  const f = fixture(t, {
    react: () =>
      new Promise((_resolve, rejectRequest) => {
        reject = rejectRequest;
      }),
  });
  await turn();
  f.state.sessionId = 'new-session';
  reject(new Error('late old failure'));
  await turn();
  await f.advance(10000);
  assert.deepEqual(f.requests, [100000]);
  assert.deepEqual(f.reactionErrors, []);
});
