import {useEffect,useRef,useState} from 'react';
import {mixClipAudio} from './clip-audio';
import {ClipBuffer} from './clip-buffer';

export function useClipBuffer(screen:MediaStream|null,mic:MediaStream|null,enabled:boolean,sessionId:string|null,system:MediaStream|null=null){
  const current=useRef<ClipBuffer|null>(null);
  const [buffering,setBuffering]=useState(false);
  useEffect(()=>{
    setBuffering(false);
    if(!enabled||!screen||!sessionId||!screen.getVideoTracks().some(t=>t.readyState==='live'))return;
    if(!MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus'))return;
    let release=()=>{};
    try{
      const mixed=mixClipAudio([system,mic].filter((s):s is MediaStream=>!!s));
      release=()=>mixed.close();
      const stream=new MediaStream([...screen.getVideoTracks().map(t=>t.clone()),...mixed.tracks]);
      let released=false;
      release=()=>{if(released)return;released=true;stream.getTracks().forEach(t=>t.stop());mixed.close();};
      const buffer=new ClipBuffer({sessionId,hasAudio:mixed.tracks.length>0,
        create:()=>new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:900000,audioBitsPerSecond:64000}),
        onFailure:()=>{release();setBuffering(false);}});
      current.current=buffer;setBuffering(true);buffer.start();
      return()=>{buffer.dispose();if(current.current===buffer)current.current=null;release();setBuffering(false);};
    }catch{release();setBuffering(false);}
  },[screen,mic,enabled,sessionId,system]);
  return {buffering,takeAt:(at:number)=>current.current?.takeAt(at)||Promise.resolve(null)};
}
