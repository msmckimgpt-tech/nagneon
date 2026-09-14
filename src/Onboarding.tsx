import {Brand} from './Brand';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,Gamepad2,Heart,MessageCircle,Radio,Sparkles} from 'lucide-react';
import {api} from './api';
import {ConnectionPanel} from './ConnectionPanel';
import type {Settings,State} from './types';
import './onboarding.css';

const vibes=[
  {id:'cozy',title:'편한 단골 방송',text:'안부도 묻고, 작은 성공에도 웃어주는 채팅.',icon:Heart},
  {id:'lively',title:'티키타카 놀이터',text:'적당한 드립과 관객끼리의 짧은 대화.',icon:MessageCircle},
  {id:'stadium',title:'나만의 응원석',text:'극적인 순간에 터지는 짧고 큰 호응.',icon:Sparkles}
] as const;

export function Onboarding({state,onDone}:{state:State;onDone:()=>void}){
  const [step,setStep]=useState(0),[name,setName]=useState(state.settings.streamer),[title,setTitle]=useState(state.settings.title),[category,setCategory]=useState(state.settings.category),[vibe,setVibe]=useState(state.settings.crowdStyle),[style,setStyle]=useState(state.settings.streamerStyle),[advice,setAdvice]=useState(state.settings.adviceMode),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[step]);
  async function finish(mode?:Settings['mode']){
    setSaving(true);setError('');
    try{await api('onboarding',mode?{streamer:name,title,category,crowdStyle:vibe,streamerStyle:style,adviceMode:advice,mode}:{skip:true});onDone();}
    catch(e){setError(e instanceof Error?e.message:'시작 안내를 저장하지 못했습니다.');}finally{setSaving(false);}
  }
  const ready=!!name.trim()&&!!title.trim();
  const busy=saving||state.busy||state.running||!!state.training.active;
  return <div className="welcome-shell">
    <header className="welcome-header"><span className="brand"><Brand/></span><button className="text-button" disabled={busy} onClick={()=>void finish()}>나중에 설정하기</button></header>
    <main className="welcome-main"><div className="welcome-intro"><span className="eyebrow">WELCOME TO NAGNEON</span><h1 tabIndex={-1} ref={heading}>{['방송을 켜면, 이야기가 찾아옵니다.','어떤 채팅창을 꿈꾸셨나요?','관객이 인사할 준비를 할게요.'][step]}</h1><p>{['나그네처럼 들러, 단골처럼 머무는 관객들을 만나세요.','관객마다 성격은 다르게, 함께하는 분위기는 당신답게.','지금 연결하거나, 리허설로 방송실을 먼저 둘러보세요.'][step]}</p></div>
    <ol className="welcome-steps" aria-label="첫 방송 준비 단계">{['내 방송','채팅 분위기','연결과 시작'].map((label,i)=><li key={label} className={i===step?'current':i<step?'done':''} aria-current={i===step?'step':undefined}><span>{i<step?<Check size={15}/>:i+1}</span>{label}</li>)}</ol>
    <div className="welcome-columns"><section className="welcome-card">
      {step===0&&<><div className="welcome-form"><label htmlFor="welcome-name">관객이 부를 이름</label><input id="welcome-name" autoComplete="nickname" maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="스트리머 이름"/><label htmlFor="welcome-title">첫 방송 제목</label><input id="welcome-title" maxLength={100} value={title} onChange={e=>setTitle(e.target.value)} placeholder="오늘, 어떤 이야기를 해볼까요?"/></div><fieldset className="welcome-fieldset"><legend>첫 방송은</legend><div className="category-options"><button aria-pressed={category==='gaming'} onClick={()=>setCategory('gaming')}><Gamepad2 size={24}/><b>게임하며 함께</b><span>선택한 화면을 관객과 같이 봐요.</span></button><button aria-pressed={category==='just-chatting'} onClick={()=>setCategory('just-chatting')}><MessageCircle size={24}/><b>Just Chatting</b><span>목소리나 키보드로 편하게 수다.</span></button></div></fieldset></>}
      {step===1&&<><fieldset className="welcome-fieldset"><legend>함께할 분위기</legend><div className="vibe-options">{vibes.map(v=><button key={v.id} aria-pressed={vibe===v.id} onClick={()=>setVibe(v.id)}><v.icon size={22}/><span><b>{v.title}</b><small>{v.text}</small></span>{vibe===v.id&&<Check size={17}/>}</button>)}</div></fieldset><div className="welcome-form"><label htmlFor="welcome-style">꼭 있었으면 하는 방송 느낌</label><textarea id="welcome-style" value={style} maxLength={2000} onChange={e=>setStyle(e.target.value)} placeholder="예: 실패해도 같이 웃고, 잘했을 때는 다 같이 신나게"/><label htmlFor="welcome-advice">게임 훈수는 언제 받을까요?</label><select id="welcome-advice" value={advice} onChange={e=>setAdvice(e.target.value as Settings['adviceMode'])}><option value="on-request">내가 요청할 때만</option><option value="always">자유롭게 이야기해도 좋아요</option><option value="never">훈수 없이 함께 즐기기</option></select></div></>}
      {step===2&&<><ConnectionPanel state={state}/><div className="first-stream-note"><b>입장한 뒤, 직접 방송을 시작하세요.</b><p>마이크와 화면은 각각 연결 버튼을 눌렀을 때만 켜집니다. 마이크 소리는 이 PC에서 글로 바뀌며, 켠 화면의 이미지와 대화가 AI에 전달됩니다.</p><p>리허설에서 채팅과 화면 배치를 살펴보고 첫 방송을 준비하세요.</p></div></>}
      {error&&<p role="alert" className="connection-problem">{error}</p>}
      <div className="welcome-actions">{step>0&&<button className="secondary" disabled={busy} onClick={()=>setStep(step-1)}><ArrowLeft size={15}/> 이전</button>}{step<2?<button className="primary" disabled={!ready||busy} onClick={()=>setStep(step+1)}>다음 <ArrowRight size={15}/></button>:<><button className="secondary" disabled={busy||!ready} onClick={()=>void finish('rehearsal')}>리허설로 입장</button><button className="primary" disabled={busy||!ready||!state.provider.configured} onClick={()=>void finish('live')}>AI 방송실 입장 <ArrowRight size={15}/></button></>}</div>
    </section><aside className="welcome-preview"><div className="welcome-preview-title"><span className="dot green"/><b>{title||'나의 첫 방송'}</b><small>채팅 미리보기</small></div><div className="welcome-sample"><span style={{color:'#a89bff'}}>모모</span><p>{name||'방장'} 왔다! 오늘은 뭐 하면서 놀아요?</p></div><div className="welcome-sample"><span style={{color:'#f18fac'}}>팝콘도둑</span><p>{vibe==='stadium'?'오늘 명장면 하나 나올 느낌인데 ㅋㅋ':vibe==='lively'?'첫 채팅 선점 성공 ㅋㅋ 팝콘 준비됐다':'일단 의자부터 당겨야지 🍿'}</p></div><div className="welcome-sample"><span style={{color:'#99d9af'}}>루나 · 매니저</span><p>{advice==='on-request'?'힌트는 방장이 부탁할 때 같이 생각해봐요.':'다들 편하게 즐겨요. 스포일러는 조심!'}</p></div><div className="welcome-promise"><Sparkles size={24}/><h2>처음엔 나그네, 어느새 단골</h2><p>기억에 남는 순간은 핫클립으로,<br/>방송 밖 이야기는 커뮤니티로.<br/>팬 페스티벌과 기념 방송도 기다리고 있어요.</p><small>처음엔 나그네,<br/>어느새 우리 단골.</small></div></aside></div>
    </main><footer className="welcome-footer">설정은 언제든 바꿀 수 있어요. 기존 관객과 기억은 유지됩니다.</footer>
  </div>;
}
