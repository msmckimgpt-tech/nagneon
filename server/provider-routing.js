import { z } from 'zod';
import routeLabels from '../shared/provider-routes.json' with { type: 'json' };

const model = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\s\x00-\x1f]+$/);
const effort = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional();
export function validApiBase(value) {
  try {
    const u = new URL(value);
    return (
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === '127.0.0.1'))
    );
  } catch {
    return false;
  }
}
const apiBase = z
  .string()
  .max(500)
  .refine(validApiBase, 'HTTPS 또는 이 PC의 HTTP 주소를 입력하세요.')
  .transform((v) => v.replace(/\/$/, ''));
export const RoutedProvider = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('codex'), model: model.optional(), effort }).strict(),
    z
      .object({
        kind: z.literal('ollama'),
        model,
        base: z.string().max(200).default('http://127.0.0.1:11434'),
        contextSize: z.number().int().min(4096).max(131072).default(65536),
        think: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('openai'),
        model,
        base: apiBase.default('https://api.openai.com/v1'),
        protocol: z.enum(['responses', 'chat-completions']).default('responses'),
        effort,
        vision: z.boolean().default(false),
        webSearch: z.boolean().default(false),
      })
      .strict(),
  ])
  .superRefine((v, ctx) => {
    if (v.kind === 'ollama') {
      try {
        const u = new URL(v.base);
        if (
          u.protocol !== 'http:' ||
          u.hostname !== '127.0.0.1' ||
          u.username ||
          u.password ||
          u.search ||
          u.hash ||
          u.pathname !== '/'
        )
          throw Error();
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Ollama는 이 PC의 127.0.0.1 주소를 사용하세요.' });
      }
    }
    if (v.kind === 'openai' && v.protocol === 'chat-completions' && v.webSearch)
      ctx.addIssue({
        code: 'custom',
        message: 'Chat Completions 연결에는 웹 검색을 지정할 수 없습니다.',
      });
  });
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const route = z
  .object({
    primary: id,
    fallbacks: z.array(id).max(2).default([]),
    timeoutMs: z.number().int().min(1000).max(60000).default(45000),
  })
  .strict();
export const RoutingSelection = z
  .object({
    kind: z.literal('routing'),
    version: z.literal(1),
    connections: z
      .array(
        z
          .object({ id, label: z.string().trim().min(1).max(80), provider: RoutedProvider })
          .strict(),
      )
      .min(1)
      .max(20),
    routes: z
      .object(
        Object.fromEntries(
          Object.keys(routeLabels).map((k) => [k, k === 'default' ? route : route.optional()]),
        ),
      )
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = new Set(v.connections.map((c) => c.id));
    if (ids.size !== v.connections.length)
      ctx.addIssue({ code: 'custom', message: '연결 ID가 중복됩니다.' });
    for (const r of Object.values(v.routes)) {
      const path = [r.primary, ...r.fallbacks];
      if (path.some((i) => !ids.has(i)) || new Set(path).size !== path.length)
        ctx.addIssue({ code: 'custom', message: '경로에는 등록된 연결을 중복 없이 지정하세요.' });
    }
  });

