import {createHash} from 'node:crypto';
import {z} from 'zod';

export const ArrivalClipReading=z.object({version:z.literal(1),clipId:z.string().uuid(),receiptId:z.string().uuid(),receivedAt:z.number().finite().nonnegative().max(8.64e15),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const cut=(text,limit)=>{const value=String(text||'').slice(0,limit);return /[\uD800-\uDBFF]$/.test(value)?value.slice(0,-1):value;};

// Version 1 binds exactly the bounded discovery description made available at
// admission. A clip ID alone, a media flag, or an old origin is not a reading.
export function arrivalClipSnapshot(clip){
  const summary={clipId:clip.id,title:cut(clip.title,100),game:cut(clip.game,100),scene:cut(clip.scene,600),source:cut(clip.source,80),fictional:['season-chapter','directed-episode'].includes(clip.source),excerpt:String(clip.title||'').length>100||String(clip.game||'').length>100||String(clip.scene||'').length>600};
  return {summary,hash:createHash('sha256').update(JSON.stringify({version:1,...summary})).digest('hex')};
}

export function recallArrivalClip(clips,reading,now=Date.now()){
  if(!reading)return null;
  const parsed=ArrivalClipReading.safeParse(reading);if(!parsed.success||parsed.data.receivedAt>now)return null;
  const r=parsed.data,clip=clips.find(c=>c.id===r.clipId);if(!clip)return null;
  const current=arrivalClipSnapshot(clip);if(current.hash!==r.hash)return null;
  return {...current.summary,receivedAt:r.receivedAt,experience:'read-discovery-summary'};
}

// Event details belong in the versioned encounter, never in a permanent bio.
// The persona generator gets only the broad interest category for this route.
export function arrivalClipInterest(clip,settings){
  const game=settings.games.find(g=>g.name===clip.game);
  return clip.game==='Just Chatting'?'일상 대화와 취향 교류':game?.genre||'게임 장면 구경';
}
