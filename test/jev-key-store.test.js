import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JevKeyStore } from '../desktop/jev-key-store.cjs';
import { DecisionAssistant, defaultDecisionConfig } from '../server/decision/assistant.js';

const key = 'synthetic-secret-never-log';
const fakeStorage = () => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (text) => Buffer.from(text).map((byte) => byte ^ 0xa5),
  decryptString: (bytes) =>
    Buffer.from(bytes)
      .map((byte) => byte ^ 0xa5)
      .toString(),
});
const fixture = (t, storage = fakeStorage(), platform = 'darwin') => {
  const dir = mkdtempSync(join(tmpdir(), 'jev-key-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'secrets', 'jev-key.bin');
  return { file, make: () => new JevKeyStore({ file, safeStorage: storage, platform }) };
};
const assistant = (keyStore, provider = 'typesafe') =>
  new DecisionAssistant({
    aiControl: { allowed: () => false },
    config: { ...structuredClone(defaultDecisionConfig), provider },
    keyStore,
  });

test('desktop key survives a new assistant from encrypted profile bytes without claiming a successful probe', async (t) => {
  const { file, make } = fixture(t);
  const first = assistant(make());
  const saved = first.setKey(key);
  assert.equal(saved.keyStorage, 'saved');
  assert.equal(saved.configured, true);
  assert.equal(readFileSync(file).includes(key), false);
  await first.close();
  const second = assistant(make());
  const restored = second.snapshot();
  assert.equal(restored.configured, true);
  assert.equal(restored.keyStorage, 'saved');
  assert.equal(restored.probe, null);
  assert.equal(JSON.stringify(restored).includes(key), false);
  await second.close();
});

test('provider switch removes the old encrypted key before saving the new provider', async (t) => {
  const { file, make } = fixture(t);
  const first = assistant(make());
  first.setKey(key);
  const switched = first.configure({
    ...structuredClone(defaultDecisionConfig),
    provider: 'openrouter',
  });
  assert.equal(switched.configured, false);
  assert.equal(existsSync(file), false);
  await first.close();
  const second = assistant(make(), 'openrouter');
  assert.equal(second.snapshot().configured, false);
  assert.equal(second.snapshot().keyStorage, 'none');
  await second.close();
});

test('removing key deletes encrypted bytes and restart cannot restore it', async (t) => {
  const { file, make } = fixture(t);
  const first = assistant(make());
  first.setKey(key);
  assert.equal(first.setKey('').configured, false);
  assert.equal(existsSync(file), false);
  await first.close();
  const second = assistant(make());
  assert.equal(second.snapshot().configured, false);
  await second.close();
});

test('failed encryption cannot replace the previous saved key or claim a new key was saved', async (t) => {
  const storage = fakeStorage();
  const { file, make } = fixture(t, storage);
  const first = assistant(make());
  first.setKey(key);
  const prior = readFileSync(file);
  storage.encryptString = () => {
    throw Error('upstream secret detail');
  };
  assert.throws(() => first.setKey('replacement-secret'), /JEV/);
  assert.deepEqual(readFileSync(file), prior);
  assert.equal(JSON.stringify(first.snapshot()).includes('upstream secret detail'), false);
  await first.close();
  storage.encryptString = fakeStorage().encryptString;
  const second = assistant(make());
  assert.equal(second.snapshot().configured, true);
  await second.close();
});

test('unavailable encryption only keeps a new key for the current session and clears stale ciphertext', async (t) => {
  const storage = fakeStorage();
  const { file, make } = fixture(t, storage);
  const first = assistant(make());
  first.setKey(key);
  await first.close();
  storage.isEncryptionAvailable = () => false;
  const second = assistant(make());
  assert.equal(second.snapshot().configured, false);
  const session = second.setKey('session-secret');
  assert.equal(session.keyStorage, 'session');
  assert.equal(session.configured, true);
  assert.match(session.keyStorageError, /저장/);
  assert.equal(existsSync(file), false);
  await second.close();
  storage.isEncryptionAvailable = () => true;
  const third = assistant(make());
  assert.equal(third.snapshot().configured, false);
  await third.close();
});

test('Linux basic_text and corrupt ciphertext cannot be treated as restored keys', async (t) => {
  const storage = fakeStorage();
  const { file, make } = fixture(t, storage, 'linux');
  const first = assistant(make());
  first.setKey(key);
  await first.close();
  writeFileSync(file, Buffer.from('damaged ciphertext'));
  const damaged = assistant(make());
  assert.equal(damaged.snapshot().configured, false);
  assert.match(damaged.snapshot().keyStorageError, /복원/);
  assert.equal(JSON.stringify(damaged.snapshot()).includes(key), false);
  await damaged.close();
  storage.getSelectedStorageBackend = () => 'basic_text';
  const unsafe = assistant(make());
  assert.equal(unsafe.setKey('session-only').keyStorage, 'session');
  assert.equal(existsSync(file), false);
  await unsafe.close();
});

test('a retained key that cannot be decrypted can still be removed before encryption returns', async (t) => {
  const storage = fakeStorage();
  const { file, make } = fixture(t, storage);
  const first = assistant(make());
  first.setKey(key);
  await first.close();
  storage.isEncryptionAvailable = () => false;
  const failed = assistant(make());
  assert.equal(failed.snapshot().configured, false);
  assert.equal(failed.snapshot().storedKeyPresent, true);
  assert.match(failed.snapshot().keyStorageError, /복원/);
  assert.equal(failed.setKey('').storedKeyPresent, false);
  assert.equal(existsSync(file), false);
  await failed.close();
  storage.isEncryptionAvailable = () => true;
  const next = assistant(make());
  assert.equal(next.snapshot().configured, false);
  await next.close();
});
