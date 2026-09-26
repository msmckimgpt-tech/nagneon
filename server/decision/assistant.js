import { z } from 'zod';
import { DecisionService } from './service.js';
import { DecisionTask, assertDecisionTask, decisionAbstain } from './contracts.js';
import { JevHttpClient } from './http-client.js';
import { prepareJevRequest } from './request-schema.js';

const taskNames = Object.values(DecisionTask);
const taskSchema = z
  .object(Object.fromEntries(taskNames.map((task) => [task, z.boolean()])))
  .strict();
export const DecisionAssistantConfig = z
  .object({
    provider: z.enum(['typesafe', 'openrouter']).default('typesafe'),
    mode: z.enum(['off', 'shadow', 'assist']),
    model: z.enum(['jev-1.13.0', 'jev-latest']),
    timeoutMs: z.number().int().min(250).max(5000),
    acknowledgeTransfer: z.boolean(),
    tasks: taskSchema,
  })
  .strict();
export const defaultDecisionConfig = Object.freeze({
  provider: 'typesafe',
  mode: 'off',
  model: 'jev-1.13.0',
  timeoutMs: 1000,
  acknowledgeTransfer: false,
  tasks: Object.freeze(Object.fromEntries(taskNames.map((task) => [task, task !== 'route-hint']))),
});

const cancelled = () =>
  Object.assign(new Error('JEV 판단 설정이 바뀌어 응답을 취소했습니다.'), { code: 'ai_cancelled' });
const safeReason = (error) =>
  ['auth', 'credits', 'usage', 'network', 'invalid_response', 'unavailable', 'timeout'].includes(
    error?.code,
  )
    ? error.code
    : 'error';
const freezeJson = (value) => {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) freezeJson(nested);
    Object.freeze(value);
  }
  return value;
};

