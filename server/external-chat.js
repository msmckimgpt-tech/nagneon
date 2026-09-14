import {randomUUID,createHash} from 'node:crypto';

const bounded=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
// Ephemeral external facts are not AI personas, streamer commands or memories.
export class ExternalChat {
  constructor({now=Date.now,limit=200,onChange=()=>{}}={}){Object.assign(this,{now,limit,onChange});this.source=null;this.messages=[];this.seen=new Map();}
  open({platform,channelId,sessionId}){
    if(!['youtube','chzzk'].includes(platform)||!bounded(channelId,1024)||!sessionId)throw Error('외부 채팅 출처를 확인해주세요.');
    this.clear();this.source={id:randomUUID(),platform,channelId,sessionId,startedAt:this.now()};this.onChange();return this.source.id;
  }
  clear(){this.source=null;this.messages=[];this.seen.clear();this.onChange();}
  snapshot(){return {source:this.source?{...this.source}:null,messages:this.messages.map(m=>({...m}))};}
  ingest(sourceId,sessionId,items){
    if(!this.source||sourceId!==this.source.id||sessionId!==this.source.sessionId)return false;
    const now=this.now();let changed=false;
    for(const item of items.slice(0,2000)){
      const remoteId=bounded(item.id,1024);if(!remoteId)continue;
      const id=createHash('sha256').update(`${sourceId}:${remoteId}`).digest('hex');
      if(item.deleted){const count=this.messages.length;this.messages=this.messages.filter(m=>m.id!==id);changed ||= count!==this.messages.length;this.seen.set(id,now);continue;}
      if(this.seen.has(id))continue;
      const text=bounded(item.text,2000),name=bounded(item.name,100),authorId=bounded(item.authorId,1024),publishedAt=item.publishedAt;
      // Initial history is not newly witnessed. Late/future frames are rejected.
      if(!text||!name||!Number.isFinite(publishedAt)||publishedAt<this.source.startedAt||publishedAt>now+2000||now-publishedAt>60000)continue;
      this.seen.set(id,now);this.messages.push({id,platform:this.source.platform,sourceId,authorId,name,text,publishedAt,receivedAt:now,kind:'external'});changed=true;
    }
    this.messages=this.messages.filter(m=>now-m.receivedAt<=60000).slice(-this.limit);
    for(const [id,at] of this.seen)if(now-at>120000)this.seen.delete(id);
    while(this.seen.size>4000)this.seen.delete(this.seen.keys().next().value);
    if(changed)this.onChange();return changed;
  }
  context(joinedAt){const now=this.now();return Number.isFinite(joinedAt)?this.messages.filter(m=>m.publishedAt>=joinedAt&&m.receivedAt>=joinedAt&&now-m.receivedAt<=60000).slice(-20).map(m=>({...m})):[];}
}

export function youtubeItems(batch){
  return (batch.items||[]).filter(m=>!m.snippet?.live_chat_id||m.snippet.live_chat_id===batch.liveChatId).map(m=>({
    id:m.id,deleted:m.snippet?.type===2,
    text:[1,15,16,17].includes(m.snippet?.type)?m.snippet?.display_message:'',
    name:m.author_details?.display_name,authorId:m.author_details?.channel_id||m.snippet?.author_channel_id,
    publishedAt:Date.parse(m.snippet?.published_at)
  }));
}
