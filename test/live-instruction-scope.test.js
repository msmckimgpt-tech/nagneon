import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { broadcastChatSchema } from '../server/broadcast-chat.js';
import { OpenAIProvider, format } from '../server/provider.js';
import { CodexProvider } from '../server/codex-provider.js';
import { OllamaProvider } from '../server/ollama-provider.js';
import { Observation, Settings } from '../server/schema.js';
import { defaults } from '../shared/defaults.js';

const args = (extra = {}) => ({
  settings: Settings.parse({ ...defaults, mode: 'live' }),
  speech: '합성 상황',
  ...extra,
});
const response = {
  game: '합성 게임',
  scene: '합성 장면',
  confidence: 0.5,
  excitement: 0.3,
  messages: [],
};
const text = (schema) => schema.properties.messages.items.properties.text;

test('live writing annotation preserves every hosted and local validation rule and shared schema', () => {
  for (const original of [format.schema, z.toJSONSchema(Observation)]) {
    const before = structuredClone(original);
    const live = broadcastChatSchema(original);
    assert.match(text(live).description, /No commas/);
    assert.match(text(live).description, /factual answer/);
    const validation = structuredClone(live);
    delete text(validation).description;
    assert.deepEqual(validation, before);
    assert.deepEqual(original, before);
    assert.equal(text(live).maxLength, 240);
  }
});

test('live followed by special, offstream, culture and replaced debug calls does not leak short-chat constraints', () => {
  const provider = new OpenAIProvider();
  const live = provider.payload(args());
  assert.ok(text(live.text.format.schema).description);
  for (const extra of [
    { special: { kind: 'interview' } },
    { special: { kind: 'contract' } },
    { special: { kind: 'social-daily', automatic: true } },
    { offStream: true },
    { cultureSource: { excerpt: 'synthetic public source' } },
    { debugPrompt: { enabled: true, mode: 'replace', prompt: 'custom output contract' } },
  ]) {
    const payload = provider.payload(args(extra));
    assert.equal(payload.text.format, format);
    if (extra.debugPrompt) assert.equal(payload.instructions, 'custom output contract');
  }
  assert.deepEqual(provider.payload(args()).text.format.schema, live.text.format.schema);
});

test('Codex serializes the request-selected schema for live and special calls', async () => {
  const seen = [];
  const provider = new CodexProvider({}, (_bin, command) => {
    seen.push(JSON.parse(readFileSync(command[command.indexOf('--output-schema') + 1], 'utf8')));
    const output = command[command.indexOf('--output-last-message') + 1];
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin.resume();
    child.stdin.on('finish', () => {
      writeFileSync(output, JSON.stringify(response));
      child.stdout.write(JSON.stringify({ type: 'turn.completed', usage: {} }) + '\n');
      child.emit('close', 0);
    });
    return child;
  });
  provider.available = true;
  for (const extra of [{}, { special: { kind: 'interview' } }, { offStream: true }]) {
    const request = args(extra);
    const expected = provider.payload(request).text.format.schema;
    await provider.react(request, new AbortController().signal);
    assert.deepEqual(seen.at(-1), expected);
  }
  assert.ok(text(seen[0]).description);
  assert.equal(text(seen[1]).description, undefined);
  assert.equal(text(seen[2]).description, undefined);
});

test('local generation uses the scoped annotation without relaxing UUID or length bounds', async () => {
  const seen = [];
  const provider = new OllamaProvider({ OLLAMA_MODEL: 'fixture' });
  provider.check = async () => {
    provider.available = true;
  };
  provider.localRequest = async (_path, body) => {
    seen.push(body.format);
    return { done: true, message: { content: JSON.stringify(response) } };
  };
  await provider.react(args());
  await provider.react(args({ special: { kind: 'interview' } }));
  assert.ok(text(seen[0]).description);
  assert.equal(text(seen[1]).description, undefined);
  for (const schema of seen) {
    assert.equal(text(schema).maxLength, 240);
    assert.equal(schema.properties.messages.items.properties.replyTo.anyOf[0].format, 'uuid');
    assert.equal(schema.properties.confidence.maximum, 1);
  }
});
