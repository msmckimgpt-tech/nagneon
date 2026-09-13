import type {ClipSegment} from './clip-buffer';
type Candidate={id:string;source:string;sessionId?:string;video:boolean;createdAt:number;observedAt?:number};
type Options={sessionId:string;takeAt:(at:number)=>Promise<ClipSegment|null>;allowed:()=>boolean;onError:(message:string)=>void;
  request?:typeof fetch;now?:()=>number;retryDelays?:number[];timeoutMs?:number};

// One bounded upload at a time. Keep its Blob across retries, and check whether
// the server committed a lost response before sending those same bytes again.
export class ClipUploads {
  private options:Options;
  private queue:Candidate[]=[];
  private seen=new Set<string>();
  private working=false;
  private closed=false;
  private abort=new AbortController();
  private request:typeof fetch;
  private now:()=>number;
  constructor(options:Options){this.options=options;this.request=options.request||fetch;this.now=options.now||Date.now;}
  private allowed(){return !this.closed&&this.options.allowed();}
  add(clips:Candidate[]){
    if(!this.allowed())return;
    const ids=new Set(clips.map(c=>c.id)),unsaved=new Set(clips.filter(c=>!c.video).map(c=>c.id));
    this.queue=this.queue.filter(c=>unsaved.has(c.id));
    for(const id of this.seen)if(!ids.has(id))this.seen.delete(id);
    for(const clip of clips){
      if(clip.source!=='spectator'||clip.sessionId!==this.options.sessionId||clip.video||this.seen.has(clip.id)||this.now()-clip.createdAt>120_000||this.queue.length>=100)continue;
      this.seen.add(clip.id);this.queue.push(clip);
    }
    void this.pump();
  }
  private async call(path:string,init:RequestInit={}){
    const controller=new AbortController();const cancel=()=>controller.abort();
    this.abort.signal.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(cancel,this.options.timeoutMs??10_000);
    try{
      if(!this.allowed())throw new Error('clip upload cancelled');
      const response=await this.request(path,{...init,headers:{'X-Backseat-Client':'studio',...init.headers},signal:controller.signal});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'핫클립 영상을 저장하지 못했습니다.');
      return data;
    }finally{clearTimeout(timer);this.abort.signal.removeEventListener('abort',cancel);}
  }
  private async wait(ms:number){
    if(!this.allowed())return;
    await new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);this.abort.signal.removeEventListener('abort',done);resolve();};
      const timer=setTimeout(done,ms);this.abort.signal.addEventListener('abort',done,{once:true});
    });
  }
  private async upload(clip:Candidate,recording:ClipSegment){
    const delays=this.options.retryDelays??[1000,3000];
    const path=`/api/clips/${encodeURIComponent(clip.id)}`;
    const params=new URLSearchParams({startedAt:String(recording.startedAt),endedAt:String(recording.endedAt),hasAudio:String(recording.hasAudio)});
    let failure:unknown;
    for(let attempt=0;attempt<=delays.length;attempt++){
      if(!this.allowed()||!this.seen.has(clip.id))return;
      if(attempt){
        await this.wait(delays[attempt-1]);if(!this.allowed())return;
        try{const saved=await this.call(path);if(saved.id===clip.id&&saved.video)return;}catch{}
      }
      if(!this.allowed())return;
      if(this.now()-recording.endedAt>120_000)throw failure||new Error('영상 버퍼의 저장 시간이 지났습니다.');
      try{
        const saved=await this.call(`${path}/video?${params}`,{method:'POST',headers:{'Content-Type':'video/webm'},body:recording.blob});
        if(saved.id!==clip.id||!saved.video)throw new Error('핫클립 영상 저장을 확인하지 못했습니다.');
        return;
      }catch(error){failure=error;}
    }
    // The final POST may also have committed before its response was lost.
    if(this.allowed())try{const saved=await this.call(path);if(saved.id===clip.id&&saved.video)return;}catch{}
    throw failure;
  }
  private async pump(){
    if(this.working)return;this.working=true;
    try{
      while(this.allowed()&&this.queue.length){
        const clip=this.queue.shift()!;
        try{
          const recording=await this.options.takeAt(clip.observedAt??clip.createdAt);
          if(!this.allowed())return;
          if(!this.seen.has(clip.id))continue;
          if(!recording||recording.sessionId!==this.options.sessionId)continue;
          await this.upload(clip,recording);
        }catch(error){if(this.allowed())this.options.onError((error instanceof Error?error.message:'관객 클립 영상 연결 실패')+' · 관객의 장면 기록은 저장되어 있습니다.');}
      }
    }finally{this.working=false;}
  }
  dispose(){if(this.closed)return;this.closed=true;this.abort.abort();this.queue=[];this.seen.clear();}
}
