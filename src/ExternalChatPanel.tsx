import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import type {State} from './types';
import './external-chat.css';

export function ExternalChatPanel({state,onError}:{state:State;onError:(text:string)=>void}){
  const [video,setVideo]=useState(''),[key,setKey]=useState(''),[busy,setBusy]=useState(false);
  const request=useRef<AbortController|null>(null),ticket=useRef(0);const chat=state.externalChat;
  useEffect(()=>()=>{ticket.current++;request.current?.abort();},[]);
  async function connect(){const id=++ticket.current,controller=new AbortController();request.current=controller;setBusy(true);
    try{const response=await fetch('/api/external/youtube/connect',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({video,apiKey:key}),signal:controller.signal});const result=await response.json();if(!response.ok)throw Error(result.error);}
    catch(e){if(id===ticket.current&&!controller.signal.aborted)onError(e instanceof Error?e.message:'외부 채팅 연결 실패');}
    finally{if(request.current===controller)request.current=null;if(id===ticket.current){setKey('');setBusy(false);}}
  }
  async function disconnect(){const id=++ticket.current;request.current?.abort();setBusy(true);setKey('');try{await api('external/disconnect');}catch(e){if(id===ticket.current)onError(e instanceof Error?e.message:'외부 채팅 해제 실패');}finally{if(id===ticket.current)setBusy(false);}}
  const connected=!!chat?.source;
  const status:Record<string,string>={disconnected:'연결 안 됨',connecting:'연결 중',receiving:'채팅 수신 중',reconnecting:'다시 연결 중',ended:'외부 방송 종료',failed:'연결 확인 필요'};
  return <details className="panel external-chat-panel"><summary>실제 방송 채팅 · 선택 사항</summary>
    <p>연결 후 들어온 YouTube 채팅을 관객과 함께 읽어요. 외부 방송에 메시지를 보내지는 않아요.</p>
    <p role="status">{status[chat?.phase||'disconnected']||'연결 중'}</p>{chat?.error&&<p role="alert">{chat.error}</p>}
    {!connected&&<><label>YouTube 방송 URL<input aria-label="YouTube 방송 URL" value={video} maxLength={2048} disabled={busy} onChange={e=>setVideo(e.target.value)}/></label><label>API 키<input aria-label="YouTube API 키" type="password" autoComplete="off" maxLength={256} value={key} disabled={busy} onChange={e=>setKey(e.target.value)}/></label>
      <p className="muted">Google Cloud에서 YouTube Data API v3를 활성화하고 API 키를 만드세요. 키는 저장하지 않아요. 치지직 연결은 준비 중이에요.</p>
      <button className="secondary" disabled={busy||!video||key.length<10||!state.running||state.settings.mode!=='live'} onClick={()=>void connect()}>YouTube 채팅 연결</button>{!state.running&&<p className="muted">실제 AI 방송을 시작한 뒤 연결할 수 있어요.</p>}</>}
    {(connected||busy)&&<button className="text-button" onClick={()=>void disconnect()}>{busy?'연결 취소':'외부 채팅 연결 해제'}</button>}
    {connected&&<div className="external-chat-messages" aria-label="실제 YouTube 채팅">{chat.messages.length===0?<p>연결 이후의 새 채팅을 기다리고 있어요.</p>:chat.messages.slice(-20).map(m=><p key={m.id}><span className="external-source">YouTube</span> <b>{m.name}</b> <span>{m.text}</span></p>)}</div>}
  </details>;
}
