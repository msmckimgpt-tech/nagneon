import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechOutbox,SpeechQueue} from '../src/speech-flow.ts';
import {speechTimedOut} from '../src/speech-operation.ts';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('reset releases an uncooperative recognition and lets the new generation run',async()=>{
  const outputs=[],errors=[],started=[];
  const q=new SpeechQueue({
    execute:(value)=>{started.push(value);return value==='stuck'?new Promise(()=>{}):Promise.resolve(value+'-done');},
    onResult:value=>outputs.push(value),onError:error=>errors.push(error),operationTimeoutMs:1000
  });
  q.enqueue('stuck');await turn();q.reset();q.enqueue('fresh');
  for(let i=0;i<5&&outputs.length===0;i++)await turn();
  assert.deepEqual(started,['stuck','fresh']);
  assert.deepEqual(outputs,['fresh-done']);
  assert.deepEqual(errors,[]);
  assert.equal(q.running,false);
});

test('recognition timeout reports once and continues with the next utterance',async()=>{
  const outputs=[],errors=[];
  const q=new SpeechQueue({
    execute:value=>value==='stuck'?new Promise(()=>{}):Promise.resolve(value),
    onResult:value=>outputs.push(value),onError:error=>errors.push(error),operationTimeoutMs:10
  });
  q.enqueue('stuck');q.enqueue('next');
  await delay(30);await turn();
  assert.equal(errors.length,1);
  assert.equal(speechTimedOut(errors[0]),true);
  assert.deepEqual(outputs,['next']);
  assert.equal(q.running,false);
});

test('delivery timeout retains the same event id and the retry acknowledges it once',async()=>{
  let serial=0;const box=new SpeechOutbox(()=>String(++serial),10);
  box.add('전달할 발언','session','microphone',{startedAt:10,endedAt:20});
  const original=structuredClone(box.items[0]);
  await assert.rejects(box.flush(async()=>new Promise(()=>{})),error=>speechTimedOut(error));
  assert.deepEqual(box.items,[original]);
  const sent=[];await box.flush(async item=>sent.push(structuredClone(item)));
  assert.deepEqual(sent,[original]);
  assert.equal(box.items.length,0);
});

test('clear releases an uncooperative old send without deleting the new session item',async()=>{
  let serial=0;const box=new SpeechOutbox(()=>String(++serial),1000);
  box.add('이전 방송','old');let signal;
  const old=box.flush(async(_item,current)=>{signal=current;return new Promise(()=>{});});
  await turn();box.clear();box.add('새 방송','new');
  await old;
  assert.equal(signal.aborted,true);
  assert.equal(box.items.length,1);
  assert.equal(box.items[0].sessionId,'new');
  await box.flush(async()=>{});
  assert.equal(box.items.length,0);
});

test('one flush processes only the items that existed when it began',async()=>{
  let serial=0;const box=new SpeechOutbox(()=>String(++serial),1000);
  box.add('first','session');const sent=[];
  await box.flush(async item=>{sent.push(item.text);if(item.text==='first')box.add('arrived during flush','session');});
  assert.deepEqual(sent,['first']);
  assert.deepEqual(box.items.map(item=>item.text),['arrived during flush']);
  await box.flush(async item=>sent.push(item.text));
  assert.deepEqual(sent,['first','arrived during flush']);
});
