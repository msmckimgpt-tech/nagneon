import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { defaultSpeechRetention } from '../shared/speech-retention.js';

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
  constructor(
    root,
    { now = () => Date.now(), policy = defaultSpeechRetention, isActive = () => false } = {},
  ) {
    this.root = root;
    this.now = now;
    this.buckets = new Map();
    this.records = new Map();
    this.writes = new Map();
    this.lastSweep = 0;
    this.policy = policy;
    this.isActive = isActive;
    this.operation = Promise.resolve();
    this.usedBytes = null;
    this.pins = new Map();
    this.deleted = new Set();
    this.sources = new Map();
  }
  exclusive(action) {
    const next = this.operation.catch(() => {}).then(action);
    this.operation = next.catch(() => {});
    return next;
  }
  retained(entry, sessionId) {
    return (
      this.isActive(sessionId) ||
      this.now() - entry.createdAt < this.policy().retentionHours * 3600000
    );
  }
  async safeFolder(sessionId, inputEpoch) {
    const folder = this.folder(sessionId, inputEpoch);
    for (const path of [join(this.root, sessionId), folder]) {
      const info = await lstat(path).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (info && (!info.isDirectory() || info.isSymbolicLink()))
        throw new Error('원음 보관 경로를 확인하지 못했습니다.');
    }
    return folder;
  }
  folder(sessionId, inputEpoch) {
    key(sessionId, inputEpoch);
    return join(this.root, sessionId, inputEpoch);
  }
  async entries(sessionId, inputEpoch) {
    const bucket = key(sessionId, inputEpoch);
    if (this.records.has(bucket)) return this.records.get(bucket);
    const folder = await this.safeFolder(sessionId, inputEpoch),
      files = await readdir(folder, { withFileTypes: true }).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    const result = [];
    for (const item of files) {
      if (!item.isFile()) continue;
      const file = item.name;
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
  async sourceFor(sessionId, inputEpoch) {
    const bucket = key(sessionId, inputEpoch);
    if (this.sources.has(bucket)) return this.sources.get(bucket);
    const path = join(await this.safeFolder(sessionId, inputEpoch), 'source.json');
    const info = await lstat(path).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) return 'microphone';
    if (!info.isFile() || info.isSymbolicLink() || info.size > 512)
      throw new Error('원음 출처 기록을 확인하지 못했습니다.');
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (!['microphone', 'system-output'].includes(value.source))
      throw new Error('원음 출처가 올바르지 않습니다.');
    this.sources.set(bucket, value.source);
    return value.source;
  }
  async append({
    sessionId,
    inputEpoch,
    sequence,
    startFrame,
    frameCount,
    data,
    source = 'microphone',
  }) {
    const bucket = key(sessionId, inputEpoch);
    if (
      !['microphone', 'system-output'].includes(source) ||
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
    const operation = this.exclusive(async () => {
      const folder = await this.safeFolder(sessionId, inputEpoch);
      if (!this.deleted.has(bucket)) {
        const marker = await lstat(join(folder, 'deleted.json')).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (marker) this.deleted.add(bucket);
      }
      if (this.deleted.has(bucket))
        throw new Error('삭제한 원음에 늦게 도착한 입력을 저장하지 않습니다.');
      const state = await this.continuity(sessionId, inputEpoch, { sequence, startFrame }),
        file = name(sequence, startFrame, frameCount),
        path = join(folder, file);
      if (
        (this.records.get(bucket)?.length || this.sources.has(bucket)) &&
        (await this.sourceFor(sessionId, inputEpoch)) !== source
      )
        throw new Error('원음 연결 중 입력 출처를 바꿀 수 없습니다.');
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
      if (this.usedBytes === null) await this.measure();
      if (this.usedBytes + data.length > this.policy().maxBytes) {
        const error = new Error(
          '원음 보관 용량이 가득 찼습니다. 방송을 중지한 뒤 지난 원음을 삭제하거나 보관 용량을 늘려주세요.',
        );
        error.code = 'SPEECH_STORAGE_FULL';
        throw error;
      }
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, 'source.json'), JSON.stringify({ source }), {
        flag: 'wx',
        flush: true,
      }).catch(async (error) => {
        if (error.code !== 'EEXIST') throw error;
        if ((await this.sourceFor(sessionId, inputEpoch)) !== source)
          throw new Error('원음 연결 중 입력 출처를 바꿀 수 없습니다.');
      });
      this.sources.set(bucket, source);
      const temporary = join(folder, `${file}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, data, { flag: 'wx', flush: true });
        await rename(temporary, path);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      state.nextSequence++;
      state.latestCapturedFrame = startFrame + frameCount;
      state.durableThrough = state.latestCapturedFrame;
      this.usedBytes += data.length;
      this.records.get(bucket).push({
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
      return {
        duplicate: false,
        durableThrough: state.durableThrough,
        storageNearlyFull: this.policy().maxBytes - this.usedBytes < 128000,
      };
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
        const entries = await this.entries(session.name, epoch.name);
        if (entries.length)
          result.push({
            sessionId: session.name,
            inputEpoch: epoch.name,
            source: await this.sourceFor(session.name, epoch.name),
            firstAt: entries[0].createdAt,
            lastAt: entries.at(-1).createdAt,
            chunkCount: entries.length,
            bytes: entries.reduce((n, entry) => n + entry.bytes, 0),
            active: this.isActive(session.name),
            expiresAt: entries[0].createdAt + this.policy().retentionHours * 3600000,
          });
      }
    }
    return result.sort((a, b) => b.lastAt - a.lastAt);
  }
  async measure() {
    const records = await this.list();
    this.usedBytes = records.reduce((total, item) => total + item.bytes, 0);
    return { ...this.policy(), usedBytes: this.usedBytes, records };
  }
  async status() {
    return this.exclusive(() => this.measure());
  }
  async remove(sessionId, inputEpoch) {
    const bucket = key(sessionId, inputEpoch);
    return this.exclusive(async () => {
      if (this.isActive(sessionId) || this.pins.has(bucket))
        throw new Error('방송 중이거나 사용 중인 원음은 삭제할 수 없습니다.');
      const folder = await this.safeFolder(sessionId, inputEpoch);
      const entries = await this.entries(sessionId, inputEpoch);
      if (!entries.length) return { deleted: 0 };
      // Keep a durable tombstone so a delayed retry cannot recreate deleted audio.
      const marker = join(folder, 'deleted.json');
      await writeFile(marker, JSON.stringify({ deletedAt: this.now() }), {
        flag: 'wx',
        flush: true,
      }).catch(async (error) => {
        if (error.code !== 'EEXIST') throw error;
        const info = await lstat(marker);
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error('원음 삭제 기록의 경로를 확인하지 못했습니다.');
      });
      this.deleted.add(bucket);
      let deleted = 0;
      try {
        for (const entry of entries) {
          await unlink(entry.path).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
          deleted += entry.bytes;
        }
      } finally {
        this.records.delete(bucket);
        this.usedBytes = null;
      }
      return { deleted };
    });
  }
  async pin(sessionId, inputEpoch) {
    const bucket = key(sessionId, inputEpoch);
    await this.exclusive(() => this.pins.set(bucket, (this.pins.get(bucket) || 0) + 1));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.pins.get(bucket) - 1;
      if (count) this.pins.set(bucket, count);
      else this.pins.delete(bucket);
    };
  }
  async download(sessionId, inputEpoch) {
    const release = await this.pin(sessionId, inputEpoch);
    try {
      const entries = (await this.entries(sessionId, inputEpoch)).filter((entry) =>
        this.retained(entry, sessionId),
      );
      if (!entries.length) {
        release();
        return null;
      }
      const bytes = entries.reduce((n, entry) => n + entry.bytes, 0),
        header = wavHeader(bytes);
      async function* chunks() {
        yield header;
        for (const entry of entries) yield* createReadStream(entry.path);
      }
      const stream = Readable.from(chunks());
      stream.once('close', release);
      return { stream, bytes: bytes + 44 };
    } catch (error) {
      release();
      throw error;
    }
  }
  async readRange(sessionId, inputEpoch, startFrame, endFrame) {
    const release = await this.pin(sessionId, inputEpoch);
    try {
      return await this.readPinnedRange(sessionId, inputEpoch, startFrame, endFrame);
    } finally {
      release();
    }
  }
  async readPinnedRange(sessionId, inputEpoch, startFrame, endFrame) {
    if (
      !number(startFrame) ||
      !number(endFrame) ||
      endFrame <= startFrame ||
      endFrame - startFrame > 16000 * 30
    )
      throw new Error('원음 조회 구간이 올바르지 않습니다.');
    const entries = (await this.entries(sessionId, inputEpoch)).filter((entry) =>
      this.retained(entry, sessionId),
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
  sweep() {
    return this.exclusive(() => this.sweepExpired());
  }
  async sweepExpired() {
    const sessions = await readdir(this.root, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const removed = [];
    for (const session of sessions) {
      if (!session.isDirectory() || !uuid.test(session.name)) continue;
      for (const epoch of await readdir(join(this.root, session.name), { withFileTypes: true })) {
        if (!epoch.isDirectory() || !uuid.test(epoch.name)) continue;
        const bucket = key(session.name, epoch.name);
        if (this.isActive(session.name) || this.pins.has(bucket)) continue;
        const folder = await this.safeFolder(session.name, epoch.name);
        for (const file of await readdir(folder)) {
          if (!/^\d{8}-\d{12}-\d{8}\.pcm\.[0-9a-f-]{36}\.tmp$/i.test(file)) continue;
          const path = join(folder, file),
            details = await stat(path).catch((error) => {
              if (error.code === 'ENOENT') return null;
              throw error;
            });
          if (
            details?.isFile() &&
            this.now() - details.mtimeMs >= this.policy().retentionHours * 3600000
          ) {
            await unlink(path);
            removed.push(path);
          }
        }
        const existing = await this.entries(session.name, epoch.name);
        try {
          for (const entry of existing)
            if (!this.retained(entry, session.name)) {
              await unlink(entry.path);
              removed.push(entry.path);
            }
        } finally {
          this.records.delete(bucket);
          this.usedBytes = null;
        }
      }
    }
    if (removed.length) this.usedBytes = null;
    return removed;
  }
}
