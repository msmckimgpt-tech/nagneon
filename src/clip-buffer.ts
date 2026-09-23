export type ClipSegment={blob:Blob;startedAt:number;endedAt:number;hasAudio:boolean;sessionId:string;kind:'video'|'audio';audioLayout?:'mixed'|'separate'|'microphone-only';voice?:ClipSegment};
type Timer=ReturnType<typeof setTimeout>;
type Clock={now:()=>number;set:(callback:()=>void,ms:number)=>Timer;clear:(timer:Timer|undefined)=>void};
// Browser timers require their Window receiver. Storing them as clock methods
// invokes them with `clock` as this and aborts recording with Illegal invocation.
const clock:Clock={now:Date.now,set:(callback,ms)=>setTimeout(callback,ms),clear:timer=>clearTimeout(timer)};
export const CLIP_RETENTION_MS=120_000;
const SEGMENT_MS=15_000,MAX_BYTES=24*1024*1024,MAX_SEGMENT_BYTES=20*1024*1024;

// Every entry contains ALL chunks from one completed recording. Chunks from
// different recorders cannot be concatenated into a reliably playable WebM.
export class ClipBuffer {
  private segments:ClipSegment[]=[];
  private pending=new Set<{at:number;resolve:(value:ClipSegment|null)=>void;timer:Timer}>();
  private active:MediaRecorder|null=null;
  private startedAt=0;
  private stoppedAt:number|null=null;
  private rotation:Timer|undefined;
  private watchdog:Timer|undefined;
  private closed=false;
  private options:{sessionId:string;hasAudio:boolean;kind?:'video'|'audio';create:()=>MediaRecorder;onFailure:()=>void;clock?:Clock};
  private clock:Clock;

  constructor(options:ClipBuffer['options']){this.options=options;this.clock=options.clock||clock;}
  start(){if(!this.closed&&!this.active)this.record();}
  private prune(){
    this.segments=this.segments.filter(s=>this.clock.now()-s.endedAt<=CLIP_RETENTION_MS);
    let bytes=this.segments.reduce((n,s)=>n+s.blob.size,0);
    while(this.segments.length>10||bytes>MAX_BYTES)bytes-=this.segments.shift()!.blob.size;
  }
  private find(at:number){this.prune();return this.segments.find(s=>s.startedAt<=at&&s.endedAt>=at)||null;}
  private record(){
    try{
      const rec=this.options.create();this.active=rec;
      const began=this.clock.now();this.startedAt=began;this.stoppedAt=null;
      let parts:Blob[]=[];let bytes=0;
      rec.ondataavailable=e=>{
        if(this.closed||this.active!==rec||!e.data.size)return;
        bytes+=e.data.size;
        if(bytes>MAX_SEGMENT_BYTES){parts=[];this.fail();return;}
        parts.push(e.data);
      };
      rec.onerror=()=>{if(!this.closed&&this.active===rec)this.fail();};
      rec.onstop=()=>{
        if(this.closed||this.active!==rec)return;
        this.clock.clear(this.rotation);this.clock.clear(this.watchdog);
        // A delayed stop callback does not mean we captured its intervening gap.
        const endedAt=this.stoppedAt??this.clock.now();
        if(parts.length&&endedAt-began>=1000&&endedAt-began<=45_000){
          const kind=this.options.kind||'video';
          this.segments.push({blob:new Blob(parts,{type:kind+'/webm'}),startedAt:began,endedAt,
            hasAudio:this.options.hasAudio,sessionId:this.options.sessionId,kind});
        }
        parts=[];this.active=null;this.prune();
        for(const p of this.pending){this.clock.clear(p.timer);p.resolve(this.find(p.at));}
        this.pending.clear();this.record();
      };
      rec.start(1000);
      this.rotation=this.clock.set(()=>{
        if(this.closed||this.active!==rec)return;
        this.stoppedAt=this.clock.now();
        this.watchdog=this.clock.set(()=>this.fail(),4000);
        try{if(rec.state==='recording')rec.stop();}catch{this.fail();}
      },SEGMENT_MS);
    }catch{this.fail();}
  }
  takeAt(at:number):Promise<ClipSegment|null>{
    if(this.closed||!Number.isFinite(at)||at>this.clock.now())return Promise.resolve(null);
    const saved=this.find(at);if(saved)return Promise.resolve(saved);
    if(!this.active||at<this.startedAt||(this.stoppedAt!==null&&at>this.stoppedAt)||this.pending.size>=100)return Promise.resolve(null);
    // Several viewers can await the same full segment without forcing a stop.
    // This also preserves the reaction after a pick made near the segment start.
    return new Promise(resolve=>{
      const p={at,resolve,timer:this.clock.set(()=>{this.pending.delete(p);resolve(null);},SEGMENT_MS+4000)};
      this.pending.add(p);
    });
  }
  private fail(){if(this.closed)return;this.dispose();this.options.onFailure();}
  dispose(){
    if(this.closed)return;this.closed=true;
    this.clock.clear(this.rotation);this.clock.clear(this.watchdog);
    for(const p of this.pending){this.clock.clear(p.timer);p.resolve(null);}this.pending.clear();this.segments=[];
    const rec=this.active;this.active=null;
    if(rec){rec.ondataavailable=null;rec.onstop=null;rec.onerror=null;try{if(rec.state==='recording')rec.stop();}catch{}}
  }
}
