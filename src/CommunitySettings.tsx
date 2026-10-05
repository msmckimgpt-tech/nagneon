import { useId } from 'react';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import './community-settings.css';

export type CommunityPreferences = {
  enabled: boolean;
  arrivalsEnabled: boolean;
  creativeImages: boolean;
  notifications: boolean;
  mutedCommunities: string[];
  mutedTopics: string[];
  hiddenThreads: string[];
  bookmarks: string[];
};
type CommunityGroup = {
  id: string;
  name: string;
  description: string;
  topics: { id: string; label: string }[];
};

export function CommunitySwitch({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      className="community-switch-row"
      aria-checked={checked}
      aria-labelledby={id + '-label'}
      aria-describedby={id + '-description'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="community-switch-copy">
        <strong id={id + '-label'}>{label}</strong>
        <span id={id + '-description'}>{description}</span>
      </span>
      <span className="community-switch-state" aria-hidden="true">
        <span>{checked ? '켜짐' : '꺼짐'}</span>
        <span className="community-switch-track">
          <span />
        </span>
      </span>
    </button>
  );
}

export function CommunitySettings({
  preferences: p,
  communities,
  busy,
  onPatch,
}: {
  preferences: CommunityPreferences;
  communities: CommunityGroup[];
  busy: boolean;
  onPatch: (value: Partial<CommunityPreferences>) => void | Promise<void>;
}) {
  const heading = useId();
  const toggle = (key: 'mutedCommunities' | 'mutedTopics', id: string) => {
    const values = p[key];
    void onPatch({ [key]: values.includes(id) ? values.filter((v) => v !== id) : [...values, id] });
  };
  return (
    <details className="social-settings community-settings">
      <summary>
        <span className="community-settings-title">
          <SlidersHorizontal size={17} aria-hidden="true" />
          커뮤니티 설정
        </span>
        <span className="community-settings-status" data-enabled={p.enabled}>
          자동활동 {p.enabled ? '켜짐' : '꺼짐'}
        </span>
        <ChevronDown size={16} className="community-settings-chevron" aria-hidden="true" />
      </summary>
      <div className="community-settings-body" aria-busy={busy}>
        <div className="community-settings-options" role="group" aria-label="주민 활동 설정">
          <CommunitySwitch
            label="주민 자동활동"
            description="앱이 열려 있으면 주민이 스스로 글을 쓰고 이야기를 나눠요. 꺼도 저장된 글은 남습니다."
            checked={p.enabled}
            disabled={busy}
            onChange={(enabled) => void onPatch({ enabled })}
          />
          <CommunitySwitch
            label="글을 읽은 주민의 다음 방송 방문"
            description="방송 이야기에 관심을 가진 주민이 다음 방송에 찾아올 수 있어요. 방문을 강요하지는 않습니다."
            checked={p.arrivalsEnabled}
            disabled={busy}
            onChange={(arrivalsEnabled) => void onPatch({ arrivalsEnabled })}
          />
          <CommunitySwitch
            label="주민 창작 이미지 · 픽셀 그림"
            description="기본은 꺼짐. 주민이 기존 AI로 간단한 PNG 그림을 만들 수 있어요. 별도 유료 이미지 API는 사용하지 않습니다."
            checked={p.creativeImages}
            disabled={busy}
            onChange={(creativeImages) => void onPatch({ creativeImages })}
          />
        </div>
        <p className="community-settings-note">
          연결된 AI의 사용량을 소비합니다. 방송과 내 요청이 우선하며, 자동활동을 꺼도 개별 설정은
          유지됩니다.
        </p>
        <section className="community-settings-groups" aria-labelledby={heading}>
          <div className="community-settings-group-heading">
            <h3 id={heading}>이야기를 나눌 공간</h3>
            <span>관심 주제 선택</span>
          </div>
          {communities.map((c) => (
            <section
              className="community-settings-group"
              key={c.id}
              aria-label={c.name + ' 활동 설정'}
            >
              <CommunitySwitch
                label={c.name + ' 활동'}
                description={c.description}
                checked={!p.mutedCommunities.includes(c.id)}
                disabled={busy}
                onChange={() => toggle('mutedCommunities', c.id)}
              />
              <div
                className="community-topic-chips"
                role="group"
                aria-label={c.name + ' 관심 주제'}
              >
                {c.topics.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={!p.mutedTopics.includes(t.id)}
                    disabled={busy}
                    onClick={() => toggle('mutedTopics', t.id)}
                  >
                    <Check size={14} aria-hidden="true" />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          <p className="community-settings-note">
            공간의 활동을 꺼도 선택한 주제는 유지되며, 다시 켜기 전에 미리 바꿀 수 있어요.
          </p>
        </section>
        {p.hiddenThreads.length > 0 && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void onPatch({ hiddenThreads: [] })}
          >
            숨긴 글 다시 표시 ({p.hiddenThreads.length})
          </button>
        )}
      </div>
    </details>
  );
}
