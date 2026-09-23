import { useState } from 'react';
import { api } from './api';

export type SocialComment = {
  id: string;
  name: string;
  text: string;
  parentId: string | null;
  at: number;
  deleted?: boolean;
  authorIsViewer: boolean;
};
export type SocialAttachment = {
  id: string;
  name: string;
  kind: 'image' | 'video';
  mime: string;
  bytes: number;
  url: string;
  available: boolean;
  generated?: boolean;
};
export type Discussion = {
  id: string;
  comments: SocialComment[];
  recommendationCount: number;
  recommended: boolean;
  attachments: SocialAttachment[];
};
export function SocialDiscussion({
  post,
  onChanged,
  onError,
}: {
  post: Discussion;
  onChanged: () => void;
  onError: (s: string) => void;
}) {
  const [text, setText] = useState(''),
    [reply, setReply] = useState<SocialComment | null>(null),
    [busy, setBusy] = useState(false),
    [failedMedia, setFailedMedia] = useState<string[]>([]);
  async function action(path: string, body?: unknown, method = 'POST') {
    if (busy) return;
    setBusy(true);
    try {
      await api('social/threads/' + post.id + '/' + path, body, method);
      onChanged();
    } catch (e) {
      onError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const comment = (c: SocialComment) => (
    <article
      key={c.id}
      className={`social-comment${c.authorIsViewer ? ' social-viewer-post' : ''}`}
    >
      <small>
        {c.name} {c.authorIsViewer && <span className="social-viewer-badge">나의 관객</span>} ·{' '}
        {new Date(c.at).toLocaleString('ko-KR')}
      </small>
      <p>{c.text}</p>
      {!c.deleted && (
        <div className="social-actions">
          <button className="text-button" disabled={busy} onClick={() => setReply(c)}>
            답글
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void action('comments/' + c.id, undefined, 'DELETE').catch(() => {})}
          >
            댓글 지우기
          </button>
        </div>
      )}
    </article>
  );
  return (
    <section className="social-discussion" aria-label="댓글과 첨부">
      <div className="social-actions">
        <button
          disabled={busy}
          aria-pressed={post.recommended}
          onClick={() =>
            void action('recommendation', { recommended: !post.recommended }, 'PUT').catch(() => {})
          }
        >
          {post.recommended ? '추천 취소' : '추천'} · {post.recommendationCount}
        </button>
        <span>댓글 {post.comments.filter((c) => !c.deleted).length}</span>
      </div>
      <div className="social-attachments">
        {post.attachments.map((a) => (
          <figure key={a.id}>
            {a.available && !failedMedia.includes(a.id) ? (
              a.kind === 'image' ? (
                <img
                  src={a.url}
                  alt={a.name}
                  loading="lazy"
                  onError={() => setFailedMedia((v) => [...v, a.id])}
                />
              ) : (
                <video
                  src={a.url}
                  controls
                  preload="metadata"
                  playsInline
                  onError={() => setFailedMedia((v) => [...v, a.id])}
                />
              )
            ) : (
              <p>
                {a.available
                  ? '이 첨부를 표시할 수 없습니다. 파일 형식과 코덱을 확인하세요.'
                  : '원본 첨부파일이 없습니다.'}
              </p>
            )}
            <figcaption>
              {a.name}
              {a.generated ? ' · 주민 창작 그림' : ''} · {Math.ceil(a.bytes / 1024)}KB
            </figcaption>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void action('attachments/' + a.id, undefined, 'DELETE').catch(() => {})
              }
            >
              첨부 지우기
            </button>
          </figure>
        ))}
      </div>
      <label className="social-upload">
        이미지·동영상 첨부
        <input
          aria-label="이미지·동영상 첨부"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm"
          disabled={busy || post.attachments.length >= 4}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (file.size > (file.type.startsWith('image/') ? 8 : 24) * 1024 * 1024) {
              onError('이미지는 8MB, 동영상은 24MB 이하로 선택하세요.');
              return;
            }
            setBusy(true);
            try {
              const response = await fetch('/api/social/threads/' + post.id + '/attachments', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/octet-stream',
                  'X-Backseat-Client': 'studio',
                  'X-File-Name': encodeURIComponent(file.name),
                },
                body: file,
              });
              if (!response.ok)
                throw Error((await response.json()).error || '첨부하지 못했습니다.');
              onChanged();
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <p className="muted">글당 4개 · 이미지 8MB / 동영상 24MB · 자동 재생 없음</p>
      <h4>댓글</h4>
      {post.comments.length === 0 && <p className="muted">아직 댓글이 없어요.</p>}
      {post.comments
        .filter((c) => !c.parentId)
        .map((c) => (
          <div key={c.id}>
            {comment(c)}
            <div className="social-replies">
              {post.comments.filter((r) => r.parentId === c.id).map(comment)}
            </div>
          </div>
        ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await action('comments', { text, parentId: reply?.id || null });
            setText('');
            setReply(null);
          } catch {}
        }}
      >
        {reply && (
          <div className="social-actions">
            <span>{reply.name}님에게 답글</span>
            <button type="button" className="text-button" onClick={() => setReply(null)}>
              답글 취소
            </button>
          </div>
        )}
        <label>
          {reply ? '답글 작성' : '댓글 작성'}
          <textarea
            aria-label="댓글 내용"
            required
            maxLength={600}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
        </label>
        <button disabled={busy || !text.trim()}>
          {busy ? '저장 중…' : reply ? '답글 등록' : '댓글 등록'}
        </button>
      </form>
    </section>
  );
}
