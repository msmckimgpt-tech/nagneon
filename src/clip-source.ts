import {mixClipAudio} from './clip-audio.ts';

// `screen` is the explicitly shared picture. A system-audio source can also
// carry a video track, but that track is never consulted or cloned here.
export function createClipSource(screen:MediaStream|null,mic:MediaStream|null,system:MediaStream|null,
  {supported=(mime:string)=>MediaRecorder.isTypeSupported(mime),mix=mixClipAudio,makeStream=(tracks:MediaStreamTrack[])=>new MediaStream(tracks)}={}){
  const video=screen?.getVideoTracks().filter(t=>t.readyState==='live')||[];
  const sources=[system,mic].filter((s):s is MediaStream=>!!s&&s.getAudioTracks().some(t=>t.readyState==='live'));
  if(!video.length&&!sources.length)return null;
  const kind:'video'|'audio'=video.length?'video':'audio';
  const mimeType=kind==='video'?'video/webm;codecs=vp8,opus':'audio/webm;codecs=opus';
  if(!supported(mimeType))return null;
  const owned:MediaStreamTrack[]=[];let mixed:ReturnType<typeof mixClipAudio>|null=null,closed=false;
  const close=()=>{if(closed)return;closed=true;owned.forEach(t=>t.stop());mixed?.close();};
  try{
    mixed=mix(sources);
    for(const track of video)owned.push(track.clone());
    const stream=makeStream([...owned,...mixed.tracks]);
    return {stream,kind,hasAudio:mixed.tracks.length>0,mimeType,close,
      recorderOptions:{mimeType,...(kind==='video'?{videoBitsPerSecond:900000}:{}),audioBitsPerSecond:64000}};
  }catch(error){close();throw error;}
}
