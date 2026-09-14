import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import type {State} from './types';
import './guided-tutorial.css';

const steps:Record<string,{title:string;text:string;target:string;group:number}>={
  audience:{title:'첫 관객을 초대해볼까요?',text:'왼쪽의 나의 관객을 눌러보세요. Tab으로 이동하고 Enter로 선택해도 좋아요.',target:'nav-audience',group:2},
  invite:{title:'첫 만남을 먼저 준비해요',text:'첫 관객 초대 버튼을 누르세요. 50P로 한 명을 생성하며 실패하면 돌려드려요. 준비되는 동안 리허설을 계속할 수 있어요.',target:'invite',group:2},
  studio:{title:'방송실로 돌아가요',text:'왼쪽 방송실을 눌러 실습을 이어가세요.',target:'nav-studio',group:3},
  start:{title:'직접 리허설을 켜보세요',text:'강조된 리허설 시작 버튼을 누르세요. 로그인 없이 준비된 채팅으로 연습하며 마이크와 화면은 켜지지 않아요.',target:'start',group:4},
  greet:{title:'관객에게 첫 인사를 보내요',text:'채팅창에 인사를 입력하고 Enter 또는 보내기를 누르세요. 내 인사와 준비된 리허설 응답이 표시되면 다음으로 넘어가요.',target:'compose',group:4},
  hide:{title:'내 발언을 숨겨보세요',text:'내 발언 표시를 꺼보세요. 메시지는 삭제되지 않고 채팅창에서만 숨겨져요.',target:'display',group:5},
  show:{title:'내 발언을 다시 표시해요',text:'같은 스위치를 다시 켜보세요. Space 키로도 바꿀 수 있어요.',target:'display',group:5},
  overlay:{title:'채팅창을 따로 띄워보세요',text:'오버레이를 열고 투명도를 조절한 뒤 닫으세요. 오버레이가 필요 없다면 이 단계를 건너뛰어도 좋아요.',target:'overlay',group:5},
  meet:{title:'첫 관객을 만나보세요',text:'나의 관객에서 생성 결과를 확인하세요. 아직 준비 중이라면 기다리지 않고 계속할 수 있어요.',target:'nav-audience',group:6},
  stop:{title:'리허설을 마쳐볼까요?',text:'방송실의 방송 종료 버튼을 눌러보세요. 첫 관객 생성은 리허설이 끝나도 계속됩니다.',target:'start',group:7},
  finish:{title:'이제 첫 방송을 준비할 수 있어요',text:'방송 설정에서 AI 연결을 확인하세요. 실제 방송을 시작하면 마이크가 자동 연결됩니다. 화면은 직접 선택할 때만 공유해요.',target:'settings',group:7}
};

