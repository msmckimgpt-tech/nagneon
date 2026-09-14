import {DebugPanel} from './DebugPanel';
import {useMemo,useRef,useState,type KeyboardEvent} from 'react';
import {Check,Clapperboard,Gamepad2,Plus,Radio,Shield,SlidersHorizontal,Sparkles,X,type LucideIcon} from 'lucide-react';
import {api} from './api';
import {AccessibleDialog} from './AccessibleDialog';
import {ConnectionPanel} from './ConnectionPanel';
import {CrowdPresets} from './CrowdPresets';
import type {Game,Settings,State} from './types';
import './settings-dialog.css';
import modelCallLimits from '../shared/model-call-limits.json';

// The tabbed settings editor. It owns a private draft of the settings and only
// commits it when the user saves; personas are intentionally never edited or
// sent from here — the server owns the audience roster.
type TabId='broadcast'|'mood'|'connection'|'manager'|'media'|'games'|'debug';

const TABS:{id:TabId;label:string;Icon:LucideIcon}[]=[
  {id:'broadcast',label:'방송',Icon:Radio},
  {id:'mood',label:'분위기·훈수',Icon:Sparkles},
  {id:'connection',label:'연결·사용량',Icon:SlidersHorizontal},
  {id:'manager',label:'매니저·채팅',Icon:Shield},
  {id:'media',label:'미디어·기록',Icon:Clapperboard},
  {id:'games',label:'게임',Icon:Gamepad2},
  {id:'debug',label:'디버그',Icon:SlidersHorizontal},
];

// Stable element IDs so the tab/panel aria-controls / aria-labelledby wiring
// never shifts between renders.
const tabId=(id:TabId)=>`settings-tab-${id}`;
const panelId=(id:TabId)=>`settings-panel-${id}`;

