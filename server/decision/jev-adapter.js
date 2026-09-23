const invalid = (message) => Object.assign(new Error(message), { code: 'invalid_response' });

function cleanVersion(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text && text.length <= 200 ? text : fallback;
}

export class JevAdapter {
  constructor({ judge, modelVersion = 'unverified-jev' } = {}) {
    if (typeof judge !== 'function') throw new TypeError('JEV judge 함수가 필요합니다.');
    this.judge = judge;
    this.modelVersion = cleanVersion(modelVersion, 'unverified-jev');
  }
  async evaluate({ task, input, signal }) {
    signal?.throwIfAborted();
    const result = await this.judge({ task, input, signal });
    signal?.throwIfAborted();
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      !Object.hasOwn(result, 'value') ||
      result.value === undefined
    )
      throw invalid('JEV 응답 형식이 올바르지 않습니다.');
    const confidence = Number.isFinite(result.confidence) ? result.confidence : undefined;
    const inputTokens =
      Number.isInteger(result.usage?.inputTokens) && result.usage.inputTokens >= 0
        ? result.usage.inputTokens
        : undefined;
    return {
      value: result.value,
      ...(confidence === undefined ? {} : { confidence }),
      modelVersion: cleanVersion(result.modelVersion, this.modelVersion),
      ...(inputTokens === undefined ? {} : { usage: { inputTokens } }),
    };
  }
}