// Classify metadata supplied by Studio, never instructions from model output or user text.
export function routeRequirements(args = {}) {
  const vision =
    !!args.image ||
    !!args.frames?.length ||
    !!args.liveSpeech?.some((s) => s.source === 'microphone' && s.capture?.screen?.frames?.length);
  return {
    role: args.connectionProbe
      ? 'default'
      : args.offStream
        ? 'offStream'
        : args.adviceRequested
          ? 'advice'
          : vision
            ? 'vision'
            : 'chat',
    vision,
    webSearch: !!(args.adviceRequested && args.settings?.webSearch),
  };
}
const failure = (code, message) => Object.assign(new Error(message), { code });
const retryable = new Set(['network', 'model', 'unavailable', 'capability', 'timeout']);
export class ProviderRouter {
  constructor(config, { create, onFallback = () => {} }) {
    this.config = RoutingSelection.parse(config);
    this.onFallback = onFallback;
    this.entries = new Map(
      this.config.connections.map((c) => [c.id, { ...c, backend: create(c) }]),
    );
    this.primary = this.entries.get(this.config.routes.default.primary);
  }
  get model() {
    return this.primary.backend.model;
  }
  get effort() {
    return this.primary.backend.effort;
  }
  get key() {
    return this.primary.backend.key;
  }
  set key(value) {
    this.setKey(this.primary.id, value);
  }
  setKey(id, value) {
    const entry = this.entries.get(id);
    if (entry?.provider.kind !== 'openai') throw Error('API 연결을 선택하세요.');
    entry.backend.key = value;
  }
  status() {
    const status = this.primary.backend.status();
    const ready = [
      this.config.routes.default.primary,
      ...this.config.routes.default.fallbacks,
    ].some((id) => this.entries.get(id).backend.status().configured);
    return {
      ...status,
      configured: ready,
      ...(!status.configured && ready
        ? { authMessage: '지정한 대체 연결을 사용할 수 있습니다.' }
        : {}),
      kind: this.primary.provider.kind,
      routing: true,
    };
  }
  snapshot() {
    return {
      config: structuredClone(this.config),
      connections: [...this.entries.values()].map((c) => ({
        id: c.id,
        configured: !!c.backend.status().configured,
      })),
    };
  }
  async check(signal) {
    for (const c of this.entries.values()) {
      signal?.throwIfAborted();
      await c.backend.check?.(signal);
    }
    return this.status();
  }
  async transcribe(...args) {
    return this.primary.backend.transcribe(...args);
  }
  async react(args, signal) {
    const need = routeRequirements(args),
      route = this.config.routes[need.role] || this.config.routes.default;
    const deadline = AbortSignal.timeout(90000),
      total = AbortSignal.any([deadline, ...(signal ? [signal] : [])]);
    const attempts = [];
    for (const id of [route.primary, ...route.fallbacks]) {
      total.throwIfAborted();
      const c = this.entries.get(id),
        b = c.backend,
        status = b.status();
      const vision =
        c.provider.kind === 'codex' ||
        (c.provider.kind === 'ollama' ? status.vision : c.provider.vision);
      const search =
        c.provider.kind === 'codex' || (c.provider.kind === 'openai' && c.provider.webSearch);
      const attemptSignal = AbortSignal.any([total, AbortSignal.timeout(route.timeoutMs)]);
      try {
        if (!status.configured) throw failure('unavailable', '연결 준비가 필요합니다.');
        if ((need.vision && !vision) || (need.webSearch && !search))
          throw failure('capability', '요청에 필요한 화면 또는 검색 기능을 지원하지 않습니다.');
        if (!args.connectionProbe && attempts.some((a) => a.called)) this.onFallback();
        attempts.push({ id, called: true });
        const result = await b.react(args, attemptSignal);
        total.throwIfAborted();
        attemptSignal.throwIfAborted();
        return {
          ...result,
          routing: {
            role: need.role,
            connectionId: id,
            model: b.model,
            effort: b.effort,
            attempts: attempts.map((a) => ({
              id: a.id,
              code: a.code || 'completed',
              called: !!a.called,
            })),
          },
        };
      } catch (error) {
        total.throwIfAborted();
        const code = attemptSignal.aborted ? 'timeout' : error.code || 'invalid_response';
        if (attempts.at(-1)?.id === id) attempts.at(-1).code = code;
        else attempts.push({ id, called: false, code });
        if (!retryable.has(code) || id === [route.primary, ...route.fallbacks].at(-1))
          throw failure(
            code,
            `${c.label}: ${code === 'timeout' ? '응답 시간이 초과됐습니다.' : code === 'capability' ? '화면·검색 기능을 확인하세요.' : code === 'unavailable' ? '연결을 확인하세요.' : '응답을 완료하지 못했습니다. 연결·모델 설정을 확인하세요.'}`,
          );
      }
    }
  }
}
