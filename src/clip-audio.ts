// Mix only the supplied audio tracks, without a connection to the speakers.
export function mixClipAudio(sources:MediaStream[]){
  const tracks=[...new Set(sources.flatMap(s=>s.getAudioTracks()))].filter(t=>t.readyState==='live');
  if(!tracks.length)return {tracks:[] as MediaStreamTrack[],close:()=>{}};
  const context=new AudioContext(),clones:MediaStreamTrack[]=[];
  let destination:MediaStreamAudioDestinationNode|undefined,closed=false;
  const close=()=>{if(closed)return;closed=true;clones.forEach(t=>t.stop());destination?.stream.getTracks().forEach(t=>t.stop());void context.close().catch(()=>{});};
  try{
    destination=context.createMediaStreamDestination();
    for(const track of tracks){
      const clone=track.clone();clones.push(clone);
      const gain=context.createGain();gain.gain.value=1/tracks.length;
      context.createMediaStreamSource(new MediaStream([clone])).connect(gain).connect(destination);
    }
    void context.resume().catch(close);
    return {tracks:destination.stream.getAudioTracks(),close};
  }catch(error){close();throw error;}
}
