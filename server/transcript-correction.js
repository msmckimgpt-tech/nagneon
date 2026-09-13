import {requestsAdvice} from './advice-intent.js';

const clean=text=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const protectedWords=text=>(text.normalize('NFKC').toLowerCase().match(/\d+(?:[.,]\d+)*|아니|않|없|못|안(?=[가-힣])|\b(?:not|no|never|cannot|can't|don't)\b/g)||[]).join('|');
function distance(a,b){let prior=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prior[j]+1,prior[j-1]+(a[i-1]===b[j-1]?0:1));prior=row;}return prior[b.length];}

// This is a conservative admission guard, not an oracle for what was spoken.
// The original remains immutable; accepted text is an attributed annotation.
export function admitTranscriptCorrection(original,proposal){
  if(typeof proposal?.text!=='string'||!Number.isFinite(proposal.confidence)||proposal.confidence<.9||typeof proposal.reason!=='string'||proposal.reason.trim().length<3)return false;
  const corrected=proposal.text.trim(),left=clean(original),right=clean(corrected);
  if(!corrected||corrected===original||corrected.length>3000||!left||!right||Math.max(left.length,right.length)>400)return false;
  if(protectedWords(original)!==protectedWords(corrected))return false;
  if(requestsAdvice(original,'on-request')!==requestsAdvice(corrected,'on-request'))return false;
  if(/[?？]/.test(original)!==/[?？]/.test(corrected))return false;
  if(Math.min(left.length,right.length)/Math.max(left.length,right.length)<.7)return false;
  const a=left.normalize('NFD'),b=right.normalize('NFD');
  return distance(a,b)<=Math.max(1,Math.floor(Math.max(a.length,b.length)*.32));
}
