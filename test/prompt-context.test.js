import test from 'node:test';
import assert from 'node:assert/strict';
import {compactViewerContext} from '../server/prompt-context.js';
import {OpenAIProvider} from '../server/provider.js';
import {CodexProvider} from '../server/codex-provider.js';
import {liveViewerContext} from '../server/viewer-context.js';
import {defaults} from '../shared/defaults.js';

const clone=value=>JSON.parse(JSON.stringify(value));
function expand(data){
  const copy=clone(data);
  for(const {viewerIds,fields} of copy.viewerContextShared||[])for(const id of viewerIds)Object.assign(copy.viewerContext[id],clone(fields));
  delete copy.viewerContextShared;return copy;
}
const rows=Array.from({length:35},(_,i)=>({id:`row-${i}`,time:100+i,personaId:'streamer',text:`방송 기록 ${i}: 오늘은 빨간 의자에서 쉬면서 지난 탐험과 다음 방송 이야기를 천천히 나누고 있어요.`,kind:'streamer'}));
function input(){
  const people=defaults.personas.slice(0,4);
  const packets=liveViewerContext({members:people.map((p,i)=>({id:p.id,joinedAt:i===3?200:0,memories:[p.id+'만의 기억']}))},people,rows,{scene:'빨간 의자',at:150},{now:200,speech:'기억나요?'});
  return {settings:clone(defaults),history:rows,speech:'기억나요?',...packets};
}
test('shared context round-trips real viewer packets without widening newcomer knowledge or mutating memory',()=>{
  const args=input(),before=clone(args),encoded=compactViewerContext(args);
  assert.ok(encoded.instructions);assert.deepEqual(expand(encoded.data),before);assert.deepEqual(clone(args),before);
  assert.ok(encoded.data.viewerContextShared.every(g=>!g.viewerIds.includes('new')));
  assert.deepEqual(encoded.data.viewerContext.new.chatHistory,[]);
  assert.equal(encoded.data.viewerContext.new.previous,null);
  assert.deepEqual(encoded.data.viewerContext.momo.memories,['momo만의 기억']);
  assert.ok(Buffer.byteLength(JSON.stringify(encoded.data)+encoded.instructions)<Buffer.byteLength(JSON.stringify(args)));
});
test('only exact field matches share: changed text, corrections, order, timestamps and provenance remain distinct',()=>{
  for(const mutate of [r=>r.reverse(),r=>r[0].text='정정된 발언',r=>r[0].time++,r=>r[0].transcriptionCorrection={original:'원문',text:'정정'},r=>r[0].witnesses=['gg']]){
    const args=clone(input());mutate(args.viewerContext.gg.chatHistory);const before=clone(args);
    const encoded=compactViewerContext(args);assert.deepEqual(expand(encoded.data),before);
    assert.deepEqual(encoded.data.viewerContext.gg.chatHistory,before.viewerContext.gg.chatHistory);
  }
});
test('short packets and single viewers keep original encoding without overhead',()=>{
  for(const data of [{},{viewerContext:{a:{chatHistory:[]}}},{viewerContext:{a:{chatHistory:[]},b:{chatHistory:[]}}}]){
    const result=compactViewerContext(data);assert.equal(result.data,data);assert.equal(result.instructions,'');
  }
});
test('provider opt-in keeps all other payload fields and instructions; debug replacement preserves original contract',()=>{
  const args=input(),plain=new OpenAIProvider({}).payload(args),provider=new OpenAIProvider({BACKSEAT_SHARED_VIEWER_CONTEXT:'1'}),compact=provider.payload(args);
  assert.deepEqual(expand(JSON.parse(compact.input[0].content[0].text)),JSON.parse(plain.input[0].content[0].text));
  assert.ok(compact.instructions.startsWith(plain.instructions));assert.deepEqual(compact.text,plain.text);
  assert.equal(compact.max_output_tokens,plain.max_output_tokens);
  assert.deepEqual(provider.payload({...args,debugPrompt:{enabled:true,mode:'replace',prompt:'custom'}}).input,plain.input);
});
test('qualified Codex path enables sharing by default and supports explicit rollback',()=>{
  const args=input();
  assert.ok(JSON.parse(new CodexProvider({}).payload(args).input[0].content[0].text).viewerContextShared);
  assert.equal(JSON.parse(new CodexProvider({BACKSEAT_SHARED_VIEWER_CONTEXT:'0'}).payload(args).input[0].content[0].text).viewerContextShared,undefined);
});
