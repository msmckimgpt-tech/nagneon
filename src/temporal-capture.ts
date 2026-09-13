import {TemporalFrames,pixelChange} from './temporal-frames.ts';
import {VIDEO_SAMPLE_MS,VIDEO_FRAME_CHARS} from '../shared/temporal-policy.js';

export function startTemporalCapture(video:HTMLVideoElement,buffer:TemporalFrames,onError:(e:unknown)=>void,{
  now=Date.now,canvas=()=>document.createElement('canvas'),schedule=(fn:()=>void)=>setInterval(fn,VIDEO_SAMPLE_MS),cancel=(id:ReturnType<typeof setInterval>)=>clearInterval(id)
}={}){
  const full=canvas(),tiny=canvas();tiny.width=32;tiny.height=18;
  const ctx=full.getContext('2d'),probe=tiny.getContext('2d',{willReadFrequently:true});
  const sessionId=buffer.sessionId,sourceId=buffer.sourceId;
  let lastMediaTime=-1,previous:Uint8ClampedArray|undefined,stopped=false;
  const sample=()=>{
    if(stopped||buffer.sessionId!==sessionId||buffer.sourceId!==sourceId||video.readyState<2||!video.videoWidth||!video.videoHeight||video.paused||video.ended||video.currentTime===lastMediaTime)return;
    try{
      if(!ctx||!probe)throw Error('연속 화면을 준비하지 못했습니다.');
      lastMediaTime=video.currentTime;
      const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
      full.width=Math.max(1,Math.round(video.videoWidth*scale));full.height=Math.max(1,Math.round(video.videoHeight*scale));
      ctx.drawImage(video,0,0,full.width,full.height);
      probe.drawImage(full,0,0,32,18);const pixels=probe.getImageData(0,0,32,18).data;
      const change=pixelChange(previous,pixels);previous=pixels;
      let image=full.toDataURL('image/jpeg',.6);
      if(image.length>VIDEO_FRAME_CHARS)image=full.toDataURL('image/jpeg',.35);
      if(image.length>VIDEO_FRAME_CHARS){full.width=Math.max(1,Math.floor(full.width*.65));full.height=Math.max(1,Math.floor(full.height*.65));ctx.drawImage(video,0,0,full.width,full.height);image=full.toDataURL('image/jpeg',.35);}
      buffer.add(image,now(),change);
    }catch(error){stopped=true;try{onError(error);}finally{buffer.reset();}}
  };
  sample();const timer=schedule(sample);
  return ()=>{stopped=true;cancel(timer);full.width=full.height=tiny.width=tiny.height=0;previous=undefined;};
}
