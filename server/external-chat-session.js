import {z} from 'zod';
import {ExternalChat,youtubeItems} from './external-chat.js';
import {YoutubeChat,youtubeVideoId} from './youtube-chat.js';
import {ChzzkAuth,CHZZK_CALLBACK} from './chzzk-auth.js';
import {ChzzkChat} from './chzzk-chat.js';

export class ExternalChatSession {
  constructor(studio,{youtubeFactory=options=>new YoutubeChat(options),chzzkFactory=options=>new ChzzkChat(options),authFactory=options=>new ChzzkAuth(options),openExternalAuth}={}){
    Object.assign(this,{studio,youtubeFactory,chzzkFactory,authFactory,openExternalAuth});this.generation=0;this.transport=null;this.auth=null;this.authorizationUrl='';this.status={phase:'disconnected'};this.previousIds=new Set();
    this.buffer=new ExternalChat({now:studio.now,onChange:()=>{
      const ids=new Set(this.buffer.messages.map(m=>m.id));const removed=[...this.previousIds].filter(id=>!ids.has(id));this.previousIds=ids;
      if(removed.length){const invalid=new Set(removed);const op=studio.liveReaction;if(op?.externalIds?.some(id=>invalid.has(id))){op.superseded=true;op.controller.abort();}studio.queue=studio.queue.filter(m=>!m.externalIds?.some(id=>invalid.has(id)));}
      studio.publish();
    }});
  }
  snapshot(){return {...this.status,...this.buffer.snapshot(),chzzkCallback:CHZZK_CALLBACK};}
  disconnect(){this.generation++;const old=this.transport,auth=this.auth;this.transport=null;this.auth=null;this.authorizationUrl='';auth?.cancel();old?.disconnect();this.status={phase:'disconnected'};this.buffer.clear();}
  async openAuthorization(){
    if(!this.authorizationUrl||!this.auth?.active)throw Error('치지직 인증을 먼저 시작해주세요.');
    const url=new URL(this.authorizationUrl);if(url.origin!=='https://chzzk.naver.com'||url.pathname!=='/account-interlock')throw Error('치지직 인증 주소를 확인할 수 없습니다.');
    if(this.openExternalAuth){try{await this.openExternalAuth(url.href);return {opened:true};}catch{throw Error('브라우저를 열지 못했습니다. 인증 주소를 복사해 기본 브라우저에 붙여넣어주세요.');}}
    return {opened:false,authorizationUrl:url.href};
  }
  async beginChzzk(credentials){
    const s=this.studio;if(!s.running||s.settings.mode!=='live')throw Error('실제 AI 방송을 시작한 뒤 외부 채팅을 연결해주세요.');
    this.disconnect();const generation=this.generation,sessionId=s.sessionId;
    const current=()=>this.generation===generation&&s.running&&s.sessionId===sessionId&&s.settings.mode==='live';let sourceId;
    const auth=this.authFactory({onState:status=>{if(!current()||status.phase==='authorized')return;if(status.phase==='failed'){this.authorizationUrl='';this.buffer.clear();}this.status=status;s.publish();},onAuthorized:async(tokens,signal)=>{
      if(!current()||signal.aborted)return;
      const transport=this.chzzkFactory({onState:status=>{if(!current())return;this.status=status;
        if(status.phase==='receiving'&&!sourceId){this.authorizationUrl='';sourceId=this.buffer.open({platform:'chzzk',channelId:status.channelId,sessionId});}
        if(['failed','ended','disconnected'].includes(status.phase))this.buffer.clear();s.publish();
      },onBatch:batch=>{if(current()&&sourceId&&batch.channelId===this.buffer.source?.channelId)this.buffer.ingest(sourceId,sessionId,batch.items);}});
      this.transport=transport;await transport.connect(tokens,signal);
    }});this.auth=auth;
    try{const result=await auth.begin(credentials);if(!current())return {cancelled:true};this.authorizationUrl=result.authorizationUrl;
      let opened=false;try{opened=(await this.openAuthorization()).opened;}catch{/* The returned copyable URL remains available when shell launch fails. */}
      if(!current())return {cancelled:true};return {...result,opened};
    }catch{if(current()){this.authorizationUrl='';this.status={phase:'failed',error:'치지직 인증을 시작하지 못했습니다. 앱 등록 정보와 콜백 포트를 확인해주세요.'};this.buffer.clear();}throw Error('치지직 인증을 시작하지 못했습니다.');}
  }
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
  app.post('/api/external/chzzk/start',async(req,res)=>{
    const input=z.object({clientId:z.string().min(8).max(512),clientSecret:z.string().min(8).max(512)}).strict().parse(req.body);if(res.destroyed)return;
    const pending=chat.beginChzzk(input),generation=chat.generation;
    const cancel=()=>{if(!res.writableEnded&&chat.generation===generation)chat.disconnect();};res.on('close',cancel);
    try{const result=await pending;if(!res.destroyed)res.json(result);}finally{res.off('close',cancel);}
  });
  app.post('/api/external/chzzk/open',async(_req,res)=>res.json(await chat.openAuthorization()));
  return chat;
}
