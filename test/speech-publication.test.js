import test from 'node:test';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';

function setup(t){
 const s=new Studio({settings:{...defaults,mode:'live',lurkRatio:0},now:()=>100000,random:()=>0,provider:{status:()=>({configured:true}),react:async()=>{throw Error('Unexpected model call');}}});
 clearInterval(s.timer);s.start();t.after(()=>s.close());return s;
}
const speech=(s,id='one',extra={})=>({id,sessionId:s.sessionId,text:'새 상황을 보고 있어요',source:'keyboard',...extra});

test('speech publishes one complete receipt after invalidating the previous reaction',t=>{
 const s=setup(t),reaction={hasSpeech:false,controller:new AbortController()};s.liveReaction=reaction;
 s.queue=[{origin:'live',text:'old reaction'},{origin:'paid',text:'paid reaction'}];
 const observed=[];s.on('state',state=>observed.push({state:structuredClone(state),pending:s.speechInbox.pending.length,aborted:reaction.controller.signal.aborted}));
 const result=s.receiveSpeech(speech(s));
 assert.equal(result.duplicate,false);assert.equal(observed.length,1);
 assert.equal(observed[0].pending,1);assert.equal(observed[0].aborted,true);assert.equal(reaction.superseded,true);
 assert.equal(observed[0].state.queued,1);assert.equal(s.queue[0].origin,'paid');
 assert.equal(observed[0].state.messages.length,1);assert.equal(observed[0].state.messages[0].id,result.messageId);
 assert.equal(s.journal.data.entries.some(m=>m.id===result.messageId),true);
});

test('speech retries remain idempotent and direct audience messages still publish immediately',t=>{
 const s=setup(t),states=[];s.on('state',state=>states.push(structuredClone(state)));
 const first=s.receiveSpeech(speech(s));const retry=s.receiveSpeech(speech(s));
 assert.equal(retry.duplicate,true);assert.equal(retry.messageId,first.messageId);
 assert.equal(s.messages.length,1);assert.equal(s.speechInbox.pending.length,1);assert.equal(states.length,2);
 s.addMessage('momo','직접 관객 메시지');assert.equal(states.length,3);assert.equal(states[2].messages.length,2);
});

test('full speech inbox rejects a new message without a partial publication',t=>{
 const s=setup(t);for(let i=0;i<40;i++)s.receiveSpeech(speech(s,String(i)));
 const before=s.messages.length,states=[];s.on('state',state=>states.push(state));
 assert.throws(()=>s.receiveSpeech(speech(s,'overflow')),/밀렸어요/);
 assert.equal(s.messages.length,before);assert.equal(s.speechInbox.pending.length,40);assert.equal(states.length,0);
 assert.equal(s.speechInbox.receipts.has('overflow'),false);
});

test('journal failure still publishes the accepted microphone message and storage warning once',t=>{
 const s=setup(t);s.journal.record=()=>{throw Error('synthetic storage unavailable');};
 const states=[];s.on('state',state=>states.push(structuredClone(state)));
 const result=s.receiveSpeech(speech(s,'microphone',{source:'microphone'}));
 assert.equal(result.duplicate,false);assert.equal(states.length,1);assert.equal(states[0].messages[0].transcription.source,'microphone');
 assert.match(states[0].lastError,/synthetic storage unavailable/);assert.equal(s.speechInbox.pending.length,1);
});
