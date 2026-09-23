import {mixClipAudio} from './clip-audio.ts';

const hasAudio=(source:MediaStream|null)=>!!source?.getAudioTracks().some(t=>t.readyState==='live');
// Prefer a supplied system source; otherwise use audio explicitly shared with
// the picture. Never mix two captures of the same Windows output.
const systemAudio=(screen:MediaStream|null,system:MediaStream|null)=>hasAudio(system)?system:hasAudio(screen)?screen:null;

// Record the microphone independently when there is a picture or system sound.
// Already mixed legacy recordings cannot be separated by a playback switch.
export function createSeparatedClipSources(screen:MediaStream|null,mic:MediaStream|null,system:MediaStream|null,create=createClipSource){
  const hasMic=!!mic?.getAudioTracks().some(t=>t.readyState==='live');
  const other=!!screen?.getVideoTracks().some(t=>t.readyState==='live')||!!systemAudio(screen,system);
  const base=create(screen,other?null:mic,system);if(!base)return null;
  let voice:ReturnType<typeof createClipSource>=null;
  try{if(other&&hasMic){voice=create(null,mic,null);if(!voice)throw Error('마이크 클립을 분리해 녹음할 수 없습니다.');}
    return {base,voice,audioLayout:(voice?'separate':!other&&hasMic?'microphone-only':'separate') as 'separate'|'microphone-only',close:()=>{base.close();voice?.close();}};
  }catch(error){base.close();voice?.close();throw error;}
}

// `screen` is the explicitly shared picture. A system-audio source can also
// carry a video track, but that track is never consulted or cloned here.
export function createClipSource(screen:MediaStream|null,mic:MediaStream|null,system:MediaStream|null,
  {supported=(mime:string)=>MediaRecorder.isTypeSupported(mime),mix=mixClipAudio,makeStream=(tracks:MediaStreamTrack[])=>new MediaStream(tracks)}={}){
  const video=screen?.getVideoTracks().filter(t=>t.readyState==='live')||[];
  const sources=[systemAudio(screen,system),mic].filter((s):s is MediaStream=>!!s&&s.getAudioTracks().some(t=>t.readyState==='live'));
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
