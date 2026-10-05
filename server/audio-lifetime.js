import { AsyncLocalStorage } from 'node:async_hooks';

export class AudioClosingError extends Error {
  constructor() {
    super('앱이 종료 중입니다. 새 음성 입력을 받지 않습니다.');
    this.code = 'AUDIO_CLOSING';
  }
}

const cancellation = (error) => error instanceof AudioClosingError || error?.name === 'AbortError';

// Register before invoking callbacks, including synchronous capture. An active
// accepted operation may finish its descendants after admission is sealed;
// a later external call, or a callback from a finished operation, may not.
export class AudioLifetime {
  constructor() {
    this.scope = new AsyncLocalStorage();
    this.pending = new Set();
    this.failures = new Set();
    this.sealed = false;
  }
  assertOpen() {
    if (this.sealed && !this.scope.getStore()?.active) throw new AudioClosingError();
  }
  run(work, { preserveErrors = false } = {}) {
    try {
      this.assertOpen();
    } catch (error) {
      const rejected = Promise.reject(error);
      rejected.catch(() => {});
      return rejected;
    }
    let resolve, reject;
    const operation = new Promise((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const token = { active: true };
    this.pending.add(operation);
    operation.then(
      () => {
        token.active = false;
        this.pending.delete(operation);
      },
      (error) => {
        token.active = false;
        this.pending.delete(operation);
        if (this.sealed && (preserveErrors || !cancellation(error))) this.failures.add(error);
      },
    );
    this.scope.run(token, () => {
      try {
        Promise.resolve(work()).then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
    return operation;
  }
  wrap(owner, names) {
    for (const name of names) {
      const method = owner[name].bind(owner);
      owner[name] = (...args) => this.run(() => method(...args));
    }
  }
  seal() {
    this.sealed = true;
  }
  async drain() {
    this.seal();
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    this.scope.disable();
    return [...this.failures];
  }
}

// Preserve the actual errors, including a single original object's identity.
export function throwAudioFailures(values) {
  const seen = new Set(),
    errors = [];
  const add = (error) => {
    if (!error || seen.has(error)) return;
    seen.add(error);
    if (error instanceof AggregateError && error.errors.length) error.errors.forEach(add);
    else errors.push(error);
  };
  values.forEach(add);
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, '음성 종료 정리를 완료하지 못했습니다.');
}
