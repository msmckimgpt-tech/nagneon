import {isChatQuestion} from './conversation-rhythm.js';

const compact=text=>text.normalize('NFKC').toLocaleLowerCase().replace(/[ㅋㅎ]{2,}|[!?.,~…。！？」「“”"'\s]/gu,'').replace(/[^\p{L}\p{N}]/gu,'');
const grams=text=>{const result=new Set();for(let i=0;i<text.length-2;i++)result.add(text.slice(i,i+3));return result;};
const dice=(a,b)=>{const left=grams(a),right=grams(b);let overlap=0;for(const token of left)if(right.has(token))overlap++;return 2*overlap/Math.max(1,left.size+right.size);};
const polarity=text=>/\b(?:not|never|no|cannot|can't|isn't|wasn't)\b|(?:^|\s)(?:안|못)\s|아니|않|없|실패|싫|별로|불편|실망/.test(text.normalize('NFKC').toLowerCase());
const numbers=text=>(text.match(/\d+(?:[.,]\d+)*/g)||[]).join('|');
// A double negative is not equivalent to a single negative. This only
// preserves an explicit lexical difference; it does not infer a sentiment.
const negations=text=>(text.normalize('NFKC').toLowerCase().replace(/[‘’ʼ]/g,"'").match(/\b(?:not|no|never|cannot|[a-z]+n't)\b|(?:^|\s)(?:안|못)(?=[가-힣\s.!?…]|$)|아니|않|없/gu)||[]).length;

export function repeatedChat(candidate,recent,now,{addressViewers}={}){
  const core=compact(candidate.text);
  // Punctuation attached only to ㅋ/ㅎ or symbols must keep the original
  // short-cheer spam rule. A question cue needs some actual word content.
  const questionCue=text=>/[^\u110f\u1112]/u.test(compact(text))&&isChatQuestion(text);
  const question=questionCue(candidate.text),negativeCount=negations(candidate.text);
  let targets;
  const sameTargets=text=>{
    if(!addressViewers)return true;
    targets??=addressViewers(candidate.text);
    const prior=addressViewers(text);
    return targets.size===prior.size&&[...targets].every(id=>prior.has(id));
  };
  return recent.some(prior=>{
    if(prior.kind==='streamer')return false;
    const age=now-(prior.time??prior.createdAt??now);if(age<0||age>45000)return false;
    if(question!==questionCue(prior.text)||negativeCount!==negations(prior.text))return false;
    const other=compact(prior.text);
    // Short cheers are a shared crowd response, not a paraphrased analysis.
    // The same person still cannot spam an identical cheer every pump tick.
    if(core.length<8||other.length<8)return age<=8000&&prior.personaId===candidate.personaId&&(core||candidate.text.normalize('NFKC'))===(other||prior.text.normalize('NFKC'))&&sameTargets(prior.text);
    if(numbers(candidate.text)!==numbers(prior.text)||polarity(candidate.text)!==polarity(prior.text))return false;
    if(core===other)return sameTargets(prior.text);
    if(Math.min(core.length,other.length)/Math.max(core.length,other.length)<.7)return false;
    const threshold=prior.personaId===candidate.personaId&&age<30000 ? .58 : .8;
    return dice(core,other)>=threshold&&sameTargets(prior.text);
  });
}
