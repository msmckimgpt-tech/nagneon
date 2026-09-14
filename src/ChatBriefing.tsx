import {useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {chatBriefing} from '../shared/chat-briefing.js';
import type {State} from './types';
import './chat-briefing.css';

export function ChatBriefing({state,now}:{state:State;now:number}){
  const [open,setOpen]=useState(false);
  const details=useRef<HTMLDetailsElement>(null);
  const report=useMemo(()=>open?chatBriefing(state.messages,{now,startedAt:state.startedAt||0,mode:state.settings.mode,enabledIds:state.settings.personas.filter(p=>p.enabled).map(p=>p.id)}):null,[open,state.messages,state.startedAt,state.settings.mode,state.settings.personas,now]);
  const byId=new Map(state.messages.map(m=>[m.id,m]));
  const close=()=>{if(details.current){details.current.open=false;details.current.querySelector('summary')?.focus();}setOpen(false);};
  return <details ref={details} className="chat-briefing" onToggle={e=>setOpen(e.currentTarget.open)} onKeyDown={e=>{if(e.key==='Escape')close();}}>
    <summary>놓친 채팅 모아보기</summary>
    {report&&createPortal(<section className="briefing-content" aria-label="놓친 채팅 모아보기"><button className="text-button" onClick={close}>모아보기 닫기</button><p className="muted">최근 1분 · {report.count}개 채팅 · {report.speakers}명 참여</p>
      <p className="muted">질문·후원과 함께 나온 반응의 원문을 추렸어요. 질문에 답했는지는 직접 확인해주세요.</p>
      {state.settings.mode!=='live'?<p>리허설 채팅은 모아보기에 포함하지 않아요.</p>:report.items.length===0?<p>최근에 모아볼 채팅이 없어요.</p>:<ul>{report.items.map(item=>{
        const m=byId.get(item.ids[0]);if(!m)return null;
        return <li key={m.id}><span className="briefing-kind">{item.donation?'후원':item.question?'질문':'반응'}</span><strong>{m.name}</strong><time>{new Date(m.time).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</time><p>{m.text}</p>{item.ids.length>1&&<small>같은 표현 {item.ids.length}건</small>}</li>;
      })}</ul>}
    </section>,document.body)}
  </details>;
}
