import {z} from 'zod';
import {transcriptAnomaly} from './transcript-correction.js';

export const JOURNAL_LIMIT=4000, PIN_LIMIT=100;
const actor=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));
const Transcription=z.object({source:z.literal('microphone'),correction:z.object({text:z.string().min(1).max(3000),confidence:z.number().min(.9).max(1),reason:z.string().max(240),at:z.number().finite().nonnegative()}).optional()});
const Donation=z.object({amount:z.number().int().min(1).max(200),anonymous:z.boolean()});
const Entry=z.object({id:z.string().uuid(),sessionId:z.string().uuid(),at:z.number().finite().nonnegative(),personaId:actor,name:z.string().max(100),text:z.string().min(1).max(3000),witnesses:z.array(actor).max(40),fictional:z.boolean(),title:z.string().max(200),pinned:z.boolean(),transcription:Transcription.optional(),kind:z.enum(['chat','streamer','notice','donation']).optional(),donation:Donation.optional()}).superRefine((e,ctx)=>{
  if((e.kind==='donation')!==!!e.donation)ctx.addIssue({code:'custom',message:'후원 기억의 종류와 포인트 기록이 맞지 않습니다.'});
  if(e.donation?.anonymous&&(e.personaId!=='anonymous'||e.name!=='익명의 관객'))ctx.addIssue({code:'custom',message:'익명 후원 기억에 후원자를 기록할 수 없습니다.'});
});
export const JournalData=z.object({version:z.literal(1),revision:z.number().int().nonnegative(),entries:z.array(Entry).max(JOURNAL_LIMIT)}).superRefine((v,ctx)=>{
  if(new Set(v.entries.map(e=>e.id)).size!==v.entries.length)ctx.addIssue({code:'custom',message:'중복된 대화 기억 ID입니다.'});
  if(v.entries.filter(e=>e.pinned).length>PIN_LIMIT)ctx.addIssue({code:'custom',message:'고정한 대화 기억이 너무 많습니다.'});
});
export const emptyJournal=()=>({version:1,revision:0,entries:[]});
// Copy mutable nested records while sharing immutable text at capacity.
const copyJournal=value=>({...value,entries:value.entries.map(e=>({...e,witnesses:[...e.witnesses],...(e.transcription?{transcription:structuredClone(e.transcription)}:{}),...(e.donation?{donation:{...e.donation}}:{})}))});
const normalize=text=>text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ');
// A word like "후원" need not appear in a gift's own message. Only a typed
// event contributes these search terms; ordinary claims never become receipts.
const memoryText=e=>e.text+' '+(e.transcription?.correction?.text||'')+(e.donation?` 후원 응원 포인트 ${e.donation.amount}P ${e.donation.amount}포인트 ${e.donation.anonymous?'익명':''}`:'');
const routine=['기억','이야기','얘기','오늘','어제','전에','그때','우리','내가','네가','너는','나는','무슨','뭐였','알려','말해','말하','말한','말했','내용','각자','서로','맡으려','맡고','어떤','다시','그냥','기준','지금','지난','예전','방금','확인','정확'];
function terms(text){const set=new Set();for(let word of normalize(text).split(/\s+/)){if(word.length<2||routine.some(prefix=>word.startsWith(prefix)))continue;const suffix=['에게','에서','으로','이라고','라는','은','는','이','가','을','를'].find(s=>word.endsWith(s)&&word.length-s.length>=2);if(suffix)word=word.slice(0,-suffix.length);set.add(word);}return [...set].slice(0,40);}