export function SettingsDialog({state,initial,onClose,onSaved,onGuide}:{
  state:State;
  initial:Settings;
  onClose:()=>void;
  onSaved:()=>void;
  onGuide:()=>void;
}){
  const [draft,setDraft]=useState<Settings>(()=>structuredClone(initial));
  const [active,setActive]=useState<TabId>('broadcast');
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  const [apiKey,setApiKey]=useState('');

  const tabRefs=useRef<(HTMLButtonElement|null)[]>([]);
  const initialFocusRef=useRef<HTMLElement|null>(null);

  // Settings must not change mid-broadcast, mid-rehearsal, or while the model is
  // mid-response. These guards keep both the save and the API-key action inert.
  const locked=state.running||state.busy||!!state.training.active;

  function update<K extends keyof Settings>(field:K,value:Settings[K]){
    setDraft(prev=>({...prev,[field]:value}));
  }
  function updateGame(index:number,patch:Partial<Game>){
    setDraft(prev=>({...prev,games:prev.games.map((g,i)=>i===index?{...g,...patch}:g)}));
  }
  function addGame(){
    setDraft(prev=>({...prev,games:[...prev.games,{
      id:crypto.randomUUID(),name:'새 게임',genre:'기타',
      context:'화면에 보이는 상황을 함께 관찰하며 배운다.',popularity:0.2,
    }]}));
  }

  // Manager can only be chosen from the enabled roster the server handed us. If
  // the current manager is a disabled or system-provided persona we still keep
  // it as an option so saving never silently reassigns it.
  const managerOptions=useMemo(()=>{
    const list=initial.personas.filter(p=>p.enabled).map(p=>({id:p.id,name:p.name}));
    if(draft.managerId&&!list.some(p=>p.id===draft.managerId)){
      const current=initial.personas.find(p=>p.id===draft.managerId);
      list.unshift({id:draft.managerId,name:current?current.name:'현재 매니저 (시스템)'});
    }
    return list;
  },[initial.personas,draft.managerId]);

  async function save(){
    if(locked||pending)return;
    setPending(true);setError('');
    try{
      // The private server owns the persona roster, so strip personas before
      // saving; every other field is round-tripped back to the service.
      const payload:Record<string,unknown>={...draft};
      delete payload.personas;
      await api('settings',payload,'PUT');
      onSaved();
    }catch(e){
      setError(e instanceof Error?e.message:'설정을 저장하지 못했어요.');
    }finally{
      setPending(false);
    }
  }

  async function connectKey(){
    if(locked||pending||!apiKey)return;
    setPending(true);setError('');
    try{
      await api('connection',{apiKey});
      setApiKey('');
    }catch(e){
      setError(e instanceof Error?e.message:'API 키를 연결하지 못했어요.');
    }finally{
      setPending(false);
    }
  }

  // Roving tabindex: only the selected tab is in the tab order; arrows / Home /
  // End move selection (and focus) between the tabs.
  function onTabKey(e:KeyboardEvent<HTMLButtonElement>,index:number){
    let next=-1;
    if(e.key==='ArrowRight'||e.key==='ArrowDown')next=(index+1)%TABS.length;
    else if(e.key==='ArrowLeft'||e.key==='ArrowUp')next=(index-1+TABS.length)%TABS.length;
    else if(e.key==='Home')next=0;
    else if(e.key==='End')next=TABS.length-1;
    if(next<0)return;
    e.preventDefault();
    setActive(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  const describe=locked
    ?'방송·연습·응답 생성이 끝난 뒤에 설정을 저장할 수 있어요.'
    :'당신의 방송을 어떤 분위기로 만들지 골라보세요.';

  function renderPanel(id:TabId){
    switch(id){
      case 'debug':return active==='debug'?<DebugPanel locked={locked} onSettingsSaved={onSaved}/>:null;
      case 'broadcast':
        return <>
          <button type="button" className="guide-link" disabled={locked} onClick={onGuide}>
            처음 시작 안내 다시 보기 →
          </button>
          <label className="set-field">방송 제목
            <input value={draft.title} maxLength={100} onChange={e=>update('title',e.target.value)}/>
          </label>
          <label className="set-field">스트리머 이름
            <input value={draft.streamer} maxLength={40} onChange={e=>update('streamer',e.target.value)}/>
          </label>
          <div className="set-row">
            <label className="set-field">방송 모드
              <select value={draft.mode} onChange={e=>update('mode',e.target.value as Settings['mode'])}>
                <option value="rehearsal">리허설</option>
                <option value="live">관객 연결 · ChatGPT</option>
              </select>
            </label>
            <label className="set-field">방송 카테고리
              <select value={draft.category} onChange={e=>update('category',e.target.value as Settings['category'])}>
                <option value="gaming">게임 방송</option>
                <option value="just-chatting">Just Chatting · 화면 없이 소통</option>
              </select>
            </label>
          </div>
          <label className="set-field">지금 플레이하는 게임
            <select value={draft.gameId} onChange={e=>update('gameId',e.target.value)}>
              {draft.games.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <p className="field-note">게임 프로필은 ‘게임’ 탭에서 추가하고 다듬을 수 있어요.</p>
        </>;

      case 'mood':
        return <>{state.debug?.previewEnabled&&<CrowdPresets draft={draft} locked={locked} onChange={patch=>setDraft(previous=>({...previous,...patch}))}/>}
          <div className="set-row">
            <label className="set-field">커뮤니티 규모와 리듬
              <select value={draft.crowdStyle} onChange={e=>update('crowdStyle',e.target.value as Settings['crowdStyle'])}>
                <option value="cozy">소규모 단골 방송</option>
                <option value="lively">활발한 중규모 채팅</option>
                <option value="stadium">대규모 응원형 채팅</option>
              </select>
            </label>
            <label className="set-field">초기 잠수 관객 비율 {Math.round(draft.lurkRatio*100)}%
              <input type="range" min={0} max={0.9} step={0.05} value={draft.lurkRatio}
                onChange={e=>update('lurkRatio',Number(e.target.value))}/>
            </label>
          </div>
          <label className="set-field">방송 안팎의 커뮤니티 규범
            <textarea value={draft.communityCulture} maxLength={2000}
              onChange={e=>update('communityCulture',e.target.value)}/>
          </label>
          <label className="set-field">스트리머 성향
            <textarea value={draft.streamerStyle} maxLength={2000}
              onChange={e=>update('streamerStyle',e.target.value)}/>
          </label>
          <div className="set-row">
            <label className="set-field">훈수 정책
              <select value={draft.adviceMode} onChange={e=>update('adviceMode',e.target.value as Settings['adviceMode'])}>
                <option value="on-request">요청할 때만</option>
                <option value="always">자유롭게 훈수</option>
                <option value="never">훈수 금지</option>
              </select>
            </label>
            <label className="set-field">잘못된 게임 훈수 연출 {Math.round(draft.mistakenAdvice*100)}%
              <input type="range" min={0} max={1} step={0.05} value={draft.mistakenAdvice}
                onChange={e=>update('mistakenAdvice',Number(e.target.value))}/>
            </label>
          </div>
          <label className="set-field">관심 끌기 연출 {Math.round(draft.attentionSeeking*100)}%
            <input type="range" min={0} max={1} step={0.05} value={draft.attentionSeeking}
              onChange={e=>update('attentionSeeking',Number(e.target.value))}/>
          </label>
          <label className="set-check">
            <input type="checkbox" checked={draft.webSearch} onChange={e=>update('webSearch',e.target.checked)}/>
            <span>훈수 요청 시 인터넷 공략 검색 허용</span>
          </label>
          <p className="field-note">관객들의 말투와 반응을 조절해 원하는 방송 분위기를 만들어보세요.</p>
        </>;

      case 'connection':
        return <>
          <ConnectionPanel state={state}/>
          {!['codex','ollama','claude-cli','gemini-cli'].includes(state.provider.kind||'')&&<label className="set-field">{state.provider.kind==='claude'?'Claude':state.provider.kind==='gemini'?'Gemini':'OpenAI'} API 키 (앱 종료 시 삭제)
            <div className="inline-form">
              <input type="password" autoComplete="off" value={apiKey} placeholder="API 키"
                onChange={e=>setApiKey(e.target.value)}/>
              <button type="button" className="secondary" disabled={locked||pending||!apiKey}
                onClick={()=>void connectKey()}>연결</button>
            </div>
          </label>}
          <div className="set-row">
            <label className="set-field">AI 반응 최소 간격 (초)
              <input type="number" min={5} max={120} value={draft.intervalSeconds}
                onChange={e=>update('intervalSeconds',Number(e.target.value))}/>
            </label>
            <label className="set-field">세션 모델 호출 한도
              <input type="number" min={1} max={modelCallLimits.max} step={1} value={draft.maxCalls}
                onChange={e=>update('maxCalls',Number(e.target.value))}/>
            </label>
          </div>
          <button type="button" className="secondary" disabled={locked||pending}
            onClick={()=>update('maxCalls',modelCallLimits.generous)}>넉넉하게 · 10만 회</button>
          <p className="field-note">화면은 응답을 기다리는 동안에도 0.5초마다 모으고, 최근 16초에서 최대 8장을 시간순으로 전달해요. 간격이 길거나 응답이 늦으면 일부 장면을 놓칠 수 있어요. 방송당 1~100만 회까지 설정할 수 있어요. Nagneon 자체 한도이며 ChatGPT 계정의 사용 한도를 변경하지는 않습니다. 리허설 모드에서는 사용량이 들지 않아요.</p>
        </>;

      case 'manager':
        return <>
          <div className="set-row">
            <label className="set-field">매니저 임명
              <select value={draft.managerId} onChange={e=>update('managerId',e.target.value)}>
                {managerOptions.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="set-field">관객별 슬로우 모드 (초)
              <input type="number" min={0} max={60} value={draft.slowModeSeconds}
                onChange={e=>update('slowModeSeconds',Number(e.target.value))}/>
            </label>
          </div>
          <label className="set-field">한 번에 반응할 관객 수
            <input type="number" min={1} max={8} value={draft.chatPace}
              onChange={e=>update('chatPace',Number(e.target.value))}/>
          </label>
          <label className="set-field">매니저 운영 지침
            <textarea value={draft.managerRules} maxLength={3000}
              onChange={e=>update('managerRules',e.target.value)}/>
          </label>
          <label className="set-field">금칙어 (쉼표로 구분)
            <input value={draft.blockedWords.join(',')}
              onChange={e=>update('blockedWords',e.target.value.split(',').filter(Boolean))}/>
          </label>
          <label className="set-check">
            <input type="checkbox" checked={draft.spoilerGuard} onChange={e=>update('spoilerGuard',e.target.checked)}/>
            <span>스포일러 필터 사용</span>
          </label>
          <p className="field-note">이미 만난 관객을 매니저로 임명할 수 있어요. 새 관객은 방송과 핫클립, 포인트로 연 만남을 통해 들어옵니다.</p>
          <label className="set-check">
            <input type="checkbox" checked={draft.showStreamerMessages!==false} onChange={e=>update('showStreamerMessages',e.target.checked)}/>
            <span>채팅창과 오버레이에 내 발언 표시<small>숨겨도 관객은 말을 듣고 기억해요. 방송 중에는 채팅창 위에서도 바꿀 수 있어요.</small></span>
          </label>
        </>;

      case 'media':
        return <>
          <h3>음성 인식</h3>
          <label className="set-check">
            <input type="checkbox" checked={draft.contextualTranscription!==false} onChange={e=>update('contextualTranscription',e.target.checked)}/>
            <span>게임과 대화 맥락으로 음성 오인식 교정<small>인식 원문을 먼저 전달하고, 관객이 답할 때 확실한 부분만 교정해요. ‘음성 교정’ 표시에서 원문을 확인할 수 있어요.</small></span>
          </label>
          <h3>핫클립과 장면 기록</h3>
          <label className="set-check">
            <input type="checkbox" checked={draft.clipBufferEnabled}
              onChange={e=>update('clipBufferEnabled',e.target.checked)}/>
            <span>방송 중 영상·음성 클립 버퍼 사용
              <small>켜면 공유한 화면과 연결된 소리·마이크를 잠시 보관해요. 화면 없이 소리만 연결해도 관객이 고른 순간을 음성 클립으로 이 PC에 저장할 수 있어요.</small>
            </span>
          </label>
          <label className="set-check">
            <input type="checkbox" checked={draft.autoHighlights}
              onChange={e=>update('autoHighlights',e.target.checked)}/>
            <span>관객의 장면 기록 허용
              <small>관객이 좋아한 순간을 화면 이미지와 대화로 남겨요. 조용한 잡담이나 웃긴 실패처럼, 꼭 멋진 순간이 아니어도 기록될 수 있어요.</small>
            </span>
          </label>
          <p className="field-note">직접 공유한 화면과 켜 둔 마이크·연결된 소리만 기록합니다. 버퍼를 끄거나 연결을 끊으면 해당 임시 구간을 비우고, 이미 저장된 클립은 핫클립에서 삭제할 수 있어요.</p>
          <h3>포인트와 특수 기능</h3>
          <label className="set-check">
            <input type="checkbox" checked={draft.communityActivityEnabled!==false} onChange={e=>update('communityActivityEnabled',e.target.checked)}/>
            <span>관객의 커뮤니티 활동 허용<small>앱이 켜져 있을 때 클립을 감상하거나 갤러리를 읽고 댓글·추천·방송 후기를 스스로 결정해요. 방송 응답을 우선하며 자동 방문은 시간당 최대 6회, 세션 호출 한도 안에서 진행해요. 꺼 두면 방문을 쉽니다.</small></span>
          </label>
          <label className="set-check">
            <input type="checkbox" checked={draft.pointsEnabled}
              onChange={e=>update('pointsEnabled',e.target.checked)}/>
            <span>후원 포인트와 관객 교류
              <small>후원으로 모은 포인트로 관객과 더 가까워져요.</small>
            </span>
          </label>
        </>;

      case 'games':
        return <>
          <p className="field-note">실제 방송에서 인식한 게임과 직접 추가한 프로필이 관객의 관찰 기준이 됩니다.</p>
          {draft.games.map((g,i)=><div className="persona-editor" key={g.id}>
            <div className="set-row">
              <label className="set-field">게임 이름
                <input value={g.name} maxLength={80} onChange={e=>updateGame(i,{name:e.target.value})}/>
              </label>
              <label className="set-field">인지도 {Math.round(g.popularity*100)}%
                <input type="range" min={0} max={1} step={0.05} value={g.popularity}
                  onChange={e=>updateGame(i,{popularity:Number(e.target.value)})}/>
              </label>
            </div>
            <label className="set-field">관찰 지침
              <textarea value={g.context} maxLength={3000} onChange={e=>updateGame(i,{context:e.target.value})}/>
            </label>
          </div>)}
          <button type="button" className="secondary" disabled={draft.games.length>=100} onClick={addGame}>
            <Plus size={15}/> 새 게임 추가
          </button>
        </>;
    }
  }

  return <AccessibleDialog
    className="settings-dialog"
    labelledBy="settings-dialog-title"
    describedBy="settings-dialog-desc"
    initialFocus={initialFocusRef}
    onClose={onClose}
  >
    <header className="modal-title">
      <div>
        <h2 id="settings-dialog-title">나의 방송 설정</h2>
        <p id="settings-dialog-desc">{describe}</p>
      </div>
      <button type="button" className="icon" aria-label="방송 설정 창 닫기" onClick={onClose}><X/></button>
    </header>

    <div role="tablist" aria-label="방송 설정 범주" className="settings-tabs">
      {TABS.map((t,i)=><button
        key={t.id}
        type="button"
        role="tab"
        id={tabId(t.id)}
        aria-selected={active===t.id}
        aria-controls={panelId(t.id)}
        tabIndex={active===t.id?0:-1}
        ref={el=>{tabRefs.current[i]=el;if(t.id===active)initialFocusRef.current=el;}}
        onClick={()=>setActive(t.id)}
        onKeyDown={e=>onTabKey(e,i)}
      >
        <t.Icon size={14}/> {t.label}
      </button>)}
    </div>

    <div className="settings-body">
      {TABS.map(t=><div
        key={t.id}
        role="tabpanel"
        id={panelId(t.id)}
        aria-labelledby={tabId(t.id)}
        className="settings-panel"
        tabIndex={0}
        hidden={active!==t.id}
      >
        {renderPanel(t.id)}
      </div>)}
    </div>

    {error&&<p role="alert" className="settings-error">{error}</p>}

    <footer className="modal-footer">
      <span>설정과 게임 기억은 이 PC에 저장됩니다.</span>
      <div className="footer-actions">
        <button type="button" className="secondary" onClick={onClose}>닫기</button>
        <button type="button" className="primary" disabled={locked||pending||active==='debug'} onClick={()=>void save()}>
          <Check size={16}/> {pending?'저장 중…':'설정 저장'}
        </button>
      </div>
    </footer>
  </AccessibleDialog>;
}
