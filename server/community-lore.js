import {createHash} from 'node:crypto';

// Legacy expiry dates remain in the save as metadata, never as a deletion rule.
export function normalizeLore(entries){
  return entries.map((entry,index)=>({...entry,id:entry.id||createHash('sha256').update(JSON.stringify([entry.text,entry.expiresAt,index])).digest('hex').slice(0,24)}));
}

const normalize=text=>String(text||'').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^\p{L}\p{N}\s]/gu,' ');
const routine=['오늘','어제','우리','다시','그때','기억','얘기','이야기','말해','알려','무슨','어떤','지금','그냥'];
const suffixes=['이라고','이라는','에서는','에서','으로','에게','라는','처럼','하고','이랑','에는','은','는','이','가','을','를','도'];
function terms(text){
  const result=new Set();
  for(let word of normalize(text).split(/\s+/)){
    if(word.length<2||routine.some(prefix=>word.startsWith(prefix)))continue;
    const suffix=suffixes.find(s=>word.endsWith(s)&&word.length-s.length>=2);
    if(suffix)word=word.slice(0,-suffix.length);
    result.add(word);
  }
  return [...result].slice(0,40);
}

// Retrieval is bounded; storage is not silently trimmed. No extra model call.
export function relevantLore(entries,speech){
  const query=terms(speech);if(!query.length)return [];
  return entries.map((entry,index)=>{
    const words=terms(entry.text),score=query.reduce((sum,q)=>sum+(words.some(w=>w===q)?2:words.some(w=>q.length>=3&&(w.startsWith(q)||q.startsWith(w)))?1:0),0);
    return {entry,index,score};
  }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||b.index-a.index).slice(0,3).map(({entry})=>({id:entry.id,text:entry.text.slice(0,300),source:'streamer-note'}));
}
