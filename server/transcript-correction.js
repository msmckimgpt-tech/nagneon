import {requestsAdvice} from './advice-intent.js';

const clean=text=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const protectedWords=text=>(text.normalize('NFKC').toLowerCase().match(/\d+(?:[.,]\d+)*|아니|않|없|못|안(?=[가-힣])|\b(?:not|no|never|cannot|can't|don't)\b/g)||[]).join('|');
// Preserve pragmatic meaning as well as spelling: uncertainty, preferences,
// emotional words, laughter and the speaker's register are not ASR noise.
const stance=text=>(text.normalize('NFKC').match(/좋|싫|기쁘|슬프|무섭|재밌|재미|힘들|편하|불편|농담|장난|아마|혹시|같[아은]|겠|싶|까|[ㅋㅎ]{2,}|하하+|허허+|습니다|습니까|세요|줘|줄래|요(?=[.!?…\s]|$)/g)||[]).join('|');

export function transcriptAnomaly(text){
  // A long decoder loop is uncertain, not proof the speaker repeated a word.
  // Never silently delete a suffix or change keyboard speech.
  const tokens=text.normalize('NFKC').match(/[\p{L}\p{N}]+/gu)||[];
  for(let width=1;width<=4;width++)for(let i=0;i+width*8<=tokens.length;i++){
    const unit=tokens.slice(i,i+width).join('\0');let count=1;
    while(tokens.slice(i+width*count,i+width*(count+1)).join('\0')===unit)count++;
    if(count>=8&&unit.replaceAll('\0','').length*count>=16)return 'repeated-decoder-output';
  }
  return null;
}
function distance(a,b){let prior=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prior[j]+1,prior[j-1]+(a[i-1]===b[j-1]?0:1));prior=row;}return prior[b.length];}

// This is a conservative admission guard, not an oracle for what was spoken.
// The original remains immutable; accepted text is an attributed annotation.
export function admitTranscriptCorrection(original,proposal){
  if(typeof proposal?.text!=='string'||!Number.isFinite(proposal.confidence)||proposal.confidence<.9||typeof proposal.reason!=='string'||proposal.reason.trim().length<3)return false;
  const corrected=proposal.text.trim(),left=clean(original),right=clean(corrected);
  if(!corrected||corrected===original||corrected.length>3000||!left||!right||Math.max(left.length,right.length)>400)return false;
  if(protectedWords(original)!==protectedWords(corrected))return false;
  if(stance(original)!==stance(corrected)||transcriptAnomaly(original))return false;
  if(requestsAdvice(original,'on-request')!==requestsAdvice(corrected,'on-request'))return false;
  if(/[?？]/.test(original)!==/[?？]/.test(corrected))return false;
  if(Math.min(left.length,right.length)/Math.max(left.length,right.length)<.7)return false;
  // Matching context must not pay for rewriting the one meaningful word:
  // a long sentence previously let "힘" become "게임" at high confidence.
  // Compare the changed syllables, while allowing close spelling repairs
  // such as "자바" -> "잡아" (two decomposed Hangul edits).
  let start=0,endLeft=left.length,endRight=right.length;
  while(start<endLeft&&start<endRight&&left[start]===right[start])start++;
  while(endLeft>start&&endRight>start&&left[endLeft-1]===right[endRight-1]){endLeft--;endRight--;}
  const a=left.slice(start,endLeft).normalize('NFD'),b=right.slice(start,endRight).normalize('NFD');
  if(distance(a,b)>Math.max(2,Math.floor(Math.max(a.length,b.length)*.32)))return false;
  // Separate distant edits; unchanged middle words cannot subsidize rewriting
  // a second, meaning-bearing word. Word boundaries here ignore spacing repairs.
  const before=original.match(/[\p{L}\p{N}]+/gu)||[],after=corrected.match(/[\p{L}\p{N}]+/gu)||[];
  if(before.length===after.length)for(let i=0;i<before.length;i++){
    const x=before[i].normalize('NFD'),y=after[i].normalize('NFD');
    if(distance(x,y)>Math.max(2,Math.floor(Math.max(x.length,y.length)*.32)))return false;
  }
  return true;
}
