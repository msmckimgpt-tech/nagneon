import { useEffect, useState } from 'react';
import './community-fact.css';
import {
  publicStoredTrendFact,
  isCurrentStoredTrendFact,
  type CommunityFactRecord,
} from '../server/culture/trend-fact-context.js';

export type TrendInputStatus = {
  connection: 'disconnected' | 'connected' | 'synthetic';
  activeFacts: number;
  validUntil?: number;
};
export type { CommunityFactRecord } from '../server/culture/trend-fact-context.js';
export type FactPost = {
  externalFact?: CommunityFactRecord;
  externalFactStatus?: 'observed' | 'expired' | 'synthetic';
  reactionKind?: 'fictional-personal-reaction';
};
const timestamp = (value: number) => Number.isFinite(value) && value >= 0 && value <= 8.64e15;
export function communityFactState(post: FactPost, now: number) {
  if (!post.externalFact) return null;
  const f = publicStoredTrendFact(post.externalFact);
  if (!f || !timestamp(now) || f.observedAt > now) return 'unverified';
  if (!isCurrentStoredTrendFact(f, now)) return 'expired';
  return f.evidenceKind === 'synthetic' ? 'synthetic' : 'observed';
}
const labels = {
  observed: '출처가 있는 가상 반응',
  synthetic: '합성 입력에 대한 가상 반응',
  expired: '유효기간이 지난 근거',
  unverified: '확인할 수 없는 근거',
};
export function CommunityFactInputStatus({
  input,
  now,
}: {
  input?: TrendInputStatus;
  now?: number;
}) {
  const [clock, setClock] = useState(() => now ?? Date.now());
  useEffect(() => {
    if (now !== undefined) return;
    setClock(Date.now());
    const deadline = input?.validUntil;
    if (deadline === undefined || !timestamp(deadline) || deadline <= Date.now()) return;
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.min(deadline - Date.now() + 1, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [input?.validUntil, now]);
  const text =
    input?.connection === 'synthetic'
      ? '합성 입력으로 확인 중이에요. 실제 최신 소식이 아니에요.'
      : input?.connection === 'connected' &&
          input.activeFacts > 0 &&
          input.validUntil !== undefined &&
          timestamp(input.validUntil) &&
          (now ?? clock) < input.validUntil
        ? '공개 출처에서 관측한 근거가 있어요. 반응은 가상 인물의 의견입니다.'
        : input?.connection === 'connected'
          ? '연결되었지만 현재 유효한 근거가 없어요. 최신 소식은 확인하지 않았어요.'
          : '사실 입력 미연결 · 최신 소식은 확인하지 않았어요.';
  return (
    <p className="community-fact-input" role="status">
      {text}
    </p>
  );
}
export function CommunityFact({
  post,
  compact = false,
  now,
}: {
  post: FactPost;
  compact?: boolean;
  now?: number;
}) {
  const [clock, setClock] = useState(() => now ?? Date.now());
  const f = publicStoredTrendFact(post.externalFact);
  useEffect(() => {
    if (now !== undefined || !f) return;
    setClock(Date.now());
    const deadline = f.expiresAt;
    if (!timestamp(deadline) || deadline <= Date.now()) return;
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.min(deadline - Date.now() + 1, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [f?.expiresAt, f?.publishedAt, now]);
  const status = communityFactState(post, now ?? clock);
  if (!status) return null;
  if (compact) return <span className="community-fact-summary">{labels[status]}</span>;
  if (status === 'unverified')
    return (
      <aside className="community-fact" aria-label="외부 사실 근거">
        <p>근거를 확인할 수 없어 현재 화제로 사용하지 않아요.</p>
      </aside>
    );
  if (!f) return null;
  const date = (value: number) => (
    <time dateTime={new Date(value).toISOString()}>{new Date(value).toLocaleString('ko-KR')}</time>
  );
  const topicMetrics = f.metrics.filter((m) => m.scope === 'topic');
  const metricNames = {
    views: '조회',
    comments: '댓글',
    reactions: '반응',
    'concurrent-players': '게임 동접',
  };
  const metrics = f.metrics;
  return (
    <aside className="community-fact" aria-label="외부 사실 근거">
      <strong>{labels[status]}</strong>
      {status === 'expired' && (
        <p>현재 화제로 사용하지 않아요. 자동 대화의 근거로는 만료됐습니다.</p>
      )}
      <p>
        <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer">
          {f.headline}
        </a>
      </p>
      <dl>
        <dt>게시</dt>
        <dd>{date(f.publishedAt)}</dd>
        <dt>관측</dt>
        <dd>{date(f.observedAt)}</dd>
        <dt>만료</dt>
        <dd>{date(f.expiresAt)}</dd>
      </dl>
      {metrics.map((m, i) => (
        <p key={i}>
          {f.evidenceKind === 'synthetic' ? '합성 관측값' : '관측값'}: {metricNames[m.kind]}{' '}
          {m.value.toLocaleString('ko-KR')} ·{' '}
          {m.scope === 'game' ? '게임 범위' : '해당 출처의 이슈 범위'} · {date(m.observedAt)}
          <br />
          <small>지표 출처: {m.sourceUrl}</small>
        </p>
      ))}
      {topicMetrics.length ? (
        <p>
          {f.evidenceKind === 'synthetic' ? '합성 지표' : '출처의 관측값'}:{' '}
          {topicMetrics
            .map((m) => `${metricNames[m.kind]} ${m.value.toLocaleString('ko-KR')}`)
            .join(' · ')}
          . 인터넷 전체의 인기도를 뜻하지 않아요.
        </p>
      ) : (
        <p>이슈 화제 규모: 미관측. 게임 동접으로 이 이슈의 인기를 판단하지 않아요.</p>
      )}
      <p>위 내용은 출처의 근거이며, 글과 댓글은 가상 인물의 개인 의견입니다.</p>
    </aside>
  );
}
