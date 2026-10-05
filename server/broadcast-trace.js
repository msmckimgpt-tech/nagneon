import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { JsonStore } from './storage.js';
import { normalizeUsage } from './ai-control.js';

export const TRACE_RETENTION_MS = 7 * 86400000;
export const TRACE_MAX_BYTES = 16 * 1024 * 1024;
export const TRACE_SEGMENT_BYTES = 256 * 1024;
const RECORD_BYTES = 64 * 1024;
const ownedName =
  /^trace-(\d{13})-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.jsonl$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashId = z.string().regex(/^[a-f0-9]{32}$/);
const time = z.number().finite().nonnegative();
const optionalTime = time.nullable().optional();
const tally = z.number().int().nonnegative();
const presence = z.enum(['active', 'lurking', 'away', 'waiting', 'unknown']);
const reasons = z.enum([
  'expired',
  'absent',
  'disabled',
  'blocked',
  'duplicate',
  'spoiler',
  'advice',
  'pace',
  'cleared',
  'delivery-error',
  'manager-role',
]);
const timingNames = [
  'captureStartedAt',
  'captureEndedAt',
  'firstTranscriptObservedAt',
  'transcriptObservedAt',
  'receivedAt',
  'requestStartedAt',
  'responseAt',
  'screenThrough',
  'serverPublishedAt',
  'rendererObservedAt',
  'dueAt',
  'expiresAt',
  'modelMs',
  'firstDeliveryMs',
];
const metricNames = [
  'frameCount',
  'present',
  'eligible',
  'eligibleViewers',
  'lurkingEligible',
  'generated',
  'admitted',
  'delivered',
  'pending',
  'requests',
];
const messageKind = z.enum(['chat', 'notice', 'streamer', 'donation']);
const memory = z
  .object({
    source: hashId,
    at: time,
    experience: z.enum(['own-words', 'witnessed-words', 'witnessed-donation']),
    witnessed: z.boolean(),
  })
  .strict();
const member = z
  .object({
    id: hashId,
    presence,
    joinedAt: optionalTime,
    heard: z.boolean().optional(),
    memories: z.array(memory).max(12).optional(),
  })
  .strict();
