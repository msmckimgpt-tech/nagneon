import {useEffect,useRef,useState} from 'react';
import {createClipSource} from './clip-source';
import {ClipBuffer} from './clip-buffer';

export function useClipBuffer(screen:MediaStream|null,mic:MediaStream|null,enabled:boolean,sessionId:string|null,system:MediaStream|null=null){
  const current=useRef<ClipBuffer|null>(null);
  const [buffering,setBuffering]=useState(false);
  useEffect(()=>{
    setBuffering(false);
    if(!enabled||!sessionId)return;
    let release=()=>{};
    try{
      const source=createClipSource(screen,mic,system);if(!source)return;
      release=source.close;
      const buffer=new ClipBuffer({sessionId,hasAudio:source.hasAudio,kind:source.kind,
        create:()=>new MediaRecorder(source.stream,source.recorderOptions),
        onFailure:()=>{release();setBuffering(false);}});
      current.current=buffer;setBuffering(true);buffer.start();
      return()=>{buffer.dispose();if(current.current===buffer)current.current=null;release();setBuffering(false);};
    }catch{release();setBuffering(false);}
  },[screen,mic,enabled,sessionId,system]);
  return {buffering,takeAt:(at:number)=>current.current?.takeAt(at)||Promise.resolve(null)};
}
