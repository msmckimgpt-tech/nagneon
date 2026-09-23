import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

export const SPEECH_RAW_RETENTION_MS = 24 * 60 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const filename = /^(\d{8})-(\d{12})-(\d{8})\.pcm$/;
const number = (value) => Number.isSafeInteger(value) && value >= 0;
const key = (sessionId, inputEpoch) => {
  if (!uuid.test(sessionId) || !uuid.test(inputEpoch))
    throw new Error('원음 세션 식별자가 올바르지 않습니다.');
  return `${sessionId}/${inputEpoch}`;
};
const name = (sequence, startFrame, frameCount) =>
  `${String(sequence).padStart(8, '0')}-${String(startFrame).padStart(12, '0')}-${String(frameCount).padStart(8, '0')}.pcm`;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function wavHeader(bytes) {
  if (bytes > 0xffffffff - 36) throw new Error('원음 다운로드 크기가 WAV 한도를 넘었습니다.');
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  return header;
}

export class SpeechRecoveryStore {
  constructor(root, { now = () => Date.now() } = {}) {
    this.root = root;
    this.now = now;
    this.buckets = new Map();
    this.records = new Map();
    this.writes = new Map();
    this.lastSweep = 0;
  }
  folder(sessionId, inputEpoch) {
    key(sessionId, inputEpoch);
    return join(this.root, sessionId, inputEpoch);
  }
  async entries(sessionId, inputEpoch) {
    const bucket = key(sessionId, inputEpoch);
    if (this.records.has(bucket)) return this.records.get(bucket);
    const folder = this.folder(sessionId, inputEpoch),
      files = await readdir(folder).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    const result = [];
    for (const file of files) {
      const match = filename.exec(file);
      if (!match) continue;
      const path = join(folder, file),
        details = await stat(path).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
      if (details)
        result.push({
          file,
          path,
          sequence: Number(match[1]),
          startFrame: Number(match[2]),
          frameCount: Number(match[3]),
          bytes: details.size,
          createdAt: details.mtimeMs,
        });
    }
    result.sort((a, b) => a.sequence - b.sequence);
    this.records.set(bucket, result);
    return result;
  }
  async continuity(sessionId, inputEpoch, firstWrite) {
    const bucket = key(sessionId, inputEpoch);
    if (this.buckets.has(bucket)) return this.buckets.get(bucket);
    const entries = await this.entries(sessionId, inputEpoch),
      folder = this.folder(sessionId, inputEpoch);
    const existingFolder = await stat(folder)
      .then((details) => details.isDirectory())
      .catch((error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
    const first = entries[0];
    let nextSequence = first?.sequence ?? (existingFolder ? firstWrite.sequence : 1);
    let latestCapturedFrame = first?.startFrame ?? (existingFolder ? firstWrite.startFrame : 0);
    for (const entry of entries) {
      if (entry.sequence !== nextSequence || entry.startFrame !== latestCapturedFrame)
        throw new Error('보존된 마이크 원음 사이에 빈 구간이 있습니다.');
      nextSequence++;
      latestCapturedFrame += entry.frameCount;
    }
    const state = { nextSequence, latestCapturedFrame, durableThrough: latestCapturedFrame };
    this.buckets.set(bucket, state);
    return state;
  }
  async append({ sessionId, inputEpoch, sequence, startFrame, frameCount, data }) {
    const bucket = key(sessionId, inputEpoch);
    if (
      !number(sequence) ||
      sequence < 1 ||
      !number(startFrame) ||
      !number(frameCount) ||
      frameCount < 1 ||
      frameCount > 16000 ||
      !Buffer.isBuffer(data) ||
      data.length !== frameCount * 2
    )
      throw new Error('마이크 원음 프레임이 올바르지 않습니다.');
    const previous = this.writes.get(bucket) || Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(async () => {
        const state = await this.continuity(sessionId, inputEpoch, { sequence, startFrame }),
          folder = this.folder(sessionId, inputEpoch),
          file = name(sequence, startFrame, frameCount),
          path = join(folder, file);
        const existing = await readFile(path).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (existing) {
          if (digest(existing) !== digest(data))
            throw new Error('같은 원음 순번의 내용이 달라졌습니다.');
          return { duplicate: true, durableThrough: state.durableThrough };
        }
        if (sequence !== state.nextSequence) throw new Error('원음 순번이 연속되지 않습니다.');
        if (startFrame !== state.latestCapturedFrame)
          throw new Error('원음 프레임에 빈 구간이나 중복이 있습니다.');
        await mkdir(folder, { recursive: true });
        const temporary = join(folder, `${file}.${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, data, { flag: 'wx' });
          await rename(temporary, path);
        } catch (error) {
          await unlink(temporary).catch(() => {});
          throw error;
        }
        state.nextSequence++;
        state.latestCapturedFrame = startFrame + frameCount;
        state.durableThrough = state.latestCapturedFrame;
        this.records
          .get(bucket)
          .push({
            file,
            path,
            sequence,
            startFrame,
            frameCount,
            bytes: data.length,
            createdAt: this.now(),
          });
        if (this.now() - this.lastSweep > 60000) {
          this.lastSweep = this.now();
          void this.sweep().catch(() => {});
        }
        return { duplicate: false, durableThrough: state.durableThrough };
      });
    this.writes.set(bucket, operation);
    try {
      return await operation;
    } finally {
      if (this.writes.get(bucket) === operation) this.writes.delete(bucket);
    }
  }
  async list() {
    const sessions = await readdir(this.root, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const result = [];
    for (const session of sessions) {
      if (!session.isDirectory() || !uuid.test(session.name)) continue;
      const epochs = await readdir(join(this.root, session.name), { withFileTypes: true });
      for (const epoch of epochs) {
        if (!epoch.isDirectory() || !uuid.test(epoch.name)) continue;
        const entries = (await this.entries(session.name, epoch.name)).filter(
          (entry) => this.now() - entry.createdAt < SPEECH_RAW_RETENTION_MS,
        );
        if (entries.length)
          result.push({
            sessionId: session.name,
            inputEpoch: epoch.name,
            firstAt: entries[0].createdAt,
            lastAt: entries.at(-1).createdAt,
            chunkCount: entries.length,
            bytes: entries.reduce((n, entry) => n + entry.bytes, 0),
            expiresAt:
              Math.min(...entries.map((entry) => entry.createdAt)) + SPEECH_RAW_RETENTION_MS,
          });
      }
    }
    return result.sort((a, b) => b.lastAt - a.lastAt);
  }
  async download(sessionId, inputEpoch) {
    const entries = (await this.entries(sessionId, inputEpoch)).filter(
      (entry) => this.now() - entry.createdAt < SPEECH_RAW_RETENTION_MS,
    );
    if (!entries.length) return null;
    const bytes = entries.reduce((n, entry) => n + entry.bytes, 0),
      header = wavHeader(bytes);
    async function* chunks() {
      yield header;
      for (const entry of entries) yield* createReadStream(entry.path);
    }
    return { stream: Readable.from(chunks()), bytes: bytes + 44 };
  }
  async readRange(sessionId, inputEpoch, startFrame, endFrame) {
    if (
      !number(startFrame) ||
      !number(endFrame) ||
      endFrame <= startFrame ||
      endFrame - startFrame > 16000 * 30
    )
      throw new Error('원음 조회 구간이 올바르지 않습니다.');
    const entries = (await this.entries(sessionId, inputEpoch)).filter(
      (entry) => this.now() - entry.createdAt < SPEECH_RAW_RETENTION_MS,
    );
    const parts = [];
    let cursor = startFrame;
    for (const entry of entries) {
      const end = entry.startFrame + entry.frameCount;
      if (end <= cursor) continue;
      if (entry.startFrame > cursor)
        throw new Error('보존된 마이크 원음 사이에 빈 구간이 있습니다.');
      const until = Math.min(endFrame, end),
        data = await readFile(entry.path);
      parts.push(data.subarray((cursor - entry.startFrame) * 2, (until - entry.startFrame) * 2));
      cursor = until;
      if (cursor === endFrame) break;
    }
    if (cursor !== endFrame)
      throw new Error('요청한 마이크 원음이 아직 보존되지 않았거나 만료되었습니다.');
    const bytes = Buffer.concat(parts);
    return Buffer.concat([wavHeader(bytes.length), bytes]);
  }
  async sweep() {
    const sessions = await readdir(this.root, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const removed = [];
    for (const session of sessions) {
      if (!session.isDirectory() || !uuid.test(session.name)) continue;
      for (const epoch of await readdir(join(this.root, session.name), { withFileTypes: true })) {
        if (!epoch.isDirectory() || !uuid.test(epoch.name)) continue;
        for (const entry of await this.entries(session.name, epoch.name))
          if (this.now() - entry.createdAt >= SPEECH_RAW_RETENTION_MS) {
            await unlink(entry.path);
            removed.push(entry.path);
          }
        const bucket = key(session.name, epoch.name),
          records = this.records.get(bucket);
        if (records)
          this.records.set(
            bucket,
            records.filter((entry) => this.now() - entry.createdAt < SPEECH_RAW_RETENTION_MS),
          );
      }
    }
    return removed;
  }
}
