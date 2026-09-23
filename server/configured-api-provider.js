import { OpenAIProvider } from './provider.js';
import { Observation } from './schema.js';
import { RoutedProvider } from './provider-routing.js';

// A protocol adapter, not a vendor/model catalogue. Credentials belong to this
// connection instance and are never inherited from a different API endpoint.
export class ConfiguredApiProvider extends OpenAIProvider {
  constructor(config, fetcher = fetch) {
    const c = RoutedProvider.parse(config);
    super(
      {
        OPENAI_MODEL: c.model,
        OPENAI_BASE_URL: c.base,
        OPENAI_REASONING_EFFORT: c.effort || 'low',
      },
      fetcher,
    );
    this.config = c;
    this.key = '';
  }
  status() {
    return {
      ...super.status(),
      configured: !!this.key || new URL(this.base).hostname === '127.0.0.1',
      vision: this.config.vision,
      webSearch: this.config.webSearch,
    };
  }
  async request(path, body, signal, multipart = false) {
    if (!this.status().configured)
      throw Object.assign(Error('이 연결의 API 키를 입력하세요.'), { code: 'auth' });
    let response;
    try {
      response = await this.fetcher(`${this.base}/${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          ...(!multipart ? { 'Content-Type': 'application/json' } : {}),
          ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
        },
        body: multipart ? body : JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])]),
      });
    } catch {
      signal?.throwIfAborted();
      throw Object.assign(Error('API 연결에 실패했습니다.'), { code: 'network' });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(Error(`API 요청 실패 (${response.status})`), {
        code:
          response.status === 401 || response.status === 403
            ? 'auth'
            : response.status === 429
              ? 'usage'
              : response.status === 404
                ? 'model'
                : response.status >= 500
                  ? 'network'
                  : 'request',
      });
    }
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw Error('응답 크기 초과');
        chunks.push(value);
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw Error('API 응답 형식을 확인하지 못했습니다.');
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  payload(args) {
    const payload = super.payload(args);
    if (!this.config.effort) delete payload.reasoning;
    if (!this.config.webSearch) delete payload.tools;
    return payload;
  }
  async react(args, signal) {
    if (this.config.protocol === 'responses') return super.react(args, signal);
    const payload = this.payload(args),
      { type, ...schema } = payload.text.format;
    const result = await this.request(
      'chat/completions',
      {
        model: this.model,
        messages: [
          { role: 'system', content: payload.instructions },
          ...payload.input.map((m) => ({
            role: m.role,
            content: m.content.map((c) =>
              c.type === 'input_text'
                ? { type: 'text', text: c.text }
                : { type: 'image_url', image_url: { url: c.image_url, detail: c.detail } },
            ),
          })),
        ],
        response_format: { type: 'json_schema', json_schema: schema },
        max_completion_tokens: payload.max_output_tokens,
        ...(this.config.effort ? { reasoning_effort: this.config.effort } : {}),
      },
      signal,
    );
    args.onAiUsage?.(result.usage);
    if (result.choices?.[0]?.finish_reason !== 'stop')
      throw Error('AI 응답이 완료되지 않았습니다.');
    try {
      return {
        observation: Observation.parse(JSON.parse(result.choices[0].message.content)),
        usage: {
          ...result.usage,
          input_tokens: result.usage?.prompt_tokens,
          output_tokens: result.usage?.completion_tokens,
        },
      };
    } catch {
      throw Error('AI 응답 형식이 올바르지 않습니다.');
    }
  }
}
