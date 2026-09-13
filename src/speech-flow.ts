// Pure capture/queue policy, shared by the renderer and deterministic tests.
export const VOICE_MAX_MS=6000,VOICE_SILENCE_MS=450;
export class VoiceBoundary {
  startedAt:number;lastAt:number;lastVoiceAt:number;voicedMs=0;
  constructor(at:number){this.startedAt=at;this.lastAt=at;this.lastVoiceAt=at;}
  sample(rms:number,at:number):'speech-end'|'limit'|'idle'|null{
    const dt=Math.min(200,Math.max(0,at-this.lastAt));this.lastAt=at;
    if(Number.isFinite(rms)&&rms>0.012){this.voicedMs+=dt;this.lastVoiceAt=at;}
    const elapsed=at-this.startedAt;
    if(elapsed>=VOICE_MAX_MS)return 'limit';
    if(this.voicedMs>=200&&elapsed>=700&&at-this.lastVoiceAt>=VOICE_SILENCE_MS)return 'speech-end';
    if(this.voicedMs<200&&elapsed>=3000)return 'idle';
    return null;
  }
  get hasSpeech(){return this.voicedMs>=200;}
}

export class SpeechQueue<T,R> {
  pending:{value:T;generation:number}[]=[];generation=0;running=false;controller:AbortController|null=null;
  execute:(value:T,signal:AbortSignal)=>Promise<R>;onResult:(result:R)=>void;onError:(error:unknown)=>void;onCount:(count:number)=>void;
  constructor(options:{execute:(value:T,signal:AbortSignal)=>Promise<R>;onResult:(result:R)=>void;onError:(error:unknown)=>void;onCount?:(count:number)=>void}){this.execute=options.execute;this.onResult=options.onResult;this.onError=options.onError;this.onCount=options.onCount||(()=>{});}
  enqueue(value:T){if(this.pending.length>=8)return false;this.pending.push({value,generation:this.generation});this.notify();void this.drain();return true;}
  reset(){this.generation++;this.pending=[];this.controller?.abort();this.notify();}
  notify(){this.onCount(this.pending.length+(this.running?1:0));}
  async drain(){
    if(this.running)return;this.running=true;
    try{while(this.pending.length){const item=this.pending.shift()!;const controller=new AbortController();this.controller=controller;this.notify();try{const result=await this.execute(item.value,controller.signal);if(item.generation===this.generation&&!controller.signal.aborted)this.onResult(result);}catch(error){if(item.generation===this.generation&&!controller.signal.aborted)this.onError(error);}finally{if(this.controller===controller)this.controller=null;}}}
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

type DeliveryItem={id:string;sessionId:string;text:string;source:'keyboard'|'microphone'};
// Delivery runs independently of the AI request. An uncertain HTTP result
// retains the exact event ID so a retry cannot print the same speech twice.
export class SpeechOutbox {
  items:DeliveryItem[]=[];running=false;generation=0;controller:AbortController|null=null;idFactory:()=>string;
  constructor(idFactory:()=>string=()=>crypto.randomUUID()){this.idFactory=idFactory;}
  add(text:string,sessionId:string,source:'keyboard'|'microphone'='keyboard'){const chunks=new SpeechMailbox();if(!chunks.add(text)||this.items.length+chunks.items.length>40)return false;this.items.push(...chunks.items.map(item=>({id:this.idFactory(),sessionId,text:item.text,source})));return true;}
  clear(){this.generation++;this.items=[];this.controller?.abort();}
  async flush(send:(item:DeliveryItem,signal:AbortSignal)=>Promise<unknown>){
    if(this.running)return;this.running=true;const generation=this.generation;
    try{
      while(this.items.length&&generation===this.generation){
        const item=this.items[0],controller=new AbortController();this.controller=controller;
        try{await send(item,controller.signal);if(generation===this.generation)this.items.shift();}
        catch(error){if(generation===this.generation&&!controller.signal.aborted)throw error;return;}
        finally{if(this.controller===controller)this.controller=null;}
      }
    }finally{this.running=false;}
  }
}
