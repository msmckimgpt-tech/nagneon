import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/CommunityFact.tsx', import.meta.url))],
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
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(
  require,
  module,
  module.exports,
);
const { CommunityFact, CommunityFactInputStatus, communityFactState } = module.exports;
const at = Date.UTC(2026, 9, 1, 2);
const source = 'https://store.steampowered.com/news/app/570/view/123';
const fact = (patch = {}) => ({
  id: 'synthetic-example',
  evidenceKind: 'official-api',
  sourceUrl: source,
  headline: '검증용 합성 제목',
  publishedAt: at - 3600000,
  observedAt: at - 300000,
  expiresAt: at + 3600000,
  tags: ['합성게임'],
  metrics: [],
  ...patch,
});
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
test('missing, disconnected, synthetic and empty connections never imply current trends', () => {
  for (const input of [
    undefined,
    { connection: 'disconnected', activeFacts: 0 },
    { connection: 'connected', activeFacts: 0 },
    { connection: 'connected', activeFacts: 1 },
  ]) {
    const html = render(CommunityFactInputStatus, { input });
    assert.match(html, /최신 소식은 확인하지 않았어요/);
    assert.doesNotMatch(html, /현재 인기|최신화제|실시간 화제/);
  }
  assert.match(
    render(CommunityFactInputStatus, { input: { connection: 'synthetic', activeFacts: 1 } }),
    /실제 최신 소식이 아니에요/,
  );
});
test('a stale connection count cannot advertise valid evidence after its deadline', () => {
  const input = { connection: 'connected', activeFacts: 1, validUntil: at + 1 };
  assert.match(render(CommunityFactInputStatus, { input, now: at }), /관측한 근거가 있어요/);
  assert.match(
    render(CommunityFactInputStatus, { input, now: at + 1 }),
    /최신 소식은 확인하지 않았어요/,
  );
});
test('detail shows source and all times; missing popularity remains unobserved', () => {
  const post = { externalFact: fact(), externalFactStatus: 'observed' };
  const html = render(CommunityFact, { post, now: at });
  assert.ok(html.includes(source));
  for (const label of ['게시', '관측', '만료', '이슈 화제 규모: 미관측', '가상 인물의 개인 의견'])
    assert.ok(html.includes(label));
  assert.equal((html.match(/<time /g) || []).length, 3);
});
test('game audience is displayed with game scope and cannot become issue popularity', () => {
  const metrics = [
    {
      kind: 'concurrent-players',
      scope: 'game',
      value: 50000,
      observedAt: at - 300000,
      sourceUrl:
        'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=570',
    },
  ];
  const html = render(CommunityFact, { post: { externalFact: fact({ metrics }) }, now: at });
  assert.match(html, /게임 동접 50,000/);
  assert.match(html, /게임 범위/);
  assert.match(html, /지표 출처/);
  assert.match(html, /이슈 화제 규모: 미관측/);
});
test('expired facts stay visible as historical provenance even if server status says observed', () => {
  const post = { externalFact: fact({ expiresAt: at }), externalFactStatus: 'observed' };
  assert.equal(communityFactState(post, at), 'expired');
  const html = render(CommunityFact, { post, now: at });
  assert.match(html, /유효기간이 지난 근거/);
  assert.match(html, /현재 화제로 사용하지 않아요/);
  assert.equal(render(CommunityFact, { post, compact: true, now: at }).includes('<a '), false);
});
test('synthetic metrics are labeled and malformed source/time cannot look verified', () => {
  assert.match(
    render(CommunityFact, { post: { externalFact: fact({ evidenceKind: 'synthetic' }) }, now: at }),
    /합성 입력/,
  );
  for (const patch of [
    { sourceUrl: 'javascript:alert(1)' },
    { observedAt: at + 1 },
    { expiresAt: NaN },
  ]) {
    const post = { externalFact: fact(patch), externalFactStatus: 'observed' };
    assert.equal(communityFactState(post, at), 'unverified');
    const html = render(CommunityFact, { post, now: at });
    assert.ok(!html.includes('<a '));
    assert.match(html, /근거를 확인할 수 없어/);
  }
  const escaped = render(CommunityFact, {
    post: { externalFact: fact({ headline: '<script>synthetic</script>' }) },
    now: at,
  });
  assert.ok(!escaped.includes('<script>'));
});
test('outside community integrates connection, list and detail provenance surfaces', () => {
  const text = readFileSync(new URL('../src/CommunitySpace.tsx', import.meta.url), 'utf8');
  assert.match(text, /<CommunityFactInputStatus input=/);
  assert.match(text, /<CommunityFact post=\{selected\}/);
  assert.match(text, /<CommunityFact post=\{post\} compact/);
});