// Exact public quotes and the identities present when they were published.
// No inferred emotional state, secret interview, or invented recollection enters here.
export class ConversationJournal {
  constructor(data=emptyJournal(),save=()=>{}){this.data=JournalData.parse(data);this.save=save;this.normalized=new Map(this.data.entries.map(e=>[e.id,normalize(memoryText(e))]));}
  change(edit){const next=copyJournal(this.data);const changed=edit(next);if(changed===false)return;next.revision++;const checked=JournalData.parse(next);this.save(copyJournal(checked));this.data=checked;const active=new Set(checked.entries.map(e=>e.id));for(const id of this.normalized.keys())if(!active.has(id))this.normalized.delete(id);}
  record(message,{sessionId,witnesses,title=''}){
    const existing=this.data.entries.find(e=>e.id===message.id);
    if(existing){if(existing.text!==message.text||existing.personaId!==message.personaId||existing.sessionId!==sessionId||existing.kind!==message.kind||existing.donation?.amount!==message.donation?.amount||existing.donation?.anonymous!==message.donation?.anonymous)throw new Error('대화 기억 ID의 원문이 다릅니다.');return;}
    const entry=Entry.parse({id:message.id,sessionId,at:message.time,personaId:message.personaId,name:message.name,text:message.text,witnesses:[...new Set(witnesses)],fictional:!!message.fictional,title:title.slice(0,200),pinned:false,...(message.transcription?{transcription:message.transcription}:{}),...(message.kind?{kind:message.kind}:{}),...(message.donation?{donation:message.donation}:{})});
    this.change(next=>{next.entries.push(entry);while(next.entries.length>JOURNAL_LIMIT){const index=next.entries.findIndex(e=>!e.pinned);next.entries.splice(index,1);}});
  }
  pin(id,pinned){this.change(next=>{const entry=next.entries.find(e=>e.id===id);if(!entry)throw new Error('대화 기억을 찾을 수 없습니다.');if(entry.pinned===pinned)return false;if(pinned&&next.entries.filter(e=>e.pinned).length>=PIN_LIMIT)throw new Error(`대화는 ${PIN_LIMIT}개까지 고정할 수 있습니다.`);entry.pinned=pinned;});}
  annotateTranscription(id,correction){let changed=false;this.change(next=>{const entry=next.entries.find(e=>e.id===id);if(!entry||entry.personaId!=='streamer'||entry.transcription?.source!=='microphone'||entry.transcription.correction)return false;entry.transcription=Transcription.parse({source:'microphone',correction});changed=true;});if(changed)this.normalized.delete(id);return changed;}
  forget(ids){const set=new Set(ids);this.change(next=>{const kept=next.entries.filter(e=>!set.has(e.id));if(kept.length===next.entries.length)return false;next.entries=kept;});}
  summary(){return {revision:this.data.revision,count:this.data.entries.length,pinned:this.data.entries.filter(e=>e.pinned).length,limit:JOURNAL_LIMIT,pinLimit:PIN_LIMIT};}
  list({viewerId='',query='',pinned=false,offset=0,limit=30}={}){
    const needle=normalize(query).trim();const matches=this.data.entries.filter(e=>(!viewerId||e.witnesses.includes(viewerId))&&(!pinned||e.pinned)&&(!needle||normalize(memoryText(e)+' '+e.name+' '+e.title).includes(needle))).slice().reverse();
    return {entries:structuredClone(matches.slice(offset,offset+limit)),total:matches.length,offset,...this.summary()};
  }
  recall(viewerId,query='',excludeIds=[]){
    const excluded=new Set(excludeIds);let topic=query;for(const name of new Set(this.data.entries.map(e=>e.name)))if(name)topic=topic.replaceAll(name,' ');const words=terms(topic);
    for(const word of [...words]){const root=word.replace(/(?:빌드|조합|전략|공략)$/,'');if(root!==word&&root.length>=2&&!words.includes(root))words.push(root);}
    const candidates=this.data.entries.filter(e=>e.witnesses.includes(viewerId)&&!excluded.has(e.id)&&!(e.transcription?.source==='microphone'&&transcriptAnomaly(e.text)));
    const frequency=new Map();const scored=candidates.map((entry,index)=>{
      if(!this.normalized.has(entry.id))this.normalized.set(entry.id,normalize(memoryText(entry)));
      const text=this.normalized.get(entry.id),hits=words.flatMap(word=>{
        let match=text.includes(word)?1:0;
        if(!match&&word.length>=3&&/[가-힣]/.test(word)){let found=0;for(let i=0;i<word.length-1;i++)if(text.includes(word.slice(i,i+2)))found++;const ratio=found/(word.length-1);if(ratio>=.5)match=ratio*.5;}
        if(!match)return [];frequency.set(word,(frequency.get(word)||0)+1);return [{word,match}];
      });
      // Lexical retrieval is intentionally inspectable, not semantic/emotional inference.
      return {entry,index,hits,relevance:0,anchor:/좋아|싫어|약속|취향|구호|별명|불편|그만|원해|바꿀|정정/.test(entry.text)};
    });
    for(const row of scored)row.relevance=row.hits.reduce((n,h)=>n+h.match*Math.log(1+candidates.length/(1+frequency.get(h.word))),0);
    const selected=new Map();const take=(rows,max)=>{for(const row of rows.slice(0,max))selected.set(row.entry.id,row.entry);};
    if(/누구|누가|어느\s*분/.test(query)&&/추천|한\s*표|골라|고르/.test(query)){
      // Return the witnessed recommendation itself, before later commentary
      // about the resulting build. This is still a quote, not a decision fact.
      take(scored.filter(r=>!r.entry.fictional&&r.entry.personaId!=='streamer'&&/추천|한\s*표|저라면/.test(r.entry.text)&&r.hits.some(h=>!/(?:추천|누구|누가|주신|있었|골라|고르)/.test(h.word))).sort((a,b)=>b.relevance-a.relevance||a.index-b.index),2);
    }
    take(scored.filter(r=>r.relevance>0&&r.entry.personaId===viewerId).sort((a,b)=>b.relevance-a.relevance||b.index-a.index),2);
    // An old pinned promise must not outlive an explicit later cancellation.
    take(scored.filter(r=>r.entry.personaId==='streamer'&&/취소|정정|바꿀|그만|철회|하지 말|하지마/.test(r.entry.text)).reverse(),2);
    take(scored.filter(r=>r.relevance>0).sort((a,b)=>b.relevance-a.relevance||b.index-a.index),3);
    take(scored.filter(r=>r.entry.pinned).reverse(),1);
    take(scored.filter(r=>r.anchor).reverse(),1);
    if(!selected.size){
      take(scored.filter(r=>r.entry.personaId===viewerId).reverse(),2);
      // Casual follow-ups may omit a topic's search words. Quiet witnesses
      // still remember conversation: offer at most three recent witnessed
      // sources, not a guessed semantic match. Keep specific hits in priority
      // and do not add this fallback to frame-only requests with no speech.
      if(query.trim())take(scored.slice(-3).reverse(),3);
    }
    // Include the next public utterance by the same speaker when nearby: it may
    // qualify or correct a retrieved statement. Chronology remains explicit.
    for(const entry of [...selected.values()]){const index=candidates.findIndex(e=>e.id===entry.id);const following=candidates.slice(index+1,index+5).find(e=>e.personaId===entry.personaId&&e.sessionId===entry.sessionId&&e.at-entry.at<=120000&&/취소|정정|바꿀|철회/.test(e.text));if(following)selected.set(following.id,following);}
    if(this.normalized.size>JOURNAL_LIMIT){const active=new Set(this.data.entries.map(e=>e.id));for(const id of this.normalized.keys())if(!active.has(id))this.normalized.delete(id);}
    let remaining=1800;const chosen=[...selected.values()].slice(0,8).sort((a,b)=>a.at-b.at);
    return chosen.map((e,index)=>{let text=e.text.slice(0,Math.min(600,Math.floor(remaining/(chosen.length-index))));if(/[\uD800-\uDBFF]$/.test(text))text=text.slice(0,-1);remaining-=text.length;return {sourceId:e.id,sessionId:e.sessionId,at:e.at,speakerId:e.personaId,speaker:e.name,text,excerpt:text.length<e.text.length,fictional:e.fictional,title:e.title,...(e.kind?{kind:e.kind}:{}),...(e.donation?{donation:{...e.donation}}:{}),...(e.transcription?.correction?{transcriptionCorrection:{text:e.transcription.correction.text.slice(0,600),confidence:e.transcription.correction.confidence,source:"contextual-stt"}}:{})};});
  }
}
