import {useEffect,useRef,useState} from 'react';
import {mixClipAudio} from './clip-audio';
type Segment={blob:Blob;startedAt:number;endedAt:number;hasAudio:boolean;sessionId:string};
export function useClipBuffer(screen:MediaStream|null,mic:MediaStream|null,enabled:boolean,sessionId:string|null,system:MediaStream|null=null){
  const latest=useRef<Segment|null>(null),active=useRef<MediaRecorder|null>(null),resolveTake=useRef<((value:Segment|null)=>void)|null>(null),started=useRef(0);
  const [buffering,setBuffering]=useState(false);
  useEffect(()=>{
    latest.current=null;
    if(!enabled||!screen||!sessionId){setBuffering(false);return;}
    if(!MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus'))return;
    const mixed=mixClipAudio([system,mic].filter((s):s is MediaStream=>!!s));const stream=new MediaStream([...screen.getVideoTracks().map(t=>t.clone()),...mixed.tracks]);let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
    const segment=()=>{
      if(disposed)return;const parts:BlobPart[]=[];const rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:900000,audioBitsPerSecond:64000});active.current=rec;const began=Date.now();started.current=began;
      rec.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
      rec.onstop=()=>{clearTimeout(timer);if(disposed)return;const endedAt=Date.now();const value=parts.length&&endedAt-began>=1000?{blob:new Blob(parts,{type:'video/webm'}),startedAt:began,endedAt,hasAudio:mixed.tracks.length>0,sessionId}:null;
        if(value)latest.current=value;resolveTake.current?.(value||latest.current);resolveTake.current=null;if(!disposed)segment();};
      rec.onerror=()=>{disposed=true;clearTimeout(timer);setBuffering(false);resolveTake.current?.(null);resolveTake.current=null;active.current=null;stream.getTracks().forEach(t=>t.stop());mixed.close();};
      rec.start(1000);setBuffering(true);timer=setTimeout(()=>{if(rec.state==='recording')rec.stop();},15000);
    };
    try{segment();}catch{stream.getTracks().forEach(t=>t.stop());mixed.close();setBuffering(false);}
    return()=>{disposed=true;clearTimeout(timer);resolveTake.current?.(null);resolveTake.current=null;if(active.current?.state==='recording')active.current.stop();active.current=null;stream.getTracks().forEach(t=>t.stop());mixed.close();setBuffering(false);};
  },[screen,mic,enabled,sessionId,system]);
  async function take():Promise<Segment|null>{
    if(resolveTake.current)throw new Error('이전 클립을 저장하고 있습니다.');
    if(active.current?.state==='recording'&&Date.now()-started.current>=1000)return new Promise(resolve=>{const done=(value:Segment|null)=>{clearTimeout(timeout);if(resolveTake.current===done)resolveTake.current=null;resolve(value);};const timeout=setTimeout(()=>done(null),4000);resolveTake.current=done;try{active.current!.stop();}catch{done(null);}});
    return latest.current?.sessionId===sessionId&&Date.now()-latest.current.endedAt<120000?latest.current:null;
  }
  return {buffering,take};
}
