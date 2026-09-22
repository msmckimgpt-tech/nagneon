import test from 'node:test';
import assert from 'node:assert/strict';
import {startMicrophoneRecorder} from '../src/microphone-recorder.ts';

function makeClock(){
  let now=0,serial=0;const tasks=new Map(),cancelled=new Set();
  const schedule=(fn,ms,interval)=>{const id=++serial;tasks.set(id,{fn,at:now+ms,ms,interval});return id;};
  const clear=id=>{tasks.delete(id);cancelled.add(id);};
  const advance=ms=>{
    const target=now+ms;
    while(true){
      let selected=null;
      for(const [id,task] of tasks){if(task.at<=target&&(!selected||task.at<selected.task.at||(task.at===selected.task.at&&id<selected.id)))selected={id,task};}
      if(!selected)break;
      const {id,task}=selected;tasks.delete(id);now=task.at;task.fn();
      if(task.interval&&!cancelled.has(id))tasks.set(id,{...task,at:now+task.ms});
    }
    now=target;
  };
  return {now:()=>now,wallNow:()=>1_000_000+now,setTimeout:(fn,ms)=>schedule(fn,ms,false),clearTimeout:clear,setInterval:(fn,ms)=>schedule(fn,ms,true),clearInterval:clear,advance,pending:()=>tasks.size};
}

function analyser(value=.08){return {fftSize:8,getFloatTimeDomainData(samples){samples.fill(value);}};}

function recorder(instances,{emitStop=true,emitData=false,failStart=false}={}){
  const rec={state:'inactive',ondataavailable:null,onstop:null,onerror:null,stopCalls:0,
    start(){if(failStart)throw new Error('start failed');this.state='recording';},
    stop(){this.stopCalls++;this.state='inactive';if(emitData)this.ondataavailable?.({data:new Blob(['voice'])});if(emitStop)this.onstop?.();}
  };instances.push(rec);return rec;
}

test('a normal segment starts its successor before delivering the completed audio',()=>{
  const clock=makeClock(),instances=[],order=[],captures=[];
  const dispose=startMicrophoneRecorder({
    stream:{},analyser:analyser(),mimeType:'audio/webm',active:()=>true,onLevel:()=>{},clock,
    recorderFactory:()=>recorder(instances,{emitData:true}),
    attachScreen:capture=>captures.push({...capture}),
    onSegment:()=>order.push(`segment-after-${instances.length}-recorders`),
    onFailure:error=>assert.fail(error.message)
  });
  clock.advance(6000);
  assert.equal(instances.length,2);
  assert.deepEqual(order,['segment-after-2-recorders']);
  assert.equal(captures.length,1);
  assert.ok(captures[0].endedAt>=captures[0].startedAt);
  dispose();assert.equal(clock.pending(),0);
});

test('missing stop event is recovered by the watchdog and recording continues',()=>{
  const clock=makeClock(),instances=[],errors=[];
  const dispose=startMicrophoneRecorder({
    stream:{},analyser:analyser(0),mimeType:'audio/webm',active:()=>true,onLevel:()=>{},clock,stopEventTimeoutMs:10,
    recorderFactory:()=>recorder(instances,{emitStop:instances.length>0}),
    onSegment:()=>{},onFailure:error=>errors.push(error)
  });
  clock.advance(3000);assert.equal(instances.length,1);assert.equal(instances[0].stopCalls,1);
  clock.advance(10);assert.equal(instances.length,2);assert.deepEqual(errors,[]);
  dispose();assert.equal(clock.pending(),0);
});

test('failure to create the successor stops recovery instead of leaving a false active recorder',()=>{
  const clock=makeClock(),instances=[],errors=[];let attempts=0;
  const dispose=startMicrophoneRecorder({
    stream:{},analyser:analyser(),mimeType:'audio/webm',active:()=>true,onLevel:()=>{},clock,
    recorderFactory:()=>{attempts++;if(attempts===2)throw new Error('factory failed');return recorder(instances,{emitStop:true});},
    onSegment:()=>{},onFailure:error=>errors.push(error)
  });
  clock.advance(6000);
  assert.equal(attempts,2);assert.equal(errors.length,1);assert.match(errors[0].message,/factory failed/);
  const before=attempts;clock.advance(12000);assert.equal(attempts,before);
  dispose();assert.equal(clock.pending(),0);
});

test('recorder start failure is synchronous and leaves no timers behind',()=>{
  const clock=makeClock(),instances=[];
  assert.throws(()=>startMicrophoneRecorder({
    stream:{},analyser:analyser(),mimeType:'audio/webm',active:()=>true,onLevel:()=>{},clock,
    recorderFactory:()=>recorder(instances,{failStart:true}),onSegment:()=>{},onFailure:()=>assert.fail('unexpected async failure')
  }),/start failed/);
  assert.equal(clock.pending(),0);
});

for(const emitStop of [true,false]){
  test(`retired recorder callbacks cannot stop the successor after ${emitStop?'normal stop':'watchdog recovery'}`,()=>{
    const clock=makeClock(),instances=[],errors=[],segments=[];
    const dispose=startMicrophoneRecorder({
      stream:{},analyser:analyser(),mimeType:'audio/webm',active:()=>true,onLevel:()=>{},clock,stopEventTimeoutMs:10,
      recorderFactory:()=>recorder(instances,{emitStop,emitData:true}),
      onSegment:blob=>segments.push(blob),onFailure:error=>errors.push(error)
    });
    clock.advance(emitStop?6000:6010);
    assert.equal(instances.length,2);assert.equal(instances[1].state,'recording');
    const segmentCount=segments.length;
    instances[0].onerror();
    instances[0].ondataavailable({data:new Blob(['late'])});
    instances[0].onstop();
    assert.deepEqual(errors,[]);
    assert.equal(instances[1].state,'recording');
    assert.equal(instances[1].stopCalls,0);
    assert.equal(instances.length,2);
    assert.equal(segments.length,segmentCount);
    dispose();assert.equal(clock.pending(),0);
    instances[1].onerror();assert.deepEqual(errors,[]);
  });
}

test('an active recorder error still stops recording and reports once',()=>{
  const clock=makeClock(),instances=[],errors=[];
  const dispose=startMicrophoneRecorder({
    stream:{},analyser:analyser(),mimeType:'audio/webm',active:()=>true,onLevel:()=>{},clock,
    recorderFactory:()=>recorder(instances),
    onSegment:()=>{},onFailure:error=>errors.push(error)
  });
  instances[0].onerror();instances[0].onerror();
  assert.equal(errors.length,1);
  assert.equal(instances[0].state,'inactive');
  assert.equal(instances[0].stopCalls,1);
  assert.equal(clock.pending(),0);
  clock.advance(12000);assert.equal(instances.length,1);
  dispose();
});
