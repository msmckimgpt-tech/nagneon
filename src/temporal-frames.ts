import {VIDEO_WINDOW_MS,VIDEO_MAX_FRAMES,VIDEO_FRAME_CHARS,VIDEO_FRESH_MS} from '../shared/temporal-policy.js';

export type VideoFrame={image:string;at:number;still?:{since:number;samples:number}};
type Sample=VideoFrame&{change:number};
export type VideoWindow={sessionId:string;sourceId:string;frames:VideoFrame[]};

// Capture continues while inference is busy. Keep raw samples only in memory;
// acknowledge only delivered windows so an aborted request does not lose action.
export class TemporalFrames {
  samples:Sample[]=[];
  through=0;
  sourceId='';
  sessionId='';
  reset(sessionId='',sourceId=''){this.samples=[];this.through=0;this.sessionId=sessionId;this.sourceId=sourceId;}
  add(image:string,at:number,change=0){
    if(!image||image.length>VIDEO_FRAME_CHARS||!Number.isFinite(at)||at<=(this.samples.at(-1)?.at??-1))return;
    this.samples.push({image,at,change:Math.max(0,Math.min(1,change))});
    let bytes=this.samples.reduce((n,f)=>n+f.image.length,0);
    while(this.samples.length>33||this.samples[0].at<at-VIDEO_WINDOW_MS||bytes>6_400_000)bytes-=this.samples.shift()!.image.length;
  }
  window(now:number):VideoWindow|undefined{
    const fresh=this.samples.filter(f=>f.at>=now-VIDEO_WINDOW_MS&&f.at<=now);
    if(!fresh.length||now-fresh.at(-1)!.at>VIDEO_FRESH_MS)return;
    const anchor=fresh.reduce((last,f,i)=>f.at<=this.through?i:last,-1);
    let runStart=0;
    const pending=fresh.slice(Math.max(0,anchor)).map((f,i,all)=>{
      if(i===0||f.image!==all[i-1].image)runStart=i;
      return {...f,...(i>runStart?{still:{since:all[runStart].at,samples:i-runStart+1}}:{})};
    });
    const frames=pending.filter((f,i)=>i===0||i===pending.length-1||f.image!==pending[i-1].image||f.image!==pending[i+1].image);
    const selected=new Set([0,frames.length-1]);
    // Reserve two transition pairs, then fill the largest time gaps. Endpoints
    // alone miss a short jump/failure that returns to the original pose.
    const changes=frames.map((f,i)=>({i,change:f.change})).filter(f=>f.i>0&&f.change>.002).sort((a,b)=>b.change-a.change||a.i-b.i);
    for(const {i} of changes){if(selected.size>=4)break;selected.add(i-1);selected.add(i);}
    while(selected.size<Math.min(VIDEO_MAX_FRAMES,frames.length)){
      let best=-1,distance=-1;
      for(let i=0;i<frames.length;i++){if(selected.has(i))continue;const gap=Math.min(...[...selected].map(j=>Math.abs(frames[j].at-frames[i].at)));if(gap>distance){distance=gap;best=i;}}
      if(best<0)break;selected.add(best);
    }
    return {sessionId:this.sessionId,sourceId:this.sourceId,frames:[...selected].sort((a,b)=>a-b).map(i=>({image:frames[i].image,at:frames[i].at,...(frames[i].still?{still:frames[i].still}:{})}))};
  }
  acknowledge(window:VideoWindow){if(window.sessionId===this.sessionId&&window.sourceId===this.sourceId)this.through=Math.max(this.through,window.frames.at(-1)?.at??0);}
  // Freeze evidence before recognition, regardless of the live viewing cursor.
  speechWindow(startedAt:number,endedAt:number):VideoWindow|undefined{
    if(!this.sessionId||!this.sourceId)return;
    const frames=this.samples.filter(f=>f.at>=startedAt-500&&f.at<=endedAt);
    if(!frames.length||endedAt-frames.at(-1)!.at>1000)return;
    const indices=[...new Set([0,Math.floor((frames.length-1)/2),frames.length-1])];
    return {sessionId:this.sessionId,sourceId:this.sourceId,frames:indices.map(i=>({image:frames[i].image,at:frames[i].at}))};
  }
}

// Pixel distance selects visual changes, never semantic events or emotions.
export function pixelChange(before:Uint8ClampedArray|undefined,after:Uint8ClampedArray){
  if(!before||before.length!==after.length)return 0;
  let sum=0;for(let i=0;i<after.length;i++)if(i%4!==3)sum+=Math.abs(after[i]-before[i]);
  return sum/(after.length/4*3*255);
}
