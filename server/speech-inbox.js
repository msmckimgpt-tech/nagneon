import {createHash} from 'node:crypto';

// Per-broadcast transport receipts. A retry has the same identity even after
// its text has left the pending model batch; it must not repeat in chat.
export class SpeechInbox {
  constructor(){this.pending=[];this.receipts=new Map();}
  receive(id,text,publish,source='keyboard',capture,hearers=[]){
    const fingerprint=createHash('sha256').update(source+'\0'+text+(capture?'\0'+JSON.stringify([capture.startedAt,capture.endedAt,capture.screen?.sessionId,capture.screen?.sourceId,capture.screen?.frames.map(f=>[f.at,f.image]),capture.listening]):'')).digest('hex'),prior=this.receipts.get(id);
    if(prior){if(prior.fingerprint!==fingerprint)throw new Error('같은 발언 ID의 내용이 달라졌습니다.');return {messageId:prior.messageId,duplicate:true};}
    if(this.pending.length>=40)throw new Error('아직 답하지 못한 말이 많이 밀렸어요. 잠시 후 다시 전달해주세요.');
    if(this.receipts.size>=20000)throw new Error('이번 방송의 발언 보관 한도에 도달했습니다. 방송을 마친 뒤 새로 시작해주세요.');
    const message=publish();
    this.receipts.set(id,{fingerprint,messageId:message.id});this.pending.push({id,text,messageId:message.id,source,hearers:[...hearers],...(capture?{capture:structuredClone(capture)}:{})});
    return {messageId:message.id,duplicate:false};
  }
  batch(){
    const items=[];let size=0,audience;
    for(const item of this.pending){
      const key=JSON.stringify([...item.hearers].sort()),next=item.text.length+(items.length?1:0);
      // Keep arrival boundaries between utterances. A later question for a
      // returnee must not be lost merely because an older question is pending.
      const nativeBatch=item.capture?.listening&&items[0]?.capture?.listening;
      if(size+next>3000||items.length>=4||(items.length&&(key!==audience||((item.capture||items[0].capture)&&!nativeBatch))))break;
      audience=key;size+=next;items.push(item);
    }
    return {text:items.map(e=>e.text).join('\n'),ids:items.map(e=>e.id)};
  }
  acknowledge(ids){const done=new Set(ids);this.pending=this.pending.filter(e=>!done.has(e.id));}
  sources(ids){const requested=new Set(ids);return this.pending.filter(e=>requested.has(e.id)).map(({messageId,text,source,capture,hearers})=>({messageId,text,source,hearers:[...hearers],...(capture?{capture:structuredClone(capture)}:{})}));}
  hearers(ids){const requested=new Set(ids),items=this.pending.filter(e=>requested.has(e.id));return items.length?items[0].hearers.filter(id=>items.every(e=>e.hearers.includes(id))):[];}
  candidates(ids){const requested=new Set(ids);return this.pending.filter(e=>requested.has(e.id)&&e.source==='microphone'&&!e.capture?.listening&&!e.corrected).slice(0,4).map(e=>({messageId:e.messageId,text:e.text}));}
  annotate(messageId,text){const entry=this.pending.find(e=>e.messageId===messageId);if(entry){entry.text=text;entry.corrected=true;}}
  forget(messageId){this.pending=this.pending.filter(e=>e.messageId!==messageId);}
  clear(){this.pending=[];}
}
