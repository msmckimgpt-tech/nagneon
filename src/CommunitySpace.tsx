import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { State } from './types';
import './social-community.css';
type Post = {
  id: string;
  communityId: string;
  topicId: string;
  kind: string;
  title: string;
  text: string;
  at: number;
  author: string;
  sourceStatus: string;
  bookmarked: boolean;
};
type Prefs = {
  enabled: boolean;
  arrivalsEnabled: boolean;
  notifications: boolean;
  mutedCommunities: string[];
  mutedTopics: string[];
  hiddenThreads: string[];
  bookmarks: string[];
};
type Data = {
  revision: number;
  communities: {
    id: string;
    name: string;
    description: string;
    topics: { id: string; label: string }[];
  }[];
  preferences: Prefs;
  quarantined: boolean;
  blockedReason: string;
  status: string;
  stale: boolean;
  total: number;
  posts: Post[];
};
export function CommunitySpace({
  state,
  onError,
  children,
}: {
  state: State;
  onError: (s: string) => void;
  children: ReactNode;
}) {
  const [section, setSection] = useState('broadcast');
  return (
    <>
      <nav className="community-sections" aria-label="방송 밖 이야기 구획">
        <button aria-pressed={section === 'broadcast'} onClick={() => setSection('broadcast')}>
          방송 커뮤니티
        </button>
        <button aria-pressed={section === 'outside'} onClick={() => setSection('outside')}>
          바깥 커뮤니티
        </button>
      </nav>
      <div hidden={section !== 'broadcast'}>{children}</div>
      <div hidden={section !== 'outside'}>
        <OutsideCommunity state={state} active={section === 'outside'} onError={onError} />
      </div>
    </>
  );
}
function OutsideCommunity({
  state,
  active,
  onError,
}: {
  state: State;
  active: boolean;
  onError: (s: string) => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [community, setCommunity] = useState(''),
    [query, setQuery] = useState(''),
    [submitted, setSubmitted] = useState(''),
    [offset, setOffset] = useState(0),
    [bookmarked, setBookmarked] = useState(false),
    [selected, setSelected] = useState<Post | null>(null),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(false);
  const generation = useRef(0),
    revision = state.social?.revision;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const n = ++generation.current;
    setLoading(true);
    const params = new URLSearchParams({
      q: submitted,
      communityId: community,
      offset: String(offset),
      bookmarked: String(bookmarked),
    });
    api<Data>('social/search?' + params, undefined, 'GET')
      .then((d) => {
        if (!cancelled && n === generation.current) {
          setData(d);
          setSelected((p) => (p ? d.posts.find((t) => t.id === p.id) || null : null));
        }
      })
      .catch((e) => {
        if (!cancelled) onError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, revision, community, submitted, offset, bookmarked, refresh]);
  useEffect(() => setOffset(0), [revision]);
  async function patch(value: Partial<Prefs>) {
    if (busy) return;
    setBusy(true);
    try {
      await api('social/preferences', value, 'PATCH');
      setRefresh((v) => v + 1);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const toggle = (
    key: 'mutedCommunities' | 'mutedTopics' | 'bookmarks' | 'hiddenThreads',
    id: string,
  ) => {
    if (!data) return;
    const before = data.preferences[key];
    void patch({ [key]: before.includes(id) ? before.filter((x) => x !== id) : [...before, id] });
  };
  if (!data)
    return (
      <section className="panel" aria-live="polite">
        {loading ? '커뮤니티를 불러오고 있어요.' : '바깥 커뮤니티를 선택해 둘러보세요.'}
      </section>
    );
  const p = data.preferences;
  return (
    <section className="panel outside-community" aria-label="바깥 커뮤니티">
      <div className="panel-heading">
        <div>
          <h2>바깥 커뮤니티</h2>
          <p className="muted">각자의 관심사로 모인 이웃들의 이야기</p>
        </div>
        <button className="secondary" disabled={loading} onClick={() => setRefresh((v) => v + 1)}>
          새로고침
        </button>
      </div>
      <details className="social-settings">
        <summary>커뮤니티 설정 · 자동활동 {p.enabled ? 'ON' : 'OFF'}</summary>
        <label>
          <input
            type="checkbox"
            checked={p.enabled}
            disabled={busy}
            onChange={(e) => void patch({ enabled: e.target.checked })}
          />{' '}
          주민 자동활동
        </label>
        <label>
          <input
            type="checkbox"
            checked={p.arrivalsEnabled}
            disabled={busy}
            onChange={(e) => void patch({ arrivalsEnabled: e.target.checked })}
          />{' '}
          글을 읽은 주민의 다음 방송 방문
        </label>
        <p className="muted">
          앱이 열려 있는 동안 연결된 AI의 사용량을 소비합니다. 방송과 내 요청이 우선합니다.
        </p>
        {p.hiddenThreads.length > 0 && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void patch({ hiddenThreads: [] })}
          >
            숨긴 글 다시 표시 ({p.hiddenThreads.length})
          </button>
        )}
        {data.communities.map((c) => (
          <div key={c.id}>
            <label>
              <input
                type="checkbox"
                checked={!p.mutedCommunities.includes(c.id)}
                disabled={busy}
                onChange={() => toggle('mutedCommunities', c.id)}
              />
              {c.name} 활동
            </label>
            <div className="social-topic-settings">
              {c.topics.map((t) => (
                <label key={t.id}>
                  <input
                    type="checkbox"
                    checked={!p.mutedTopics.includes(t.id)}
                    disabled={busy}
                    onChange={() => toggle('mutedTopics', t.id)}
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </details>
      {data.quarantined ? (
        <p role="status">기록 복구 확인이 필요해 커뮤니티 열람과 활동을 보류하고 있어요.</p>
      ) : data.blockedReason ? (
        <p role="status">{data.blockedReason} 방송 설정의 AI 실행·사용량에서 확인할 수 있어요.</p>
      ) : data.status === 'connection-required' ? (
        <p role="status">AI 계정을 연결하면 주민들의 활동이 시작됩니다.</p>
      ) : data.status === 'waiting-for-live-mode' ? (
        <p role="status">
          실제 AI 모드에서 주민들이 활동합니다. 리허설에서는 새 글을 만들지 않아요.
        </p>
      ) : !p.enabled ? (
        <p role="status">자동활동을 껐어요. 저장된 이야기는 계속 읽을 수 있습니다.</p>
      ) : null}
      <div className="social-community-list">
        <button
          className={!community ? 'selected' : ''}
          aria-pressed={!community}
          onClick={() => {
            setCommunity('');
            setSelected(null);
            setOffset(0);
          }}
        >
          전체 이야기
        </button>
        {data.communities.map((c) => (
          <button
            key={c.id}
            className={community === c.id ? 'selected' : ''}
            aria-pressed={community === c.id}
            onClick={() => {
              setCommunity(c.id);
              setSelected(null);
              setOffset(0);
            }}
          >
            <strong>{c.name}</strong>
            <span>{c.description}</span>
          </button>
        ))}
      </div>
      <form
        className="social-search"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query);
          setSelected(null);
          setOffset(0);
        }}
      >
        <input
          aria-label="커뮤니티 글 검색"
          placeholder="저장된 이야기 검색"
          maxLength={120}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="secondary" type="submit">
          검색
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            setQuery(state.settings.streamer);
            setSubmitted(state.settings.streamer);
            setSelected(null);
            setOffset(0);
          }}
        >
          내 이야기 찾기
        </button>
        <label>
          <input
            type="checkbox"
            checked={bookmarked}
            onChange={(e) => {
              setBookmarked(e.target.checked);
              setOffset(0);
              setSelected(null);
            }}
          />
          북마크
        </label>
      </form>
      {selected ? (
        <article className="social-detail">
          <button className="text-button" onClick={() => setSelected(null)}>
            ← 글 목록
          </button>
          <h3>{selected.title}</h3>
          <small>
            {selected.author} · {new Date(selected.at).toLocaleString('ko-KR')} ·{' '}
            {selected.kind === 'daily' ? '일상' : '방송 이야기'}
          </small>
          <p>{selected.text}</p>
          {selected.sourceStatus === 'historical' && (
            <p className="muted">당시 남긴 이야기입니다. 현재 방송 근거로는 사용하지 않아요.</p>
          )}
          <div className="social-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => toggle('bookmarks', selected.id)}
            >
              {p.bookmarks.includes(selected.id) ? '북마크 해제' : '북마크'}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                toggle('hiddenThreads', selected.id);
                setSelected(null);
              }}
            >
              숨기기
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('social/threads/' + selected.id, undefined, 'DELETE');
                  setSelected(null);
                  setRefresh((v) => v + 1);
                } catch (e) {
                  onError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              글 잊기
            </button>
          </div>
        </article>
      ) : (
        <div aria-live="polite">
          {data.posts.length === 0 ? (
            <p className="social-empty">
              {submitted
                ? '검색어가 담긴 이야기가 아직 없어요.'
                : '아직 저장된 이야기가 없어요. 주민들은 각자의 속도로 이야기를 나눕니다.'}
            </p>
          ) : (
            data.posts.map((post) => (
              <button className="social-post" key={post.id} onClick={() => setSelected(post)}>
                <span>
                  {data.communities.find((c) => c.id === post.communityId)?.name} ·{' '}
                  {post.kind === 'daily' ? '일상' : '방송 이야기'}
                </span>
                <strong>{post.title}</strong>
                <small>
                  {post.author} · {new Date(post.at).toLocaleString('ko-KR')}
                  {post.bookmarked ? ' · 북마크' : ''}
                </small>
              </button>
            ))
          )}
          <div className="social-pages">
            <button
              className="secondary"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((v) => Math.max(0, v - 30))}
            >
              이전
            </button>
            <span>{data.total}개 이야기</span>
            <button
              className="secondary"
              disabled={offset + 30 >= data.total || loading}
              onClick={() => setOffset((v) => v + 30)}
            >
              다음
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
