// MediaRecorder has inconsistent support for multiple audio tracks. Mix into
// one track without connecting anything to the speakers (no playback echo).
export function mixClipAudio(sources:MediaStream[]){
  const tracks=sources.flatMap(s=>s.getAudioTracks()).filter(t=>t.readyState==='live');
  if(!tracks.length)return {tracks:[] as MediaStreamTrack[],close:()=>{}};
  const context=new AudioContext(),destination=context.createMediaStreamDestination();
  const clones=tracks.map(t=>t.clone());
  for(const track of clones){const gain=context.createGain();gain.gain.value=1/Math.max(1,tracks.length);context.createMediaStreamSource(new MediaStream([track])).connect(gain).connect(destination);}
  void context.resume();
  return {tracks:destination.stream.getAudioTracks(),close:()=>{clones.forEach(t=>t.stop());destination.stream.getTracks().forEach(t=>t.stop());void context.close();}};
}
