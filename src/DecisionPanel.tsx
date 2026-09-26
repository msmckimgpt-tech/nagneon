import { useRef, useState } from 'react';
import { api } from './api';
import type { DecisionConfig, DecisionSnapshot, DecisionTask, State } from './types';

const tasks: [DecisionTask, string, string][] = [
  ['live-plan', '먼저 반응할 관객', '이미 반응할 수 있는 관객 중 순서를 고릅니다.'],
  ['memory-rerank', '관련 기억 찾기', '목격한 대화와 기록 중 관련 있는 내용을 찾습니다.'],
  ['intent-hint', '말의 의도 보조', '질문·이어 말하기를 구분할 때 돕습니다.'],
  ['reaction-check', '자동 반응의 반복 줄이기', '선택적인 자동 채팅의 반복을 살핍니다.'],
  [
    'community-affinity',
    '커뮤니티 관심 판단',
    '관객이 실제로 볼 수 있는 게시물의 관심도를 살핍니다.',
  ],
  ['culture-relevance', '문화 자료 관련도', '허용된 공개 자료 중 관련 내용을 고릅니다.'],
  ['clip-relevance', '핫클립 후보 선택', '기존 기준을 통과한 후보의 순서를 돕습니다.'],
  [
    'route-hint',
    '등록된 모델 경로 선택',
    '이미 설정된 호환 경로 안에서만 순서를 돕습니다. 현재 Codex·Gemini 선택은 바뀌지 않습니다.',
  ],
];
const configOf = (value: DecisionSnapshot): DecisionConfig => ({
  provider: value.provider,
  mode: value.mode,
  model: value.model,
  timeoutMs: value.timeoutMs,
  acknowledgeTransfer: value.acknowledgeTransfer,
  tasks: { ...value.tasks },
});
const issue: { [key: string]: string } = {
  auth: '키 또는 계정 권한을 확인하세요.',
  credits: '크레딧 또는 잔액이 부족해요. 선택한 제공처의 결제 설정을 확인하세요.',
  usage: '사용량 제한으로 연결하지 못했어요.',
  network: '네트워크 연결을 확인하세요.',
  timeout: '응답 시간이 초과됐어요.',
  invalid_response: '응답을 확인하지 못했어요.',
  unavailable: '서비스에 연결하지 못했어요.',
  error: '연결 확인에 실패했어요.',
};

