import {z} from 'zod';
import {ExternalChat,youtubeItems} from './external-chat.js';
import {YoutubeChat,youtubeVideoId} from './youtube-chat.js';

export class ExternalChatSession {
  constructor(studio,{youtubeFactory=options=>new YoutubeChat(options)}={}){
    this.studio=studio;this.youtubeFactory=youtubeFactory;this.generation=0;this.transport=null;this.status={phase:'disconnected'};this.previousIds=new Set();
    this.buffer=new ExternalChat({now:studio.now,onChange:()=>{
      const ids=new Set(this.buffer.messages.map(m=>m.id));const removed=[...this.previousIds].filter(id=>!ids.has(id));this.previousIds=ids;
      if(removed.length){const invalid=new Set(removed);const op=studio.liveReaction;if(op?.externalIds?.some(id=>invalid.has(id))){op.superseded=true;op.controller.abort();}studio.queue=studio.queue.filter(m=>!m.externalIds?.some(id=>invalid.has(id)));}
      studio.publish();
    }});
  }
  snapshot(){return {...this.status,...this.buffer.snapshot()};}
  disconnect(){this.generation++;const old=this.transport;this.transport=null;old?.disconnect();this.status={phase:'disconnected'};this.buffer.clear();}
  async connect({video,apiKey}){
    const s=this.studio;if(!s.running||s.settings.mode!=='live')throw Error('실제 AI 방송을 시작한 뒤 외부 채팅을 연결해주세요.');
    const channelId=youtubeVideoId(video);this.disconnect();const generation=this.generation,sessionId=s.sessionId;
    const sourceId=this.buffer.open({platform:'youtube',channelId,sessionId});
    const current=()=>this.generation===generation&&s.running&&s.sessionId===sessionId&&s.settings.mode==='live';
    const transport=this.youtubeFactory({onState:status=>{if(!current())return;this.status=status;if(['failed','ended'].includes(status.phase))this.buffer.clear();s.publish();},onBatch:batch=>{if(current())this.buffer.ingest(sourceId,sessionId,youtubeItems(batch));}});this.transport=transport;
    try{await transport.connect({video:channelId,apiKey});if(!current())return;return this.snapshot();}
    catch{if(current()){this.transport=null;transport.disconnect();this.status={phase:'failed',error:'YouTube 연결을 완료하지 못했습니다. API 키와 방송 상태를 확인해주세요.'};this.buffer.clear();}throw Error('YouTube 연결을 완료하지 못했습니다.');}
  }
}

export function externalChatRoutes(app,studio,options){
  const chat=new ExternalChatSession(studio,options);studio.externalChat=chat.buffer;
  app.post('/api/external/youtube/connect',async(req,res)=>{
    const input=z.object({video:z.string().min(1).max(2048),apiKey:z.string().min(10).max(256)}).strict().parse(req.body);if(res.destroyed)return;
    const pending=chat.connect(input),generation=chat.generation;
    const cancel=()=>{if(!res.writableEnded&&chat.generation===generation)chat.disconnect();};res.on('close',cancel);
    try{const result=await pending;if(!res.destroyed)res.json(result||{cancelled:true});}finally{res.off('close',cancel);}
  });
  app.post('/api/external/disconnect',(_req,res)=>{chat.disconnect();res.json(chat.snapshot());});
  return chat;
}
