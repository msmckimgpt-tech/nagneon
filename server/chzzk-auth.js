import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {listenBrowserLoopback} from './browser-loopback.js';

export const CHZZK_CALLBACK='http://127.0.0.1:4319/chzzk/callback';
const validSecret=value=>typeof value==='string'&&/^[\x21-\x7e]{8,2048}$/.test(value);
const sameState=(a,b)=>typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));

// A temporary loopback listener receives exactly one authorization response.
// No authorization code, token or client secret is put in public state/logs.
export class ChzzkAuth {
  constructor({port=4319,fetchImpl=fetch,timeoutMs=300000,onState=()=>{},onAuthorized=async()=>{}}={}){
    Object.assign(this,{port,fetchImpl,timeoutMs,onState,onAuthorized});this.active=null;this.serial=0;
  }
  cancel(){const c=this.active;this.active=null;this.serial++;if(c){clearTimeout(c.timer);c.controller.abort();c.server.close();c.server.closeAllConnections();}this.onState({phase:'disconnected'});}
  async begin({clientId,clientSecret}){
    if(!validSecret(clientId)||!validSecret(clientSecret))throw Error('치지직 Client ID와 Client Secret을 확인해주세요.');
    this.cancel();const c={state:randomBytes(32).toString('hex'),controller:new AbortController(),used:false,server:null,timer:null};
    c.server=createServer({maxHeaderSize:4096,headersTimeout:5000,requestTimeout:15000},(req,res)=>{void this.callback(c,req,res,{clientId,clientSecret}).catch(()=>{if(!res.headersSent)res.writeHead(400);res.end();});});
    this.active=c;
    try{await listenBrowserLoopback(c.server,{port:this.port,signal:c.controller.signal});}
    catch{if(this.active===c){this.cancel();this.onState({phase:'failed',error:'치지직 인증용 포트를 열지 못했습니다. 다른 연결을 종료한 뒤 다시 시도해주세요.'});}throw Error('치지직 인증 창을 준비하지 못했습니다.');}
    if(this.active!==c){c.server.close();throw Error('치지직 인증이 취소되었습니다.');}
    c.redirectUri=`http://127.0.0.1:${c.server.address().port}/chzzk/callback`;
    c.timer=setTimeout(()=>{if(this.active===c){this.cancel();this.onState({phase:'failed',error:'치지직 인증 시간이 지났습니다. 다시 연결해주세요.'});}},this.timeoutMs);c.timer.unref();
    const url=new URL('https://chzzk.naver.com/account-interlock');url.search=new URLSearchParams({clientId,redirectUri:c.redirectUri,state:c.state}).toString();
    this.onState({phase:'authorizing'});return {authorizationUrl:url.href,redirectUri:c.redirectUri};
  }
  async callback(c,req,res,{clientId,clientSecret}){
    res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    const deny=()=>{res.writeHead(400);res.end('인증 응답을 확인할 수 없습니다. 앱에서 다시 연결해주세요.');};
    if(this.active!==c||c.used||req.method!=='GET'||req.headers.host!==new URL(c.redirectUri).host||req.url.length>8192)return deny();
    let url;try{url=new URL(req.url,c.redirectUri);}catch{return deny();}
    const states=url.searchParams.getAll('state'),codes=url.searchParams.getAll('code');
    if(url.pathname!=='/chzzk/callback'||states.length!==1||!sameState(states[0],c.state))return deny();
    if(url.searchParams.has('error')){deny();this.cancel();this.onState({phase:'failed',error:'치지직 승인이 취소되었습니다.'});return;}
    if(codes.length!==1||!validSecret(codes[0]))return deny();
    c.used=true;res.end('인증 응답을 받았습니다. 앱으로 돌아가 연결 결과를 확인해주세요.');c.server.close();
    this.onState({phase:'connecting'});
    try{
      const response=await this.fetchImpl('https://openapi.chzzk.naver.com/auth/v1/token',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({grantType:'authorization_code',clientId,clientSecret,code:codes[0],state:c.state}),signal:AbortSignal.any([c.controller.signal,AbortSignal.timeout(10000)])});
      if(!response.ok)throw Error('token');
      const reader=response.body.getReader();let size=0,chunks=[];
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('size');chunks.push(value);}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(body.code&&body.code!==200)throw Error('token status');
      const data=body.content??body,expiresIn=Number(data.expiresIn);
      if(!validSecret(data.accessToken)||data.tokenType!=='Bearer'||!Number.isFinite(expiresIn)||expiresIn<=0||expiresIn>86400)throw Error('token shape');
      if(this.active!==c)return;
      await this.onAuthorized({accessToken:data.accessToken,expiresAt:Date.now()+expiresIn*1000},c.controller.signal);
      if(this.active===c){clearTimeout(c.timer);this.active=null;this.onState({phase:'authorized'});}
    }catch{if(this.active===c){this.cancel();this.onState({phase:'failed',error:'치지직 인증을 완료하지 못했습니다. 앱 등록 정보와 권한을 확인해주세요.'});}}
  }
}
