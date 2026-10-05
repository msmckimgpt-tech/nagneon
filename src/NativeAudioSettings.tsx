import { useEffect, useState } from 'react';
import { api } from './api';
import type { State } from './types';
import { AudioStorageSettings } from './AudioStorageSettings';
import { MicrophoneSettings } from './MicrophoneSettings';

export function NativeAudioSettings({ state, disabled }: { state: State; disabled: boolean }) {
  const current = state.nativeAudio;
  const [mode, setMode] = useState<'local' | 'remote'>(current?.mode || 'remote');
  const [consent, setConsent] = useState(
    (current?.transport === 'subscription' && current.consent && current.consentVersion === 2) ||
      false,
  );
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (current) {
      setMode(current.mode);
      setConsent(
        current.transport === 'subscription' && current.consent && current.consentVersion === 2,
      );
    }
  }, [current?.mode, current?.consent, current?.consentVersion, current?.transport]);
  if (!current) return null;
  async function save() {
    setPending(true);
    setMessage('');
    try {
      await api('native-audio/config', {
        mode,
        transport: 'subscription',
        consent: mode === 'remote' && consent,
        consentVersion: 2,
      });
      setMessage('음성 연결 설정을 저장했습니다. 방송 시작 시 적용됩니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '음성 연결을 저장하지 못했습니다.');
    } finally {
      setPending(false);
    }
  }
  const stages = {
    preparing: '구독 음성 연결 준비 중',
    connected: '마이크 입력 준비 중',
    listening: '구독 음성 청취 중',
    received: '발언 접수 · 계속 청취 중',
    stopped: '마이크 꺼짐',
  };
  return (
    <>
      <MicrophoneSettings state={state} />
      <fieldset
        className="provider-picker-fields"
        disabled={disabled || pending}
        aria-label="마이크 원음 이해"
      >
        <legend>마이크 음성 연결</legend>
        <label>
          음성 전달 방식{' '}
          <select
            aria-label="음성 전달 방식"
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="remote">ChatGPT 구독 음성</option>
            <option value="local">기존 로컬 음성 인식</option>
          </select>
        </label>
        {mode === 'remote' && (
          <>
            <p>
              이 설정을 적용하면 나그네온의 방송 시작 버튼으로 마이크와 전용 음성 연결이 함께
              시작됩니다. 방송 중에는 마이크 연결 버튼으로 다시 켤 수 있습니다. ChatGPT 앱을 직접
              조작하거나 전달 명령을 말할 필요가 없습니다. GPT의 답변 소리는 재생하지 않습니다.
            </p>
            <p className="field-note">
              기존 ChatGPT 구독 포함량을 사용합니다. API 키와 별도 결제는 필요하지 않습니다.
              연결이나 한도에 문제가 생기면 중지하며 유료 API 또는 로컬 음성 인식으로 자동 전환하지
              않습니다.
            </p>
            <p className="field-note">
              관객은 마이크 발언, 선택한 게임 화면, 게임·시스템 소리 속 발언을 함께 참고합니다.
              게임·시스템 소리는 방송과 함께 연결되며 별도로 끄지 않습니다. 다른 앱의
              알림·음악·통화도 Windows 출력 소리에 포함됩니다. 다른 창의 화면은 보내지 않습니다.
            </p>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <input
                style={{ width: 'auto', flexShrink: 0 }}
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>
                마이크의 원음·주변 발언과 Windows 출력 전체 소리가 OpenAI로 전송되고, ChatGPT 구독
                포함량을 사용함을 확인했습니다.
              </span>
            </label>
            <p className="field-note">
              마이크를 끄면 마이크 전송을 중단합니다. 방송을 종료하거나 AI 대시보드에서 원음 이해를
              차단하면 두 소리의 전송과 관객 반영을 중단합니다. 복구용 원음은 이 PC에 보관하며 아래
              보관 설정에 따라 정리합니다. 이미 전송된 데이터는 회수할 수 없으며 제공처의 데이터
              처리 조건이 적용됩니다.
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
              ? stages[current.stage || 'listening']
              : mode === 'remote'
                ? '방송에서 마이크를 켜면 구독 연결을 확인합니다.'
                : '기존 로컬 음성 인식 사용')}
        </p>
        {!!current.pending && (
          <p className="field-note">
            확인이 끝나지 않은 원음 {current.pending}구간을 보존하고 있습니다. 조용했던 구간도
            포함될 수 있습니다. 지난 방송의 원음은 새 방송에 자동 전달하지 않습니다.
          </p>
        )}
      </fieldset>
      <AudioStorageSettings running={state.running} />
    </>
  );
}
