import { CommunityLore } from './CommunityLore';
import { RuntimeDownloads } from './RuntimeDownloads';
import { GuidedTutorial, FirstViewerStatus } from './GuidedTutorial';
import { TextReactions } from './TextReactions';
import { Brand } from './Brand';
import { ExternalChatPanel } from './ExternalChatPanel';
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Activity,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Check,
  ChevronRight,
  Clapperboard,
  Download,
  Gamepad2,
  Heart,
  LayoutDashboard,
  MessageCircle,
  Mic,
  Monitor,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  Send,
  Settings2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { api } from './api';
import { DonationBadge } from './DonationBadge';
import { SpecialStudio } from './SpecialStudio';
import { DonationToast, DonationHistory } from './Donations';
import { HotClips } from './HotClips';
import { CommunityGallery } from './CommunityGallery';
import { SettingsDialog } from './SettingsDialog';
import { AudiencePanel } from './AudiencePanel';
import { Onboarding } from './Onboarding';
import './studio-layout.css';

import { ConversationMemories } from './ConversationMemories';

import { SoundPanel } from './SoundPanel';
import { ObsPanel } from './ObsPanel';
import { CapturePicker } from './CapturePicker';
import { ChatDisplayToggle } from './ChatDisplayToggle';
import { ReactionDiagnostics } from './ReactionDiagnostics';
import { ChatBriefing } from './ChatBriefing';
import { useMedia } from './useMedia';
import { useChatFollow } from './useChatFollow';
import { useStudioState } from './useStudioState';
import type { Message, Settings } from './types';

