import test from 'node:test';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';

test('empty rehearsal announces its purpose without a system helper impersonating a viewer',async t=>{
  const manager={...defaults.personas.find(p=>p.id===defaults.managerId),system:true,name:'방송 도우미'};
  const studio=new Studio({settings:{...defaults,mode:'rehearsal',personas:[manager]},provider:{status:()=>({configured:false}),react:()=>{throw Error('offline rehearsal must not call a provider');}}});
  t.after(()=>studio.close());
  studio.start();
  await studio.react({speech:'안녕하세요'});
  const helper=studio.messages.filter(m=>m.personaId===manager.id);
  assert.equal(helper.length,1);
  assert.equal(helper[0].kind,'notice');
  assert.match(helper[0].text,/리허설/);
  assert.equal(studio.queue.length,0);
  assert.equal(studio.calls,0);
});
