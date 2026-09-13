import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {ConversationJournal} from '../server/conversation-journal.js';
import {CodexProvider} from '../server/codex-provider.js';
import {defaults} from '../shared/defaults.js';
const original=JSON.parse(await readFile('artifacts/conversation-memory-live.json','utf8'));
const data=JSON.parse(await readFile(join(original.folder,'conversation-journal.json'),'utf8'));
const provider=new CodexProvider();await provider.check();assert.equal(provider.available,true);
const people=defaults.personas.filter(p=>['momo','gg'].includes(p.id));
const results=[];
for(const index of [7,6]){
  const question=data.entries.find(e=>e.personaId==='streamer'&&e.text===original.requests[index].speech);
  assert.ok(question,'Original question must have an exact source');
  const journal=new ConversationJournal({...data,entries:data.entries.filter(e=>e.at<=question.at)});
  const speech=original.requests[index].speech,viewerContext={};for(const p of people){const prior=original.requests[index].viewerContext[p.id];viewerContext[p.id]={...prior,recollections:journal.recall(p.id,speech,prior.chatHistory.map(m=>m.id))};}
  if(index===7)for(const p of people){const own=original.requests[0].observation.messages.find(m=>m.personaId===p.id);assert.ok(viewerContext[p.id].recollections.some(e=>e.speakerId===p.id&&e.text===own.text),'Own earlier role must remain among selected quotes for '+p.id);}
  const started=Date.now();const result=await provider.react({settings:{...defaults,mode:'live',category:'just-chatting',personas:people,chatPace:2,webSearch:false},history:[],previous:null,speech,viewerContext,audience:{eligible:people.map(p=>p.id),members:people.map(p=>({id:p.id,presence:'active',sessions:3}))}},new AbortController().signal);
  assert.ok(Object.values(viewerContext).every(c=>c.recollections.every(e=>e.at<=question.at)),'No future source may enter a historical replay');
  results.push({index,cutoff:question.at,speech,viewerContext,ms:Date.now()-started,...result});console.log(JSON.stringify(results.at(-1)));
}
const roles=results[0].observation.messages;assert.match(roles.find(m=>m.personaId==='momo')?.text||'',/작은 행복/);assert.match(roles.find(m=>m.personaId==='gg')?.text||'',/한 판 돌아보기/);assert.ok(results[1].observation.messages.some(m=>/취소/.test(m.text)));
await writeFile('artifacts/conversation-memory-retrieval-fix.json',JSON.stringify({passed:true,model:provider.model,effort:provider.effort,source:original.folder,results,scope:'Two actual model replays from preserved public source quotes, correcting failed role recall and rechecking later cancellation. No physical audio; not long-term naturalness certification.'},null,2));
