import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReadingPosition } from './useReadingPosition';
import { api } from './api';
import type { State } from './types';
import './social-community.css';
import { SocialDiscussion, type Discussion } from './SocialDiscussion';
type Post = Discussion & {
  id: string;
  communityId: string;
  topicId: string;
  kind: string;
  title: string;
  text: string;
  at: number;
  author: string;
  authorIsViewer: boolean;
  sourceStatus: string;
  bookmarked: boolean;
};
type Prefs = {
  enabled: boolean;
  creativeImages: boolean;
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
  section,
  setSection,
}: {
  state: State;
  onError: (s: string) => void;
  children: ReactNode;
  section: 'broadcast' | 'outside';
  setSection: (section: 'broadcast' | 'outside') => void;
}) {
  const navigation = useReadingPosition(section);
  return (
    <div ref={navigation.ref} className="community-reading-space">
      <nav className="community-sections" aria-label="방송 밖 이야기 구획">
        <button
          aria-label="방송 커뮤니티"
          aria-pressed={section === 'broadcast'}
          onClick={() => navigation.move(() => setSection('broadcast'), true)}
        >
          방송 커뮤니티
        </button>
        <button
          aria-label="바깥 커뮤니티"
          aria-pressed={section === 'outside'}
          onClick={() => navigation.move(() => setSection('outside'), true)}
        >
          바깥 커뮤니티{' '}
          <span className="social-count" aria-label="저장된 게시글 수">
            {state.social?.threads ?? 0}
          </span>
        </button>
      </nav>
      <div hidden={section !== 'broadcast'}>{children}</div>
      <div hidden={section !== 'outside'}>
        <OutsideCommunity state={state} active={section === 'outside'} onError={onError} />
      </div>
    </div>
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
  const [loadedKey, setLoadedKey] = useState('');
  const listKey = JSON.stringify([community, submitted, offset, bookmarked]);
  const reading = useReadingPosition(
    selected ? 'post:' + selected.id : listKey,
    loadedKey === listKey,
    active,
  );
  const generation = useRef(0),
    revision = state.social?.revision,
    audienceKey = state.settings.personas
      .filter((p) => !p.system && state.audience.members[p.id]?.sessions > 0)
      .map((p) => p.id)
      .sort()
      .join('|');
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
          setLoadedKey(listKey);
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
  }, [active, revision, audienceKey, community, submitted, offset, bookmarked, refresh]);
  const selectedId = selected?.id;
  useEffect(() => {
    if (!active || !selectedId) return;
    let cancelled = false;
    // A new list item can push the open post onto another page. Its identity
    // and lifetime come from the detail endpoint, not the current list page.
    void (async () => {
      try {
        const response = await fetch('/api/social/threads/' + selectedId, {
          headers: { 'X-Backseat-Client': 'studio' },
        });
        if (cancelled) return;
        if (response.status === 404) {
          reading.move(() => setSelected(null));
          return;
        }
        const post = await response.json();
        if (!response.ok) throw new Error(post.error || '글을 불러오지 못했습니다.');
        if (!cancelled) setSelected((current) => (current?.id === selectedId ? post : current));
      } catch (error) {
        if (!cancelled) onError((error as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, selectedId, revision, audienceKey, refresh]);
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
          <p className="muted">관객과 일반 주민이 각자의 관심사로 나누는 이야기</p>
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
        <label>
          <input
            type="checkbox"
            checked={p.creativeImages}
            disabled={busy}
            onChange={(e) => void patch({ creativeImages: e.target.checked })}
          />{' '}
          주민 창작 이미지 · 픽셀 그림
        </label>
        <p className="muted">
          기본 OFF. 켜면 기존 AI가 일상 글과 함께 간단한 PNG 그림을 만들 수 있어요. 별도 유료 이미지
          API는 사용하지 않습니다.
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
          onClick={() =>
            reading.move(() => {
              setCommunity('');
              setSelected(null);
              setOffset(0);
            }, true)
          }
        >
          전체 이야기
        </button>
        {data.communities.map((c) => (
          <button
            key={c.id}
            className={community === c.id ? 'selected' : ''}
            aria-pressed={community === c.id}
            onClick={() =>
              reading.move(() => {
                setCommunity(c.id);
                setSelected(null);
                setOffset(0);
              }, true)
            }
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
          reading.move(() => {
            setSubmitted(query);
            setSelected(null);
            setOffset(0);
          }, true);
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
          onClick={() =>
            reading.move(() => {
              setQuery(state.settings.streamer);
              setSubmitted(state.settings.streamer);
              setSelected(null);
              setOffset(0);
            }, true)
          }
        >
          내 이야기 찾기
        </button>
        <label>
          <input
            type="checkbox"
            checked={bookmarked}
            onChange={(e) =>
              reading.move(() => {
                setBookmarked(e.target.checked);
                setOffset(0);
                setSelected(null);
              }, true)
            }
          />
          북마크
        </label>
      </form>
      <div ref={reading.ref} className="community-reading-content" tabIndex={-1}>
        {selected ? (
          <article
            className={`social-detail${selected.authorIsViewer ? ' social-viewer-post' : ''}`}
          >
            <button className="text-button" onClick={() => reading.move(() => setSelected(null))}>
              ← 글 목록
            </button>
            <h3>{selected.title}</h3>
            <small>
              <span className="social-author">
                {selected.author}
                {selected.authorIsViewer && <span className="social-viewer-badge">나의 관객</span>}
              </span>{' '}
              · {new Date(selected.at).toLocaleString('ko-KR')} ·{' '}
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
            <SocialDiscussion
              key={selected.id}
              post={selected}
              onError={onError}
              onChanged={() => setRefresh((v) => v + 1)}
            />
          </article>
        ) : (
          <div aria-live="polite">
            {data.posts.length === 0 ? (
              <div className="social-empty">
                <p>
                  {submitted || community || bookmarked
                    ? '현재 검색·필터에 맞는 이야기가 없어요.'
                    : '아직 저장된 이야기가 없어요. 주민들은 각자의 속도로 이야기를 나눕니다.'}
                </p>
                {(submitted || community || bookmarked) && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setCommunity('');
                      setQuery('');
                      setSubmitted('');
                      setBookmarked(false);
                      setOffset(0);
                    }}
                  >
                    전체 이야기 보기
                  </button>
                )}
              </div>
            ) : (
              data.posts.map((post) => (
                <button
                  className={`social-post${post.authorIsViewer ? ' social-viewer-post' : ''}`}
                  key={post.id}
                  data-reading-id={post.id}
                  onClick={() => reading.move(() => setSelected(post), false, true)}
                >
                  <span>
                    {data.communities.find((c) => c.id === post.communityId)?.name} ·{' '}
                    {post.kind === 'daily' ? '일상' : '방송 이야기'}
                  </span>
                  <strong>{post.title}</strong>
                  <small>
                    <span className="social-author">
                      {post.author}
                      {post.authorIsViewer && (
                        <span className="social-viewer-badge">나의 관객</span>
                      )}
                    </span>{' '}
                    · {new Date(post.at).toLocaleString('ko-KR')}
                    {post.bookmarked ? ' · 북마크' : ''}
                    {' · 댓글 ' +
                      post.comments.filter((c) => !c.deleted).length +
                      ' · 추천 ' +
                      post.recommendationCount}
                    {post.attachments.length > 0 ? ' · 첨부 ' + post.attachments.length : ''}
                  </small>
                </button>
              ))
            )}
            <div className="social-pages">
              <button
                className="secondary"
                disabled={offset === 0 || loading}
                onClick={() => reading.move(() => setOffset((v) => Math.max(0, v - 30)))}
              >
                이전
              </button>
              <span>{data.total}개 이야기</span>
              <button
                className="secondary"
                disabled={offset + 30 >= data.total || loading}
                onClick={() => reading.move(() => setOffset((v) => v + 30))}
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
