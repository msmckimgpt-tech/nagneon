import { randomUUID } from 'node:crypto';
import {
  DecisionMode,
  assertDecisionTask,
  decisionAbstain,
  decisionObservation,
  decisionProposal,
  normalizeDecisionUsage,
  parseDecisionConfig,
} from './contracts.js';

const safeCode = (error) => {
  const code = typeof error?.code === 'string' ? error.code : 'error';
  return new Set(['auth', 'credits', 'usage', 'network', 'invalid_response', 'unavailable']).has(
    code,
  )
    ? code
    : 'error';
};

export class DecisionService {
  constructor({
    adapter = null,
    config = {},
    now = Date.now,
    idFactory = randomUUID,
    onEvent = () => {},
  } = {}) {
    this.adapter = adapter;
    this.config = parseDecisionConfig(config);
    this.now = now;
    this.idFactory = idFactory;
    this.onEvent = onEvent;
    this.inFlight = 0;
    this.pending = new Set();
    this.controller = new AbortController();
    this.closing = null;
  }
  status() {
    return {
      mode: this.config.mode,
      configured: !!this.adapter,
      closed: this.controller.signal.aborted,
      inFlight: this.inFlight,
      maxInFlight: this.config.maxInFlight,
      timeoutMs: this.config.timeoutMs,
    };
  }
  advise(task, input, { signal, scopeToken = null, questionVersion = null, timeoutMs } = {}) {
    assertDecisionTask(task);
    if (this.controller.signal.aborted) return Promise.reject(this.controller.signal.reason);
    if (signal?.aborted) return Promise.reject(signal.reason);
    const base = { task, mode: this.config.mode, scopeToken, questionVersion };
    if (this.config.mode === DecisionMode.OFF)
      return Promise.resolve(decisionAbstain(base, 'disabled'));
    if (!this.adapter) return Promise.resolve(decisionAbstain(base, 'unavailable'));
    const allowance = Number.isFinite(timeoutMs)
      ? Math.max(0, Math.min(this.config.timeoutMs, Math.floor(timeoutMs)))
      : this.config.timeoutMs;
    if (!allowance) return Promise.resolve(decisionAbstain(base, 'timeout'));
    if (this.inFlight >= this.config.maxInFlight)
      return Promise.resolve(decisionAbstain(base, 'busy'));

    const requestId = this.idFactory(),
      startedAt = this.now(),
      timeout = AbortSignal.timeout(allowance);
    const combined = AbortSignal.any([
      this.controller.signal,
      timeout,
      ...(signal ? [signal] : []),
    ]);
    this.inFlight++;
    const meta = { ...base, requestId, startedAt };
    // Retain capacity and drain ownership until the adapter really settles,
    // even when the caller has already fallen back after cancellation.
    const evaluation = Promise.resolve().then(() => {
      combined.throwIfAborted();
      return this.adapter.evaluate({ task, input, signal: combined });
    });
    this.pending.add(evaluation);
    const cleanup = () => {
      this.inFlight--;
      this.pending.delete(evaluation);
    };
    evaluation.then(cleanup, cleanup);
    let onAbort;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(combined.reason);
      combined.addEventListener('abort', onAbort, { once: true });
      if (combined.aborted) onAbort();
    });
    this.#emit({
      type: 'started',
      task,
      mode: this.config.mode,
      requestId,
      questionVersion:
        Number.isSafeInteger(questionVersion) && questionVersion >= 0 ? questionVersion : null,
    });

    return (async () => {
      try {
        const result = await Promise.race([evaluation, cancelled]);
        combined.throwIfAborted();
        if (
          !result ||
          typeof result !== 'object' ||
          Array.isArray(result) ||
          !Object.hasOwn(result, 'value') ||
          result.value === undefined
        )
          throw Object.assign(new Error('판단 응답 형식이 올바르지 않습니다.'), {
            code: 'invalid_response',
          });
        const receivedAt = this.now(),
          finished = { ...meta, receivedAt };
        const extra = {
          ...(result.modelVersion ? { modelVersion: result.modelVersion } : {}),
          ...(Number.isFinite(result.confidence) ? { confidence: result.confidence } : {}),
          ...(normalizeDecisionUsage(result.usage)
            ? { usage: normalizeDecisionUsage(result.usage) }
            : {}),
        };
        const output =
          this.config.mode === DecisionMode.SHADOW
            ? decisionObservation(finished, result.value, extra)
            : decisionProposal(finished, result.value, extra);
        this.#emit({
          type: 'completed',
          task,
          mode: this.config.mode,
          requestId,
          durationMs: Math.max(0, receivedAt - startedAt),
          kind: output.kind,
        });
        return output;
      } catch (error) {
        if (signal?.aborted) signal.throwIfAborted();
        if (this.controller.signal.aborted) this.controller.signal.throwIfAborted();
        const receivedAt = this.now(),
          reason = timeout.aborted ? 'timeout' : safeCode(error);
        this.#emit({
          type: 'abstained',
          task,
          mode: this.config.mode,
          requestId,
          durationMs: Math.max(0, receivedAt - startedAt),
          reason,
        });
        return decisionAbstain({ ...meta, receivedAt }, reason);
      } finally {
        combined.removeEventListener('abort', onAbort);
      }
    })();
  }
  close() {
    if (!this.closing) {
      this.controller.abort(new Error('판단 서비스 종료로 요청을 취소했습니다.'));
      this.closing = Promise.allSettled([...this.pending]).then(() => {});
    }
    return this.closing;
  }
  #emit(event) {
    try {
      this.onEvent(event);
    } catch {}
  }
}
