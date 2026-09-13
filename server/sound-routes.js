import express from 'express';
import {z} from 'zod';
const uuid=z.string().uuid();
export function soundRoutes(app,studio,worker){
  app.post('/api/sound/connect',async(req,res)=>{
    const {id}=z.object({id:uuid}).parse(req.body);
    const channel=studio.sound.start(id),controller=new AbortController();
    const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
    const signal=AbortSignal.any([controller.signal,channel.controller.signal,studio.controller.signal]);
    try{await worker.prepare(signal);signal.throwIfAborted();studio.publish();res.json({ok:true});}
    catch(error){studio.sound.stop(id);studio.publish();throw error;}
    finally{res.off('close',disconnect);}
  });
  app.delete('/api/sound/:id',(req,res)=>{studio.sound.stop(uuid.parse(req.params.id));studio.publish();res.json({ok:true});});
  app.post('/api/sound/:id',express.raw({type:['audio/webm','audio/mp4','audio/ogg','audio/wav'],limit:'2mb'}),async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const input=z.object({segmentId:uuid,startedAt:z.coerce.number().finite(),endedAt:z.coerce.number().finite()}).parse(req.query);
    if(!Buffer.isBuffer(req.body)||!req.body.length)throw Error('시스템 소리 데이터가 비어 있습니다.');
    const ticket=studio.sound.begin({id,...input}),controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,studio.sound.active.controller.signal,studio.controller.signal]);
    const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
    try{const result=await worker.analyze(req.body,signal);signal.throwIfAborted();const event=studio.sound.finish(ticket,result);if(!event)throw Error('만료된 소리 구간입니다.');res.json({ok:true});}
    finally{res.off('close',disconnect);studio.sound.release(ticket);studio.publish();}
  });
}
