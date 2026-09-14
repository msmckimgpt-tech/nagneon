import {useEffect,useState} from 'react';
import {Gift,X} from 'lucide-react';
import {AccessibleDialog} from './AccessibleDialog';
import {api} from './api';
import type {Message} from './types';
import './donations.css';

export function DonationToast({messages}:{messages:Message[]}){
  const [now,setNow]=useState(Date.now());
  const recent=messages.filter(m=>m.kind==='donation'&&m.time<=Date.now()&&Date.now()-m.time<12000).slice(-2);
  const expiry=recent.length?Math.min(...recent.map(m=>m.time+12000)):0;
  useEffect(()=>{
    if(!expiry)return;
    const timer=setTimeout(()=>setNow(Date.now()),Math.max(1,expiry-Date.now()));
    return ()=>clearTimeout(timer);
  },[expiry,now]);
  return <div className="donation-toasts" role="status" aria-live="polite">{recent.map(m=><div className="donation-toast" key={m.id}>
    <Gift size={24}/><div><b>{m.name} · {m.donation?.amount}P</b><p>{m.text}</p><small>응원해 주셔서 고마워요!</small></div>
  </div>)}</div>;
}

type Donation={id:string;at:number;amount:number;text:string;anonymous:boolean;donorId?:string;donorName:string;currentName:string|null};
export function DonationHistory({onClose,revision}:{onClose:()=>void;revision:string}){
  const [entries,setEntries]=useState<Donation[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;setError('');
    void api<{entries:Donation[]}>('donations',undefined,'GET').then(result=>{if(active)setEntries(result.entries);}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[revision,retry]);
  return <AccessibleDialog onClose={onClose} className="donation-history" labelledBy="donation-history-title" describedBy="donation-history-help">
    <div className="modal-header"><h2 id="donation-history-title">받은 후원</h2><button className="icon" aria-label="후원 내역 닫기" onClick={onClose}><X size={20}/></button></div>
    <p id="donation-history-help">스트리머만 보는 내역이에요. 익명으로 전한 응원의 주인공도 여기서 확인할 수 있어요. 최근 포인트 거래 300건에 포함된 후원을 보여드려요.</p>
    {error&&<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>다시 불러오기</button></p>}
    {!entries&&!error&&<p role="status">후원 내역을 불러오는 중이에요.</p>}
    {entries?.length===0&&<p className="muted">아직 받은 후원이 없어요. 함께 즐거운 순간을 만들어 보세요.</p>}
    <div className="donation-history-list">{entries?.map(d=><article key={d.id}>
      <header><b>{d.donorName}</b><span>{d.amount}P</span>{d.anonymous&&<small>공개: 익명</small>}</header>
      {d.currentName&&d.currentName!==d.donorName&&<p>현재 닉네임: {d.currentName}</p>}
      <p>{d.text||'메시지 없이 보낸 응원'}</p><footer><time dateTime={new Date(d.at).toISOString()}>{new Date(d.at).toLocaleString('ko-KR')}</time><small>관객 ID: {d.donorId||'이전 기록 없음'}</small></footer>
    </article>)}</div>
    <p className="field-note">공개 채팅과 오버레이에는 익명 후원자의 이름이 표시되지 않아요.</p>
  </AccessibleDialog>;
}
