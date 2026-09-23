import {TemporalFrames,pixelChange} from './temporal-frames.ts';
import {VIDEO_SAMPLE_MS,VIDEO_FRAME_CHARS} from '../shared/temporal-policy.js';

function jpegDataURL(canvas:HTMLCanvasElement,quality:number):Promise<string>{
  return new Promise((resolve,reject)=>{
    canvas.toBlob(blob=>{
      if(!blob){reject(Error('화면 이미지를 변환하지 못했습니다.'));return;}
      const reader=new FileReader();
      reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(Error('화면 이미지를 읽지 못했습니다.'));
      reader.onerror=()=>reject(reader.error??Error('화면 이미지를 읽지 못했습니다.'));
      reader.onabort=()=>reject(Error('화면 이미지 읽기가 취소되었습니다.'));
      reader.readAsDataURL(blob);
    },'image/jpeg',quality);
  });
}

export function startTemporalCapture(video:HTMLVideoElement,buffer:TemporalFrames,onError:(e:unknown)=>void,{
  now=Date.now,canvas=()=>document.createElement('canvas'),schedule=(fn:()=>void)=>setInterval(fn,VIDEO_SAMPLE_MS),
  cancel=(id:ReturnType<typeof setInterval>)=>clearInterval(id),encode=jpegDataURL
}={}){
  const full=canvas(),tiny=canvas();tiny.width=32;tiny.height=18;
  const ctx=full.getContext('2d'),probe=tiny.getContext('2d',{willReadFrequently:true});
  const sessionId=buffer.sessionId,sourceId=buffer.sourceId;
  let lastMediaTime=-1,previous:Uint8ClampedArray|undefined,stopped=false,busy=false;
  let reduced:HTMLCanvasElement|undefined;
  const ownsBuffer=()=>buffer.sessionId===sessionId&&buffer.sourceId===sourceId;
  const active=()=>!stopped&&ownsBuffer();
  const release=()=>{
    full.width=full.height=tiny.width=tiny.height=0;
    if(reduced)reduced.width=reduced.height=0;
    previous=undefined;
  };
  const sample=async()=>{
    if(!active()||busy||video.readyState<2||!video.videoWidth||!video.videoHeight||video.paused||video.ended||video.currentTime===lastMediaTime)return;
    busy=true;
    try{
      if(!ctx||!probe)throw Error('연속 화면을 준비하지 못했습니다.');
      lastMediaTime=video.currentTime;
      const capturedAt=now();
      const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
      full.width=Math.max(1,Math.round(video.videoWidth*scale));full.height=Math.max(1,Math.round(video.videoHeight*scale));
      ctx.drawImage(video,0,0,full.width,full.height);
      probe.drawImage(full,0,0,32,18);const pixels=probe.getImageData(0,0,32,18).data;
      const change=pixelChange(previous,pixels);previous=pixels;
      let image=await encode(full,.6);
      if(!active())return;
      if(image.length>VIDEO_FRAME_CHARS){image=await encode(full,.35);if(!active())return;}
      if(image.length>VIDEO_FRAME_CHARS){
        // Preserve the captured frame: the live video may advance while encoding.
        reduced??=canvas();reduced.width=Math.max(1,Math.floor(full.width*.65));reduced.height=Math.max(1,Math.floor(full.height*.65));
        const reducedCtx=reduced.getContext('2d');if(!reducedCtx)throw Error('화면 이미지를 줄이지 못했습니다.');
        reducedCtx.drawImage(full,0,0,reduced.width,reduced.height);
        image=await encode(reduced,.35);if(!active())return;
      }
      buffer.add(image,capturedAt,change);
    }catch(error){
      if(!active())return;
      stopped=true;cancel(timer);release();
      try{onError(error);}finally{if(ownsBuffer())buffer.reset();}
    }finally{busy=false;}
  };
  const timer=schedule(()=>{void sample();});void sample();
  return ()=>{stopped=true;cancel(timer);release();};
}
