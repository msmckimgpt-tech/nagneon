import { useState } from 'react';
import { ArrowUpRight, Activity, ShieldCheck, Pause, Play } from 'lucide-react';
import { api } from './api';
import type { State } from './types';
import type { AiPolicy, AiUsage } from './ai-types';
import './ai-dashboard.css';

const number = (n: number | null | undefined) => (n == null ? '미보고' : n.toLocaleString('ko-KR'));
const stamp = (n: number) =>
  new Date(n).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
const scopes: Record<string, string> = {
  live: '방송 중 자동',
  background: '방송 밖 자동',
  manual: '직접 실행',
};
const outcomes: Record<string, string> = {
  running: '응답 대기',
  completed: '응답 완료',
  failed: '실패',
  cancelled: '취소',
  interrupted: '종료 시 확인 불가',
};
const empty: AiUsage = {
  calls: 0,
  failed: 0,
  cancelled: 0,
  unknown: 0,
  input: 0,
  cached: 0,
  output: 0,
  total: 0,
  estimatedUsd: 0,
  priced: 0,
};

export function AiDashboard({
  state,
  connected,
  navigate,
}: {
  state: State;
  connected: boolean;
  navigate: (destination: string) => void;
}) {
  const ai = state.ai;
  const [period, setPeriod] = useState<'today' | 'week' | 'session'>('today');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [rate, setRate] = useState({
    connection: '',
    model: '',
    input: '',
    cached: '',
    output: '',
  });
  if (!ai) return <div className="panel">AI 상태를 불러오는 중입니다.</div>;
  const totals = Object.values(ai.usage[period]).reduce(
    (a, b) =>
      Object.fromEntries(
        Object.keys(a).map((k) => [k, a[k as keyof AiUsage] + b[k as keyof AiUsage]]),
      ) as AiUsage,
    { ...empty },
  );
  const disabled = pending || !connected;
  async function update(patch: Partial<AiPolicy>) {
    if (disabled) return;
    setPending(true);
    setError('');
    try {
      await api('ai/policy', patch, 'PATCH');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 설정을 저장하지 못했습니다.');
    } finally {
      setPending(false);
    }
  }
  const visible = ai.features.filter(
    (f) =>
      !f.retired &&
      (filter === 'all' ||
        (filter === 'active' && ai.active.some((o) => o.featureId === f.id)) ||
        filter === f.scope) &&
      `${f.name} ${f.trigger}`.includes(query),
  );
  const title = !connected
    ? '연결 끊김 · 현재 상태 확인 불가'
    : ai.storageError
      ? '기록 저장 확인 필요'
      : ai.policy.paused
        ? '모든 AI 호출 차단 중'
        : ai.active.length
          ? `AI ${ai.active.length}개 작업 실행 중`
          : ai.policy.background
            ? '방송 밖 자동 AI 허용 중'
            : '방송 밖 자동 AI 차단 중';
  return (
    <div className="ai-dashboard">
      <section
        className={'ai-overview panel ' + (ai.policy.background ? 'ai-caution' : '')}
        aria-label="AI 전체 상태"
      >
        <div>
          <span className="ai-kicker">AI CONTROL</span>
          <h2>
            <ShieldCheck size={24} />
            {title}
          </h2>
          <p>
            {!connected
              ? '마지막 수신 상태입니다. 연결을 확인하면 조작할 수 있습니다.'
              : ai.policy.paused
                ? '앱을 다시 열어도 차단이 유지됩니다. 이미 전송된 요청에는 사용량이 발생할 수 있습니다.'
                : ai.policy.background
                  ? '앱을 켜둔 동안 커뮤니티 활동과 문화 자료 분석이 조건에 따라 AI를 호출할 수 있습니다.'
                  : '앱을 켜두기만 해서는 방송 밖 자동 AI를 호출하지 않습니다. 직접 실행하는 기능은 별도입니다.'}
          </p>
        </div>
        <button
          className={ai.policy.paused ? 'primary' : 'secondary'}
          disabled={disabled}
          onClick={() => void update({ paused: !ai.policy.paused })}
        >
          {ai.policy.paused ? <Play size={17} /> : <Pause size={17} />}{' '}
          {ai.policy.paused ? 'AI 호출 차단 해제' : '모든 AI 호출 차단'}
        </button>
      </section>
      {(error || ai.storageError) && (
        <p className="ai-error" role="alert">
          {error || ai.storageError}
        </p>
      )}
      <div className="ai-flow" aria-label="AI 동작 순서">
        <span>화면·음성·직접 요청</span>
        <b>→</b>
        <span>실행 허용·조건 확인</span>
        <b>→</b>
        <span className={ai.active.length ? 'ai-live' : ''}>
          모델 호출 <strong>{connected ? ai.active.length : '?'}</strong>
        </span>
        <b>→</b>
        <span>응답 확인·결과 반영</span>
      </div>
      <section className="ai-policy panel" aria-label="AI 기본 정책">
        <label className="ai-switch">
          <input
            type="checkbox"
            role="switch"
            checked={ai.policy.background}
            disabled={disabled}
            onChange={(e) => void update({ background: e.target.checked })}
          />
          <span>
            <b>방송 밖 자동 AI 허용</b>
            <small>기본은 차단입니다. 켜면 아래에서 허용한 자동 활동이 동작합니다.</small>
          </span>
        </label>
        <div>
          <b>사용량을 확인하며 직접 관리하세요</b>
          <small>
            앱은 사용량 상한을 설정하지 않습니다. 필요할 때 전체 또는 기능별 AI 호출을 차단할 수
            있습니다.
          </small>
        </div>
      </section>
      <section aria-label="AI 사용량">
        <div className="ai-section-heading">
          <h2>사용량</h2>
          <div className="ai-segments" aria-label="사용량 기간">
            {(
              [
                ['today', '오늘'],
                ['week', '최근 7일'],
                ['session', '이번 방송'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} aria-pressed={period === key} onClick={() => setPeriod(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="ai-metrics">
          <article className="panel">
            <small>모델 요청 시도</small>
            <strong>
              {number(totals.calls)}
              <small>회</small>
            </strong>
            <span>
              실패 {totals.failed} · 취소 {totals.cancelled}
            </span>
          </article>
          <article className="panel">
            <small>보고된 토큰</small>
            <strong>{number(totals.total)}</strong>
            <span>토큰 총량 미보고 {totals.unknown}회</span>
          </article>
          <article className="panel">
            <small>확인 가능한 API 예상 비용</small>
            <strong>{totals.priced ? `$${totals.estimatedUsd.toFixed(4)}` : '계산 불가'}</strong>
            <span>단가와 토큰이 확인된 {totals.priced}회만 포함</span>
          </article>
        </div>
        <p className="ai-note">
          나그네온에서 이 기록 기능을 적용한 이후의 사용량입니다. 구독 잔여량·실제 청구액은
          제공처에서 확인하세요. 미보고는 0이 아니며, 로컬 모델도 기기 자원을 사용합니다.
        </p>
      </section>
      <section className="panel ai-features" aria-label="기능별 AI 관리">
        <div className="ai-section-heading">
          <h2>기능별 AI 관리</h2>
          <input
            aria-label="AI 기능 검색"
            placeholder="기능 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="ai-segments ai-filters">
          {[
            ['all', '전체'],
            ['active', '실행 중'],
            ['live', '방송 중 자동'],
            ['background', '방송 밖 자동'],
            ['manual', '직접 실행'],
          ].map(([key, label]) => (
            <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="ai-table-scroll">
          <table>
            <thead>
              <tr>
                <th>기능 / 실행 조건</th>
                <th>현재 상태</th>
                <th>요청 / 보고된 토큰</th>
                <th>실행 허용</th>
                <th>바로가기</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((f) => {
                const active = ai.active.find((o) => o.featureId === f.id),
                  usage = ai.usage[period][f.id] || empty;
                const status = !connected
                  ? '확인 불가'
                  : active
                    ? active.status === 'cancelling'
                      ? '취소 처리 중'
                      : '실행 중'
                    : f.reason
                      ? '차단'
                      : !f.ready
                        ? '준비 필요'
                        : '조건 대기';
                return (
                  <tr key={f.id}>
                    <td>
                      <b>{f.name}</b>
                      <small>
                        {scopes[f.scope]} · {f.trigger}
                      </small>
                    </td>
                    <td>
                      <span className={'ai-status ' + (active ? 'ai-live' : '')}>{status}</span>
                      <small>
                        {!connected
                          ? '마지막 수신 상태'
                          : f.reason ||
                            (!f.ready
                              ? f.id === 'culture'
                                ? '분석할 공개 도메인을 설정하세요.'
                                : '현재 로컬 음성 인식을 사용합니다.'
                              : '실행 조건을 충족하면 호출합니다.')}
                      </small>
                      {!f.reason && f.nextAt && (
                        <small>다음 확인 가능 {stamp(f.nextAt)} 이후</small>
                      )}
                    </td>
                    <td>
                      <b>
                        {number(usage.calls)}회 / {number(usage.total)}
                      </b>
                      <small>
                        {usage.unknown ? `총량 미보고 ${usage.unknown}회` : '보고된 총량 기준'}
                      </small>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={`${f.name} 실행 허용`}
                        checked={f.enabled}
                        disabled={disabled}
                        onChange={(e) => void update({ features: { [f.id]: e.target.checked } })}
                      />
                    </td>
                    <td>
                      <button
                        className="secondary"
                        aria-label={`${f.name} 화면으로 이동`}
                        onClick={() => navigate(f.destination)}
                      >
                        <ArrowUpRight size={16} />
                        <span>열기</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!visible.length && <p className="ai-empty">해당하는 AI 기능이 없습니다.</p>}
        <p className="ai-note">
          허용 스위치를 켜도 즉시 호출하지 않습니다. 전체 차단·기능 설정을 함께 확인합니다. 재개 시
          지난 요청을 몰아서 실행하지 않습니다.
        </p>
      </section>
      <section className="panel">
        <div className="ai-section-heading">
          <h2>
            <Activity size={18} /> 최근 요청
          </h2>
          <small>최근 40건 · 실패·취소 포함</small>
        </div>
        {ai.recent.length ? (
          <div className="ai-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>시각 / 기능</th>
                  <th>제공처 / 실제 모델</th>
                  <th>요청 결과</th>
                  <th>입력 / 캐시 / 출력</th>
                  <th>총 토큰</th>
                </tr>
              </thead>
              <tbody>
                {ai.recent.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {stamp(r.at)}
                      <small>
                        {ai.features.find((f) => f.id === r.featureId)?.name || r.featureId}
                      </small>
                    </td>
                    <td>
                      {r.provider}
                      <small>
                        {r.model}
                        {r.connection && ` · ${r.connection}`}
                      </small>
                    </td>
                    <td>
                      {outcomes[r.status] || r.status}
                      <small>
                        {r.application === 'accepted' ? '결과 반영 확인' : '결과 반영 미확인'}
                      </small>
                    </td>
                    <td>
                      {number(r.usage?.input)} / {number(r.usage?.cached)} /{' '}
                      {number(r.usage?.output)}
                    </td>
                    <td>{number(r.usage?.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ai-empty">
            아직 모델 요청 기록이 없습니다. 대시보드를 여는 동작은 AI를 호출하지 않습니다.
          </p>
        )}
      </section>
      <div className="ai-bottom-grid">
        <section className="panel">
          <h3>입력 장치와 로컬 처리</h3>
          <p>
            AI 호출 차단은 화면 공유·마이크·로컬 음성 인식을 종료하지 않습니다. 장치 상태는
            방송실에서 확인하고 중지할 수 있습니다.
          </p>
          <button className="secondary" onClick={() => navigate('studio')}>
            방송실에서 장치 확인 <ArrowUpRight size={16} />
          </button>
        </section>
        <section className="panel">
          <h3>사용 중인 모델과 연결</h3>
          <p>
            기능에 따라 지정한 모델과 대체 연결을 사용합니다. 실제 요청마다 위 기록에 남으며, 대체
            요청도 사용 기록에 별도로 남습니다.
          </p>
          <button className="secondary" onClick={() => navigate('settings:connection')}>
            AI 연결·모델 설정 <ArrowUpRight size={16} />
          </button>
        </section>
      </div>
      <details className="panel ai-rates">
        <summary>API 예상 비용 단가 설정</summary>
        <p>
          사용 중인 연결 ID와 모델에 해당하는 100만 토큰당 USD 단가를 직접 입력하세요. 입력 토큰 중
          캐시를 분리해 계산합니다. 도구·음성·기타 요금은 포함하지 않으며 구독·로컬 모델에는
          적용하지 않습니다. 저장 이후 요청에 적용됩니다.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !rate.model.trim() ||
              [rate.input, rate.cached, rate.output].some(
                (v) => v === '' || !Number.isFinite(Number(v)) || Number(v) < 0,
              )
            ) {
              setError('모델과 세 종류의 유효한 단가를 입력해주세요.');
              return;
            }
            void update({
              rates: [
                ...ai.policy.rates.filter(
                  (r) => r.connection !== rate.connection || r.model !== rate.model.trim(),
                ),
                {
                  connection: rate.connection,
                  model: rate.model.trim(),
                  input: Number(rate.input),
                  cached: Number(rate.cached),
                  output: Number(rate.output),
                },
              ],
            });
          }}
        >
          <div className="ai-rate-fields">
            {(
              [
                ['connection', '연결 ID (단일 연결이면 빈칸)'],
                ['model', '모델 ID'],
                ['input', '입력 단가'],
                ['cached', '캐시 입력 단가'],
                ['output', '출력 단가'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={rate[key]}
                  type={['input', 'cached', 'output'].includes(key) ? 'number' : 'text'}
                  min="0"
                  step="any"
                  disabled={disabled}
                  onChange={(e) => setRate({ ...rate, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <button disabled={disabled}>단가 저장</button>
        </form>
        {ai.policy.rates.map((r) => (
          <p key={r.connection + ':' + r.model}>
            {r.connection || '단일 연결'} · {r.model} · ${r.input} / ${r.cached} / ${r.output}{' '}
            <button
              disabled={disabled}
              onClick={() => void update({ rates: ai.policy.rates.filter((v) => v !== r) })}
            >
              삭제
            </button>
          </p>
        ))}
      </details>
    </div>
  );
}