export function GuidedTutorial({state,tab,navigate}:{state:State;tab:string;navigate:(tab:string)=>void}){
  const guide=state.tutorial!;const step=guide.step;const info=steps[step]||steps.audience;
  const [error,setError]=useState(''),[pending,setPending]=useState(false);
  const card=useRef<HTMLElement>(null);
  const lastCommand=useRef({action:'advance',skip:false});
  const advancing=useRef(false);const attempted=useRef('');
  async function command(action:string,skip=false){
    if(advancing.current)return;lastCommand.current={action,skip};advancing.current=true;setPending(true);setError('');
    try{await api('tutorial',{action,step,skip});}catch(e){setError(e instanceof Error?e.message:'안내를 저장하지 못했어요.');}
    finally{advancing.current=false;setPending(false);}
  }
  useEffect(()=>{attempted.current='';setError('');},[step]);
  useEffect(()=>{
    const el=card.current,parent=el?.parentElement;if(!el||!parent)return;
    const measure=()=>parent.style.setProperty('--guide-height',`${el.getBoundingClientRect().height}px`);
    measure();const observer=new ResizeObserver(measure);observer.observe(el);
    return()=>{observer.disconnect();parent.style.removeProperty('--guide-height');};
  },[]);
  // Resume into a usable page without simulating the navigation lessons.
  useEffect(()=>{if(step==='invite')navigate('audience');if(['start','greet','hide','show','overlay','stop'].includes(step))navigate('studio');},[step]);
  const mustStart=step==='greet'&&!state.running;
  const target=mustStart?'start':info.target;
  useEffect(()=>{
    const el=document.querySelector<HTMLElement>(`[data-tutorial="${target}"]`);
    if(!el)return;
    el.classList.add('tutorial-target');const previous=el.getAttribute('aria-describedby');el.setAttribute('aria-describedby','tutorial-instruction');
    el.scrollIntoView({block:'nearest',inline:'nearest'});el.focus({preventScroll:true});
    return()=>{el.classList.remove('tutorial-target');if(previous===null)el.removeAttribute('aria-describedby');else el.setAttribute('aria-describedby',previous);};
  },[target,tab]);
  useEffect(()=>{
    const greeting=state.messages.findIndex(m=>m.kind==='streamer');
    const received=greeting>=0&&state.messages.slice(greeting+1).some(m=>m.kind==='chat');
    const done=step==='audience'?tab==='audience':step==='invite'?(state.settings.personas.some(p=>!p.system)||!!guide.arrival&&guide.arrival.status!=='failed'):step==='studio'?tab==='studio':step==='start'?state.running&&state.settings.mode==='rehearsal':step==='greet'?state.running&&received:step==='hide'?state.settings.showStreamerMessages===false:step==='show'?state.settings.showStreamerMessages!==false:step==='overlay'?guide.overlayClosed:step==='stop'?!state.running:false;
    if(done&&!pending&&!advancing.current&&attempted.current!==step){attempted.current=step;void command('advance');}
  },[step,tab,state.running,state.messages,state.settings.showStreamerMessages,guide.arrival,guide.overlayClosed,pending]);
  return <section ref={card} className="guided-tutorial" aria-label="따라 배우기">
    <div className="tutorial-copy" aria-live="polite"><span className="eyebrow">따라 배우기 · {info.group} / 7</span><h2>{info.title}</h2><p id="tutorial-instruction">{mustStart?'리허설이 꺼져 있어요. 먼저 강조된 시작 버튼을 누른 뒤 인사를 보내세요.':info.text}</p></div>
    <div className="tutorial-actions">
      {step==='meet'&&tab==='audience'&&<button className="primary" disabled={pending} onClick={()=>void command('advance')}>{guide.arrival?.status==='completed'?'관객 확인했어요':'기다리지 않고 계속'}</button>}
      {step==='finish'?<button className="primary" disabled={pending} onClick={()=>void command('advance')}>튜토리얼 완료</button>:<button className="secondary" disabled={pending} onClick={()=>void command('advance',true)}>이 단계 건너뛰기</button>}
      <button className="text-button" disabled={pending} onClick={()=>void command('pause')}>나중에 계속하기</button>
      <button className="text-button" disabled={pending} onClick={()=>void command('skip')}>튜토리얼 건너뛰기</button>
      <small>건너뛰어도 요청한 관객 생성은 계속돼요. 리허설은 종료해요.</small>
      {error&&<div role="alert">{error}<button className="text-button" onClick={()=>{attempted.current='';void command(lastCommand.current.action,lastCommand.current.skip);}}>다시 시도</button></div>}
    </div>
  </section>;
}

export function FirstViewerStatus({state,onView}:{state:State;onView:()=>void}){
  const arrival=state.tutorial?.arrival;
  if(!arrival)return null;
  const viewer=state.settings.personas.find(p=>p.id===arrival.personaId);
  return <div className="first-viewer-status" role="status"><span>{arrival.status==='pending'?'첫 관객 준비 중 · 다른 화면에서도 계속 진행돼요':arrival.status==='completed'?`${viewer?.name||'첫 관객'} 준비 완료 · 실제 방송에서 만나요`:'첫 관객 준비 실패 · 포인트가 반환됐어요'}</span><button className="text-button" onClick={onView}>{arrival.status==='failed'?'확인·재시도':'관객 보기'}</button></div>;
}
