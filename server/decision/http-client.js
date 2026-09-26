import { prepareJevRequest, validateJevResponse } from './request-schema.js';

const endpoints = Object.freeze({
  typesafe: 'https://api.typesafe.ai/v1/systemone',
  openrouter: 'https://openrouter.ai/api/v1/systemone',
});
const models = Object.freeze({
  typesafe: { 'jev-1.13.0': 'jev-1.13.0', 'jev-latest': 'jev-latest' },
  openrouter: { 'jev-1.13.0': 'jev-1.13', 'jev-latest': 'jev-latest' },
});
const problem = (code, status) =>
  Object.assign(new Error('JEV 요청을 완료하지 못했습니다.'), { code, status });

export class JevHttpClient {
  constructor({ apiKey, provider = 'typesafe', model = 'jev-1.13.0', fetchImpl = fetch } = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 500)
      throw new TypeError('JEV API 키가 필요합니다.');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch 함수가 필요합니다.');
    if (!Object.hasOwn(endpoints, provider) || !Object.hasOwn(models[provider], model))
      throw new TypeError('JEV 제공처 또는 모델 설정이 올바르지 않습니다.');
    this.apiKey = apiKey.trim();
    this.provider = provider;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }
  async evaluate({ state, questions, signal, onUsage } = {}) {
    const body = prepareJevRequest({ state, questions, model: this.model });
    const wireBody =
      this.provider === 'openrouter'
        ? JSON.stringify({ ...JSON.parse(body), model: models.openrouter[this.model] })
        : body;
    signal?.throwIfAborted();
    let response;
    try {
      response = await this.fetchImpl(endpoints[this.provider], {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: wireBody,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted();
      throw problem('network');
    }
    signal?.throwIfAborted();
    if (!response?.ok) {
      const status = response?.status;
      throw problem(
        status === 401
          ? 'auth'
          : status === 402
            ? 'credits'
            : status === 429
              ? 'usage'
              : status === 529
                ? 'unavailable'
                : 'network',
        status,
      );
    }
    let parsed;
    try {
      parsed = await response.json();
    } catch {
      throw problem('invalid_response');
    }
    signal?.throwIfAborted();
    return validateJevResponse(parsed, questions, onUsage);
  }
}
