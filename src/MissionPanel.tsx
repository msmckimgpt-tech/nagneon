import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import './missions.css';

type Template = { id: string; title: string; type: string; condition: string };
type Participant = { personaId: string; name: string; amount?: number; reason: string };
type Campaign = {
  id: string;
  rootId: string;
  version: number;
  sessionId: string;
  gameId: string;
  gameName: string;
  proposerName: string;
  templateId: string;
  template: Template;
  target: number;
  total: number;
  supporterCount: number;
  reason: string;
  status: string;
  fundingDeadline: number;
  performanceDeadline: number | null;
  reviewDeadline: number | null;
  endReason: string;
  contributions: Participant[];
  opponents: Participant[];
};
export type MissionState = {
  enabled: boolean;
  error?: string;
  templates: Template[];
  wallets: Record<string, { balance: number; held: number; consumed: number }>;
  campaigns: Campaign[];
};
const statuses: Record<string, string> = {
  funding: '함께 모으는 중',
  ready: '수락 기다림',
  accepted: '진행 중',
  review: '완료 확인 기다림',
  completed: '완료 · 예치 소비',
  rejected: '거절 · 반환',
  cancelled: '취소 · 반환',
  expired: '기한 종료 · 반환',
  revised: '조건 변경 · 반환',
  failed: '미이행 · 반환',
};
const live = (m: Campaign) => ['funding', 'ready', 'accepted', 'review'].includes(m.status);
function remaining(deadline: number | null, now: number) {
  const seconds = Math.max(0, Math.ceil(((deadline || 0) - now) / 1000));
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}
export function MissionPanel({
  state,
  running,
  sessionId,
  gameId,
}: {
  state?: MissionState;
  running: boolean;
  sessionId: string | null;
  gameId: string;
}) {
  const requestBusy = useRef(false);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!state) return null;
  const command = async (values: Record<string, unknown>) => {
    if (requestBusy.current) return;
    requestBusy.current = true;
    setPending(true);
    setError('');
    try {
      await api('missions', { ...values, requestId: crypto.randomUUID() });
    } catch (e) {
      setError(e instanceof Error ? e.message : '미션 결정을 저장하지 못했어요.');
    } finally {
      requestBusy.current = false;
      setPending(false);
    }
  };
  return (
    <section className="panel mission-panel" aria-labelledby="mission-panel-title">
      <header className="mission-heading">
        <div>
          <b id="mission-panel-title">AI 관객 미션</b>
          <small>관객의 가상 미션점 · 기존 앱 가상P와 별도</small>
        </div>
        <button
          className="secondary"
          disabled={pending}
          onClick={() => void command({ kind: 'enabled', enabled: !state.enabled })}
        >
          {state.enabled ? '미션 전체 중지' : '미션 제안 켜기'}
        </button>
      </header>
      <p className="mission-help">
        모금은 부탁이에요. 수락은 자유이며 표시된 조건을 직접 확인한 뒤 예치를 소비해요.
      </p>
      {(error || state.error) && <p role="alert">{error || state.error}</p>}
      {!state.campaigns.some(live) && (
        <p className="muted">
          {state.enabled
            ? '보고 싶은 장면이 생기면 관심 있는 AI 관객이 제안해요. 모두 참여할 필요는 없어요.'
            : '미션 제안을 쉬고 있어요.'}
        </p>
      )}
      <div className="mission-list">
        {state.campaigns
          .slice(-5)
          .reverse()
          .map((m) => {
            const current = running && m.sessionId === sessionId && m.gameId === gameId;
            const deadline =
              m.status === 'review'
                ? m.reviewDeadline
                : m.status === 'accepted'
                  ? m.performanceDeadline
                  : m.fundingDeadline;
            const editable = current && ['funding', 'ready'].includes(m.status);
            return (
              <article className="mission-card" data-mission-id={m.id} key={m.id}>
                <header>
                  <b>{m.template.title}</b>
                  <span>{statuses[m.status] || m.status}</span>
                </header>
                <small>
                  {m.gameName} · 조건 v{m.version} ·{' '}
                  {m.template.type === 'performance' ? '수행형 · 승패 무관' : '성공형 · 처치 필요'}
                </small>
                <p className="mission-condition">{m.template.condition}</p>
                <p>
                  {m.proposerName}의 제안: {m.reason}
                </p>
                <progress
                  aria-label={`${m.template.title} 가상 모금`}
                  max={m.target}
                  value={m.total}
                />
                <p className="mission-funding">
                  {live(m) ? '예치' : '모금 이력'} {m.total}/{m.target}미션점 · AI 관객{' '}
                  {m.supporterCount}명 동참
                </p>
                {live(m) && (
                  <small>
                    남은{' '}
                    {m.status === 'review'
                      ? '확인'
                      : m.status === 'accepted'
                        ? '수행'
                        : '모금·수락'}{' '}
                    시간: {remaining(deadline, now)} · 기한 종료 시 반환
                  </small>
                )}
                {!!m.endReason && <p className="mission-result">{m.endReason}</p>}
                <details>
                  <summary>동참과 다른 의견</summary>
                  {m.contributions.map((p) => (
                    <p key={p.personaId}>
                      <b>{p.name}</b> · {p.amount}미션점: {p.reason}
                    </p>
                  ))}
                  {m.opponents.map((p) => (
                    <p key={p.personaId}>
                      <b>{p.name}</b> · 반대: {p.reason}
                    </p>
                  ))}
                  {!m.opponents.length && (
                    <p className="muted">
                      반대 의견이 기록되지 않았어요. 다른 AI 관객의 침묵은 찬성이 아니에요.
                    </p>
                  )}
                </details>
                <div className="mission-actions">
                  {current && m.status === 'ready' && (
                    <button
                      className="primary"
                      disabled={pending}
                      onClick={() => void command({ kind: 'accept', missionId: m.id })}
                    >
                      이 조건 수락
                    </button>
                  )}
                  {editable && (
                    <button
                      className="secondary"
                      disabled={pending}
                      onClick={() => void command({ kind: 'reject', missionId: m.id })}
                    >
                      거절 · 예치 반환
                    </button>
                  )}
                  {current && ['accepted', 'review'].includes(m.status) && (
                    <>
                      <button
                        className="primary"
                        disabled={pending}
                        onClick={() =>
                          void command({ kind: 'confirm', missionId: m.id, completed: true })
                        }
                      >
                        조건을 지켰어요 · 예치 소비
                      </button>
                      <button
                        className="secondary"
                        disabled={pending}
                        onClick={() =>
                          void command({ kind: 'confirm', missionId: m.id, completed: false })
                        }
                      >
                        조건 미충족 · 반환
                      </button>
                    </>
                  )}
                  {current && live(m) && (
                    <button
                      className="text-button"
                      disabled={pending}
                      onClick={() => void command({ kind: 'cancel', missionId: m.id })}
                    >
                      취소 · 반환
                    </button>
                  )}
                  {current && m.status === 'rejected' && (
                    <button
                      className="text-button"
                      disabled={pending}
                      onClick={() => void command({ kind: 'reopen', templateId: m.templateId })}
                    >
                      내 요청으로 같은 조건 재제안 허용
                    </button>
                  )}
                </div>
                {editable && (
                  <MissionRevision
                    mission={m}
                    templates={state.templates}
                    pending={pending}
                    command={command}
                  />
                )}
                {['accepted', 'review'].includes(m.status) && (
                  <p className="mission-help">
                    위 게임 조건을 직접 확인해주세요. AI 완료 후보만으로는 소비하지 않아요. 확인
                    지연·미이행·방송 종료 시 예치를 반환해요.
                  </p>
                )}
              </article>
            );
          })}
      </div>
    </section>
  );
}
function MissionRevision({
  mission,
  templates,
  pending,
  command,
}: {
  mission: Campaign;
  templates: Template[];
  pending: boolean;
  command: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [templateId, setTemplateId] = useState(mission.templateId),
    [target, setTarget] = useState(mission.target);
  return (
    <details className="mission-revision">
      <summary>조건을 바꿔 다시 제안</summary>
      <fieldset disabled={pending}>
        <label>
          게임 조건
          <select
            aria-label="새 미션 조건"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <p>{templates.find((t) => t.id === templateId)?.condition}</p>
        <label>
          새 목표 미션점
          <input
            aria-label="새 목표 미션점"
            type="number"
            min={20}
            max={200}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          />
        </label>
        <p className="mission-help">
          기존 예치를 전액 반환하고 새 조건으로 다시 모아요. 이전 동참은 승계되지 않아요.
        </p>
        <button
          className="secondary"
          disabled={!Number.isInteger(target) || target < 20 || target > 200}
          onClick={() =>
            void command({ kind: 'revise', missionId: mission.id, templateId, target })
          }
        >
          예치 반환 후 새 조건 제안
        </button>
      </fieldset>
    </details>
  );
}
