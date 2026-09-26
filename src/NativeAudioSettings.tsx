import { useEffect, useState } from 'react';
import { api } from './api';
import type { State } from './types';

export function NativeAudioSettings({ state, disabled }: { state: State; disabled: boolean }) {
  const current = state.nativeAudio;
  const [mode, setMode] = useState<'local' | 'remote'>(current?.mode || 'remote');
  const [consent, setConsent] = useState(current?.consent || false);
  const [key, setKey] = useState(''),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (current) {
      setMode(current.mode);
      setConsent(current.consent);
    }
  }, [current?.mode, current?.consent]);
  if (!current) return null;
  async function save() {
    setPending(true);
    setMessage('');
    try {
      await api('native-audio/config', {
        mode,
        consent: mode === 'remote' && consent,
        ...(key ? { apiKey: key } : {}),
      });
      setKey('');
      setMessage('음성 연결 설정을 저장했습니다. 마이크를 켜면 적용됩니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '음성 연결을 저장하지 못했습니다.');
    } finally {
      setPending(false);
    }
  }
  return (
    <fieldset
      className="provider-picker-fields"
      disabled={disabled || pending}
      aria-label="마이크 원음 이해"
    >
      <legend>마이크 원음 이해</legend>
      <label>
        음성 전달 방식{' '}
        <select
          aria-label="음성 전달 방식"
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="remote">원격 원음 이해 · GPT-Realtime-2.1</option>
          <option value="local">기존 로컬 음성 인식</option>
        </select>
      </label>
      {mode === 'remote' && (
        <>
          <p>
            마이크 원음을 OpenAI에 전송해 직접 이해합니다. 게임 PC에서 마이크 음성 추론을 실행하지
            않으며, 연결이 끊겨도 로컬 STT로 자동 전환하지 않습니다.
          </p>
          <p className="field-note">
            ChatGPT 구독과 별도로 API 요금이 발생합니다. 관객 반응에는 선택한 관객 모델을
            사용합니다. 시스템 소리·핫클립의 기존 로컬 분석은 별도이며, 이 동의로 원음을 외부에
            보내지 않습니다.
          </p>
          <label>
            원음 이해용 OpenAI API 키{' '}
            <input
              aria-label="원음 이해용 OpenAI API 키"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={500}
              placeholder={
                current.configured ? '이 실행에서 연결됨 · 변경할 때만 입력' : 'API 키 입력'
              }
            />
          </label>
          <p className="field-note">
            키는 현재 앱의 메모리에만 유지하며 저장 파일·로그에 기록하지 않습니다. 앱을 다시
            시작하면 다시 입력해야 합니다.
          </p>
          <p className="field-note">
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
              공식 API 키 발급
            </a>{' '}
            ·{' '}
            <a
              href="https://platform.openai.com/settings/organization/billing/overview"
              target="_blank"
              rel="noreferrer"
            >
              API 결제 설정
            </a>
          </p>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <input
              style={{ width: 'auto', flexShrink: 0 }}
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              켠 마이크의 원음과 주변 발언이 OpenAI로 전송되고 API 사용량이 발생함을 확인했습니다.
            </span>
          </label>
          <p className="field-note">
            마이크·방송을 끄거나 AI 대시보드에서 원음 이해를 차단하면 새 원음 송신과 결과 반영을
            중단합니다. 원음과 청취 복구 기록은 이 PC에 보관하며, 앱 실행 중 24시간이 지난 기록을
            자동 정리합니다. 이미 전송된 데이터는 회수할 수 없으며 제공처의 데이터 처리 조건이
            적용됩니다.
          </p>
        </>
      )}
      <button
        className="secondary"
        onClick={() => void save()}
        disabled={mode === 'remote' && !consent}
      >
        {pending ? '저장 중…' : '음성 연결 적용'}
      </button>
      <p role="status">
        {message ||
          current.error ||
          (current.active
            ? `원격 청취 중 · 미처리 ${current.pending || 0}구간`
            : current.configured
              ? '원음 이해 API 키 연결됨'
              : '원음 이해 API 키 미연결')}
      </p>
      {!!current.pending && !current.active && (
        <p className="field-note">
          중지된 미처리 원음 {current.pending}구간이 남아 있습니다. 같은 방송에서 마이크를 다시 켜면
          남은 시도 범위 안에서 복구합니다. 새 방송에는 과거 원음을 자동 전달하지 않습니다.
        </p>
      )}
    </fieldset>
  );
}
