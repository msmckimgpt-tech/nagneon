import test from 'node:test';
import assert from 'node:assert/strict';
import { distributionComponents } from '../scripts/lib/distribution-components.mjs';
const file = (path, bytes = 10) => ({ path, bytes, sha256: 'a'.repeat(64) });

test('distribution partitions every file exactly once with stable reusable content identities', () => {
  const input = ['Nagneon.exe','resources/app.asar','resources/codex/bin/codex.exe','resources/speech/speech_worker.py','resources/speech/python/python.exe','resources/speech/model/model.bin','resources/sound/model/yamnet.onnx','resources/speech/microphone-model/model.bin','resources/speech/gpu/nvidia/cudnn/bin/cudnn64_9.dll'].map(p => file(p));
  const result = distributionComponents(input);
  assert.deepEqual(distributionComponents([...input].reverse()), result);
  assert.equal(result.reduce((n, c) => n + c.bytes, 0), 90);
  assert.equal(new Set(result.flatMap(c => c.files.map(f => f.path))).size, input.length);
  assert.deepEqual(result.map(c => c.files.length), [4,1,2,1,1]);
  const updated = distributionComponents(input.map(f => f.path === 'resources/app.asar' ? { ...f, sha256: 'b'.repeat(64) } : f));
  assert.notEqual(updated[0].contentId, result[0].contentId);
  assert.deepEqual(updated.slice(1), result.slice(1));
  const changedModel = distributionComponents(input.map(f => f.path.includes('microphone-model/') ? { ...f, bytes: 11 } : f));
  assert.notEqual(changedModel[3].contentId, result[3].contentId);

});

test('distribution rejects ambiguous, traversing and unverifiable file inventories', () => {
  for (const path of ['/absolute','../escape','a/../escape','a//b','a\\b','C:/file','a\u0000b']) assert.throws(() => distributionComponents([file(path)]), /path/);
  assert.throws(() => distributionComponents([file('FILE'),file('file')]), /Duplicate/);
  for (const value of [{...file('x'),bytes:-1},{...file('x'),bytes:1.2},{...file('x'),sha256:'unknown'}]) assert.throws(() => distributionComponents([value]), /integrity/);
});
