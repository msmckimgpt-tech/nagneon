import {useState} from 'react';
import {api} from './api';
import './chat-display.css';

export function ChatDisplayToggle({shown}:{shown:boolean}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function change(){setBusy(true);setError('');try{await api('chat/display',{showStreamerMessages:!shown});}catch(e){setError(e instanceof Error?e.message:'표시 설정을 저장하지 못했어요.');}finally{setBusy(false);}}
  return <div className="chat-display-control"><label title="채팅창과 오버레이에 내 발언 표시"><input data-tutorial="display" type="checkbox" checked={shown} disabled={busy} onChange={()=>void change()}/><span>내 발언 표시</span></label>{error&&<small role="alert">{error}</small>}</div>;
}
