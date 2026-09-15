import {useState} from 'react';
import {Trash2} from 'lucide-react';
import {api} from './api';
import type {State} from './types';

export function CommunityLore({items,onError}:{items:State['audience']['lore'];onError:(message:string)=>void}){
  const [text,setText]=useState(''),[pending,setPending]=useState(false),[removing,setRemoving]=useState<string|null>(null);
  async function save(){
    setPending(true);
    try{await api('community/lore',{text});setText('');}
    catch(error){onError(error instanceof Error?error.message:'기억을 저장하지 못했습니다.');}
    finally{setPending(false);}
  }
  async function remove(id:string){
    setPending(true);
    try{await api('community/lore/'+id,undefined,'DELETE');setRemoving(null);}
    catch(error){onError(error instanceof Error?error.message:'기억을 삭제하지 못했습니다.');}
    finally{setPending(false);}
  }
  return <section className="panel teaching">
    <h2>우리만의 밈과 내부 농담</h2>
    <p>등록한 이야기는 계속 보관해요. 지금 나누는 대화와 관련된 기억만 참고하며, 새로운 관객이 직접 겪은 일로 여기지는 않아요.</p>
    <div className="inline-form">
      <input aria-label="커뮤니티 밈" value={text} onChange={e=>setText(e.target.value)} maxLength={300} placeholder="예: 3번 연속 낙사한 날 생긴 별명 '낙하산 장인'"/>
      <button className="secondary" disabled={pending||!text.trim()} onClick={()=>void save()}>등록</button>
    </div>
    {items.map(item=><div className="lore-entry" key={item.id}>
      <p>{item.text}</p>
      {removing===item.id?<div className="feature-buttons"><span>이 기억을 삭제할까요?</span><button className="danger" disabled={pending} onClick={()=>void remove(item.id)}>삭제</button><button className="secondary" onClick={()=>setRemoving(null)}>취소</button></div>:<button className="icon" aria-label={'기억 삭제: '+item.text} disabled={pending} onClick={()=>setRemoving(item.id)}><Trash2 size={15}/></button>}
    </div>)}
  </section>;
}
