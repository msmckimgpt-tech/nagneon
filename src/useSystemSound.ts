import {useEffect,useRef,useState} from 'react';
import {SpeechQueue} from './speech-flow';
type Chunk={blob:Blob;segmentId:string;startedAt:number;endedAt:number};
export function useSystemSound(stream:MediaStream|null,sessionId:string|null,onError:(message:string)=>void){
  const [status,setStatus]=useState('꺼짐'),[level,setLevel]=useState(0);
  const error=useRef(onError);error.current=onError;
  useEffect(()=>{
    if(!stream||!sessionId){setStatus(stream?'방송 시작 대기':'꺼짐');setLevel(0);return;}
    const id=crypto.randomUUID(),controller=new AbortController();let disposed=false;
    let recorder:MediaRecorder|null=null,context:AudioContext|null=null,timer:ReturnType<typeof setTimeout>|undefined,meter:ReturnType<typeof setInterval>|undefined;
    const mime='audio/webm;codecs=opus';
    const queue=new SpeechQueue<Chunk,unknown>({execute:async(chunk,signal)=>{
      const params=new URLSearchParams({segmentId:chunk.segmentId,startedAt:String(chunk.startedAt),endedAt:String(chunk.endedAt)});
      const res=await fetch(`/api/sound/${id}?${params}`,{method:'POST',headers:{'Content-Type':mime,'X-Backseat-Client':'studio'},body:chunk.blob,signal});
      const value=await res.json();if(!res.ok)throw Error(value.error);return value;
    },onResult:()=>{if(!disposed)setStatus('듣는 중');},onError:e=>fail(e)});
    const disconnect=()=>{void fetch(`/api/sound/${id}`,{method:'DELETE',headers:{'X-Backseat-Client':'studio'},keepalive:true}).catch(()=>{});};
    function dispose(){if(disposed)return;disposed=true;controller.abort();queue.reset();clearTimeout(timer);clearInterval(meter);if(recorder?.state==='recording')recorder.stop();void context?.close();disconnect();}
    function fail(e:unknown){if(disposed)return;dispose();setStatus('연결 오류');setLevel(0);error.current(e instanceof Error?e.message:'시스템 소리를 연결하지 못했습니다.');}
    const start=async()=>{
      setStatus('소리 모델 준비 중');
      const res=await fetch('/api/sound/connect',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({id}),signal:controller.signal});
      const value=await res.json();if(!res.ok)throw Error(value.error);if(disposed)return;
      const soundOnly=new MediaStream(stream!.getAudioTracks());if(!soundOnly.getTracks().length)throw Error('시스템 출력 소리 트랙을 받지 못했습니다.');
      context=new AudioContext();await context.resume();if(disposed)return;
      const analyser=context.createAnalyser();analyser.fftSize=512;context.createMediaStreamSource(soundOnly).connect(analyser);
      const samples=new Float32Array(512);meter=setInterval(()=>{analyser.getFloatTimeDomainData(samples);setLevel(Math.min(1,Math.sqrt(samples.reduce((a,b)=>a+b*b,0)/samples.length)*5));},100);
      const segment=()=>{
        if(disposed)return;const parts:BlobPart[]=[],startedAt=Date.now();
        const rec=new MediaRecorder(soundOnly,{mimeType:mime,audioBitsPerSecond:96000});recorder=rec;
        rec.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
        rec.onstop=()=>{clearTimeout(timer);if(disposed)return;const endedAt=Date.now();segment();
          if(!parts.length||endedAt-startedAt>9000)return;
          // Sound events expire quickly. Bound latency by replacing older queued
          // ambience, while the independent microphone queue preserves speech.
          if(queue.pending.length>=2)queue.pending.shift();
          queue.enqueue({blob:new Blob(parts,{type:mime}),startedAt,endedAt,segmentId:crypto.randomUUID()});
        };
        rec.onerror=()=>fail(Error('시스템 소리 녹음을 이어갈 수 없습니다. 다시 연결해주세요.'));
        rec.start();timer=setTimeout(()=>{if(rec.state==='recording')rec.stop();},4000);
      };segment();setStatus('듣는 중');
    };
    void start().catch(fail);return dispose;
  },[stream,sessionId]);
  return {status,level};
}