const segmentHeader = z
  .object({
    schema: z.literal('nagneon.broadcast-trace/1'),
    key: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const TraceEvent = z
  .object({
    version: z.literal(1),
    at: time,
    run: hashId,
    sequence: tally,
    kind: z.enum([
      'session-start',
      'session-stop',
      'input',
      'request',
      'request-context',
      'request-finished',
      'model-result',
      'reaction',
      'queued',
      'published',
      'rendered',
      'presence',
      'journaled',
      'lifecycle',
    ]),
    session: hashId.nullable(),
    request: hashId.optional(),
    input: hashId.optional(),
    delivery: hashId.optional(),
    message: hashId.optional(),
    viewer: hashId.optional(),
    related: z.array(hashId).max(240).optional(),
    attempts: z.array(hashId).max(20).optional(),
    witnesses: z.array(hashId).max(128).optional(),
    part: z
      .object({ index: tally, count: tally.min(1) })
      .strict()
      .refine((v) => v.index < v.count)
      .optional(),
    source: z.enum(['keyboard', 'microphone', 'system-output']).optional(),
    timingBasis: z
      .enum(['capture-clock', 'approximate-provider-interval', 'not-measured'])
      .optional(),
    timing: z
      .object(Object.fromEntries(timingNames.map((k) => [k, optionalTime])))
      .strict()
      .optional(),
    metrics: z
      .object(Object.fromEntries(metricNames.map((k) => [k, tally.nullable().optional()])))
      .strict()
      .optional(),
    state: z
      .enum([
        'generating',
        'accepted',
        'stale-screen',
        'stopped',
        'superseded',
        'episode-ended',
        'transcription-review',
        'error',
      ])
      .optional(),
    rejected: z.partialRecord(reasons, tally).optional(),
    hasSpeech: z.boolean().optional(),
    company: z.enum(['idle', 'watching']).nullable().optional(),
    viewers: z.array(member).max(32).optional(),
    usage: z
      .object({
        input: optionalTime,
        cached: optionalTime,
        output: optionalTime,
        total: optionalTime,
        cacheWrite: optionalTime,
      })
      .strict()
      .optional(),
    messageKind: messageKind.optional(),
    meme: z.boolean().optional(),
    replyTo: hashId.nullable().optional(),
    component: z
      .enum([
        'service',
        'electron',
        'obs',
        'native-audio',
        'system-audio',
        'runtime-components',
        'requests',
        'tutorial',
        'probe',
        'studio',
        'culture',
        'clip-inspector',
        'speech',
        'community',
        'clip-perception',
        'sound',
        'http',
      ])
      .optional(),
    operation: z.enum(['startup', 'shutdown']).optional(),
    phase: z.enum(['started', 'completed', 'failed', 'quit-requested']).optional(),
    durationMs: optionalTime,
  })
  .strict();
const chunks = (values, size) =>
  Array.from({ length: Math.max(1, Math.ceil(values.length / size)) }, (_, i) =>
    values.slice(i * size, (i + 1) * size),
  );

// Only allowlisted operational metadata is stored. Profile-specific HMACs join
// stages without exporting original IDs, names, prompts, media or error text.
export class BroadcastTrace {
  constructor({ dir, now = Date.now, append = appendFileSync } = {}) {
    this.dir = dir ? resolve(dir) : null;
    this.now = now;
    this.append = append;
    this.error = '';
    this.failedRecords = 0;
    this.run = randomBytes(16).toString('hex');
    this.sequence = 0;
    this.current = null;
    this.currentBytes = 0;
    this.lastSweep = 0;
    this.presenceKey = '';
    this.presenceSession = null;
    this.requests = new Map();
    this.reactions = new Map();
    this.deliveries = new WeakMap();
    this.published = new Map();
    if (!this.dir) return;
    try {
      this.assertDirectory();
      this.assertKeyPaths();
      const keyFile = join(this.dir, 'correlation.json');
      const existing =
        existsSync(this.dir) && readdirSync(this.dir).some((name) => ownedName.test(name));
      if (
        existsSync(keyFile) &&
        (!lstatSync(keyFile).isFile() || lstatSync(keyFile).isSymbolicLink())
      )
        throw Error('invalid key path');
      this.keyStore = new JsonStore(keyFile, {
        validate: (v) =>
          z
            .object({ version: z.literal(1), salt: z.string().regex(/^[a-f0-9]{64}$/) })
            .strict()
            .parse(v),
        initial: () => ({ version: 1, salt: randomBytes(32).toString('hex') }),
        backupCount: 1,
      });
      const key = this.keyStore.load();
      if (existing && !existsSync(keyFile) && !this.keyStore.recoveredFrom)
        throw Error('missing correlation key');
      this.salt = key.salt;
      this.keyHash = digest(this.salt);
      this.keyPending = !existsSync(keyFile) || !!this.keyStore.recoveredFrom;
      this.header =
        JSON.stringify({ schema: 'nagneon.broadcast-trace/1', key: this.keyHash }) + '\n';
    } catch {
      this.error = '방송 진단 기록을 읽지 못했습니다. 기존 진단 파일을 보존합니다.';
    }
  }
  assertDirectory() {
    if (!existsSync(this.dir)) return;
    const stat = lstatSync(this.dir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !realpathSync(this.dir).startsWith(realpathSync(dirname(this.dir)) + sep)
    )
      throw Error('invalid trace directory');
  }
  assertKeyPaths() {
    if (!existsSync(this.dir)) return;
    for (const name of readdirSync(this.dir)) {
      if (!/^correlation\.json(?:\.tmp|\.bak\.\d+)?$/.test(name)) continue;
      const stat = lstatSync(join(this.dir, name));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
        throw Error('invalid correlation file');
    }
  }
  identity(scope, value) {
    return this.salt && value != null
      ? createHmac('sha256', this.salt)
          .update(scope + '\0' + String(value))
          .digest('hex')
          .slice(0, 32)
      : null;
  }
  files() {
    this.assertDirectory();
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((name) => ownedName.test(name))
      .map((name) => {
        const path = join(this.dir, name),
          stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) throw Error('invalid trace file');
        const fd = openSync(path, 'r');
        let header;
        try {
          const bytes = Buffer.alloc(512);
          const count = readSync(fd, bytes, 0, bytes.length, 0);
          header = segmentHeader.safeParse(
            JSON.parse(bytes.subarray(0, count).toString('utf8').split('\n')[0]),
          );
        } catch {
          header = { success: false };
        } finally {
          closeSync(fd);
        }
        return {
          path,
          name,
          at: Number(name.match(ownedName)[1]),
          size: stat.size,
          owned: header.success && header.data.key === this.keyHash,
        };
      })
      .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
  }
  prune(reserve = 0) {
    const files = this.files().filter((file) => file.owned);
    let bytes = files.reduce((n, file) => n + file.size, 0);
    for (const file of files) {
      if (file.path === this.current) continue;
      if (this.now() - file.at <= TRACE_RETENTION_MS && bytes + reserve <= TRACE_MAX_BYTES)
        continue;
      unlinkSync(file.path);
      bytes -= file.size;
    }
    this.lastSweep = this.now();
    if (bytes + reserve > TRACE_MAX_BYTES) throw Error('trace retention unavailable');
  }
  safe(work) {
    if (!this.dir) return false;
    if (this.error) {
      this.failedRecords++;
      return false;
    }
    try {
      return work();
    } catch {
      this.failedRecords++;
      this.error = '방송 진단 저장을 중단했습니다. 대화와 입력 기록은 별도로 유지됩니다.';
      return false;
    }
  }
  record(value) {
    return this.safe(() => {
      const row = TraceEvent.parse({
        ...value,
        version: 1,
        at: this.now(),
        run: this.run,
        sequence: ++this.sequence,
      });
      const line = JSON.stringify(row) + '\n',
        size = Buffer.byteLength(line);
      if (size > RECORD_BYTES) throw Error('trace record too large');
      this.assertDirectory();
      mkdirSync(this.dir, { recursive: true });
      if (this.keyPending) {
        this.assertKeyPaths();
        this.keyStore.save({ version: 1, salt: this.salt });
        this.keyPending = false;
      }
      if (
        !this.current ||
        this.currentBytes + size > TRACE_SEGMENT_BYTES ||
        this.now() - this.currentAt >= 86400000
      ) {
        this.current = null;
        this.prune(TRACE_SEGMENT_BYTES);
        this.currentAt = this.now();
        if (this.currentAt > 9999999999999) throw Error('unsupported clock');
        const file = join(
          this.dir,
          `trace-${String(Math.floor(this.currentAt)).padStart(13, '0')}-${randomUUID()}.jsonl`,
        );
        this.append(file, this.header + line, { encoding: 'utf8', flag: 'wx' });
        this.current = file;
        this.currentBytes = Buffer.byteLength(this.header) + size;
      } else {
        if (this.now() - this.lastSweep >= 60000)
          this.prune(TRACE_SEGMENT_BYTES - this.currentBytes);
        const current = lstatSync(this.current);
        if (!current.isFile() || current.isSymbolicLink() || current.size !== this.currentBytes)
          throw Error('trace segment changed');
        this.append(this.current, line, { encoding: 'utf8', flag: 'a' });
        this.currentBytes += size;
      }
      return true;
    });
  }
  status() {
    return {
      enabled: !!this.dir,
      error: this.error,
      failedRecords: this.failedRecords,
      retentionDays: 7,
      maxBytes: TRACE_MAX_BYTES,
    };
  }
  snapshot() {
    const events = [];
    let invalidRecords = 0,
      readError = false,
      bytes = 0,
      omittedFiles = 0,
      unmanagedFiles = 0;
    if (this.dir)
      try {
        for (const file of this.files().reverse()) {
          if (!file.owned) {
            unmanagedFiles++;
            continue;
          }
          if (file.size > TRACE_SEGMENT_BYTES) {
            invalidRecords++;
            continue;
          }
          if (this.now() - file.at > TRACE_RETENTION_MS || bytes + file.size > TRACE_MAX_BYTES) {
            omittedFiles++;
            continue;
          }
          bytes += file.size;
          for (const line of readFileSync(file.path, 'utf8').split('\n').slice(1).filter(Boolean)) {
            try {
              if (Buffer.byteLength(line) > RECORD_BYTES) throw Error('size');
              const row = TraceEvent.parse(JSON.parse(line));
              if (this.now() - row.at <= TRACE_RETENTION_MS) events.push(row);
            } catch {
              invalidRecords++;
            }
          }
        }
      } catch {
        readError = true;
      }
    // Wall-clock timestamps can move backwards. Sequence is authoritative only
    // within one process run; no ordering between simultaneous runs is invented.
    const first = new Map();
    for (const row of events)
      if (!first.has(row.run) || row.sequence < first.get(row.run).sequence)
        first.set(row.run, row);
    events.sort(
      (a, b) =>
        first.get(a.run).at - first.get(b.run).at ||
        a.run.localeCompare(b.run) ||
        a.sequence - b.sequence,
    );
    return {
      version: 1,
      ...this.status(),
      exportedAt: this.now(),
      bytes,
      invalidRecords,
      readError,
      omittedFiles,
      unmanagedFiles,
      scope:
        'live input, general reactions, witnessed journal entries and lifecycle metadata; bounded history may be incomplete; renderer receipts do not prove human reading; selected memories do not prove influence on output',
      events,
    };
  }
  scoped(id) {
    return this.requests.get(id);
  }
  lifecycle(component, phase, durationMs, operation = 'shutdown') {
    this.record({
      kind: 'lifecycle',
      session: null,
      component,
      phase,
      operation,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
  }
  session(sessionId, started) {
    if (started) {
      this.published.clear();
      this.presenceKey = '';
      this.presenceSession = sessionId;
    }
    this.record({
      kind: started ? 'session-start' : 'session-stop',
      session: this.identity('session', sessionId),
    });
  }
  inputReceived(sessionId, id, capture, source, messageId) {
    this.safe(() =>
      this.record({
        kind: 'input',
        session: this.identity('session', sessionId),
        input: this.identity('input', id),
        ...(messageId ? { message: this.identity('message', messageId) } : {}),
        source: capture?.voice?.source === 'system-output' ? 'system-output' : source,
        timingBasis:
          capture?.voice?.timing === 'approximate-provider-interval'
            ? 'approximate-provider-interval'
            : capture
              ? 'capture-clock'
              : 'not-measured',
        timing: {
          captureStartedAt: capture?.startedAt,
          captureEndedAt: capture?.voice?.sourceEndedAt ?? capture?.endedAt,
          firstTranscriptObservedAt: capture?.voice?.receivedAt,
          transcriptObservedAt: capture?.voice?.transcriptObservedAt,
          receivedAt: this.now(),
        },
      }),
    );
  }
  observePresence(sessionId, settings, audience) {
    // AI policy updates publish intermediate state during start(). Wait until
    // the audience has actually started before associating its roster.
    if (!sessionId || sessionId !== this.presenceSession) return;
    this.safe(() => {
      const viewers = settings.personas
        .filter((p) => p.enabled)
        .map((p) => ({
          id: this.identity('viewer', p.id),
          presence: presence.safeParse(audience.presence[p.id]).success
            ? audience.presence[p.id]
            : 'unknown',
          joinedAt: audience.data.members[p.id]?.joinedAt ?? null,
        }));
      const key = digest(JSON.stringify(viewers));
      if (key === this.presenceKey) return;
      this.presenceKey = key;
      const parts = chunks(viewers, 32);
      parts.forEach((part, index) =>
        this.record({
          kind: 'presence',
          session: this.identity('session', sessionId),
          viewers: part,
          part: { index, count: parts.length },
        }),
      );
    });
  }
  savedMessage(sessionId, message, witnesses) {
    this.safe(() => {
      const parts = chunks(
        witnesses.map((id) => this.identity('viewer', id)),
        128,
      );
      parts.forEach((part, index) =>
        this.record({
          kind: 'journaled',
          session: this.identity('session', sessionId),
          message: this.identity('message', message.id),
          viewer: this.identity('viewer', message.personaId),
          messageKind: message.kind,
          witnesses: part,
          part: { index, count: parts.length },
        }),
      );
    });
  }
  requested(studio, id, context, inputIds, screenThrough) {
    this.safe(() => {
      const scope = {
        session: this.identity('session', studio.sessionId),
        request: this.identity('request', studio.sessionId + ':' + id),
      };
      this.requests.set(id, scope);
      while (this.requests.size > 4000) {
        const first = this.requests.keys().next().value;
        this.requests.delete(first);
        this.reactions.delete(first);
      }
      const inputs = chunks(
        inputIds.map((input) => this.identity('input', input)),
        240,
      );
      inputs.forEach((related, index) =>
        this.record({
          kind: 'request',
          ...scope,
          related,
          part: { index, count: inputs.length },
          timing: { requestStartedAt: this.now(), screenThrough },
        }),
      );
      const journal = new Map(studio.journal.data.entries.map((e) => [e.id, e]));
      const parts = chunks(Object.entries(context.personalContext.viewerContext), 32);
      parts.forEach((part, index) =>
        this.record({
          kind: 'request-context',
          ...scope,
          part: { index, count: parts.length },
          viewers: part.map(([viewerId, value]) => ({
            id: this.identity('viewer', viewerId),
            presence: presence.safeParse(studio.audience.presence[viewerId]).success
              ? studio.audience.presence[viewerId]
              : 'unknown',
            joinedAt: value.joinedAt ?? null,
            heard: context.witnesses.includes(viewerId),
            memories: (value.recollections || []).map((m) => ({
              source: this.identity('message', m.sourceId),
              at: m.at,
              experience: m.experience,
              witnessed: !!journal.get(m.sourceId)?.witnesses.includes(viewerId),
            })),
          })),
        }),
      );
    });
  }
  modelResult(id, result) {
    this.safe(() => {
      const scope = this.scoped(id);
      if (!scope) return;
      const usage = normalizeUsage(result.usage);
      this.record({
        kind: 'model-result',
        ...scope,
        attempts: (result.aiReceipt?.attempts || []).map((attempt) =>
          this.identity('ai-attempt', attempt),
        ),
        usage: usage
          ? Object.fromEntries(
              ['input', 'cached', 'output', 'total', 'cacheWrite']
                .filter((k) => Object.hasOwn(usage, k))
                .map((k) => [k, usage[k]]),
            )
          : undefined,
        timing: { responseAt: this.now() },
      });
    });
  }
  finishRequest(id, state) {
    const scope = this.scoped(id);
    if (scope) this.record({ kind: 'request-finished', ...scope, state });
  }
  reaction(row) {
    this.safe(() => {
      const scope = row && this.scoped(row.id);
      if (!scope) return;
      const event = {
        kind: 'reaction',
        ...scope,
        hasSpeech: row.hasSpeech,
        company: row.company,
        state: row.state,
        rejected: row.rejected,
        metrics: Object.fromEntries(
          metricNames.filter((k) => Object.hasOwn(row, k)).map((k) => [k, row[k]]),
        ),
        timing: {
          requestStartedAt: row.startedAt,
          modelMs: row.modelMs,
          firstDeliveryMs: row.firstDeliveryMs,
        },
      };
      const key = JSON.stringify(event);
      if (this.reactions.get(row.id) === key) return;
      this.reactions.set(row.id, key);
      this.record(event);
    });
  }
  queued(message) {
    this.safe(() => {
      const scope = this.scoped(message.diagnosticId);
      if (!scope) return;
      const delivery = this.identity('delivery', randomUUID());
      this.deliveries.set(message, delivery);
      this.record({
        kind: 'queued',
        ...scope,
        delivery,
        viewer: this.identity('viewer', message.personaId),
        messageKind: message.kind,
        meme: !!message.meme,
        replyTo: message.replySourceId ? this.identity('message', message.replySourceId) : null,
        timing: { dueAt: message.due, expiresAt: message.expiresAt ?? null },
      });
    });
  }
  publishedMessage(queued, message) {
    this.safe(() => {
      const scope = this.scoped(queued.diagnosticId),
        delivery = this.deliveries.get(queued);
      if (!scope || !delivery) return;
      const at = this.now();
      this.published.set(message.id, { session: scope.session, at, seen: false });
      while (this.published.size > 4500) this.published.delete(this.published.keys().next().value);
      this.record({
        kind: 'published',
        ...scope,
        delivery,
        message: this.identity('message', message.id),
        viewer: this.identity('viewer', message.personaId),
        messageKind: message.kind,
        timing: { serverPublishedAt: at },
      });
    });
  }
  rendered(sessionId, ids, at) {
    if (!Number.isFinite(at) || Math.abs(this.now() - at) > 10000) return;
    this.safe(() => {
      const session = this.identity('session', sessionId);
      for (const id of ids) {
        const row = this.published.get(id);
        if (!row || row.session !== session || row.seen || at < row.at) continue;
        row.seen = true;
        this.record({
          kind: 'rendered',
          session,
          message: this.identity('message', id),
          timing: { rendererObservedAt: at, serverPublishedAt: row.at },
        });
      }
    });
  }
}
