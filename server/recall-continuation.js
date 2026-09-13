import {isChatQuestion} from './conversation-rhythm.js';

// These are reasons to retain neighbouring quotes, not assertions that a
// statement was corrected or a question answered. Never rewrite the source.
const repair=text=>/(?:취소|정정|바꿀|철회|잘못\s*(?:말|들)|헷갈|그게\s*아니|(?:^|[\s,.!?])(?:아\s*)?(?:아니(?:다|야|라|[\s,.!?])|아냐))/.test(text);
const words=entry=>!entry.donation&&entry.personaId!=='anonymous'&&(!entry.kind||['streamer','chat'].includes(entry.kind));
const near=(a,b,window)=>a.sessionId===b.sessionId&&a.fictional===b.fictional&&b.at>=a.at&&b.at-a.at<=window;

export function recallContinuations(selected,entries,candidates,limit=8){
 const visible=new Set(candidates.map(e=>e.id)),nextBySpeaker=new Map(),following=new Map(),indices=new Map();
 // Use the full retained order. An unheard/recent/different-session utterance
 // must remain a boundary; filtering first could jump over it to another turn.
 for(let i=entries.length-1;i>=0;i--){
  const entry=entries[i];indices.set(entry.id,i);
  if(nextBySpeaker.has(entry.personaId))following.set(entry.id,nextBySpeaker.get(entry.personaId));
  nextBySpeaker.set(entry.personaId,entry);
 }
 const corrections=entry=>{
  const chain=[entry];let next=following.get(entry.id);
  while(words(entry)&&next&&visible.has(next.id)&&words(next)&&near(entry,next,120000)&&near(chain.at(-1),next,120000)&&repair(next.text)){
   chain.push(next);next=following.get(next.id);
  }
  // If a source has more continuations than the entire quote budget, favour
  // its latest wording rather than returning only the outdated beginning.
  return chain.slice(-limit);
 };
 const chosen=new Map();
 for(const entry of selected){
  const group=new Map(corrections(entry).map(e=>[e.id,e]));
  if(entry.kind==='streamer'&&isChatQuestion(entry.text)){
   let answers=0;
   for(let i=indices.get(entry.id)+1;i<entries.length;i++){
    const next=entries[i];
    if(!near(entry,next,90000)||next.personaId==='streamer')break;
    if(next.kind!=='chat'||!visible.has(next.id))continue;
    const quotes=corrections(next).filter(e=>!group.has(e.id));
    if(group.size+quotes.length<=limit)for(const quote of quotes)group.set(quote.id,quote);
    if(++answers===3)break;
   }
  }
  const additions=[...group.values()].filter(e=>!chosen.has(e.id));
  // Reserve room as a group: appending a correction after the final slice
  // would leave the old claim visible while silently dropping its qualifier.
  if(chosen.size+additions.length<=limit)for(const quote of additions)chosen.set(quote.id,quote);
 }
 return [...chosen.values()];
}
