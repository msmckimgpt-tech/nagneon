import test from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startServer } from '../server/index.js';
import { clipWindow } from '../server/clip-window.js';
import {
  artifactPath,
  unredirectedArtifactRoot,
} from '../scripts/lib/packaged-profile-reader-guards.mjs';

test('legacy and context clips stream video, voice and ranges from an owned hidden parent directory', async (t) => {
  const root = resolve('artifacts');
  unredirectedArtifactRoot(root);
  const folder = mkdtempSync(join(root, '.clip-context-media-'));
  const identity = lstatSync(folder);
  let service;
  t.after(async () => {
    await service?.close();
    unredirectedArtifactRoot(root);
    artifactPath(root, folder);
    assert.equal(realpathSync.native(folder), folder);
    const current = lstatSync(folder);
    assert.equal(current.isSymbolicLink(), false);
    assert.equal(current.dev, identity.dev);
    assert.equal(current.ino, identity.ino);
    assert.equal(current.birthtimeMs, identity.birthtimeMs);
    rmSync(folder, { recursive: true });
  });
  service = await startServer({
    port: 0,
    dataDir: join(folder, 'data'),
    localSpeech: false,
    provider: {
      status: () => ({ configured: false }),
      react: async () => {
        throw Error('Model forbidden');
      },
    },
  });
  const clips = service.studio.clips,
    at = Date.now();
  clips.now = () => at;
  // Only the HTTP file transport is under test; no decoder or physical input.
  const bytes = Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(124, 7)]);
  for (const context of [false, true]) {
    const clip = clips.create({
      title: '합성 전송 회귀',
      participants: [],
      messages: [],
      source: 'spectator',
      sessionId: 'synthetic',
      observedAt: at,
      ...(context ? { recordingWindow: clipWindow(at) } : {}),
    });
    const metadata = { startedAt: at - 1000, endedAt: at, hasAudio: true, audioLayout: 'separate' };
    clips.recording(clip.id, bytes, { ...metadata, kind: 'video' });
    clips.recording(clip.id, bytes, { ...metadata, kind: 'voice' });
    const original = structuredClone(clips.get(clip.id));
    for (const kind of ['video', 'voice']) {
      const url = service.url + '/api/clips/' + clip.id + '/media/' + kind;
      const headers = { Authorization: 'Bearer ' + service.accessToken };
      const response = await fetch(url, { headers });
      assert.equal(response.status, 200, context ? 'context clip media' : 'legacy clip media');
      assert.match(
        response.headers.get('content-type'),
        new RegExp(kind === 'voice' ? '^audio/webm' : '^video/webm'),
      );
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      const ranged = await fetch(url, { headers: { ...headers, Range: 'bytes=0-15' } });
      assert.equal(ranged.status, 206);
      assert.equal(ranged.headers.get('content-range'), 'bytes 0-15/' + bytes.length);
      assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), bytes.subarray(0, 16));
    }
    assert.deepEqual(
      clips.get(clip.id),
      original,
      'playback does not rewrite context or originals',
    );
  }
});