export class DecisionAssistant {
  constructor({
    aiControl,
    config = defaultDecisionConfig,
    save = () => {},
    fetchImpl = fetch,
    now = Date.now,
    keyStore,
  } = {}) {
    if (!aiControl) throw new TypeError('AI 실행 제어기가 필요합니다.');
    this.aiControl = aiControl;
    this.config = this.#parse(config);
    this.save = save;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.keyStore = keyStore;
    const restored = keyStore?.load(this.config.provider) || {
      key: '',
      status: 'none',
      error: null,
      present: false,
    };
    this.key = restored.key;
    this.keyStorage = restored.status;
    this.keyStorageError = restored.error;
    this.storedKeyPresent = restored.present;
    this.revision = 0;
    this.cache = new Map();
    this.receipts = new WeakMap();
    this.draining = new Set();
    this.probeControllers = new Set();
    this.probePending = new Set();
    this.closed = false;
    this.cooldownUntil = 0;
    this.errorCode = null;
    this.last = null;
    this.probeStatus = null;
    this.counters = {
      calls: 0,
      inputTokens: 0,
      estimatedUsd: 0,
      cacheHits: 0,
      abstained: 0,
      applied: 0,
    };
    this.service = this.#service();
  }
  #parse(value) {
    const config = DecisionAssistantConfig.parse(value);
    return Object.freeze({ ...config, tasks: Object.freeze({ ...config.tasks }) });
  }
  #service() {
    return new DecisionService({
      config: { mode: this.config.mode, timeoutMs: this.config.timeoutMs, maxInFlight: 2 },
      now: this.now,
      adapter: { evaluate: ({ task, input, signal }) => this.#evaluate(task, input, signal) },
    });
  }
  #replace() {
    this.revision++;
    for (const controller of this.probeControllers) controller.abort(cancelled());
    this.cache.clear();
    this.cooldownUntil = 0;
    this.errorCode = null;
    this.last = null;
    this.probeStatus = null;
    const old = this.service;
    if (old) {
      const closing = old.close();
      this.draining.add(closing);
      closing.finally(() => this.draining.delete(closing));
    }
    if (!this.closed) this.service = this.#service();
  }
  snapshot() {
    return {
      configured: !!this.key,
      keyStorage: this.key ? this.keyStorage : 'none',
      keyStorageError: this.keyStorageError,
      storedKeyPresent: this.storedKeyPresent,
      provider: this.config.provider,
      mode: this.config.mode,
      model: this.config.model,
      timeoutMs: this.config.timeoutMs,
      acknowledgeTransfer: this.config.acknowledgeTransfer,
      tasks: { ...this.config.tasks },
      counters: { ...this.counters },
      last: this.last && { ...this.last },
      probe: this.probeStatus && { ...this.probeStatus },
      cooldownUntil: this.cooldownUntil > this.now() ? this.cooldownUntil : null,
      errorCode: this.errorCode,
    };
  }
  enabled(task, aiFeature = 'reaction') {
    assertDecisionTask(task);
    return (
      !this.closed &&
      this.config.mode !== 'off' &&
      this.config.tasks[task] &&
      !!this.key &&
      this.config.acknowledgeTransfer &&
      this.cooldownUntil <= this.now() &&
      this.aiControl.allowed(aiFeature)
    );
  }
  configure(value) {
    const parsed = this.#parse(value);
    const config =
      parsed.provider === this.config.provider
        ? parsed
        : Object.freeze({ ...parsed, mode: 'off', acknowledgeTransfer: false });
    if (config.provider !== this.config.provider) {
      this.keyStore?.clear();
      this.storedKeyPresent = false;
      if (this.key) this.keyStorage = 'session';
    }
    this.save(config);
    if (config.provider !== this.config.provider) {
      this.key = '';
      this.keyStorage = 'none';
      this.keyStorageError = null;
    }
    this.config = config;
    this.#replace();
    return this.snapshot();
  }
  setKey(value, provider = 'typesafe') {
    if (provider !== this.config.provider)
      throw new Error('저장된 JEV 제공처가 바뀌었습니다. 제공처를 확인하고 다시 연결하세요.');
    if (typeof value !== 'string' || value.length > 500 || /[\r\n]/.test(value))
      throw new TypeError('JEV 키 형식이 올바르지 않습니다.');
    const key = value.trim();
    const stored = key
      ? this.keyStore?.save(key, provider) || { status: 'session', error: null }
      : (this.keyStore?.clear(), { status: 'none', error: null });
    this.key = key;
    this.keyStorage = stored.status;
    this.keyStorageError = stored.error;
    this.storedKeyPresent = stored.status === 'saved';
    this.#replace();
    return this.snapshot();
  }
  async #evaluate(task, input, signal) {
    if (input.revision !== this.revision || !this.enabled(task, input.aiFeature)) throw cancelled();
    const cached = this.cache.get(input.cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      this.cache.delete(input.cacheKey);
      this.cache.set(input.cacheKey, cached);
      this.counters.cacheHits++;
      input.handle.cached = true;
      input.handle.receipt = cached.receipt;
      return { value: { answers: structuredClone(cached.answers) }, modelVersion: cached.model };
    }
    if (cached) this.cache.delete(input.cacheKey);
    const client = new JevHttpClient({
      apiKey: this.key,
      provider: this.config.provider,
      model: this.config.model,
      fetchImpl: this.fetchImpl,
    });
    const backend = {
      model: this.config.model,
      status: () => ({ kind: 'jev', model: this.config.model }),
    };
    try {
      const result = await this.aiControl.run(
        { aiFeature: input.aiFeature },
        signal,
        backend,
        'react',
        async (args, attemptSignal) => {
          this.counters.calls++;
          const evaluated = await client.evaluate({
            state: input.state,
            questions: input.questions,
            signal: attemptSignal,
            onUsage: (usage) => {
              args.onAiUsage(usage);
              this.counters.inputTokens += usage.input_tokens;
              this.counters.estimatedUsd += (usage.input_tokens * 0.042) / 1e6;
            },
          });
          return {
            value: { answers: evaluated.answers },
            modelVersion: evaluated.model,
            usage: { inputTokens: evaluated.usage.input_tokens },
          };
        },
      );
      input.handle.receipt = result.aiReceipt;
      return result;
    } catch (error) {
      if (error?.status === 429 || error?.status === 529) this.cooldownUntil = this.now() + 30000;
      this.errorCode = safeReason(error);
      throw error;
    }
  }
  async advise(
    task,
    { state, questions },
    { signal, scopeToken = null, questionVersion = 1, aiFeature = 'reaction' } = {},
  ) {
    assertDecisionTask(task);
    signal?.throwIfAborted();
    const base = { task, mode: this.config.mode, scopeToken, questionVersion };
    if (!this.enabled(task, aiFeature)) {
      this.counters.abstained++;
      return decisionAbstain(base, this.cooldownUntil > this.now() ? 'usage' : 'disabled');
    }
    let body, scope;
    try {
      body = prepareJevRequest({ state, questions, model: this.config.model });
      scope = JSON.stringify(scopeToken);
      if (scope === undefined) throw new Error('scope');
    } catch (error) {
      this.counters.abstained++;
      return decisionAbstain(base, safeReason(error));
    }
    const revision = this.revision;
    const request = freezeJson(JSON.parse(body));
    const parentGeneration = this.aiControl.generation.get(aiFeature) || 0;
    const cacheKey = JSON.stringify([
      task,
      request.model,
      body,
      scope,
      questionVersion,
      revision,
      aiFeature,
      parentGeneration,
    ]);
    const handle = { cached: false, receipt: null };
    let result;
    try {
      result = await this.service.advise(
        task,
        {
          state: request.state,
          questions: request.questions,
          aiFeature,
          revision,
          cacheKey,
          handle,
        },
        { signal, scopeToken, questionVersion },
      );
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted();
      this.counters.abstained++;
      return decisionAbstain(base, safeReason(error));
    }
    if (
      result.kind === 'abstain' ||
      revision !== this.revision ||
      !this.aiControl.allowed(aiFeature)
    ) {
      this.counters.abstained++;
      this.errorCode = result.reason || 'error';
      this.last = {
        task,
        outcome: 'abstain',
        durationMs: Math.max(
          0,
          (result.receivedAt ?? this.now()) - (result.startedAt ?? this.now()),
        ),
        model: this.config.model,
      };
      return revision === this.revision ? result : decisionAbstain(base, 'unavailable');
    }
    this.receipts.set(result, {
      revision,
      aiFeature,
      parentGeneration,
      receipt: handle.receipt,
      applied: false,
    });
    try {
      this.assertCurrent(result);
    } catch {
      this.counters.abstained++;
      return decisionAbstain(base, 'unavailable');
    }
    if (!handle.cached) {
      this.cache.set(cacheKey, {
        answers: structuredClone(result.value.answers),
        model: result.modelVersion,
        receipt: handle.receipt,
        expiresAt: this.now() + 15000,
      });
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value);
    }
    this.errorCode = null;
    this.last = {
      task,
      outcome: result.kind,
      durationMs: Math.max(0, result.receivedAt - result.startedAt),
      model: result.modelVersion || this.config.model,
    };
    return result;
  }
  assertCurrent(result) {
    const meta = this.receipts.get(result);
    if (
      !meta ||
      meta.revision !== this.revision ||
      this.closed ||
      !this.enabled(result.task, meta.aiFeature) ||
      meta.parentGeneration !== (this.aiControl.generation.get(meta.aiFeature) || 0)
    )
      throw cancelled();
    if (meta.receipt) this.aiControl.assertCurrent({ aiReceipt: meta.receipt });
  }
  accepted(result) {
    this.assertCurrent(result);
    const meta = this.receipts.get(result);
    if (result.kind !== 'proposal' || meta.applied) return;
    if (meta.receipt) this.aiControl.accepted({ aiReceipt: meta.receipt });
    meta.applied = true;
    this.counters.applied++;
  }
  async probe({ signal } = {}) {
    signal?.throwIfAborted();
    if (!this.key || !this.config.acknowledgeTransfer || this.closed) return this.snapshot();
    const question = {
      relevant: { type: 'noul', instructions: 'Is the synthetic Korean text a connection check?' },
    };
    const state = '합성 연결 확인 문장입니다.';
    prepareJevRequest({ state, questions: question, model: this.config.model });
    const revision = this.revision;
    const controller = new AbortController();
    this.probeControllers.add(controller);
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = AbortSignal.any([controller.signal, timeout, ...(signal ? [signal] : [])]);
    const client = new JevHttpClient({
      apiKey: this.key,
      provider: this.config.provider,
      model: this.config.model,
      fetchImpl: this.fetchImpl,
    });
    const backend = {
      model: this.config.model,
      status: () => ({ kind: 'jev', model: this.config.model }),
    };
    const startedAt = this.now();
    const operation = this.aiControl.run(
      { aiFeature: 'probe' },
      combined,
      backend,
      'react',
      async (args, attemptSignal) => {
        this.counters.calls++;
        const value = await client.evaluate({
          state,
          questions: question,
          signal: attemptSignal,
          onUsage: (usage) => {
            args.onAiUsage(usage);
            this.counters.inputTokens += usage.input_tokens;
            this.counters.estimatedUsd += (usage.input_tokens * 0.042) / 1e6;
          },
        });
        return { usage: value.usage };
      },
    );
    this.probePending.add(operation);
    try {
      await operation;
      if (revision !== this.revision || this.closed) return this.snapshot();
      this.errorCode = null;
      this.last = {
        task: 'probe',
        outcome: 'connected',
        durationMs: Math.max(0, this.now() - startedAt),
        model: this.config.model,
      };
      this.probeStatus = this.last;
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted();
      if (revision !== this.revision || this.closed) return this.snapshot();
      if (error?.status === 429 || error?.status === 529) this.cooldownUntil = this.now() + 30000;
      this.errorCode = timeout.aborted ? 'timeout' : safeReason(error);
      this.last = {
        task: 'probe',
        outcome: 'abstain',
        durationMs: Math.max(0, this.now() - startedAt),
        model: this.config.model,
      };
      this.probeStatus = this.last;
      this.counters.abstained++;
    } finally {
      this.probeControllers.delete(controller);
      this.probePending.delete(operation);
    }
    return this.snapshot();
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.key = '';
      this.#replace();
    }
    return Promise.allSettled([...this.draining, ...this.probePending]).then(() => {});
  }
}