export function DecisionPanel({ state }: { state: State }) {
  const current = state.decision;
  const [draft, setDraft] = useState<DecisionConfig | null>(() =>
    current ? configOf(current) : null,
  );
  const [key, setKey] = useState(''),
    [pendingAction, setPendingAction] = useState<'other' | 'probe' | null>(null),
    [stopping, setStopping] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const operationVersion = useRef(0);
  const stoppingRef = useRef(false);
  const keyEditVersion = useRef(0);
  if (!current || !draft) return null;
  const snapshot = current;
  const pending = pendingAction !== null;
  const locked = state.running || state.busy;
  const providerChanged = draft.provider !== current.provider;
  const currentProviderName = current.provider === 'openrouter' ? 'OpenRouter' : 'TypeSafe';
  const selectedProviderName = draft.provider === 'openrouter' ? 'OpenRouter' : 'TypeSafe';
  const status = !current.configured
    ? current.keyStorageError
      ? '키 복원 확인 필요'
      : '키 없음'
    : current.errorCode === 'credits'
      ? '크레딧 확인 필요'
      : current.probe?.outcome === 'connected'
        ? 'JEV 응답 확인됨'
        : current.probe?.outcome === 'abstain'
          ? '연결 확인 실패'
          : '연결 확인 전';
  async function perform(
    action: () => Promise<DecisionSnapshot>,
    message: string,
    kind: 'other' | 'probe' = 'other',
    onSuccess?: () => void,
  ) {
    if (pending || stoppingRef.current) return;
    const version = ++operationVersion.current;
    setPendingAction(kind);
    setError('');
    setNotice('');
    try {
      const result = await action();
      onSuccess?.();
      if (version !== operationVersion.current) return;
      setNotice(message);
      return result;
    } catch (e) {
      if (version === operationVersion.current)
        setError(e instanceof Error ? e.message : 'JEV 설정을 변경하지 못했어요.');
    } finally {
      if (version === operationVersion.current) setPendingAction(null);
    }
  }
  async function apply() {
    if (locked) return;
    const result = await perform(
      () => api<DecisionSnapshot>('decision', draft, 'PUT'),
      'JEV 설정이 적용되었습니다.',
    );
    if (result) setDraft(configOf(result));
  }
  async function immediateOff() {
    if ((snapshot.mode === 'off' && pendingAction !== 'probe') || stoppingRef.current) return;
    stoppingRef.current = true;
    const version = ++operationVersion.current;
    setStopping(true);
    setError('');
    setNotice('');
    try {
      const result = await api<DecisionSnapshot>(
        'decision',
        { ...configOf(snapshot), mode: 'off' },
        'PUT',
      );
      if (version === operationVersion.current) {
        setDraft(configOf(result));
        setNotice('JEV 판단을 껐습니다.');
      }
    } catch (e) {
      if (version === operationVersion.current)
        setError(e instanceof Error ? e.message : 'JEV 판단을 끄지 못했어요.');
    } finally {
      if (version === operationVersion.current) {
        setPendingAction(null);
        setStopping(false);
      }
      stoppingRef.current = false;
    }
  }
  async function saveKey(value: string) {
    if (locked || providerChanged) return;
    const submittedEditVersion = keyEditVersion.current;
    await perform(
      () => api<DecisionSnapshot>('decision/key', { apiKey: value, provider: snapshot.provider }),
      'JEV 키 설정이 변경되었습니다.',
      'other',
      () => {
        if (keyEditVersion.current === submittedEditVersion)
          setKey((current) => (value === '' || current === value ? '' : current));
      },
    );
  }
  async function probe() {
    if (locked || providerChanged || !snapshot.configured || !snapshot.acknowledgeTransfer) return;
    await perform(
      () => api<DecisionSnapshot>('decision/probe', { provider: snapshot.provider }),
      '연결 확인을 마쳤습니다.',
      'probe',
    );
  }
  return (
    <section className="account-panel decision-panel" aria-label="JEV 판단 보조 연결">
      <div className="account-summary">
        <span
          className={'connection-orb ' + (current.probe?.outcome === 'connected' ? 'ready' : '')}
        >
          J
        </span>
        <div>
          <b>JEV 판단 보조 · {status}</b>
          <p>
            {currentProviderName} · {current.model}
          </p>
        </div>
      </div>
      <p className="account-note">
        관객 대화와 커뮤니티 판단을 선택적으로 돕습니다. 키가 없거나 전송에 동의하지 않으면 호출하지
        않습니다. 관찰만 모드도 호출량과 요금이 생기지만 방송 결과를 바꾸지 않습니다.
      </p>
      <label className="set-field">
        JEV 제공처
        <select
          aria-label="JEV 제공처"
          value={draft.provider}
          disabled={locked || pending}
          onChange={(e) => {
            keyEditVersion.current++;
            setKey('');
            setDraft({
              ...draft,
              provider: e.target.value as DecisionConfig['provider'],
              mode: 'off',
              acknowledgeTransfer: false,
            });
          }}
        >
          <option value="typesafe">TypeSafe 직접 연결</option>
          <option value="openrouter">OpenRouter 경유</option>
        </select>
      </label>
      <p className="field-note">
        OpenRouter를 고르면 JEV 요청이 OpenRouter를 거쳐 TypeSafe로 전달되고 OpenRouter 계정에
        청구됩니다. 제공처를 바꾸면 이전 키와 전송 동의를 지웁니다.
        {providerChanged && ' 새 제공처를 적용한 뒤 해당 제공처의 키를 연결하세요.'}
      </p>
      <label className="set-field">
        판단 모드
        <select
          aria-label="JEV 판단 모드"
          value={draft.mode}
          disabled={locked || pending}
          onChange={(e) => setDraft({ ...draft, mode: e.target.value as DecisionConfig['mode'] })}
        >
          <option value="off">끄기</option>
          <option value="shadow">관찰만</option>
          <option value="assist">판단 보조</option>
        </select>
      </label>
      <p className="field-note">
        판단 보조는 확인된 제안만 적용하며, 불확실하거나 연결이 실패하면 기존 방식으로 이어갑니다.
      </p>
      <div className="set-row">
        <label className="set-field">
          JEV 모델
          <select
            aria-label="JEV 모델"
            value={draft.model}
            disabled={locked || pending}
            onChange={(e) =>
              setDraft({ ...draft, model: e.target.value as DecisionConfig['model'] })
            }
          >
            <option value="jev-1.13.0">jev-1.13.0</option>
            <option value="jev-latest">jev-latest</option>
          </select>
        </label>
        <label className="set-field">
          응답 대기 시간 (ms)
          <input
            aria-label="JEV 응답 대기 시간"
            type="number"
            min={250}
            max={5000}
            value={draft.timeoutMs}
            disabled={locked || pending}
            onChange={(e) => setDraft({ ...draft, timeoutMs: Number(e.target.value) })}
          />
        </label>
      </div>
      <details>
        <summary>도움받을 판단 고르기</summary>
        {tasks.map(([id, label, description]) => (
          <label className="set-check" key={id}>
            <input
              type="checkbox"
              checked={draft.tasks[id]}
              disabled={locked || pending}
              onChange={(e) =>
                setDraft({ ...draft, tasks: { ...draft.tasks, [id]: e.target.checked } })
              }
            />
            <span>
              {label}
              <small>{description}</small>
            </span>
          </label>
        ))}
      </details>
      <label className="set-check">
        <input
          type="checkbox"
          checked={draft.acknowledgeTransfer}
          disabled={locked || pending}
          onChange={(e) => setDraft({ ...draft, acknowledgeTransfer: e.target.checked })}
        />
        <span>
          {selectedProviderName} 전송과 요금을 이해했습니다.
          <small>
            판단에 필요한 대화·기억·커뮤니티 문구를{' '}
            {draft.provider === 'openrouter' ? 'OpenRouter를 거쳐 TypeSafe로' : 'TypeSafe로'} 보내며
            사용량에 따라 {selectedProviderName} 계정에 요금이 발생합니다.
          </small>
        </span>
      </label>
      <div className="connection-actions">
        <button
          type="button"
          className="secondary"
          disabled={locked || pending}
          onClick={() => void apply()}
        >
          JEV 설정 적용
        </button>
        {(current.mode !== 'off' || pendingAction === 'probe') && (
          <button
            type="button"
            className="secondary"
            disabled={stopping}
            onClick={() => void immediateOff()}
          >
            JEV 바로 끄기
          </button>
        )}
      </div>
      <label className="set-field">
        JEV API 키
        <div className="inline-form">
          <input
            aria-label="JEV API 키"
            type="password"
            autoComplete="off"
            value={key}
            disabled={locked || pending || providerChanged}
            onChange={(e) => {
              keyEditVersion.current++;
              setKey(e.target.value);
            }}
            placeholder={`${currentProviderName} API 키`}
          />
          <button
            type="button"
            className="secondary"
            disabled={locked || pending || providerChanged || !key}
            onClick={() => void saveKey(key)}
          >
            JEV 키 연결
          </button>
        </div>
      </label>
      <p className="field-note">
        {current.keyStorage === 'saved'
          ? '키가 이 프로필에 암호화되어 저장되었습니다. 다음 실행에서 복원됩니다.'
          : current.keyStorage === 'session'
            ? '키는 이번 앱 실행에만 유지됩니다. 다음 실행에서 다시 입력하세요.'
            : '데스크톱 앱에서 키를 연결하면 보안 저장소를 이용해 저장합니다. 연결 확인 전에는 응답 성공으로 표시하지 않습니다.'}
      </p>
      {current.keyStorageError && (
        <p className="connection-problem" role="alert">
          {current.keyStorageError}
        </p>
      )}
      <div className="connection-actions">
        <button
          type="button"
          className="secondary"
          disabled={
            locked ||
            pending ||
            providerChanged ||
            (!current.configured && !current.storedKeyPresent)
          }
          onClick={() => void saveKey('')}
        >
          JEV 키 제거
        </button>
        <button
          type="button"
          className="secondary"
          disabled={
            locked ||
            pending ||
            providerChanged ||
            !current.configured ||
            !current.acknowledgeTransfer
          }
          onClick={() => void probe()}
        >
          JEV 연결 확인 · 1회 사용
        </button>
        <a
          className="secondary"
          href={
            draft.provider === 'openrouter'
              ? 'https://openrouter.ai/settings/keys'
              : 'https://console.typesafe.ai/keys'
          }
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (window.backseat?.openDecisionKeyConsole) {
              e.preventDefault();
              void window.backseat
                .openDecisionKeyConsole(draft.provider)
                .catch((err) =>
                  setError(err instanceof Error ? err.message : '공식 키 페이지를 열지 못했어요.'),
                );
            }
          }}
        >
          공식 JEV 키 페이지
        </a>
      </div>
      {(current.errorCode === 'credits' || current.probe?.outcome === 'abstain') && (
        <p className="connection-problem" role="alert">
          {issue[current.errorCode || 'error'] || issue.error}
        </p>
      )}
      <p className="muted">
        이번 앱 실행 사용량 · 호출 {current.counters.calls}회 · 입력 토큰{' '}
        {current.counters.inputTokens.toLocaleString('ko-KR')}개 · 입력 기준 예상 $
        {current.counters.estimatedUsd.toFixed(9)} · 캐시 {current.counters.cacheHits}회 · 판단 보류{' '}
        {current.counters.abstained}회 · 적용 {current.counters.applied}회
        {current.last ? ` · 마지막 ${current.last.durationMs}ms` : ''}. 실제 청구액은{' '}
        {currentProviderName}
        계정에서 확인하세요.
      </p>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="connection-problem" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