const time = (n: number) =>
  new Date(n).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const ChatLine = memo(function ChatLine({
  message,
  moderate,
  managerId,
  onInsight,
}: {
  message: Message;
  onInsight?: (message: Message) => void;
  moderate?: (action: string, id: string) => void;
  managerId: string;
}) {
  return (
    <div className={'chat-line ' + message.kind}>
      <span className="chat-time">{time(message.time)}</span>
      <div>
        <strong style={{ color: message.color }}>
          {message.personaId === managerId && <Shield size={12} />} {message.name}
        </strong>
        <DonationBadge donation={message.donation} />
        <span className="chat-text">{message.transcription?.correction?.text || message.text}</span>
        {message.transcription?.correction && (
          <details className="transcript-origin">
            <summary>음성 교정</summary>
            <p>인식 원문: {message.text}</p>
            <p>맥락으로 추정한 교정이에요.</p>
          </details>
        )}
      </div>
      {onInsight && message.kind === 'chat' && (
        <button
          className="insight-button icon"
          title="이 채팅의 속마음 보기"
          onClick={() => onInsight(message)}
        >
          <Sparkles size={13} />
        </button>
      )}
      {moderate && (
        <button
          className="delete-message icon"
          title="메시지 삭제"
          onClick={() => moderate('delete', message.id)}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
});
export function App() {
  const overlay = location.pathname === '/overlay';
  const { state, connected } = useStudioState();
  const [error, setError] = useState('');
  const composeInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState('studio'),
    [draft, setDraft] = useState<Settings | null>(null),
    [modal, setModal] = useState(false),
    [captureSound, setCaptureSound] = useState<boolean | null>(null),
    [text, setText] = useState('');
  const [now, setNow] = useState(Date.now()),
    [through, setThrough] = useState(false),
    [note, setNote] = useState(''),
    [gameName, setGameName] = useState('');
  const [initialGuide, setInitialGuide] = useState<boolean | null>(null),
    [starter, setStarter] = useState(false);
  const [overlayTransparency, setOverlayTransparency] = useState(0);
  const [focusMessage, setFocusMessage] = useState<Message | null>(null);
  const [donationsOpen, setDonationsOpen] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const media = useMedia(overlay ? null : state, setError);
  useEffect(() => {
    const timer = overlay ? undefined : setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [overlay]);
  const chatFollow = useChatFollow(
    chatEnd,
    state?.messages.at(-1)?.id || '',
    state?.sessionId || '',
  );
  useEffect(() => {
    if (state && initialGuide === null) setInitialGuide(state.onboarding?.status === 'new');
  }, [state, initialGuide]);
  useEffect(() => window.backseat?.onOverlayState(setThrough), []);
  const action = useCallback(async (path: string, body?: unknown, method?: string) => {
    try {
      setError('');
      return await api(path, body, method);
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청 실패');
    }
  }, []);
  const moderate = useCallback(
    (actionName: string, id: string) => void action('moderate', { action: actionName, id }),
    [action],
  );
  const showInsight = useCallback((message: Message) => {
    setFocusMessage(message);
    setTab('special');
  }, []);
  function settings() {
    if (!state) return;
    setDraft(structuredClone(state.settings));
    setModal(true);
  }
  async function screen(withSound = false) {
    if (media.capturePreparing) return;
    if (window.backseat) setCaptureSound(withSound);
    else await media.share(undefined, { systemAudio: withSound, picture: true });
  }
  async function openOverlay() {
    if (window.backseat) await window.backseat.openOverlay();
    else window.open('/overlay', 'backseat-overlay', 'width=420,height=700');
  }
  function submit() {
    if (!text.trim() || !state?.running) return;
    media.say(text.trim());
    setText('');
  }
  if (!state || initialGuide === null)
    return (
      <div className="loading">
        <Radio size={32} />
        <h2>방송실에 연결 중</h2>
        <p>로컬 서비스가 실행 중인지 확인해주세요.</p>
      </div>
    );
  const tutorialActive = state.tutorial?.status === 'active';
  const s = state.settings,
    active = s.personas.filter((p) => p.enabled),
    manager = s.personas.find((p) => p.id === s.managerId);
  const showMessage = (m: Message) =>
    s.showStreamerMessages !== false || (m.kind !== 'streamer' && m.personaId !== 'streamer');
  const shownMessages = state.messages.filter(showMessage);
  const present =
    state.running && s.mode === 'live'
      ? active.filter((p) => ['active', 'lurking'].includes(state.audience.presence[p.id]))
      : active;
  const elapsed = state.startedAt ? Math.max(0, Math.floor((now - state.startedAt) / 1000)) : 0;
  const clock = [Math.floor(elapsed / 3600), Math.floor(elapsed / 60) % 60, elapsed % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
  if (overlay)
    return (
      <div
        className="overlay-shell"
        style={{ '--overlay-opacity': 1 - overlayTransparency / 100 } as CSSProperties}
      >
        <DonationToast messages={state.messages} publicMode={s.overlayMode === 'public'} />
        {s.overlayMode === 'public' && (
          <div className="overlay-public-disclosure">
            AI 관객과 함께하는 방송 · 가상 포인트
            <br />
            <small>관객 수와 포인트는 플랫폼의 실제 시청자·후원이 아닙니다</small>
          </div>
        )}
        <div className="overlay-grip">
          <span>
            <i className={'dot ' + (state.running ? 'green' : '')} /> NAGNEON · CHAT
          </span>
          <div className="overlay-controls" data-overlay-interactive>
            <ChatDisplayToggle shown={s.showStreamerMessages !== false} />
            {window.backseat && (
              <button
                title="클릭 통과 전환 · Ctrl+Shift+F10"
                onClick={async () => setThrough(await window.backseat!.toggleClickThrough())}
              >
                {through ? '통과 중' : '고정'}
              </button>
            )}
            <button
              title="오버레이 닫기"
              onClick={async () => {
                if (tutorialActive && state.tutorial?.overlayAdjusted)
                  await action('tutorial/overlay', { action: 'close' });
                if (window.backseat) await window.backseat.closeOverlay();
                else window.close();
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <label className="overlay-opacity" data-overlay-interactive>
          투명도{' '}
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={overlayTransparency}
            onChange={(e) => {
              setOverlayTransparency(Number(e.target.value));
              if (tutorialActive) void action('tutorial/overlay', { action: 'adjust' });
            }}
            aria-label="오버레이 투명도"
          />
          <output>{overlayTransparency}%</output>
        </label>
        {tutorialActive && state.tutorial?.step === 'overlay' && (
          <p className="muted">따라 배우기 · 투명도를 조절한 뒤 위의 닫기 버튼을 눌러주세요.</p>
        )}
        <div className="overlay-chat">
          {!state.running && <p className="muted">방송 대기 중</p>}
          {state.messages
            .filter(showMessage)
            .slice(-60)
            .map((m) => (
              <ChatLine key={m.id} message={m} managerId={s.managerId} />
            ))}
          <div ref={chatEnd} />
        </div>
        {chatFollow.unread && (
          <button className="chat-jump" onClick={chatFollow.jump}>
            새 채팅 보기 ↓
          </button>
        )}
        <div className="overlay-bottom">
          {s.mode === 'rehearsal' ? 'REHEARSAL' : 'AUDIENCE'} ·{' '}
          {present.filter((p) => !p.system).length}명 {!connected && '· 연결 끊김'}
        </div>
      </div>
    );
  if (initialGuide)
    return (
      <Onboarding
        state={state}
        onDone={() => {
          setInitialGuide(false);
          setStarter(true);
          setTab('studio');
        }}
      />
    );
  return (
    <div className={tutorialActive ? 'guided-layout' : undefined}>
      {tutorialActive && <GuidedTutorial state={state} tab={tab} navigate={setTab} />}
      <div className="app-shell">
        <aside className="sidebar">
          <a className="brand" href="/">
            <Brand />
          </a>
          <span className="sidebar-label">LEAVE A LIGHT ON</span>
          <nav>
            {[
              { id: 'studio', label: '방송실', icon: LayoutDashboard },
              { id: 'audience', label: '나의 관객', icon: Users },
              { id: 'knowledge', label: '게임 라이브러리', icon: BookOpen },
              { id: 'manager', label: '매니저', icon: Shield },
              { id: 'community', label: '방송 밖 이야기', icon: MessageCircle },
              { id: 'special', label: '마음과 포인트', icon: Heart },
              { id: 'clips', label: '핫클립', icon: Clapperboard },
            ].map((item) => (
              <button
                data-tutorial={'nav-' + item.id}
                key={item.id}
                className={tab === item.id ? 'selected' : ''}
                onClick={() => setTab(item.id)}
              >
                <item.icon size={18} />
                {item.label}
                {tab === item.id && <span className="nav-indicator" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-card">
            <div className="mini-icon">
              <Sparkles size={18} />
            </div>
            <b>
              처음엔 나그네,
              <br />
              어느새 우리 단골.
            </b>
            <p>
              같은 장면에 웃고,
              <br />
              다음 이야기를 기다려요.
            </p>
            <button onClick={() => void openOverlay()}>
              오버레이 열기 <ArrowUpRight size={15} />
            </button>
          </div>
          {window.backseat && (
            <button
              className="secondary"
              title="오버레이 클릭 통과"
              onClick={async () => setThrough(await window.backseat!.toggleClickThrough())}
            >
              {through ? '클릭 통과 끄기' : '클릭 통과 켜기'}
            </button>
          )}
          <div className="sidebar-bottom">
            <button data-tutorial="settings" onClick={settings}>
              <Settings2 size={17} /> 방송 설정
            </button>
            <button
              disabled={state.running || state.busy}
              onClick={() => void action('tutorial', { action: 'begin' })}
            >
              {state.tutorial?.status === 'paused' || state.tutorial?.status === 'active'
                ? '튜토리얼 이어하기'
                : '튜토리얼 다시 배우기'}
            </button>
            <div className="account">
              <span className="avatar streamer">P</span>
              <div>
                <b>{s.streamer}</b>
                <small>PERSONAL STUDIO</small>
              </div>
              <span className="dot green" />
            </div>
          </div>
        </aside>
        <div className={tab === 'studio' ? 'workspace studio-workspace' : 'workspace'}>
          <header className="topbar">
            <div className="breadcrumbs">
              내 스튜디오 <ChevronRight size={13} />
              <b>
                {
                  {
                    studio: '방송실',
                    audience: '나의 관객',
                    knowledge: '게임 라이브러리',
                    manager: '매니저',
                    community: '방송 밖 이야기',
                    special: '마음과 포인트',
                    clips: '핫클립',
                  }[tab]
                }
              </b>
            </div>
            <div className="top-status">
              <span className={'dot ' + (connected ? 'green' : 'red')} />
              {connected ? '연결됨' : '연결 끊김'}
              <span className="divider" />
              <span>{state.running ? 'ON AIR' : 'STANDBY'}</span>
            </div>
          </header>
          <main>
            <RuntimeDownloads state={state} activeOnly />
            <FirstViewerStatus state={state} onView={() => setTab('audience')} />
            {state.tutorial?.status === 'paused' && (
              <div className="first-viewer-status">
                <span>따라 배우기를 잠시 쉬고 있어요. 이전 단계부터 이어갈 수 있어요.</span>
                <button
                  className="secondary"
                  disabled={state.running || state.busy}
                  onClick={() => void action('tutorial', { action: 'begin' })}
                >
                  이어서 배우기
                </button>
              </div>
            )}
            <DonationToast messages={state.messages} />
            <section className="page-heading">
              <div>
                <div className="eyebrow">NAGNE + ON AIR</div>
                <h1>
                  {tab === 'studio'
                    ? '방송을 켜면, 이야기가 찾아옵니다.'
                    : tab === 'audience'
                      ? '오늘도 찾아온, 반가운 얼굴들.'
                      : tab === 'knowledge'
                        ? '같이 볼수록, 더 잘 알아요.'
                        : tab === 'community'
                          ? '방송이 끝나도, 이야기는 남아요.'
                          : tab === 'special'
                            ? '관객의 마음, 한 걸음 더 가까이.'
                            : tab === 'clips'
                              ? '명장면은, 계속 이야기되니까.'
                              : '방송의 분위기를 지켜요.'}
                </h1>
                <p>
                  {tab === 'studio'
                    ? '함께 보고, 떠들고, 기억하는 우리들의 작은 방송실.'
                    : tab === 'audience'
                      ? '단골부터 뉴비까지. 각자의 성격으로 당신의 방송에 함께합니다.'
                      : tab === 'knowledge'
                        ? '게임의 인지도와 함께한 시간이 관객의 지식으로 쌓입니다.'
                        : tab === 'community'
                          ? '함께 본 장면, 다음 방송의 기대, 우리만의 농담을 모아두세요.'
                          : tab === 'special'
                            ? '서로의 취향을 알아보고, 관객들의 관계를 탐색하세요.'
                            : tab === 'clips'
                              ? '날짜와 게임, 함께한 관객별로 장면을 꺼내보고 댓글을 나누세요.'
                              : '원하는 관객을 매니저로 지정하고, 방송 규칙을 정하세요.'}
                </p>
              </div>
              <button className="secondary" onClick={() => setDonationsOpen(true)}>
                받은 후원
              </button>
              <button
                data-tutorial="overlay"
                className="secondary"
                onClick={() => void openOverlay()}
              >
                <Clapperboard size={16} /> 오버레이 <ArrowUpRight size={15} />
              </button>
            </section>
            {state.storage.warnings.length > 0 && (
              <div className="storage-notice panel" role="status">
                <b>저장 기록을 확인해주세요</b>
                {state.storage.warnings.map((warning, i) => (
                  <p key={i}>{warning}</p>
                ))}
              </div>
            )}
            {(error || state.lastError) && (
              <div role="alert" className="alert">
                {error || state.lastError}
                <button className="icon" aria-label="알림 닫기" onClick={() => setError('')}>
                  <X size={15} />
                </button>
              </div>
            )}
            {tab === 'clips' && <HotClips state={state} onError={setError} />}
            {tab === 'special' && (
              <SpecialStudio
                key={focusMessage?.id || 'special'}
                state={state}
                focusMessage={focusMessage}
                onError={setError}
              />
            )}
            {tab === 'studio' && (
              <>
                <div className="stats-row">
                  <div className="stat">
                    <span>
                      함께하는 관객 <Users size={15} />
                    </span>
                    <b>
                      {present.filter((p) => !p.system).length}
                      <small>명</small>
                    </b>
                    <em>각자의 이야기로 함께</em>
                  </div>
                  <div className="stat">
                    <span>
                      채팅 메시지 <MessageCircle size={15} />
                    </span>
                    <b>
                      {state.messages.filter((m) => m.kind !== 'streamer').length}
                      <small>개</small>
                    </b>
                    <em>이 방송에서 나눈 이야기</em>
                  </div>
                  <div className="stat">
                    <span>
                      방송 시간 <Activity size={15} />
                    </span>
                    <b className="mono">{state.running ? clock : '00:00:00'}</b>
                    <em>{state.running ? '지금 함께하고 있어요' : '당신을 기다리고 있어요'}</em>
                  </div>
                  <div className="stat">
                    <span>
                      응원 포인트 <Sparkles size={15} />
                    </span>
                    <b>
                      {state.economy.balance.toLocaleString('ko-KR')}
                      <small>P</small>
                    </b>
                    <em>관객들이 전한 마음</em>
                  </div>
                </div>
                <div className="studio-grid">
                  <div className="stage-column">
                    <section className="panel stage">
                      <div className="panel-heading">
                        <div>
                          <span className={'badge ' + (state.running ? 'live' : '')}>
                            {state.running
                              ? s.mode === 'rehearsal'
                                ? 'REHEARSAL'
                                : 'LIVE'
                              : 'OFFLINE'}
                          </span>
                          <b>{s.title}</b>
                        </div>
                        <button
                          className="icon"
                          aria-label="방송 설정"
                          onClick={settings}
                          title="방송 설정"
                        >
                          <SlidersHorizontal size={17} />
                        </button>
                      </div>
                      <div className={'preview ' + (media.sharing ? 'has-video' : '')}>
                        <video ref={media.video} autoPlay muted playsInline />
                        {!media.sharing && (
                          <div className="preview-empty">
                            <div className="orbit orbit-a" />
                            <div className="orbit orbit-b" />
                            <div className="screen-icon">
                              <Monitor size={31} />
                              <span className="screen-spark">
                                <Sparkles size={14} />
                              </span>
                            </div>
                            <h2>
                              {state.obsInput?.sourceId
                                ? state.obsInput.selectedScene
                                : s.category === 'just-chatting'
                                  ? '오늘은 어떤 이야기를 나눌까요?'
                                  : '다음 명장면을 기다리는 중'}
                            </h2>
                            <p>
                              {state.obsInput?.sourceId
                                ? '선택한 OBS 장면을 함께 보고 있어요. 아래 OBS 연결에서 미리보기를 확인할 수 있어요.'
                                : s.category === 'just-chatting'
                                  ? '방송을 시작하고 키보드나 마이크로 인사해보세요. 화면은 선택 사항이에요.'
                                  : '게임 화면을 연결하면 관객들이 함께 보기 시작해요.'}
                            </p>
                            <button
                              className="primary"
                              disabled={!!media.capturePreparing}
                              onClick={() => void screen()}
                            >
                              <Monitor size={16} />{' '}
                              {state.obsInput?.sourceId
                                ? '일반 화면으로 전환'
                                : s.category === 'just-chatting'
                                  ? '화면 연결 (선택)'
                                  : '게임 화면 연결'}
                            </button>
                            <small>직접 선택한 화면만 공유됩니다</small>
                          </div>
                        )}
                        {media.sharing && (
                          <div className="preview-caption">
                            <span className="dot green" /> 선택한 화면 미리보기{' '}
                            <button onClick={media.stopScreen}>연결 해제</button>
                          </div>
                        )}
                      </div>
                      {media.capturePreparing && (
                        <div className="capture-preparation">
                          <div role="status">
                            <b>화면 연결 준비 중</b>
                            <span>
                              {media.capturePreparing === 'source'
                                ? '선택한 화면에 연결하고 있어요.'
                                : '첫 화면을 기다리고 있어요. 게임 창을 표시해주세요.'}
                              {media.sharing ? ' 준비되면 지금 화면에서 전환됩니다.' : ''}
                            </span>
                          </div>
                          <button className="secondary" onClick={media.cancelCapture}>
                            연결 취소
                          </button>
                        </div>
                      )}
                      <div className="stage-controls">
                        <div>
                          <button
                            className={media.mic ? 'control active' : 'control'}
                            title="마이크"
                            disabled={
                              media.mic || media.micPreparing || !state.running || s.mode !== 'live'
                            }
                            onClick={() => void media.startMic()}
                          >
                            <Mic size={18} />
                            <span>
                              {media.micPreparing
                                ? '마이크 연결 중'
                                : media.mic
                                  ? '마이크 켜짐'
                                  : state.running && s.mode === 'live'
                                    ? '마이크 재연결'
                                    : '방송 시작 시 자동 연결'}
                            </span>
                          </button>
                          <div className="audio-meter">
                            {Array.from({ length: 11 }, (_, i) => (
                              <i
                                key={i}
                                style={{
                                  height: 6 + (i % 4) * 4,
                                  background: media.level > i / 12 ? 'var(--neon)' : undefined,
                                }}
                              />
                            ))}
                          </div>
                          <button
                            className={media.soundSharing ? 'control active' : 'control'}
                            title="시스템 출력 소리"
                            disabled={!!media.capturePreparing && !media.soundSharing}
                            onClick={() =>
                              media.soundSharing ? media.stopSound() : void screen(true)
                            }
                          >
                            <Volume2 size={18} />
                            <span>{media.soundSharing ? '소리 공유 중' : '소리 연결'}</span>
                          </button>
                          <button
                            className="icon"
                            aria-label="화면 선택"
                            title="화면 선택"
                            disabled={!!media.capturePreparing}
                            onClick={() => void screen()}
                          >
                            <Monitor size={18} />
                          </button>
                        </div>
                        <button
                          data-tutorial="start"
                          className={state.running ? 'stop-button' : 'primary'}
                          disabled={!connected}
                          onClick={async () => {
                            if (state.running) {
                              media.stopAll();
                              await action('stop');
                            } else await action(tutorialActive ? 'tutorial/rehearsal' : 'start');
                          }}
                        >
                          {state.running ? (
                            <>
                              <Pause size={15} /> 방송 종료
                            </>
                          ) : (
                            <>
                              <Play size={15} fill="currentColor" />{' '}
                              {tutorialActive || s.mode === 'rehearsal'
                                ? '리허설 시작'
                                : '방송 시작'}
                            </>
                          )}
                        </button>
                      </div>
                    </section>
                    <ObsPanel state={state} onSelected={media.stopScreen} onError={setError} />
                    <ExternalChatPanel state={state} onError={setError} />
                    {starter && !tutorialActive && (
                      <section className="studio-starter">
                        <div>
                          <b>첫 방송, 이렇게 시작해보세요</b>
                          <p>
                            {s.mode === 'rehearsal'
                              ? '리허설 시작 → 채팅창에서 인사 → 오버레이를 확인해보세요.'
                              : s.category === 'just-chatting'
                                ? '방송 시작 → 키보드로 인사하거나 마이크 연결. 화면 없이도 관객과 이야기할 수 있어요.'
                                : '게임 화면 선택 → 방송 시작 → 인사. 막히면 훈수 요청 버튼으로 같이 해결해보세요.'}
                          </p>
                          <p>
                            나의 관객에서 첫 체험 포인트로 한 명을 만나보세요. 익숙해지면 마음과
                            포인트에서 취향을 알아갈 수 있어요.
                          </p>
                          <div className="connection-actions">
                            <button className="text-button" onClick={settings}>
                              연결과 방송 설정
                            </button>
                          </div>
                        </div>
                        <button className="text-button" onClick={() => setStarter(false)}>
                          안내 접기
                        </button>
                      </section>
                    )}
                    <div className="clip-quick-save">
                      <span>마음에 든 순간은 관객이 핫클립으로 남겨요.</span>
                      <span>{state.economy.balance}P · 포인트</span>
                    </div>
                    <section className="panel perception">
                      <div className="panel-heading">
                        <div>
                          <span className="mini-icon purple">
                            <Sparkles size={16} />
                          </span>
                          <b>관객이 보고 있는 순간</b>
                        </div>
                        <span className={'status-pill ' + (state.busy ? 'working' : '')}>
                          {state.busy
                            ? '흐름을 따라보는 중'
                            : state.observation
                              ? '최근 함께 본 장면'
                              : '화면 대기 중'}
                        </span>
                      </div>
                      <div className="perception-body">
                        <div className="game-tile">
                          <Gamepad2 size={27} />
                        </div>
                        <div>
                          <b>
                            {state.observation?.game ||
                              s.games.find((g) => g.id === s.gameId)?.name}
                          </b>
                          <p>
                            {state.observation?.scene ||
                              '아직 함께 본 장면이 없어요. 방송을 시작해볼까요?'}
                          </p>
                          <div className="tags">
                            <span>{media.sharing ? '연속 장면 연결' : '화면 연결 대기'}</span>
                            <span>
                              {s.adviceMode === 'on-request'
                                ? '요청할 때만 훈수'
                                : s.adviceMode === 'never'
                                  ? '훈수 없음'
                                  : '훈수 허용'}
                            </span>
                            {state.observation && (
                              <span>확신 {Math.round(state.observation.confidence * 100)}%</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {media.transcript && (
                        <div className="transcript">
                          <AudioLines size={15} />
                          <span>나의 목소리</span> {media.transcript}{' '}
                          {media.delivery && <small>({media.delivery} · 추정 단서)</small>}
                        </div>
                      )}
                      <SoundPanel
                        sound={state.sound}
                        enabled={media.soundSharing}
                        status={media.soundStatus}
                        level={media.soundLevel}
                      />
                    </section>
                    <section className="panel crew">
                      <div className="panel-heading">
                        <div>
                          <Users size={16} />
                          <b>오늘의 관객</b>
                          <span className="count">{present.filter((p) => !p.system).length}</span>
                        </div>
                        <button className="text-button" onClick={() => setTab('audience')}>
                          모두 보기 <ChevronRight size={14} />
                        </button>
                      </div>
                      <div className="crew-list">
                        {present.slice(0, 5).map((p) => (
                          <div key={p.id}>
                            <span
                              className="avatar"
                              style={{ color: p.color, background: p.color + '19' }}
                            >
                              {p.name[0]}
                            </span>
                            <b>{p.name}</b>
                            <small>{p.id === s.managerId ? '매니저' : '관객'}</small>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                  <aside className="panel chat-panel">
                    <div className="panel-heading">
                      <div>
                        <MessageCircle size={17} />
                        <b>관객 채팅</b>
                        <span className="count">{present.filter((p) => !p.system).length}</span>
                      </div>
                      <ChatDisplayToggle shown={s.showStreamerMessages !== false} />
                      <button
                        className="icon"
                        aria-label="채팅 비우기"
                        title="채팅 비우기"
                        onClick={() => moderate('clear', '')}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="chat-room-label">
                      <span className="dot green" />
                      {s.mode === 'rehearsal' ? '리허설 채팅' : '관객들과 함께하는 나만의 방송'}
                      <ChatBriefing state={state} now={now} />
                    </div>
                    <div className="pinned">
                      <Shield size={17} />
                      <div>
                        <b>{manager?.name} 매니저</b>
                        <p>{s.managerRules.slice(0, 100)}</p>
                      </div>
                    </div>
                    <div className="chat-scroll">
                      {shownMessages.length === 0 && (
                        <div className="chat-empty">
                          <MessageCircle size={30} />
                          <b>채팅창이 곧 북적일 거예요</b>
                          <p>방송을 시작하고 관객에게 인사해보세요.</p>
                        </div>
                      )}
                      {shownMessages.map((m) => (
                        <ChatLine
                          key={m.id}
                          message={m}
                          moderate={moderate}
                          managerId={s.managerId}
                          onInsight={showInsight}
                        />
                      ))}
                      <div ref={chatEnd} />
                    </div>
                    {chatFollow.unread && (
                      <button className="chat-jump" onClick={chatFollow.jump}>
                        새 채팅 보기 ↓
                      </button>
                    )}
                    <div className="chat-compose">
                      <div className="compose-box">
                        <TextReactions
                          disabled={!state.running}
                          onSelect={(reaction) => {
                            const input = composeInput.current,
                              start = input?.selectionStart ?? text.length,
                              end = input?.selectionEnd ?? start;
                            const next = text.slice(0, start) + reaction + text.slice(end);
                            if (next.length <= 3000) {
                              setText(next);
                              requestAnimationFrame(() => {
                                input?.focus();
                                input?.setSelectionRange(
                                  start + reaction.length,
                                  start + reaction.length,
                                );
                              });
                            } else {
                              setError('채팅은 3000자까지 입력할 수 있어요.');
                              input?.focus();
                            }
                          }}
                        />
                        <input
                          data-tutorial="compose"
                          ref={composeInput}
                          aria-label="관객에게 말하기"
                          placeholder={
                            state.running
                              ? '관객에게 말을 걸어보세요...'
                              : '방송을 시작하면 대화할 수 있어요'
                          }
                          disabled={!state.running}
                          value={text}
                          maxLength={3000}
                          onChange={(e) => setText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
                          }}
                        />
                        <button
                          className="icon"
                          aria-label="보내기"
                          title="보내기"
                          disabled={!state.running || !text.trim()}
                          onClick={submit}
                        >
                          <Send size={17} />
                        </button>
                      </div>
                      <div className="compose-hint">
                        <span>
                          <Shield size={12} /> {manager?.name} 관리 중
                        </span>
                        <button
                          className="text-button"
                          disabled={!state.running}
                          onClick={() =>
                            media.say(
                              '관객들아, 여기서 막혔어. 지금 화면을 보고 힌트와 훈수 좀 부탁해!',
                            )
                          }
                        >
                          훈수 요청 <Sparkles size={12} />
                        </button>
                      </div>
                    </div>
                  </aside>
                </div>
              </>
            )}
            {tab === 'audience' && <AudiencePanel state={state} onError={setError} />}
            {tab === 'knowledge' && (
              <>
                <div className="section-actions">
                  <p className="muted">
                    인지도는 초기 익숙함에, 함께 본 시간은 누적 지식에 반영됩니다. 함께 본 장면을
                    돌아보고 게임별 이야기를 모아보세요.
                  </p>
                  <button className="secondary" onClick={settings}>
                    <Plus size={16} /> 게임 프로필
                  </button>
                </div>
                <div className="knowledge-grid">
                  {state.knowledge.length === 0 && (
                    <section className="panel empty-library">
                      <BookOpen size={35} />
                      <h2>함께할 첫 게임을 기다려요</h2>
                      <p>
                        실제 방송에서 인식한 게임이 여기에 쌓입니다.
                        <br />새 게임은 아래에서 먼저 알려줄 수도 있어요.
                      </p>
                    </section>
                  )}
                  {state.knowledge.map((k) => (
                    <section className="panel knowledge-card" key={k.name}>
                      <Gamepad2 size={25} />
                      <h2>{k.name}</h2>
                      <span className="status-pill">
                        함께 본 시간 {Math.floor(k.seconds / 60)}분
                      </span>
                      <p>
                        관찰 {k.observations.length}개 · 직접 알려준 지식 {k.notes.length}개
                      </p>
                      <ul>
                        {[...k.notes.slice(-3), ...k.observations.slice(-2)].map((n) => (
                          <li key={n.id}>{n.text}</li>
                        ))}
                      </ul>
                      <button
                        className="text-button"
                        onClick={() => void action('knowledge', { name: k.name }, 'DELETE')}
                      >
                        이 게임 기억 지우기
                      </button>
                    </section>
                  ))}
                </div>
                <section className="panel teaching">
                  <h2>관객에게 게임을 알려주세요</h2>
                  <p>게임 규칙, 지금까지의 스토리, 원하는 공략을 다음 방송에서도 기억합니다.</p>
                  <input
                    placeholder="게임 이름"
                    aria-label="학습할 게임 이름"
                    value={gameName}
                    onChange={(e) => setGameName(e.target.value)}
                    maxLength={120}
                  />
                  <textarea
                    placeholder="함께 기억할 게임 지식..."
                    aria-label="게임 지식"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={3000}
                  />
                  <button
                    className="primary"
                    disabled={!gameName.trim() || !note.trim()}
                    onClick={async () => {
                      if (await action('knowledge', { name: gameName, text: note })) setNote('');
                    }}
                  >
                    <BookOpen size={16} /> 기억에 추가
                  </button>
                </section>
              </>
            )}
            {tab === 'manager' && (
              <div className="manager-grid">
                <section className="panel manager-profile">
                  <span
                    className="avatar large"
                    style={{ background: '#99d9af20', color: '#99d9af' }}
                  >
                    <Shield size={32} />
                  </span>
                  <h2>{manager?.name} 매니저</h2>
                  <p>{manager?.personality}</p>
                  <div className="rules">
                    <b>우리 방송 규칙</b>
                    <p>{s.managerRules}</p>
                  </div>
                  <div className="tags">
                    <span>슬로우 모드 {s.slowModeSeconds}초</span>
                    <span>금칙어 {s.blockedWords.length}개</span>
                    <span>스포일러 {s.spoilerGuard ? '차단' : '허용'}</span>
                  </div>
                  <button className="secondary" onClick={settings}>
                    <SlidersHorizontal size={15} /> 매니저 설정
                  </button>
                </section>
                <section className="panel event-log">
                  <div className="panel-heading">
                    <b>방송 운영 기록</b>
                    <a href="/api/export" className="text-button" download>
                      <Download size={14} /> 내보내기
                    </a>
                  </div>
                  {state.events.length === 0 && (
                    <p className="muted">방송을 시작하면 운영 기록이 쌓입니다.</p>
                  )}
                  {state.events
                    .slice()
                    .reverse()
                    .map((e) => (
                      <div className="event" key={e.id}>
                        <span>{time(e.time)}</span>
                        <p>{e.text}</p>
                      </div>
                    ))}
                  <ReactionDiagnostics />
                </section>
              </div>
            )}
            {tab === 'community' && (
              <>
                <CommunityGallery state={state} onError={setError} />
                <details className="panel teaching">
                  <summary>방송에서 나눈 대화 기억</summary>
                  <ConversationMemories state={state} onError={setError} />
                </details>
                <CommunityLore items={state.audience.lore} onError={setError} />
              </>
            )}
            <footer>
              <span>
                <span className="dot green" /> 내 방송에 머무는, 반가운 얼굴들.
              </span>
              <span>
                NAGNEON · 0.1 <span className="divider" /> 나그네온 방송실
              </span>
            </footer>
          </main>
        </div>
        {captureSound !== null && (
          <CapturePicker
            initialSound={captureSound}
            onClose={() => setCaptureSound(null)}
            onSelect={(id, options) => {
              setCaptureSound(null);
              void media.share(id, options);
            }}
          />
        )}
        {donationsOpen && (
          <DonationHistory
            onClose={() => setDonationsOpen(false)}
            revision={
              (state.economy.ledger.at(-1)?.id || '') +
              s.personas.map((p) => p.id + ':' + p.name).join('|')
            }
          />
        )}
        {modal && draft && (
          <SettingsDialog
            state={state}
            initial={draft}
            onClose={() => setModal(false)}
            onSaved={() => setModal(false)}
            onGuide={() => {
              setModal(false);
              void action('tutorial', { action: 'begin' });
            }}
          />
        )}
      </div>
    </div>
  );
}
