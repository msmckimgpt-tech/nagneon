import grpc from '@grpc/grpc-js';
import {loadSync} from '@grpc/proto-loader';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

export const youtubeDefinition=loadSync(fileURLToPath(new URL('./youtube-chat.proto',import.meta.url)),{keepCase:true,defaults:false});
const Service=grpc.loadPackageDefinition(youtubeDefinition).youtube.api.v3.V3DataLiveChatMessageService;
const createClient=()=>new Service('youtube.googleapis.com:443',grpc.credentials.createSsl(),{'grpc.max_receive_message_length':2*1024*1024});

export function youtubeVideoId(value){
  if(typeof value!=='string')throw Error('YouTube 방송 URL을 확인해주세요.');
  if(/^[\w-]{11}$/.test(value))return value;
  let url;try{url=new URL(value);}catch{throw Error('YouTube 방송 URL을 확인해주세요.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw Error('YouTube 방송 URL을 확인해주세요.');
  const host=url.hostname,id=host==='youtu.be'?url.pathname.slice(1):['youtube.com','www.youtube.com','m.youtube.com'].includes(host)?url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.startsWith('/live/')?url.pathname.slice(6):'':'';
  if(!/^[\w-]{11}$/.test(id||''))throw Error('YouTube 방송 URL을 확인해주세요.');return id;
}

// Credentials stay in the connection closure, never in snapshots or raw errors.
// The caller owns session/generation admission and clears data on disconnect.
export class YoutubeChat {
  constructor({fetchImpl=fetch,clientFactory=createClient,sleep=delay,onBatch=()=>{},onState=()=>{}}={}){
    Object.assign(this,{fetchImpl,clientFactory,sleep,onBatch,onState});this.connection=null;
  }
  disconnect(){const c=this.connection;this.connection=null;if(c){c.controller.abort();c.call?.cancel();c.client?.close();}this.onState({phase:'disconnected'});}
  async connect({video,apiKey}){
    const videoId=youtubeVideoId(video);
    if(typeof apiKey!=='string'||!/^[A-Za-z0-9_-]{10,256}$/.test(apiKey))throw Error('YouTube API 키를 확인해주세요.');
    this.disconnect();const c={controller:new AbortController(),client:null,call:null};this.connection=c;this.onState({phase:'connecting',videoId});
    try{
      const response=await this.fetchImpl(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}`,{headers:{'X-Goog-Api-Key':apiKey},redirect:'error',signal:AbortSignal.any([c.controller.signal,AbortSignal.timeout(10000)])});
      if(!response.ok)throw Error('lookup');
      // Bound this small metadata response before JSON parsing.
      const reader=response.body.getReader();let size=0,chunks=[];
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('metadata size');chunks.push(value);}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const liveChatId=result.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if(typeof liveChatId!=='string'||!liveChatId||liveChatId.length>1024)throw Error('offline');
      if(this.connection!==c)return;
      c.client=this.clientFactory();const metadata=new grpc.Metadata();metadata.set('x-goog-api-key',apiKey);
      c.done=this.consume(c,liveChatId,metadata,videoId);return {videoId};
    }catch{
      if(this.connection!==c)return;
      this.disconnect();this.onState({phase:'failed',error:'YouTube 방송을 찾지 못했습니다. API 활성화·키 제한과 진행 중 방송의 채팅 설정을 확인해주세요.'});
      throw Error('YouTube 연결을 완료하지 못했습니다.');
    }
  }
  async consume(c,liveChatId,metadata,videoId){
    let pageToken='',retries=0;
    try{
      while(this.connection===c){
        try{
          c.call=c.client.streamList({live_chat_id:liveChatId,part:['id','snippet','authorDetails'],...(pageToken?{page_token:pageToken}:{})},metadata);
          this.onState({phase:'receiving',videoId});
          for await(const batch of c.call){
            if(this.connection!==c)return;
            if(batch.next_page_token){if(batch.next_page_token.length>8192)throw Error('token size');pageToken=batch.next_page_token;}
            this.onBatch({items:(batch.items||[]).slice(0,2000),liveChatId,videoId});
            if(batch.offline_at||(batch.items||[]).some(m=>m.snippet?.type===4)){this.disconnect();this.onState({phase:'ended',videoId});return;}
          }
          // Normal remote closure can be resumed, but never busy-loop forever.
        }catch(error){
          if(this.connection!==c)return;
          if(![grpc.status.UNAVAILABLE,grpc.status.DEADLINE_EXCEEDED].includes(error.code))throw error;
        }
        if(this.connection!==c)return;
        if(++retries>3)throw Error('retry limit');
        this.onState({phase:'reconnecting',videoId});
        await this.sleep(1000*2**(retries-1),undefined,{signal:c.controller.signal});
      }
    }catch{
      if(this.connection!==c)return;
      this.disconnect();this.onState({phase:'failed',videoId,error:'YouTube 채팅 수신이 중단되었습니다. 방송 상태·권한·API 할당량을 확인한 뒤 다시 연결해주세요.'});
    }
  }
}
