import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { startServer } from '../server/index.js';

const require = createRequire(import.meta.url);
async function component(path) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false,
    loader: { '.css': 'empty' },
    jsx: 'automatic',
    logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    require,
    module,
    module.exports,
  );
  return module.exports;
}
const preferences = {
  enabled: true,
  arrivalsEnabled: false,
  creativeImages: false,
  notifications: false,
  mutedCommunities: ['one'],
  mutedTopics: ['topic-b'],
  bookmarks: ['kept'],
  hiddenThreads: ['hidden'],
};
const communities = [
  {
    id: 'one',
    name: '작은 탐험방',
    description: '각자의 발견을 나누는 공간',
    topics: [
      { id: 'topic-a', label: '작은 발견' },
      { id: 'topic-b', label: '궁금한 점' },
    ],
  },
];

test('community controls expose named switches, pressed topic chips and no operation checkboxes', async () => {
  const { CommunitySettings } = await component('../src/CommunitySettings.tsx');
  const html = renderToStaticMarkup(
    React.createElement(CommunitySettings, { preferences, communities, busy: false, onPatch() {} }),
  );
  assert.equal((html.match(/role="switch"/g) || []).length, 4);
  assert.equal((html.match(/aria-describedby=/g) || []).length, 4);
  assert.ok(html.includes('aria-pressed="true"'));
  assert.ok(html.includes('aria-pressed="false"'));
  assert.ok(!html.includes('type="checkbox"'));
  assert.ok(html.includes('자동활동을 꺼도 개별 설정은 유지'));
  assert.ok(html.includes('숨긴 글 다시 표시'));
});
test('busy settings disable all interactive writes without rewriting stored preferences', async () => {
  const { CommunitySettings } = await component('../src/CommunitySettings.tsx');
  const before = structuredClone(preferences);
  const html = renderToStaticMarkup(
    React.createElement(CommunitySettings, {
      preferences,
      communities,
      busy: true,
      onPatch() {
        throw Error('render cannot write');
      },
    }),
  );
  assert.ok(
    [...html.matchAll(/<button\b[^>]*>/g)].every(([button]) => button.includes('disabled=""')),
  );
  assert.deepEqual(preferences, before);
});
test('switch label stays identical on state changes and supports native button keyboard behaviour', async () => {
  const { CommunitySwitch } = await component('../src/CommunitySettings.tsx');
  const outputs = [false, true].map((checked) =>
    renderToStaticMarkup(
      React.createElement(CommunitySwitch, {
        label: '주민 자동활동',
        description: '활동 설명',
        checked,
        onChange() {},
      }),
    ),
  );
  for (const html of outputs) {
    assert.match(html, /^<button type="button" role="switch"/);
    assert.match(html, /<strong id="[^"]+">주민 자동활동<\/strong>/);
    assert.match(html, /aria-labelledby=/);
  }
  assert.ok(outputs[0].includes('aria-checked="false"'));
  assert.ok(outputs[1].includes('aria-checked="true"'));
});
test('streamer upload UI is absent while legacy attachments, recommendations and text replies remain', async () => {
  const { SocialDiscussion } = await component('../src/SocialDiscussion.tsx');
  const post = {
    id: 'thread',
    comments: [],
    recommendationCount: 1,
    recommended: false,
    attachments: [
      {
        id: 'old-image',
        name: '이전 이미지.png',
        kind: 'image',
        mime: 'image/png',
        bytes: 100,
        url: '/test.png',
        available: true,
      },
      {
        id: 'old-video',
        name: '주민 영상.webm',
        kind: 'video',
        mime: 'video/webm',
        bytes: 200,
        url: '/test.webm',
        available: true,
      },
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(SocialDiscussion, { post, onChanged() {}, onError() {} }),
  );
  assert.ok(!html.includes('type="file"'));
  assert.ok(!html.includes('social-upload'));
  assert.ok(html.includes('이전 이미지.png'));
  assert.ok(html.includes('<video'));
  assert.ok(html.includes('preload="metadata"'));
  assert.ok(!html.includes('autoPlay'));
  assert.ok(html.includes('<textarea'));
  assert.ok(html.includes('추천'));
});
test('public upload route rejects authenticated and forged resident uploads before body parsing, without mutation', async (t) => {
  let calls = 0;
  const service = await startServer({
    port: 0,
    persist: false,
    localSpeech: false,
    provider: {
      status: () => ({ configured: false }),
      react: async () => {
        calls++;
        throw Error('must not run');
      },
    },
  });
  t.after(() => service.close());
  clearInterval(service.studio.timer);
  const before = JSON.stringify(service.studio.world.data);
  const url = service.url + '/api/social/threads/not-a-real-thread/attachments';
  assert.equal(
    (await fetch(url, { method: 'POST', headers: { 'X-Backseat-Client': 'studio' }, body: 'x' }))
      .status,
    401,
  );
  for (const type of ['application/octet-stream', 'application/json', 'multipart/form-data']) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + service.accessToken,
        'X-Backseat-Client': 'studio',
        'X-Actor-Role': 'resident',
        'X-Resident-Id': 'forged',
        'Content-Type': type,
      },
      body: '{not even valid JSON',
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'resident-attachments-only');
  }
  assert.equal(JSON.stringify(service.studio.world.data), before);
  assert.equal(calls, 0);
});
