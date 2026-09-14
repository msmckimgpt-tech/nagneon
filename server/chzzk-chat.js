import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import WebSocket from 'ws';

// Read-only default namespace, Socket.IO protocol 4 over Engine.IO protocol 3.
// CHZZK documents the 1.x–2.0.3 protocol, not current Socket.IO v4 clients.
// This small text-only transport avoids importing the old polling/JSONP stack.
export class ChzzkSocket extends EventEmitter {
  constructor(url,{webSocketFactory=(url,options)=>new WebSocket(url,options)}={}){
    super();this.closed=false;this.ready=false;const target=new URL(url);target.protocol='wss:';target.pathname='/socket.io/';target.searchParams.set('EIO','3');target.searchParams.set('transport','websocket');
    this.socket=webSocketFactory(target.href,{handshakeTimeout:8000,maxPayload:65536,followRedirects:false,perMessageDeflate:false});
    this.socket.on('message',(bytes,binary)=>{try{if(binary)throw Error('binary');this.packet(bytes.toString('utf8'));}catch{this.emit('fault');this.close();}});
    this.socket.on('error',()=>{this.emit('fault');this.close();});this.socket.on('close',()=>{this.close();});
  }
  packet(text){
    if(this.closed)return;
    if(text[0]==='0'){
      if(this.opened)throw Error('duplicate handshake');const h=JSON.parse(text.slice(1));
      if(typeof h.sid!=='string'||!Number.isFinite(h.pingInterval)||h.pingInterval<=0||h.pingInterval>120000||!Number.isFinite(h.pingTimeout)||h.pingTimeout<=0||h.pingTimeout>120000)throw Error('handshake');
      this.opened=true;this.interval=h.pingInterval;this.timeout=h.pingTimeout;this.schedulePing();return;
    }
    if(!this.opened)throw Error('handshake missing');
    if(text==='3'){clearTimeout(this.pongTimer);this.schedulePing();return;}
    if(text==='40'){this.ready=true;return;}
    if(text==='1'||text==='41'||text.startsWith('44')){this.close();return;}
    if(text.startsWith('42')&&this.ready){const event=JSON.parse(text.slice(2));if(!Array.isArray(event)||event.length!==2)throw Error('event');if(['SYSTEM','CHAT'].includes(event[0]))this.emit(event[0],typeof event[1]==='string'?JSON.parse(event[1]):event[1]);}
  }
  schedulePing(){clearTimeout(this.pingTimer);this.pingTimer=setTimeout(()=>{if(this.closed)return;this.socket.send('2');this.pongTimer=setTimeout(()=>{this.emit('fault');this.close();},this.timeout);this.pongTimer.unref();},this.interval);this.pingTimer.unref();}
  close(){if(this.closed)return;this.closed=true;clearTimeout(this.pingTimer);clearTimeout(this.pongTimer);this.socket.terminate();this.emit('close');}
}

export function chzzkItem(message,channelId){
  if(!message||message.channelId!==channelId||typeof message.senderChannelId!=='string'||typeof message.content!=='string'||!Number.isFinite(message.messageTime))return null;
  const id=createHash('sha256').update(JSON.stringify([channelId,message.senderChannelId,message.messageTime,message.content])).digest('hex');
  return {id,name:message.profile?.nickname,authorId:message.senderChannelId,text:message.content,publishedAt:message.messageTime};
}

export class ChzzkChat {
  constructor({fetchImpl=fetch,socketFactory=url=>new ChzzkSocket(url),onState=()=>{},onBatch=()=>{}}={}){Object.assign(this,{fetchImpl,socketFactory,onState,onBatch});this.active=null;}
  disconnect(){const c=this.active;this.active=null;if(c){clearTimeout(c.timer);clearTimeout(c.expiry);c.removeAbort?.();c.controller.abort();c.socket?.close();c.reject?.(Error('cancelled'));}this.onState({phase:'disconnected'});}
  async request(path,token,signal,method='GET'){
    const response=await this.fetchImpl('https://openapi.chzzk.naver.com'+path,{method,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
    if(!response.ok)throw Error('request');const reader=response.body.getReader();let size=0,chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('size');chunks.push(value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const text=Buffer.concat(chunks).toString('utf8');const body=text?JSON.parse(text):{};if(body.code&&body.code!==200)throw Error('request');return body.content??body;
  }
  async connect({accessToken,expiresAt},signal){
    if(typeof accessToken!=='string'||!accessToken||!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw Error('치지직 인증을 다시 진행해주세요.');
    this.disconnect();const c={controller:new AbortController(),socket:null,channelId:null};this.active=c;this.onState({phase:'connecting'});
    const cancel=()=>{if(this.active===c)this.disconnect();};signal?.addEventListener('abort',cancel,{once:true});
    c.removeAbort=()=>signal?.removeEventListener('abort',cancel);
    try{
      if(signal?.aborted)throw Error('cancelled');
      const session=await this.request('/open/v1/sessions/auth',accessToken,c.controller.signal);if(this.active!==c)return;
      const url=new URL(session.url);if(url.protocol!=='https:'||!url.hostname.endsWith('.nchat.naver.com')||url.username||url.password||url.hash||url.port&&url.port!=='443')throw Error('socket URL');
      await new Promise((resolve,reject)=>{
        c.reject=reject;c.timer=setTimeout(()=>reject(Error('subscription timeout')),10000);c.timer.unref();c.socket=this.socketFactory(url.href);
        const fail=()=>{if(this.active===c){reject(Error('session ended'));this.disconnect();this.onState({phase:'failed',error:'치지직 채팅 연결이 끝났습니다. 권한과 방송 상태를 확인하고 다시 연결해주세요.'});}};
        c.socket.on('fault',fail);c.socket.on('close',fail);
        c.socket.on('SYSTEM',event=>{
          if(this.active!==c||!event)return;
          if(event.type==='connected'&&!c.subscribing&&typeof event.data?.sessionKey==='string'&&event.data.sessionKey.length<=2048){c.subscribing=true;void this.request('/open/v1/sessions/events/subscribe/chat?'+new URLSearchParams({sessionKey:event.data.sessionKey}),accessToken,c.controller.signal,'POST').catch(fail);}
          else if(event.type==='subscribed'&&c.subscribing&&event.data?.eventType==='CHAT'&&typeof event.data.channelId==='string'&&event.data.channelId.length<=1024){c.channelId=event.data.channelId;clearTimeout(c.timer);this.onState({phase:'receiving',channelId:c.channelId});resolve();}
          else if(['revoked','unsubscribed'].includes(event.type)&&event.data?.eventType==='CHAT')fail();
        });
        c.socket.on('CHAT',message=>{if(this.active!==c||!c.channelId)return;const item=chzzkItem(message,c.channelId);if(item)this.onBatch({channelId:c.channelId,items:[item]});});
      });
      if(this.active===c){c.reject=null;c.expiry=setTimeout(()=>{if(this.active===c){this.disconnect();this.onState({phase:'failed',error:'치지직 인증 시간이 만료되었습니다. 다시 연결해주세요.'});}},Math.min(86400000,Math.max(1,expiresAt-Date.now())));c.expiry.unref();}
    }catch{if(this.active===c){this.disconnect();this.onState({phase:'failed',error:'치지직 채팅을 연결하지 못했습니다. 채팅 메시지 조회 권한을 확인해주세요.'});}throw Error('치지직 채팅 연결 실패');}
    finally{if(this.active!==c)c.removeAbort();}
  }
}
