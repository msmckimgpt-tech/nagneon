import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer } from '../server/index.js';

test('authenticated settings, background analysis, restart and source removal preserve profile data', async t => {
  const folder = await mkdtemp(resolve('artifacts/culture-runtime-'));
  let calls = 0, service;
  const provider = { status: () => ({ configured: true }), react: async args => {
    calls++; assert.ok(args.cultureSource); assert.equal(args.settings.webSearch, false);
    return { observation: { cultureAnalysis: { tendencies: '합성 게임 문화', patterns: [] }, messages: [] }, usage: { total_tokens: 10 } };
  } };
  const options = { port: 0, dataDir: folder, provider, localSpeech: false };
  t.after(async () => { await service?.close(); });
  service = await startServer(options);
  const put = async body => {
    const response = await fetch(service.url + '/api/settings', { method: 'PUT', headers: { Authorization: 'Bearer ' + service.accessToken, 'Content-Type': 'application/json', 'X-Backseat-Client': 'studio' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, await response.text());
  };
  assert.equal(service.studio.settings.memesEnabled, true);
  const original = service.studio.economy.data.balance;
  const { personas, ...settings } = service.studio.state().settings;
  await put({ ...settings, mode: 'live', cultureDomains: ['community.example.org'] });
  assert.equal(service.studio.culture.data.sources[0].origin, 'https://community.example.org');
  const s = service.studio; clearInterval(s.timer);
  s.now = () => Date.now() + 120000;
  s.culture.collect = async () => ({ digest: 'fixture', documents: [{ url: 'https://community.example.org/', text: 'synthetic culture material' }] });
  s.culture.tick(); await s.culture.active?.promise;
  assert.equal(calls, 1); assert.equal(s.state().culture.sources[0].analyzedAt, s.culture.data.sources[0].analyzedAt);
  const stored = JSON.parse(await readFile(resolve(folder, 'culture-learning.json'), 'utf8'));
  assert.equal(stored.sources[0].analysis.tendencies, '합성 게임 문화');
  assert.ok(!JSON.stringify(stored).includes('synthetic culture material'));
  await service.close(); service = await startServer(options);
  assert.equal(service.studio.culture.data.sources[0].analysis.tendencies, '합성 게임 문화');
  assert.equal(service.studio.economy.data.balance, original);
  await put({ ...service.studio.settings, cultureDomains: [], memesEnabled: false });
  assert.equal(service.studio.culture.data.sources.length, 0);
  assert.deepEqual(service.studio.culture.context([]), { enabled: false });
});

test('server close aborts and drains an owned background collector', async t => {
  const service = await startServer({ port: 0, persist: false, localSpeech: false, provider: { status: () => ({ configured: true }) } });
  t.after(() => service.close());
  const s = service.studio; clearInterval(s.timer);
  s.settings.mode = 'live'; s.settings.cultureDomains = ['https://community.example.org'];
  s.culture.sync(); s.now = () => Date.now() + 120000;
  let canceled = false;
  s.culture.collect = (_origin, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => { canceled = true; reject(signal.reason); }, { once: true }));
  s.culture.tick(); assert.ok(s.culture.active); await service.close();
  assert.equal(canceled, true); assert.equal(s.culture.active, null); assert.equal(s.culture.data.sources[0].analysis, null);
});
