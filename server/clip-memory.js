import {createHash} from 'node:crypto';

// Text-only encounters. Neither a clip URL nor its media flags prove that this
// viewer watched/heard its recording. Keep versions, not duplicate quote stores.
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp=row=>({id:row.id,hash:digest(row)});
const identified=row=>typeof row.id==='string'&&row.id.length>0;
const metadata=c=>({title:c.title,game:c.game,scene:c.scene,source:c.source,fictional:['season-chapter','directed-episode'].includes(c.source)});
export function clipMessage(m){
  const anonymous=m.kind==='donation'&&m.donation?.anonymous===true;
  return {id:m.id,at:m.time,personaId:anonymous?'anonymous':m.personaId,name:anonymous?'익명의 관객':m.name,kind:m.kind,text:m.text,fictional:!!m.fictional,
    ...(m.kind==='donation'&&Number.isInteger(m.donation?.amount)&&m.donation.amount>=1&&m.donation.amount<=200?{donation:{amount:m.donation.amount,anonymous:!!m.donation.anonymous}}:{}),
    ...(m.transcription?.correction?{transcriptionCorrection:{text:m.transcription.correction.text,confidence:m.transcription.correction.confidence,source:'contextual-stt'}}:{})};
}
const clipComment=m=>({id:m.id,at:m.at,personaId:m.personaId,name:m.name,kind:m.kind,text:m.text,parentId:m.parentId||null});

export function clipTextSnapshot(clip,parentId){
  const visible=clip.comments.filter(c=>!c.deleted),selected=new Set(visible.slice(-30).map(c=>c.id));
  let parent=visible.find(c=>c.id===parentId),depth=0;
  while(parent&&depth++<4){selected.add(parent.id);parent=visible.find(c=>c.id===parent.parentId);}
  return {clipId:clip.id,...metadata(clip),messages:clip.messages.map(clipMessage),comments:visible.filter(c=>selected.has(c.id)).map(clipComment)};
}

// A request may be in flight while a streamer deletes a source. Reject the
// whole response in that case, but do not treat newly added unseen comments as read.
export function assertClipSnapshot(clip,snapshot){
  if(clip.id!==snapshot.clipId||digest(metadata(clip))!==digest(metadata(snapshot))||digest(clip.messages.map(clipMessage))!==digest(snapshot.messages))throw Error('읽던 핫클립 내용이 바뀌어 댓글을 저장하지 않았습니다. 다시 읽어주세요.');
  for(const row of snapshot.comments){const current=clip.comments.find(c=>c.id===row.id&&!c.deleted);if(!current||digest(clipComment(current))!==digest(row))throw Error('읽던 댓글이 삭제되거나 바뀌어 응답을 저장하지 않았습니다. 다시 읽어주세요.');}
}

// Runs inside the same Clips.change as accepted comments. Only successfully
// published speakers gain a reading receipt; peer replies from this batch were
// not in the input, so each speaker remembers only their own new reply.
export function recordClipReading(clip,snapshot,created,at){
  clip.readings ||= [];
  const merge=(old,rows)=>[...new Map([...old,...rows.filter(identified).map(stamp)].map(r=>[r.id,r])).values()];
  for(const viewerId of new Set(created.filter(c=>c.kind==='ai').map(c=>c.personaId))){
    const own=created.filter(c=>c.personaId===viewerId).map(clipComment);
    let receipt=clip.readings.find(r=>r.viewerId===viewerId);
    if(!receipt){receipt={viewerId,readAt:at,metadataHash:digest(metadata(snapshot)),messages:[],comments:[]};clip.readings.push(receipt);}
    receipt.readAt=at;receipt.metadataHash=digest(metadata(snapshot));
    receipt.messages=merge(receipt.messages,snapshot.messages).slice(-25);
    receipt.comments=merge(receipt.comments,[...snapshot.comments,...own]).slice(-150);
  }
}

const norm=s=>String(s||'').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
// Inspectable lexical ranking, not a claim of semantic understanding.
const queryParts=query=>{const q=norm(query),parts=new Set();for(let i=0;i<q.length-1&&parts.size<80;i++)parts.add(q.slice(i,i+2));return [...parts];};
const score=(normalized,parts)=>parts.reduce((n,p)=>n+Number(normalized.includes(p)),0);
const excerpt=(text,limit)=>{let value=String(text||'').slice(0,limit);if(/[\uD800-\uDBFF]$/.test(value))value=value.slice(0,-1);return value;};
const index=new WeakMap();
function equalProjection(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equalProjection(a[k],b[k]));
}
function indexed(raw,project){
  const value=project(raw),cached=index.get(raw);
  // Check all public values, including nested corrections/donation metadata,
  // rather than trusting updatedAt. Mutable legacy adapters cannot serve stale text.
  if(cached&&equalProjection(cached.value,value))return cached;
  const entry={value,hash:digest(value),normalized:norm('text' in value?value.text:value.title+' '+value.game+' '+value.scene)};index.set(raw,entry);return entry;
}

