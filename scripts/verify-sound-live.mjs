// One real Astra call, replaying neural perception from the Windows loopback test.
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {CodexProvider} from '../server/codex-provider.js';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';
const source=JSON.parse(await readFile('artifacts/sound-loopback-test.json','utf8'));
assert.equal(source.passed,true);const heard=source.requests.find(r=>!r.result.silent)?.result;assert.ok(heard);
const provider=new CodexProvider();await provider.check();assert.equal(provider.available,true);
let clock=Date.now()-4000;const studio=new Studio({provider,now:()=>clock,settings:{...defaults,mode:'live',category:'just-chatting',chatPace:3,lurkRatio:0}});
const report={source:'artifacts/sound-loopback-test.json',replayedPerception:true,rawAudioSentToAstra:false,model:provider.model,effort:provider.effort};
try{
  studio.start();
  const id=randomUUID();studio.sound.start(id);const begin=clock;clock+=4000;const ticket=studio.sound.begin({id,segmentId:randomUUID(),startedAt:begin,endedAt:clock});studio.sound.finish(ticket,heard);assert.ok(ticket.witnesses.length);report.witnesses=ticket.witnesses;report.virtualCaptureClock=true;
  const start=Date.now();report.response=await studio.react({speech:'화면 없이 소리만 공유하고 있어. 방금 들리는 소리에 자연스럽게 반응해 줘. 무슨 게임인지는 아직 말 안 했어.'});report.ms=Date.now()-start;
  report.observation=studio.observation;report.queued=studio.queue.map(q=>({personaId:q.personaId,text:q.text}));report.heard=heard;
  assert.ok(studio.calls===1&&!studio.lastError);assert.ok(studio.observation);assert.match(JSON.stringify(report.queued),/삐|비프|신호음|전자음|통화|사인파|톤|알람|경보/);report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{studio.close();await writeFile('artifacts/sound-live-test.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
