import express from 'express';
import {z} from 'zod';

export function clipRecordingRoutes(app,{studio,clips,inspector,uploadTimeoutMs=30000}){
  let occupied=false;
  // Reserve before parsing the 20MB body. Retries cannot accumulate bodies or
  // decoder processes while the first upload is still being inspected.
  const reserve=(req,res,next)=>{
    if(occupied){res.set('Retry-After','1');return res.status(429).json({error:'이전 클립을 저장한 뒤 다시 시도하세요.'});}
    occupied=true;const controller=new AbortController();req.clipSignal=controller.signal;
    let released=false;
    const release=()=>{if(released)return;released=true;occupied=false;clearTimeout(timer);controller.abort();res.off('close',release);res.off('finish',release);};
    const timer=setTimeout(()=>{
      controller.abort();
      if(!res.headersSent){res.once('finish',()=>req.destroy());res.status(408).json({error:'클립 업로드 시간이 초과되었습니다.'});}
      else req.destroy();
    },uploadTimeoutMs);
    res.once('close',release);res.once('finish',release);next();
  };
  const bodyFailure=(error,req,res,next)=>{if(req.clipSignal?.aborted&&(res.headersSent||res.destroyed))return;next(error);};
  for(const kind of ['video','audio','voice'])app.post(`/api/clips/:id/${kind}`,reserve,express.raw({type:(kind==='voice'?'audio':kind)+'/webm',limit:'20mb'}),bodyFailure,async(req,res)=>{
    const metadata=z.object({startedAt:z.coerce.number(),endedAt:z.coerce.number(),hasAudio:z.enum(['true','false']).transform(v=>v==='true'),audioLayout:z.enum(['mixed','separate','microphone-only']).default('mixed')}).parse(req.query);
    const id=z.string().uuid().parse(req.params.id),epoch=studio.epoch;
    const authorized=()=>{
      const c=clips.get(id);
      if(epoch!==studio.epoch||!studio.running||!studio.settings.clipBufferEnabled||!studio.settings.autoHighlights||!c.creator||c.source!=='spectator'||(kind==='audio'&&!c.audioEligible)||c.sessionId!==studio.sessionId||metadata.startedAt>c.observedAt||metadata.endedAt<c.observedAt||Math.abs(clips.now()-metadata.endedAt)>120000)throw Error('관객이 선택한 순간이 허용된 클립 버퍼 안에 있어야 합니다.');
      if(kind==='voice'){if(c.voice||!(c.video||c.audio)||c.audioLayout!=='separate')throw Error('분리된 마이크를 연결할 클립을 확인하세요.');}
      else if(c.video||c.audio)throw Error('이미 미디어가 연결된 클립입니다.');
    };
    authorized();
    const controller=new AbortController();const abort=()=>controller.abort();
    const onState=()=>{try{authorized();}catch{abort();}};
    req.clipSignal.addEventListener('abort',abort,{once:true});studio.on('state',onState);
    try{
      if(req.clipSignal.aborted)abort();
      await inspector.inspect(req.body,{...metadata,kind:kind==='voice'?'audio':kind},controller.signal);
      // No await between the final authorization and atomic file/metadata save.
      // Deletion, stop/restart, consent withdrawal and disconnected clients win.
      if(controller.signal.aborted)throw Error('클립 저장이 취소되었습니다.');
      authorized();const clip=clips.recording(id,req.body,{...metadata,kind});studio.publish();res.json(clip);
    }catch(error){
      const status={'clip-invalid':422,'clip-busy':429,'clip-unavailable':503,'clip-timeout':504}[error.code];
      if(status&&!res.headersSent&&!res.destroyed){if(status===429)res.set('Retry-After','1');res.status(status).json({error:error.message});}
      else if(!res.headersSent&&!res.destroyed)throw error;
    }finally{req.clipSignal.removeEventListener('abort',abort);studio.off('state',onState);}
  });
}
