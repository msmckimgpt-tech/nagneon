import {useState} from 'react';
import {Clapperboard,GraduationCap,Play,Send,Sparkles,Square,Stars,ArrowRight,Mic} from 'lucide-react';
import {api} from './api';
import {TrainingPanel} from './Training';
import {Seasons} from './Seasons';
import type {State,Message} from './types';

type Episode={id:string;title:string;tag:string;description:string;stages:string[]};
type Run={id:string;episodeId:string;title:string;premise:string;cast:{id:string;name:string}[];startedAt:number;stage:number;stageTitle:string;totalStages:number;messages:Message[];status:string};
export type DirectorState={catalog:Episode[];active:Run|null;archive:(Omit<Run,'messages'>&{messageCount:number;endedAt:number})[]};
export function Experiences({state,onError,onSay,onMic,mic}:{state:State;onError:(message:string)=>void;onSay:(text:string)=>void;onMic:()=>void;mic:boolean}){
  const [mode,setMode]=useState<'show'|'practice'|'seasons'>('show'),[selected,setSelected]=useState('anniversary'),[premise,setPremise]=useState(''),[line,setLine]=useState(''),[pending,setPending]=useState(false),[saved,setSaved]=useState('');
  const {director}=state,active=director.active,episode=director.catalog.find(e=>e.id===(active?.episodeId||selected));
  const request=async(path:string,body?:unknown)=>{if(pending)return;setPending(true);onError('');try{return await api(path,body);}catch(e){onError(e instanceof Error?e.message:'진행하지 못했습니다.');return null;}finally{setPending(false);}};
  const choose=(id:string)=>{setSelected(id);setSaved('');};
  return <div className="experiences">
    <div className="experience-switch" role="tablist" aria-label="방송 경험 종류">
      <button role="tab" aria-selected={mode==='show'} className={mode==='show'?'selected':''} onClick={()=>setMode('show')}><Stars size={18}/> 기획 방송 {active&&<i className="dot green"/>}</button>
      <button role="tab" aria-selected={mode==='practice'} className={mode==='practice'?'selected':''} onClick={()=>setMode('practice')}><GraduationCap size={18}/> 상황 연습 {state.training.active&&<i className="dot green"/>}</button>
      <button role="tab" aria-selected={mode==='seasons'} className={mode==='seasons'?'selected':''} onClick={()=>setMode('seasons')}><Sparkles size={18}/> 이어지는 방송 {state.seasons.active&&<i className="dot green"/>}</button>
    </div>
    {mode==='seasons'?<Seasons state={state} onError={onError} onSay={onSay} onMic={onMic} mic={mic}/>:mode==='practice'?<TrainingPanel training={state.training} onAction={async(path,body)=>{onError('');try{return await api(path,body);}catch(e){onError(e instanceof Error?e.message:'연습을 진행하지 못했습니다.');throw e;}}}/>:<>
      <section className="experience-hero panel"><div className="eyebrow">TONIGHT, YOU ARE THE MAIN CHARACTER</div><h2>한 번쯤 꿈꿨던 방송을,<br/>오늘 우리 방에서.</h2><p>수상 소감, 새벽 라디오, 관객들과 만드는 축제.<br/>당신이 무대를 열면, 익숙한 이름들이 각자의 방식으로 함께해요.</p><div className="tags"><span>10가지 기획 방송</span><span>자유로운 설정과 대화</span><span>끝나면 핫클립으로</span></div></section>
      {!state.running&&!state.training.active&&<div className="panel experience-start"><p>관객들이 입장할 수 있도록 방송을 먼저 켜주세요.</p><button className="primary" disabled={pending||state.settings.mode!=='live'} onClick={()=>void request('start')}><Play size={16}/> 방송 시작</button></div>}
      {state.training.active&&<p className="alert">상황 연습을 마치면 기획 방송을 시작할 수 있어요.</p>}
      <div className="experience-layout">
        <div className="episode-catalog">{director.catalog.map(e=><button key={e.id} className={'panel episode-card '+((active?.episodeId||selected)===e.id?'selected':'')} disabled={!!active} onClick={()=>choose(e.id)}><span>{e.tag}</span><h3>{e.title}</h3><p>{e.description}</p><small>{e.stages.length}개의 장면 <ArrowRight size={13}/></small></button>)}</div>
        <section className="panel episode-stage">
          <div className="panel-heading"><b>{episode?.title}</b><span className="status-pill">{active?'기획 방송 진행 중':'오늘의 무대'}</span></div>
          <div className="feature-body"><ol className="episode-steps">{episode?.stages.map((title,i)=><li key={title} className={active?.stage===i?'current':active&&active.stage>i?'done':''}><span>{i+1}</span>{title}</li>)}</ol>
            {!active?<><label>오늘은 어떤 이야기를 만들까요?<textarea aria-label="기획 방송 설정" maxLength={1200} value={premise} onChange={e=>setPremise(e.target.value)} placeholder="예: 오늘은 첫 방송 100일이라는 설정. 조금 쑥스러워도 관객들이 각자 좋아하는 점을 이야기해줬으면 좋겠어요."/></label><p className="field-note">과장된 세계관도 좋아요. 관객의 성격과 취향은 이어집니다.</p><button className="primary" disabled={!state.running||state.settings.mode!=='live'||pending||state.busy||!!state.seasons.active} onClick={()=>void request('director/start',{episodeId:selected,premise})}><Sparkles size={16}/> 이 무대 열기</button></>:<>
              <div className="episode-premise"><b>{active.stageTitle}</b><p>{active.premise||'우리 관객들과 자유롭게 만들어가는 시간'}</p><small>{active.cast.map(p=>p.name).join(' · ')}</small></div>
              <div className="episode-chat" aria-label="기획 방송 채팅" aria-live="polite">{active.messages.length?active.messages.slice(-24).map(m=><p key={m.id}><b style={{color:m.color}}>{m.name}</b> {m.text}</p>):<p className="muted">첫 장면을 열면 관객들이 반응해요.</p>}</div>
              <textarea aria-label="기획 방송 진행 멘트" value={line} maxLength={1200} onChange={e=>setLine(e.target.value)} placeholder="진행 멘트나 다음 장면에서 함께할 선택을 적어주세요."/>
              <div className="feature-buttons"><button className="secondary" disabled={pending||state.busy||!line.trim()} onClick={()=>{onSay(line.trim());setLine('');}}><Send size={15}/> 관객과 이야기</button><button className={'secondary '+(mic?'active':'')} onClick={onMic}><Mic size={15}/>{mic?'마이크 끄기':'마이크로 이야기'}</button>
                {active.stage<active.totalStages-1&&<button className="primary" disabled={pending||state.busy} onClick={async()=>{if(await request('director/advance',{text:line}))setLine('');}}><Play size={15}/>{active.stage<0?'첫 장면 열기':'다음 장면'}</button>}
                <button className="secondary" disabled={pending||state.busy} onClick={()=>void request('director/finish',{status:active.stage===active.totalStages-1?'completed':'interrupted'})}><Square size={14}/>{active.stage===active.totalStages-1?'피날레 · 기록 남기기':'이야기 마무리'}</button></div>
              <p className="field-note">다음 장면으로 넘어가거나, 잠시 머물며 관객과 자유롭게 이야기해보세요.</p>
            </>}
          </div>
        </section>
      </div>
      <section className="panel feature-body episode-album"><h2>우리 방의 특별한 날들</h2><p>무대가 끝나도 대화는 남아요. 핫클립으로 옮기면 다른 관객들도 댓글로 함께할 수 있습니다.</p>{saved&&<p role="status" className="saved-note">{saved}</p>}{!director.archive.length&&<p className="muted">첫 번째 특별한 방송을 기다리고 있어요.</p>}{director.archive.slice().reverse().map(item=><article key={item.id}><div><small>{new Date(item.startedAt).toLocaleString('ko-KR')} · {item.status==='completed'?'완료':'중도 마무리'}</small><h3>{item.title}</h3><p>{item.premise||item.stageTitle}</p><small>{item.cast.map(p=>p.name).join(', ')} · 대화 {item.messageCount}개</small></div><button className="secondary" disabled={pending||!item.messageCount} onClick={async()=>{if(await request('director/clip',{id:item.id}))setSaved('핫클립에 저장했어요. 핫클립 메뉴에서 댓글을 이어갈 수 있습니다.');}}><Clapperboard size={15}/> 핫클립 남기기</button></article>)}</section>
    </>}
  </div>;
}
