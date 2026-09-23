import { createSpeechRevisionTimeline } from '../shared/speech-listening.js';

const FINAL_STATUSES = new Set(['final', 'empty', 'cancelled']);

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new TypeError(`${name} must be a positive integer`);
  return value;
}
function asCode(error) {
  return error instanceof Error && error.name ? error.name : 'RECOGNITION_FAILED';
}
function abortable(operation, signal) {
  if (signal.aborted)
    return Promise.reject(Object.assign(new Error('음성 인식 취소'), { name: 'AbortError' }));
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(Object.assign(new Error('음성 인식 취소'), { name: 'AbortError' }));
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(operation).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export class SpeechListeningController {
  constructor({
    sessionId,
    inputEpoch,
    recognize,
    concurrency = 1,
    maxAttempts = 2,
    idFactory = () => globalThis.crypto.randomUUID(),
    onCommit = () => {},
    now = () => Date.now(),
  }) {
    if (typeof recognize !== 'function') throw new TypeError('recognize callback is required');
    positiveInteger(concurrency, 'concurrency');
    positiveInteger(maxAttempts, 'maxAttempts');
    this.sessionId = sessionId;
    this.inputEpoch = inputEpoch;
    this.recognize = recognize;
    this.concurrency = concurrency;
    this.maxAttempts = maxAttempts;
    this.idFactory = idFactory;
    this.onCommit = onCommit;
    this.now = now;
    this.timeline = createSpeechRevisionTimeline({ sessionId, inputEpoch });
    this.jobs = new Map();
    this.queue = [];
    this.running = 0;
    this.closed = false;
    this.committed = [];
    this.idleWaiters = [];
  }

  enqueue({ sequence, utteranceId, frameStart, frameEnd, sourceRef }) {
    if (this.closed) throw new Error('음성 청취 세션이 종료되었습니다.');
    const registration = this.timeline.register({
      sessionId: this.sessionId,
      inputEpoch: this.inputEpoch,
      sequence,
      utteranceId,
      frameStart,
      frameEnd,
    });
    if (registration.stale) return registration;
    const prior = this.jobs.get(sequence);
    if (prior) {
      if (prior.utteranceId === utteranceId && prior.sourceRef === sourceRef)
        return { accepted: true, duplicate: true };
      throw new Error('같은 발언 순번의 인식 작업이 달라졌습니다.');
    }
    const job = {
      sequence,
      utteranceId,
      frameStart,
      frameEnd,
      sourceRef,
      attempts: 0,
      revision: 0,
      active: null,
      cancelled: false,
      exhausted: false,
      retries: 0,
      nextRetryAt: 0,
    };
    this.jobs.set(sequence, job);
    this.queue.push(sequence);
    this.#pump();
    return { accepted: true, duplicate: false };
  }

  cancel(sequence, reason = 'user') {
    const job = this.jobs.get(sequence);
    if (!job) return false;
    if (this.timeline.snapshot().items.find((item) => item.sequence === sequence)?.committed)
      return false;
    job.cancelled = true;
    job.exhausted = false;
    this.queue = this.queue.filter((value) => value !== sequence);
    let attempt = job.active;
    if (!attempt) {
      const attemptId = 'cancel-' + this.idFactory();
      this.timeline.startAttempt({
        sessionId: this.sessionId,
        inputEpoch: this.inputEpoch,
        sequence,
        attemptId,
      });
      attempt = { id: attemptId, controller: null };
      job.active = attempt;
    } else attempt.controller?.abort();
    job.revision++;
    this.timeline.apply({
      sessionId: this.sessionId,
      inputEpoch: this.inputEpoch,
      sequence,
      attemptId: attempt.id,
      revision: job.revision,
      status: 'cancelled',
      cancelReason: reason,
    });
    this.#collectReady();
    this.#notifyIdle();
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    for (const job of this.jobs.values()) job.active?.controller?.abort();
    this.#notifyIdle();
  }

  retryFailed() {
    if(this.closed)return 0;
    let count=0;
    for(const job of this.jobs.values())if(job.exhausted&&!job.cancelled&&this.now()>=job.nextRetryAt){
      job.exhausted=false;job.attempts=0;job.retries++;this.queue.push(job.sequence);count++;
    }
    this.#pump();return count;
  }

  takeCommitted() {
    const result = this.committed.map((value) => structuredClone(value));
    this.committed = [];
    return result;
  }

  snapshot() {
    return {
      closed: this.closed,
      concurrency: this.concurrency,
      maxAttempts: this.maxAttempts,
      running: this.running,
      queued: [...this.queue],
      committedWaiting: this.committed.length,
      jobs: [...this.jobs.values()]
        .sort((a, b) => a.sequence - b.sequence)
        .map((job) => ({
          sequence: job.sequence,
          utteranceId: job.utteranceId,
          attempts: job.attempts,
          revision: job.revision,
          cancelled: job.cancelled,
          exhausted: job.exhausted,
          activeAttemptId: job.active?.id ?? null,
        })),
      timeline: this.timeline.snapshot(),
    };
  }

  whenIdle() {
    if (this.#isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  #isIdle() {
    return this.running === 0 && this.queue.length === 0;
  }

  #notifyIdle() {
    if (!this.#isIdle()) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  #collectReady() {
    const ready=this.timeline.drainReady();
    this.committed.push(...ready);
    for(const item of ready)this.onCommit(structuredClone(item));
  }

  #pump() {
    if (this.closed) {
      this.#notifyIdle();
      return;
    }
    while (this.running < this.concurrency && this.queue.length) {
      const sequence = this.queue.shift(),
        job = this.jobs.get(sequence);
      if (!job || job.cancelled || job.exhausted) continue;
      void this.#run(job);
    }
    this.#notifyIdle();
  }

  async #run(job) {
    this.running++;
    job.attempts++;
    const attemptId = this.idFactory(),
      controller = new AbortController();
    job.active = { id: attemptId, controller };
    this.timeline.startAttempt({
      sessionId: this.sessionId,
      inputEpoch: this.inputEpoch,
      sequence: job.sequence,
      attemptId,
    });
    let resolved = false;
    const publish = (update) => {
      if (this.closed || job.active?.id !== attemptId)
        return { accepted: false, stale: true, reason: 'attempt' };
      job.revision++;
      const result = this.timeline.apply({
        sessionId: this.sessionId,
        inputEpoch: this.inputEpoch,
        sequence: job.sequence,
        attemptId,
        revision: job.revision,
        ...update,
      });
      if (FINAL_STATUSES.has(update.status)) resolved = true;
      this.#collectReady();
      return result;
    };
    try {
      const result = await abortable(
        this.recognize({
          sessionId: this.sessionId,
          inputEpoch: this.inputEpoch,
          sequence: job.sequence,
          utteranceId: job.utteranceId,
          frameStart: job.frameStart,
          frameEnd: job.frameEnd,
          sourceRef: job.sourceRef,
          attemptId,
          attemptNo: job.attempts,
          signal: controller.signal,
          publish,
        }),
        controller.signal,
      );
      if (this.closed || job.active?.id !== attemptId) return;
      if (result !== undefined) {
        if (!result || typeof result !== 'object' || !FINAL_STATUSES.has(result.status))
          throw Object.assign(
            new Error('인식기는 final, empty 또는 cancelled 결과로 작업을 마쳐야 합니다.'),
            { code: 'RECOGNIZER_INCOMPLETE' },
          );
        publish(result);
      } else if (!resolved)
        throw Object.assign(new Error('인식기가 확정 결과 없이 종료되었습니다.'), {
          code: 'RECOGNIZER_INCOMPLETE',
        });
    } catch (error) {
      if (this.closed || job.active?.id !== attemptId || job.cancelled || controller.signal.aborted)
        return;
      job.revision++;
      this.timeline.apply({
        sessionId: this.sessionId,
        inputEpoch: this.inputEpoch,
        sequence: job.sequence,
        attemptId,
        revision: job.revision,
        status: 'failed',
        errorCode: error?.code || asCode(error),
      });
      if (job.attempts < this.maxAttempts) this.queue.unshift(job.sequence);
      else {job.exhausted = true;job.nextRetryAt=this.now()+Math.min(60000,5000*2**Math.min(job.retries,4));}
    } finally {
      if (job.active?.id === attemptId) job.active = null;
      this.running--;
      this.#collectReady();
      this.#pump();
    }
  }
}
