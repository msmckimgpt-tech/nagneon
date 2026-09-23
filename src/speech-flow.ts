import {runSpeechOperation} from './speech-operation.ts';

// Pure capture/queue policy, shared by the renderer and deterministic tests.
export const VOICE_MAX_MS=6000,VOICE_SILENCE_MS=450;
export const SPEECH_QUEUE_TIMEOUT_MS=180000,SPEECH_DELIVERY_TIMEOUT_MS=15000;
export type SpeechCapture={startedAt:number;endedAt:number;screen?:import('./temporal-frames').VideoWindow};
export class VoiceBoundary {
  startedAt:number;lastAt:number;lastVoiceAt:number;voicedMs=0;firstVoiceAt:number|null=null;
  constructor(at:number){this.startedAt=at;this.lastAt=at;this.lastVoiceAt=at;}
  sample(rms:number,at:number):'speech-end'|'limit'|'idle'|null{
    const dt=Math.min(200,Math.max(0,at-this.lastAt));this.lastAt=at;
    if(Number.isFinite(rms)&&rms>0.012){this.firstVoiceAt??=at-dt;this.voicedMs+=dt;this.lastVoiceAt=at;}
    const elapsed=at-this.startedAt;
    if(elapsed>=VOICE_MAX_MS)return 'limit';
    if(this.voicedMs>=200&&elapsed>=700&&at-this.lastVoiceAt>=VOICE_SILENCE_MS)return 'speech-end';
    if(this.voicedMs<200&&elapsed>=3000)return 'idle';
    return null;
  }
  capture(wallStartedAt:number):SpeechCapture|undefined{
    if(!this.hasSpeech||this.firstVoiceAt===null||this.lastVoiceAt-this.firstVoiceAt>15000)return;
    return {startedAt:wallStartedAt+Math.max(0,this.firstVoiceAt-this.startedAt),endedAt:wallStartedAt+this.lastVoiceAt-this.startedAt};
  }
  get hasSpeech(){return this.voicedMs>=200;}
}

export class SpeechQueue<T,R> {
  pending:{value:T;generation:number}[]=[];generation=0;running=false;controller:AbortController|null=null;
  execute:(value:T,signal:AbortSignal)=>Promise<R>;onResult:(result:R)=>void;onError:(error:unknown)=>void;onCount:(count:number)=>void;operationTimeoutMs:number;
  constructor(options:{execute:(value:T,signal:AbortSignal)=>Promise<R>;onResult:(result:R)=>void;onError:(error:unknown)=>void;onCount?:(count:number)=>void;operationTimeoutMs?:number}){this.execute=options.execute;this.onResult=options.onResult;this.onError=options.onError;this.onCount=options.onCount||(()=>{});this.operationTimeoutMs=options.operationTimeoutMs??SPEECH_QUEUE_TIMEOUT_MS;}
  enqueue(value:T){if(this.pending.length>=8)return false;this.pending.push({value,generation:this.generation});this.notify();void this.drain();return true;}
  enqueueLatest(value:T){const dropped=this.pending.length>=8?this.pending.shift():undefined;this.enqueue(value);return dropped?.value;}
  reset(){this.generation++;this.pending=[];this.controller?.abort();this.notify();}
  notify(){this.onCount(this.pending.length+(this.running?1:0));}
  async drain(){
    if(this.running)return;this.running=true;
    try{while(this.pending.length){const item=this.pending.shift()!;const controller=new AbortController();this.controller=controller;this.notify();try{const result=await runSpeechOperation(signal=>this.execute(item.value,signal),{signal:controller.signal,timeoutMs:this.operationTimeoutMs,timeoutMessage:'음성 인식 응답이 너무 오래 걸려 다음 발화를 처리합니다.'});if(item.generation===this.generation&&!controller.signal.aborted)this.onResult(result);}catch(error){if(item.generation===this.generation&&!controller.signal.aborted)this.onError(error);}finally{if(this.controller===controller)this.controller=null;}}}
    finally{this.running=false;this.notify();}
  }
}

export class SpeechMailbox {
  items:{id:number;text:string}[]=[];sequence=0;
  add(text:string){
    const value=text.trim();if(!value)return true;const chunks:string[]=[];let chunk='';
    // The HTTP limit uses UTF-16 length. Keep surrogate pairs intact while
    // respecting that same limit, otherwise an emoji-only item can block a batch.
    for(const point of value){if(chunk.length+point.length>3000){chunks.push(chunk);chunk='';}chunk+=point;}
    if(chunk)chunks.push(chunk);if(this.items.length+chunks.length>40)return false;
    for(const part of chunks)this.items.push({id:++this.sequence,text:part});return true;
  }
  batch(){const items:typeof this.items=[];let size=0;for(const item of this.items){const n=item.text.length+(items.length?1:0);if(size+n>3000)break;size+=n;items.push(item);}return {text:items.map(i=>i.text).join(' '),ids:items.map(i=>i.id)};}
  acknowledge(ids:number[]){const done=new Set(ids);this.items=this.items.filter(i=>!done.has(i.id));}
  clear(){this.items=[];}
}

type DeliveryItem={id:string;sessionId:string;text:string;source:'keyboard'|'microphone';capture?:SpeechCapture};
// Delivery runs independently of the AI request. An uncertain HTTP result
// retains the exact event ID so a retry cannot print the same speech twice.
export class SpeechOutbox {
  items:DeliveryItem[]=[];running=false;generation=0;controller:AbortController|null=null;idFactory:()=>string;sendTimeoutMs:number;
  constructor(idFactory:()=>string=()=>crypto.randomUUID(),sendTimeoutMs=SPEECH_DELIVERY_TIMEOUT_MS){this.idFactory=idFactory;this.sendTimeoutMs=sendTimeoutMs;}
  add(text:string,sessionId:string,source:'keyboard'|'microphone'='keyboard',capture?:SpeechCapture){const chunks=new SpeechMailbox();if(!chunks.add(text))return false;this.items.push(...chunks.items.map(item=>({id:this.idFactory(),sessionId,text:item.text,source,...(source==='microphone'&&capture?{capture:structuredClone(capture)}:{})})));return true;}
  clear(){this.generation++;this.items=[];this.controller?.abort();}
  async flush(send:(item:DeliveryItem,signal:AbortSignal)=>Promise<unknown>){
    if(this.running)return;this.running=true;const generation=this.generation,limit=this.items.length;let delivered=0;
    try{
      while(this.items.length&&delivered<limit&&generation===this.generation){
        const item=this.items[0],controller=new AbortController();this.controller=controller;
        try{await runSpeechOperation(signal=>send(item,signal),{signal:controller.signal,timeoutMs:this.sendTimeoutMs,timeoutMessage:'발언 전달 응답 시간이 초과되었습니다.'});if(generation===this.generation){this.items.shift();delivered++;}}
        catch(error){if(generation===this.generation&&!controller.signal.aborted)throw error;return;}
        finally{if(this.controller===controller)this.controller=null;}
      }
    }finally{this.running=false;}
  }
}

// Retry only a preparation failure; preserve the same audio and capture snapshot.
export async function recognizeWithRecovery<R>(request:()=>Promise<R>,prepare:()=>Promise<unknown>,signal:AbortSignal):Promise<R>{
  try{return await request();}catch(error){
    if(signal.aborted||!(error instanceof Error)||!('needsPreparation' in error)||error.needsPreparation!==true)throw error;
    await prepare();if(signal.aborted)throw new DOMException('음성 인식 취소','AbortError');return request();
  }
}
