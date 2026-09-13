import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {LocalSpeech} from '../server/local-speech.js';
function setup(){const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>c.emit('close');const sent=[];c.stdin.on('data',b=>sent.push(JSON.parse(String(b))));const speech=new LocalSpeech({python:process.execPath},()=>c);speech.start();c.stdout.write('{"ready":true}\n');return {speech,c,sent,emit:value=>c.stdout.write(JSON.stringify(value)+'\n')};}
test('a cancelled recognition error cannot reject a newer request',async()=>{
  const {speech,sent,emit}=setup();const old=new AbortController();const first=speech.transcribe(Buffer.from('first'),old.signal);old.abort();await assert.rejects(first,/취소/);
  const second=speech.transcribe(Buffer.from('second'),new AbortController().signal);emit({id:sent[0].id,error:'late failure of cancelled audio'});assert.equal(speech.pending.id,sent[1].id);emit({id:sent[1].id,text:'두 번째 음성'});assert.equal((await second).text,'두 번째 음성');speech.close();
});
test('old successful audio and unknown IDs do not resolve the current recognizer request',async()=>{
  const {speech,sent,emit}=setup();const job=speech.transcribe(Buffer.from('current'),new AbortController().signal);emit({id:'old',text:'wrong speech'});assert.equal(speech.pending.id,sent[0].id);emit({id:sent[0].id,text:'올바른 음성'});assert.equal((await job).text,'올바른 음성');speech.close();
});
test('worker startup failures invalidate readiness and reject the pending request',async()=>{const {speech,emit}=setup();const job=speech.transcribe(Buffer.from('current'),new AbortController().signal);emit({error:'model unavailable'});await assert.rejects(job,/model unavailable/);assert.equal(speech.ready,false);assert.throws(()=>speech.transcribe(Buffer.from('next'),new AbortController().signal),/model unavailable/);speech.close();});
test('worker close releases pending request without leaving a timeout rejection',async()=>{const {speech,c}=setup();const job=speech.transcribe(Buffer.from('current'),new AbortController().signal);c.emit('close');await assert.rejects(job,/종료/);assert.equal(speech.pending,null);assert.equal(speech.ready,false);});
