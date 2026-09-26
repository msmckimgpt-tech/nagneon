import { useEffect, useState } from 'react';
import { api } from './api';
import type { State } from './types';
import labels from '../shared/provider-routes.json';

export type ConnectionSpec = {
  id: string;
  label: string;
  provider: {
    kind: 'codex' | 'openai' | 'ollama';
    model?: string;
    effort?: string;
    base?: string;
    contextSize?: number;
    think?: boolean;
    protocol?: 'responses' | 'chat-completions';
    vision?: boolean;
    webSearch?: boolean;
  };
};
type Route = { primary: string; fallbacks: string[]; timeoutMs: number };
export type RoutingConfig = {
  kind: 'routing';
  version: 1;
  connections: ConnectionSpec[];
  routes: { default: Route; chat?: Route; vision?: Route; advice?: Route; offStream?: Route };
};
export type RoutingState = {
  config: RoutingConfig;
  connections: { id: string; configured: boolean }[];
};
const standard = (id: string): Route => ({ primary: id, fallbacks: [], timeoutMs: 45000 });

export function ProviderRouting({ state, disabled }: { state: State; disabled: boolean }) {
  const current = state.providerChoice!;
  const initial = (): RoutingConfig =>
    current.routing?.config || {
      kind: 'routing',
      version: 1,
      connections: [
        {
          id: 'main',
          label: '기존 연결',
          provider: {
            ...(current.config.kind === 'antigravity' ? {} : current.config),
            kind: current.config.kind === 'antigravity' ? 'codex' : current.config.kind,
            ...(current.config.kind === 'openai'
              ? {
                  model: current.config.model || state.provider.model,
                  base: 'https://api.openai.com/v1',
                  vision: true,
                  webSearch: true,
                }
              : {}),
          },
        },
      ],
      routes: { default: standard('main') },
    };
  const [draft, setDraft] = useState<RoutingConfig>(initial);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [keys, setKeys] = useState<Record<string, string>>({}),
    [probes, setProbes] = useState<Record<string, string>>({});
  const savedSignature = JSON.stringify(current.routing?.config || current.config);
  useEffect(() => {
    setDraft(initial());
    setKeys({});
    setProbes({});
  }, [savedSignature]);
  const change = (next: RoutingConfig) => {
    setDraft(next);
    setSaved(false);
    setError('');
  };
  const connection = (id: string, patch: Partial<ConnectionSpec>) =>
    change({
      ...draft,
      connections: draft.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  const provider = (c: ConnectionSpec, patch: Partial<ConnectionSpec['provider']>) =>
    connection(c.id, { provider: { ...c.provider, ...patch } });
  async function perform(fn: () => Promise<unknown>) {
    setPending(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '설정을 적용하지 못했습니다.');
    } finally {
      setPending(false);
    }
  }
  const matching =
    current.routing && JSON.stringify(draft) === JSON.stringify(current.routing.config);
  return (
    <details className="login-alternative">
      <summary>역할별 모델 라우팅</summary>
      <p>
        연결을 등록하고 작업별로 사용할 모델을 고르세요. 같은 대화와 기록을 사용하며, 지정하지 않은
        작업은 기본 경로를 따릅니다.
      </p>
      <fieldset
        className="provider-picker-fields"
        disabled={disabled || pending || current.changing}
      >
        {draft.connections.map((c, i) => (
          <section key={c.id} className="routing-card" aria-label={`모델 연결 ${i + 1}`}>
            <label>
              연결 이름
              <input
                aria-label={`연결 ${i + 1} 이름`}
                value={c.label}
                maxLength={80}
                onChange={(e) => connection(c.id, { label: e.target.value })}
              />
            </label>
            <label>
              연결 방식
              <select
                aria-label={`연결 ${i + 1} 방식`}
                value={c.provider.kind}
                onChange={(e) => {
                  const kind = e.target.value as ConnectionSpec['provider']['kind'];
                  connection(c.id, {
                    provider:
                      kind === 'ollama'
                        ? { kind, model: '', base: 'http://127.0.0.1:11434', contextSize: 65536 }
                        : kind === 'openai'
                          ? {
                              kind,
                              model: '',
                              base: 'https://api.openai.com/v1',
                              protocol: 'responses',
                              vision: false,
                              webSearch: false,
                            }
                          : { kind },
                  });
                  setKeys((k) => ({ ...k, [c.id]: '' }));
                }}
              >
                <option value="codex">ChatGPT 구독 · Codex</option>
                <option value="ollama">Ollama · 이 PC</option>
                <option value="openai">OpenAI 호환 API</option>
              </select>
            </label>
            <label>
              모델 ID
              <input
                aria-label={`연결 ${i + 1} 모델`}
                value={c.provider.model || ''}
                maxLength={200}
                placeholder={
                  c.provider.kind === 'codex' ? '비워두면 앱 기본 모델' : '제공처의 정확한 모델 ID'
                }
                onChange={(e) => provider(c, { model: e.target.value || undefined })}
              />
            </label>
            {c.provider.kind !== 'codex' && (
              <label>
                서버 주소
                <input
                  aria-label={`연결 ${i + 1} 주소`}
                  value={c.provider.base || ''}
                  maxLength={500}
                  onChange={(e) => provider(c, { base: e.target.value })}
                />
              </label>
            )}
            {c.provider.kind === 'ollama' ? (
              <>
                <label>
                  문맥 크기
                  <input
                    type="number"
                    min={4096}
                    max={131072}
                    value={c.provider.contextSize || 65536}
                    onChange={(e) => provider(c, { contextSize: Number(e.target.value) })}
                  />
                </label>
                <label>
                  추론 모드
                  <select
                    value={c.provider.think === undefined ? 'default' : String(c.provider.think)}
                    onChange={(e) =>
                      provider(c, {
                        think: e.target.value === 'default' ? undefined : e.target.value === 'true',
                      })
                    }
                  >
                    <option value="default">모델 기본</option>
                    <option value="false">끄기</option>
                    <option value="true">켜기</option>
                  </select>
                </label>
              </>
            ) : (
              <label>
                추론 수준
                <select
                  value={c.provider.effort || ''}
                  onChange={(e) => provider(c, { effort: e.target.value || undefined })}
                >
                  <option value="">기본</option>
                  {['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            )}
            {c.provider.kind === 'openai' && (
              <>
                <label>
                  API 형식
                  <select
                    value={c.provider.protocol || 'responses'}
                    onChange={(e) =>
                      provider(c, {
                        protocol: e.target.value as 'responses' | 'chat-completions',
                        webSearch: false,
                      })
                    }
                  >
                    <option value="responses">Responses</option>
                    <option value="chat-completions">Chat Completions</option>
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={!!c.provider.vision}
                    onChange={(e) => provider(c, { vision: e.target.checked })}
                  />
                  화면 입력 지원
                </label>
                {c.provider.protocol !== 'chat-completions' && (
                  <label>
                    <input
                      type="checkbox"
                      checked={!!c.provider.webSearch}
                      onChange={(e) => provider(c, { webSearch: e.target.checked })}
                    />
                    웹 검색 도구 지원
                  </label>
                )}
                <p className="field-note">
                  지정한 서버로 대화·필요한 화면이 전송됩니다. 해당 API 요금이 발생할 수 있습니다.
                  JSON Schema 응답을 지원하는 모델을 사용하세요.
                </p>
                <label>
                  이 연결의 API 키 · 앱 종료 시 삭제
                  <input
                    type="password"
                    autoComplete="off"
                    value={keys[c.id] || ''}
                    onChange={(e) => setKeys((k) => ({ ...k, [c.id]: e.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  className="secondary"
                  disabled={!matching}
                  onClick={() =>
                    void perform(async () => {
                      await api('connection/routing/key', { id: c.id, apiKey: keys[c.id] || '' });
                      setKeys((k) => ({ ...k, [c.id]: '' }));
                    })
                  }
                >
                  키 적용{!matching ? ' · 경로를 먼저 저장하세요' : ''}
                </button>
              </>
            )}
            {current.routing?.connections.find((v) => v.id === c.id) && (
              <small>
                {current.routing.connections.find((v) => v.id === c.id)?.configured
                  ? '설정 준비됨'
                  : '연결 확인 필요'}
              </small>
            )}
            <button
              type="button"
              className="secondary"
              disabled={!matching}
              onClick={() =>
                void perform(async () => {
                  const result = (await api('connection/routing/probe', { id: c.id })) as {
                    status: string;
                    reply?: string;
                    message?: string;
                  };
                  setProbes((p) => ({
                    ...p,
                    [c.id]:
                      result.status === 'ready'
                        ? result.reply || '응답 확인됨'
                        : result.message || '응답을 확인하지 못했습니다.',
                  }));
                })
              }
            >
              이 연결 응답 확인 · 1회 사용
            </button>
            {probes[c.id] && <p role="status">{probes[c.id]}</p>}
            <button
              type="button"
              className="secondary"
              disabled={
                draft.connections.length === 1 ||
                Object.values(draft.routes).some(
                  (r) => r.primary === c.id || r.fallbacks.includes(c.id),
                )
              }
              onClick={() => {
                change({ ...draft, connections: draft.connections.filter((v) => v.id !== c.id) });
                setKeys((k) => {
                  const next = { ...k };
                  delete next[c.id];
                  return next;
                });
              }}
            >
              연결 삭제
            </button>
          </section>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={draft.connections.length >= 20}
          onClick={() =>
            change({
              ...draft,
              connections: [
                ...draft.connections,
                {
                  id: crypto.randomUUID(),
                  label: `연결 ${draft.connections.length + 1}`,
                  provider: { kind: 'codex' },
                },
              ],
            })
          }
        >
          연결 추가
        </button>
        {Object.entries(labels).map(([key, label]) => {
          const role = key as keyof RoutingConfig['routes'],
            r = draft.routes[role];
          return (
            <section key={key} className="routing-card">
              <label>
                {label}
                <select
                  aria-label={`${label} 모델`}
                  value={r?.primary || ''}
                  onChange={(e) => {
                    const routes = { ...draft.routes };
                    if (e.target.value) routes[role] = standard(e.target.value);
                    else delete routes[role];
                    change({ ...draft, routes });
                  }}
                >
                  {key !== 'default' && <option value="">기본 경로 사용</option>}
                  {draft.connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              {r && (
                <>
                  {[0, 1].map((n) => (
                    <label key={n}>
                      대체 연결 {n + 1}
                      <select
                        aria-label={`${label} 대체 ${n + 1}`}
                        value={r.fallbacks[n] || ''}
                        disabled={n === 1 && !r.fallbacks[0]}
                        onChange={(e) => {
                          const fallbacks = [...r.fallbacks];
                          if (e.target.value) fallbacks[n] = e.target.value;
                          else fallbacks.splice(n);
                          change({
                            ...draft,
                            routes: { ...draft.routes, [role]: { ...r, fallbacks } },
                          });
                        }}
                      >
                        <option value="">사용 안 함</option>
                        {draft.connections
                          .filter(
                            (c) =>
                              c.id !== r.primary &&
                              !r.fallbacks.some((v, j) => j !== n && v === c.id),
                          )
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  ))}
                  <label>
                    연결당 응답 대기 (초)
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={r.timeoutMs / 1000}
                      onChange={(e) =>
                        change({
                          ...draft,
                          routes: {
                            ...draft.routes,
                            [role]: { ...r, timeoutMs: Number(e.target.value) * 1000 },
                          },
                        })
                      }
                    />
                  </label>
                </>
              )}
            </section>
          );
        })}
        <p className="field-note">
          방송 외 활동 → 요청받은 훈수 → 화면 → 일반 대화 순서로 경로를 결정합니다. 대체 연결은
          연결·모델 사용 불가 또는 시간 초과 때만 순서대로 사용합니다. 지정한 대체 서버에도 같은
          입력을 전송하며, 취소·인증·사용량 오류에서는 중단합니다.
        </p>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void perform(async () => {
              const response = (await api('connection/provider', draft)) as State['providerChoice'];
              if (response?.routing) setDraft(response.routing.config);
              setSaved(true);
            })
          }
        >
          {pending ? '적용 중…' : '역할별 경로 저장'}
        </button>
      </fieldset>
      {saved && <p role="status">역할별 경로를 저장했습니다.</p>}
      {error && (
        <p role="alert" className="connection-problem">
          {error}
        </p>
      )}
    </details>
  );
}
