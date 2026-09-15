import {spawn} from 'node:child_process';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {z} from 'zod';
import {ClipAudioReading,ClipSoundClass,clipMediaIdentity} from './clip-media-context.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),digest=b=>createHash('sha256').update(b).digest('hex');
const error=text=>new Error('클립 감상: '+text),MAX_BYTES=20*1024*1024;
const time=z.number().finite().min(0).max(46000);
const decoded=z.object({ok:z.literal(true),sources:z.array(z.object({role:z.enum(['base','voice']),durationMs:time.positive(),frames:z.array(z.object({offsetMs:time,image:z.string().max(320030).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)}).strict()).max(12),audioStartMs:z.number().min(-100).max(2000),audio:z.object({durationMs:time.positive(),silent:z.boolean(),volumeDb:z.number().min(-160).max(20),balance:z.number().min(-1).max(1).optional(),classes:z.array(ClipSoundClass).max(8),transcript:z.string().max(3000),language:z.string().max(20).optional(),cues:z.object({delivery:z.string().max(200)}).nullable()}).optional()}).strict()).min(1).max(2)}).strict();

export class ClipPerception {
  constructor(runtime={},launch=spawn){this.runtime=runtime;this.launch=launch;this.active=null;this.closed=false;}
  async bytes(path){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1||stat.size<100||stat.size>MAX_BYTES||resolve(await realpath(path))!==resolve(path))throw error('저장 파일의 경로와 크기를 확인하세요.');const bytes=await readFile(path);if(bytes.length!==stat.size)throw error('읽는 동안 파일이 바뀌었습니다.');return bytes;}
  async sources(clips,c,signal){
    const sources=[];
    for(const role of c.voice?['base','voice']:['base']){
      if(signal.aborted)throw error('감상을 취소했습니다.');
      const voice=role==='voice',kind=voice||c.audio?'audio':'video',prefix=voice?'voice':kind;
      const startedAt=c[prefix+'StartedAt'],endedAt=c[prefix+'EndedAt'];if(!Number.isFinite(startedAt)||!Number.isFinite(endedAt)||endedAt<=startedAt||endedAt-startedAt>45000)throw error('녹화 시각을 확인하세요.');
      const bytes=await this.bytes(clips.file(c.id,voice?'voice.webm':'webm'));
      sources.push({role,kind,startedAt,endedAt,durationMs:endedAt-startedAt,hasAudio:voice||!!c.hasAudio,audioSource:voice||c.audioLayout==='microphone-only'?'microphone':c.audioLayout==='separate'?'system-output':'mixed-audio',focusMs:Number.isFinite(c.observedAt)?Math.max(0,Math.min(endedAt-startedAt,c.observedAt-startedAt)):undefined,hash:digest(bytes),data:bytes.toString('base64')});
    }
    return sources;
  }
  read(clips,clip,signal){
    if(!clip.video&&!clip.audio)return Promise.resolve(null);
    if(this.closed||signal.aborted)return Promise.reject(error('감상을 취소했습니다.'));
    if(this.active)return Promise.reject(error('이전 감상을 마무리하고 있습니다.'));
    const controller=new AbortController(),operation={controller,promise:null};this.active=operation;
    const combined=AbortSignal.any([signal,controller.signal]);
    operation.promise=(async()=>{
      if(this.runtime.clipPerception?.prepare)await this.runtime.clipPerception.prepare(combined);
      const sources=await this.sources(clips,clip,combined),identity=clipMediaIdentity(clip);
      const result=await this.run({sources},combined);
      const frames=[],audio=[];
      for(const [i,part] of result.sources.entries()){
        const source=sources[i];if(part.role!==source.role||!!part.audio!==source.hasAudio||(source.kind==='video')!==!!part.frames.length)throw error('분석 결과의 소스가 일치하지 않습니다.');
        if(part.frames.some((f,j)=>f.offsetMs>part.durationMs||j>0&&f.offsetMs<=part.frames[j-1].offsetMs))throw error('장면 순서가 올바르지 않습니다.');
        for(const f of part.frames)frames.push({image:f.image,at:source.startedAt+f.offsetMs});
        if(part.audio){const {durationMs,cues,...heard}=part.audio;audio.push(ClipAudioReading.parse({...heard,source:source.audioSource,startedAt:source.startedAt+Math.max(0,part.audioStartMs),endedAt:source.startedAt+Math.max(0,part.audioStartMs)+durationMs,...(cues?{delivery:cues.delivery}:{})}));}
      }
      if(result.sources.length!==sources.length)throw error('분석 결과에 빠진 소스가 있습니다.');
      const hashes=sources.map(({role,hash})=>({role,hash})),signature=digest(JSON.stringify({identity,hashes}));
      return {frames,context:{source:'stored-clip',sampled:true,frameTimes:frames.map(f=>f.at),audio},signature,identity,hashes};
    })().finally(()=>{if(this.active===operation)this.active=null;});
    return operation.promise;
  }
  async assertCurrent(clips,id,reading,signal){
    const c=clips.get(id);if(JSON.stringify(clipMediaIdentity(c))!==JSON.stringify(reading.identity))throw error('감상 중 녹화가 바뀌었습니다.');
    const sources=await this.sources(clips,c,signal);if(digest(JSON.stringify({identity:clipMediaIdentity(c),hashes:sources.map(({role,hash})=>({role,hash}))}))!==reading.signature)throw error('감상 중 파일이 바뀌었습니다.');
    if(signal.aborted)throw error('감상을 취소했습니다.');
  }
  run(input,signal){
    const python=this.runtime.clips?.python||process.env.BACKSEAT_PYTHON||resolve(root,'.venv/Scripts/python.exe');
    const worker=this.runtime.clipPerception?.worker||resolve(root,'scripts/clip_perception.py');
    if(signal.aborted)return Promise.reject(error('감상을 취소했습니다.'));
    if(!existsSync(python)||!existsSync(worker))return Promise.reject(error('로컬 감상 실행 파일이 없습니다.'));
    return new Promise((yes,no)=>{
      let child;try{child=this.launch(python,['-X','utf8','-B',worker,'--sound-model',this.runtime.sound?.model||resolve(root,'.models/sound-yamnet'),'--speech-model',this.runtime.speech?.model||resolve(root,'.models/microphone')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1',OMP_NUM_THREADS:'2'}});}catch{return no(error('감상 프로세스를 시작하지 못했습니다.'));}
      const utf8=new StringDecoder('utf8');let output='',bytes=0,failure=null;const cancel=message=>{failure ||= error(message);child.stdin.destroy();child.kill();};const abort=()=>cancel('감상을 취소했습니다.');
      const timer=setTimeout(()=>cancel('감상 제한 시간이 초과됐습니다.'),this.runtime.clipPerception?.timeoutMs||75000);signal.addEventListener('abort',abort,{once:true});
      child.on('error',()=>{failure ||= error('감상 프로세스 오류입니다.');});child.stdin.on('error',()=>{failure ||= error('감상 파일을 전달하지 못했습니다.');});
      child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024)cancel('감상 결과가 너무 큽니다.');else output+=utf8.write(chunk);});child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024)cancel('감상 결과가 너무 큽니다.');});
      child.once('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',abort);if(failure)return no(failure);try{if(code!==0)throw error('저장 파일을 읽거나 로컬 모델을 실행하지 못했습니다.');yes(decoded.parse(JSON.parse(output+utf8.end())));}catch{no(error('저장 파일을 읽거나 감상 결과를 확인하지 못했습니다.'));}});
      if(signal.aborted)abort();else child.stdin.end(JSON.stringify(input));
    });
  }
  close(){this.closed=true;const operation=this.active;operation?.controller.abort();return operation?.promise.then(()=>{},()=>{})||Promise.resolve();}
}
