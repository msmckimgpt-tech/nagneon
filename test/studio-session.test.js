import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createStudioSession } = createRequire(import.meta.url)('../desktop/session.cjs');

test('persistent device identity keeps authorization limited to the current process origin', () => {
  const sessions = [],
    requests = [];
  const session = {
    fromPartition: (name, options) => {
      sessions.push({ name, options });
      return {
        webRequest: {
          onBeforeSendHeaders: (filter, handler) => requests.push({ filter, handler }),
        },
      };
    },
  };
  createStudioSession(session, { url: 'http://127.0.0.1:49321', accessToken: 'process-one' });
  createStudioSession(session, { url: 'http://127.0.0.1:49321', accessToken: 'process-two' });
  assert.equal(sessions[0].name, sessions[1].name);
  assert.match(sessions[0].name, /^persist:/);
  assert.equal(sessions[0].options.cache, false);
  assert.deepEqual(requests[1].filter.urls, ['http://127.0.0.1:49321/*']);
  const original = {
    authorization: 'stale',
    AUTHORIZATION: 'other',
    'Content-Type': 'application/json',
  };
  let result;
  requests[1].handler({ requestHeaders: original }, (value) => {
    result = value;
  });
  assert.deepEqual(result.requestHeaders, {
    'Content-Type': 'application/json',
    Authorization: 'Bearer process-two',
  });
  assert.equal(original.authorization, 'stale');
});
