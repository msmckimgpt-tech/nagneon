const LIMIT = 240;
const elapsed = (start, end) =>
  Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
const distribution = (values) => {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    samples: xs.length,
    p50Ms: xs.length ? xs[Math.floor((xs.length - 1) * 0.5)] : null,
    p95Ms: xs.length ? xs[Math.ceil(xs.length * 0.95) - 1] : null,
    maxMs: xs.length ? xs.at(-1) : null,
  };
};

// Bounded, in-memory timing metadata. IDs join stages internally; exports never
// contain text, images, audio, device IDs or viewer identities.
export class InputLatency {
  constructor(now = Date.now) {
    this.now = now;
    this.reset();
  }
  reset() {
    this.rows = new Map();
    this.requests = new Map();
    this.messages = new Map();
    this.serial = 0;
    this.since = this.now();
  }
  receive(id, capture, source = 'microphone') {
    if (!capture || this.rows.has(id)) return;
    const row = {
      sample: ++this.serial,
      source,
      timing: capture.voice?.timing || 'capture-clock',
      captureStartedAt: capture.startedAt,
      captureEndedAt: capture.voice?.sourceEndedAt ?? capture.endedAt,
      firstTranscriptObservedAt: capture.voice?.receivedAt ?? null,
      transcriptObservedAt: capture.voice?.transcriptObservedAt ?? null,
      receivedAt: this.now(),
      screenLinkedAt: null,
      screenThrough: null,
      requestStartedAt: null,
      responseAt: null,
      serverPublishedAt: null,
      rendererObservedAt: null,
      requests: 0,
    };
    this.rows.set(id, row);
    while (this.rows.size > LIMIT) this.rows.delete(this.rows.keys().next().value);
  }
  request(requestId, ids, { screenThrough } = {}) {
    const keys = ids.filter((id) => this.rows.has(id));
    if (!keys.length) return;
    this.requests.set(requestId, keys);
    while (this.requests.size > LIMIT) this.requests.delete(this.requests.keys().next().value);
    for (const id of keys) {
      const row = this.rows.get(id);
      if (row.serverPublishedAt !== null) continue;
      row.requestStartedAt = this.now();
      row.requests++;
      row.responseAt = null;
      row.screenLinkedAt = Number.isFinite(screenThrough) ? this.now() : null;
      row.screenThrough = Number.isFinite(screenThrough) ? screenThrough : null;
    }
  }
  response(requestId) {
    for (const id of this.requests.get(requestId) || []) {
      const row = this.rows.get(id);
      if (row && row.serverPublishedAt === null) row.responseAt = this.now();
    }
  }
  publish(requestId, messageId) {
    const ids = (this.requests.get(requestId) || []).filter((id) => this.rows.has(id));
    if (!ids.length) return;
    this.messages.set(messageId, ids);
    while (this.messages.size > LIMIT * 4) this.messages.delete(this.messages.keys().next().value);
    for (const id of ids) {
      const row = this.rows.get(id);
      row.serverPublishedAt ??= this.now();
    }
  }
  rendered(ids, at) {
    if (!Number.isFinite(at) || Math.abs(this.now() - at) > 10000) return;
    for (const message of ids)
      for (const id of this.messages.get(message) || []) {
        const row = this.rows.get(id);
        if (row && row.serverPublishedAt !== null && at >= row.serverPublishedAt)
          row.rendererObservedAt ??= at;
      }
  }
  snapshot() {
    const rows = [...this.rows.values()].map((row) => ({ ...row }));
    const stages = {
      captureToTranscript: ['captureEndedAt', 'transcriptObservedAt'],
      transcriptAssembly: ['firstTranscriptObservedAt', 'transcriptObservedAt'],
      transcriptToReceipt: ['transcriptObservedAt', 'receivedAt'],
      receiptToRequest: ['receivedAt', 'requestStartedAt'],
      model: ['requestStartedAt', 'responseAt'],
      responseToPublish: ['responseAt', 'serverPublishedAt'],
      publishToRenderer: ['serverPublishedAt', 'rendererObservedAt'],
      captureToRenderer: ['captureEndedAt', 'rendererObservedAt'],
    };
    return {
      version: 2,
      since: this.since,
      limit: LIMIT,
      retained: rows.length,
      approximateCaptureSamples: rows.filter(
        (row) => row.timing === 'approximate-provider-interval',
      ).length,
      stages: Object.fromEntries(
        Object.entries(stages).map(([name, [a, b]]) => [
          name,
          distribution(rows.map((row) => elapsed(row[a], row[b]))),
        ]),
      ),
      samples: rows,
    };
  }
}