// Clips.change copies the whole store for atomic writes. Transfer only equal
// public source versions after a successful commit, so an unrelated new comment
// does not force every viewer to re-index the entire library on their next turn.
export function reuseClipMemoryIndex(previous,next){
  const before=new Map(previous.map(c=>[c.id,c]));
  const transfer=(old,row,project)=>{const cached=old&&index.get(old);if(cached&&equalProjection(cached.value,project(row)))index.set(row,cached);};
  for(const c of next){const old=before.get(c.id);if(!old)continue;transfer(old,c,metadata);
    for(const [source,rows,project] of [[old.messages,c.messages,clipMessage],[old.comments,c.comments,clipComment]]){const byId=new Map(source.map(m=>[m.id,m]));for(const m of rows)transfer(byId.get(m.id),m,project);}
  }
}

export function recallClips(clips,viewerId,query='',now=Date.now()){
  const candidates=[],parts=queryParts(query);
  for(const c of clips){
    const storedReceipt=c.readings?.find(r=>r.viewerId===viewerId);
    if(!storedReceipt&&!c.comments.some(m=>!m.deleted&&m.kind==='ai'&&m.personaId===viewerId&&m.at<=now))continue;
    const receipt=storedReceipt?.readAt<=now?storedReceipt:undefined;
    const header=receipt?indexed(c,metadata):null;
    const knownMetadata=!!receipt&&receipt.metadataHash===header.hash;
    if(receipt&&!knownMetadata)continue; // Do not attach old quotes to edited framing.
    const messageRefs=new Map(receipt?.messages.map(r=>[r.id,r])),commentRefs=new Map(receipt?.comments.map(r=>[r.id,r]));
    const messages=receipt?c.messages.filter(m=>m.time<=now&&messageRefs.has(m.id)).flatMap(m=>{const row=indexed(m,clipMessage);return row.hash===messageRefs.get(m.id).hash?[{...row.value,_normalized:row.normalized,experience:'read-clip-chat'}]:[];}):[];
    const comments=c.comments.filter(m=>!m.deleted&&m.at<=now).flatMap(m=>{
      const own=m.kind==='ai'&&m.personaId===viewerId;
      const legacyOwn=own&&!storedReceipt?.comments.some(r=>r.id===m.id);
      if(!commentRefs.has(m.id)&&!legacyOwn)return [];
      const row=indexed(m,clipComment),seen=commentRefs.get(m.id)?.hash===row.hash;
      // Legacy authors can remember their own words, but no surrounding thread
      // or footage is inferred from that old authorship alone.
      if(!seen&&!legacyOwn)return [];
      return [{...row.value,_normalized:row.normalized,experience:own?'own-clip-comment':'read-clip-comment'}];
    });
    if(!knownMetadata&&!messages.length&&!comments.length)continue;
    const all=[...messages,...comments],rank=score((knownMetadata?header.normalized:'')+all.map(m=>m._normalized).join(''),parts);
    // Reserve room for a recently read streamer reply/correction as well as a
    // relevant earlier quote; chronology and authorship remain explicit.
    const picked=new Map();const add=m=>{if(m)picked.set(m.id,m);};
    for(const m of comments.filter(m=>m.personaId==='streamer').slice(-2))add(m);
    for(const {row} of all.map(row=>({row,score:score(row._normalized,parts)})).sort((a,b)=>b.score-a.score||b.row.at-a.row.at)){if(picked.size>=4)break;add(row);}
    candidates.push({clipId:c.id,fictional:metadata(c).fictional,...(knownMetadata?{title:excerpt(c.title,100),game:excerpt(c.game,100),scene:excerpt(c.scene,240),sceneExcerpt:c.scene.length>240}:{}),
      encounter:'clip-text',lastReadAt:receipt?.readAt??null,rank,latest:receipt?.readAt??Math.max(...comments.map(m=>m.at)),
      items:[...picked.values()].sort((a,b)=>a.at-b.at).map(({_normalized,...m})=>({...m,name:excerpt(m.name,100),kind:excerpt(m.kind,30),text:excerpt(m.text,220),excerpt:m.text.length>220,...(m.donation?{donation:{...m.donation}}:{}),...(m.transcriptionCorrection?{transcriptionCorrection:{...m.transcriptionCorrection,text:excerpt(m.transcriptionCorrection.text,220)}}:{})}))});
  }
  return candidates.sort((a,b)=>b.rank-a.rank||b.latest-a.latest).slice(0,2).map(({rank,latest,...c})=>c);
}
