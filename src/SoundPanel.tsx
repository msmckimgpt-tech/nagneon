import type { SoundState } from './types';
const names: Record<string, string> = {
  Music: '음악',
  Speech: '음성',
  Silence: '무음',
  'Beep, bleep': '전자음',
  'Electronic music': '전자 음악',
  'Video game music': '게임 음악',
  Explosion: '폭발음',
  'Gunshot, gunfire': '총성',
  Footsteps: '발소리',
  Alarm: '경보음',
  Conversation: '대화',
  Singing: '노래',
  Laughter: '웃음',
  Applause: '박수',
  'Sound effect': '효과음',
};
export function SoundPanel({
  sound,
  enabled,
  status,
  level,
  problem = '',
  remote = false,
}: {
  sound?: SoundState;
  enabled: boolean;
  status: string;
  level: number;
  problem?: string;
  remote?: boolean;
}) {
  const recent = sound?.last && Date.now() - sound.last.endedAt < 30000 ? sound.last : null;
  if (!enabled) return null;
  return (
    <div className="sound-panel" aria-label="게임·시스템 소리">
      <div>
        <b>게임·시스템 소리</b>
        <span role="status">{status}</span>
        <meter min={0} max={1} value={level} aria-label="시스템 출력 음량" />
      </div>
      <small>
        Windows 출력 전체 · 마이크와 별도 · {remote ? 'ChatGPT 구독 음성' : '로컬 분석'}
      </small>
      {problem && <p role="alert">{problem} 공유할 화면을 다시 선택해 연결해주세요.</p>}
      {recent ? (
        <>
          {!remote && (
            <p>
              {recent.silent
                ? '지금은 조용해요'
                : recent.classes.length
                  ? recent.classes
                      .slice(0, 4)
                      .map((c) => names[c.label] || c.label)
                      .join(' · ') + ' 소리로 추정'
                  : '소리 종류를 구분하지 못했어요'}
            </p>
          )}
          {recent.systemSpeech && (
            <p>
              <b>출력 소리 속 발언</b> “{recent.systemSpeech}”
            </p>
          )}
          <small>인식한 발언은 스트리머의 말과 구분해 관객에게 전달합니다.</small>
        </>
      ) : (
        <p>
          {remote
            ? '인식한 발언이 들어오면 여기에 표시합니다.'
            : '소리를 모으는 중입니다. 방송 중 약 4초씩 분석합니다.'}
        </p>
      )}
      {remote && (
        <small>
          다른 앱의 발언도 포함됩니다. 효과음 종류는 이 연결에서 별도로 판정하지 않습니다.
        </small>
      )}
    </div>
  );
}
