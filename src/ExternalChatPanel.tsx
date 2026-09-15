import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import type {State} from './types';
import './external-chat.css';

export function ExternalChatPanel({state,onError}:{state:State;onError:(text:string)=>void}){
  const [platform,setPlatform]=useState('youtube'),[video,setVideo]=useState(''),[key,setKey]=useState(''),[clientId,setClientId]=useState(''),[secret,setSecret]=useState(''),[authUrl,setAuthUrl]=useState(''),[busy,setBusy]=useState(false);
  const [acknowledgeAiTransfer,setAcknowledgeAiTransfer]=useState(false),[shareNames,setShareNames]=useState(false);
  const request=useRef<AbortController|null>(null),ticket=useRef(0);const chat=state.externalChat;
  useEffect(()=>()=>{ticket.current++;request.current?.abort();},[]);
  useEffect(()=>{if(!['authorizing','connecting'].includes(chat?.phase||''))setAuthUrl('');},[chat?.phase]);
  useEffect(()=>{if(['disconnected','ended','failed'].includes(chat?.phase||'disconnected')){setAcknowledgeAiTransfer(false);setShareNames(false);}},[chat?.phase]);
  async function connect(){const id=++ticket.current,controller=new AbortController();request.current=controller;setBusy(true);setAuthUrl('');
    try{const response=await fetch('/api/external/'+(platform==='chzzk'?'chzzk/start':'youtube/connect'),{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({...(platform==='chzzk'?{clientId,clientSecret:secret}:{video,apiKey:key}),acknowledgeAiTransfer,shareNames}),signal:controller.signal});const result=await response.json();if(!response.ok)throw Error(result.error);if(id===ticket.current&&result.authorizationUrl)setAuthUrl(result.authorizationUrl);}
    catch(e){if(id===ticket.current&&!controller.signal.aborted)onError(e instanceof Error?e.message:'외부 채팅 연결 실패');}
    finally{if(request.current===controller)request.current=null;if(id===ticket.current){setKey('');setSecret('');setBusy(false);}}
  }
  async function disconnect(){setAcknowledgeAiTransfer(false);setShareNames(false);const id=++ticket.current;request.current?.abort();setBusy(true);setKey('');setSecret('');setAuthUrl('');try{await api('external/disconnect');}catch(e){if(id===ticket.current)onError(e instanceof Error?e.message:'외부 채팅 해제 실패');}finally{if(id===ticket.current)setBusy(false);}}
  async function reopen(){const id=ticket.current;try{const result=await api<{authorizationUrl?:string}>('external/chzzk/open');if(id===ticket.current&&result.authorizationUrl)setAuthUrl(result.authorizationUrl);}catch(e){if(id===ticket.current)onError(e instanceof Error?e.message:'인증 화면 열기 실패');}}
  const connected=!!chat?.source,pending=['authorizing','connecting'].includes(chat?.phase||'');
  const status:Record<string,string>={disconnected:'연결 안 됨',authorizing:'치지직 승인 대기 중',connecting:'연결 중',receiving:'채팅 수신 중',reconnecting:'다시 연결 중',ended:'외부 방송 종료',failed:'연결 확인 필요'};
  const ready=platform==='youtube'?!!video&&key.length>=10:clientId.length>=8&&secret.length>=8;
  return <details className="panel external-chat-panel"><summary>실제 방송 채팅 · 선택 사항</summary>
    <p>연결한 플랫폼의 새 채팅을 관객과 함께 읽어요. 외부 방송에 메시지를 보내지는 않아요.</p>
    <p role="status">{status[chat?.phase||'disconnected']||'연결 중'}</p>{chat?.error&&<p role="alert">{chat.error}</p>}
    {!connected&&!pending&&<><label>연결할 플랫폼<select aria-label="외부 채팅 플랫폼" value={platform} disabled={busy} onChange={e=>{setPlatform(e.target.value);setAcknowledgeAiTransfer(false);setShareNames(false);}}><option value="youtube">YouTube</option><option value="chzzk">치지직</option></select></label>
      {platform==='youtube'?<><label>YouTube 방송 URL<input aria-label="YouTube 방송 URL" value={video} maxLength={2048} disabled={busy} onChange={e=>{setVideo(e.target.value);setAcknowledgeAiTransfer(false);}}/></label><label>API 키<input aria-label="YouTube API 키" type="password" autoComplete="off" maxLength={256} value={key} disabled={busy} onChange={e=>setKey(e.target.value)}/></label><p className="muted">Google Cloud에서 YouTube Data API v3를 활성화하고 API 키를 만드세요. 키는 저장하지 않아요.</p></>:<><label>Client ID<input aria-label="치지직 Client ID" value={clientId} maxLength={512} disabled={busy} onChange={e=>setClientId(e.target.value)}/></label><label>Client Secret<input aria-label="치지직 Client Secret" type="password" autoComplete="off" value={secret} maxLength={512} disabled={busy} onChange={e=>setSecret(e.target.value)}/></label><p className="muted">치지직 개발자 센터에서 앱을 등록하고 채팅 메시지 조회 권한을 선택하세요. 로그인 리디렉션 URL은 아래 주소로 등록해주세요.</p><code className="chzzk-callback">{chat?.chzzkCallback||'http://127.0.0.1:4319/chzzk/callback'}</code><p className="muted">기본 브라우저에서 내 채널의 연결을 승인해요. 비밀 키와 토큰은 저장하지 않으며 만료 후 다시 인증해요.</p></>}
      <div className="external-transfer-notice"><b>AI에 전달되는 내용</b><p>연결하면 이 방송의 새 채팅 본문이 선택한 AI 제공처에 전송되어 AI 관객의 응답에 사용됩니다.</p></div>
      <label><input type="checkbox" checked={shareNames} disabled={busy} onChange={e=>{setShareNames(e.target.checked);setAcknowledgeAiTransfer(false);}}/>닉네임도 AI에 전달하기 (기본은 익명화)</label>
      <p className="muted">작성자 ID는 AI에 보내지 않습니다. 본문에 직접 적힌 이름·개인정보까지 자동 제거하지는 않습니다. 로컬 원문은 최대 1분 뒤 또는 연결 해제 시 삭제하지만, 이미 AI에 전송된 내용까지 회수할 수는 없습니다. 실제 시청자에게도 전송 사실을 안내해주세요.</p>
      <label><input type="checkbox" checked={acknowledgeAiTransfer} disabled={busy} onChange={e=>setAcknowledgeAiTransfer(e.target.checked)}/>위 전송 내용을 확인했습니다</label>
      <button className="secondary" disabled={busy||!ready||!acknowledgeAiTransfer||!state.running||state.settings.mode!=='live'} onClick={()=>void connect()}>{platform==='youtube'?'YouTube 채팅 연결':'치지직 인증 시작'}</button>{!state.running&&<p className="muted">실제 AI 방송을 시작한 뒤 연결할 수 있어요.</p>}</>}
    {chat?.phase==='authorizing'&&<button className="text-button" onClick={()=>void reopen()}>치지직 승인 화면 열기</button>}{authUrl&&pending&&<><p className="muted">브라우저가 열리지 않았다면 아래 인증 주소를 복사해 기본 브라우저에 붙여넣어주세요.</p><input aria-label="치지직 인증 주소" readOnly value={authUrl}/><button className="text-button" onClick={()=>void navigator.clipboard.writeText(authUrl).catch(()=>onError('인증 주소를 선택해 직접 복사해주세요.'))}>인증 주소 복사</button></>}
    {(connected||pending||busy)&&<button className="text-button" onClick={()=>void disconnect()}>{busy||pending?'연결 취소':'외부 채팅 연결 해제'}</button>}
    {connected&&<><div className="external-chat-messages" aria-label="실제 방송 채팅">{chat.messages.length===0?<p>연결 이후의 새 채팅을 기다리고 있어요.</p>:chat.messages.slice(-20).map(m=><p key={m.id}><span className="external-source">{m.platform==='chzzk'?'치지직':'YouTube'}</span> <b>{m.name}</b> <span>{m.text}</span></p>)}</div>{chat.source?.platform==='chzzk'&&<p className="muted">치지직의 개별 메시지 삭제는 자동 반영되지 않을 수 있어요. 원문은 최대 1분 보관하며 연결 해제로 즉시 지울 수 있어요.</p>}</>}
  </details>;
}
