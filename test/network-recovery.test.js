import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const {createNetworkRecovery}=createRequire(import.meta.url)('../desktop/network-recovery.cjs');
function setup(loadURL){
  const app=new EventEmitter(),logs=[],delays=[];
  const recovery=createNetworkRecovery(app,{write:line=>logs.push(JSON.parse(line)),wait:async ms=>{delays.push(ms);}});
  const win={isDestroyed:()=>false,loadURL};
  return {app,logs,delays,win,recovery};
}
const failure=code=>Object.assign(new Error('load failed'),{code});
const gone={type:'Utility',serviceName:'network.mojom.NetworkService',reason:'crashed',exitCode:7};
test('initial network failure recovers without recreating the window or service',async()=>{
  let calls=0;const s=setup(async()=>{if(++calls<3)throw failure('ERR_CONNECTION_RESET');});
  assert.equal(await s.recovery.load(s.win,'http://127.0.0.1:1234/'),true);
  assert.equal(calls,3);assert.deepEqual(s.delays,[500,1000]);
});
test('persistent failure is bounded and preserves the original error',async()=>{
  const error=failure('ERR_FAILED');let calls=0;const s=setup(async()=>{calls++;throw error;});
  await assert.rejects(s.recovery.load(s.win,'http://127.0.0.1/'),e=>e===error);
  assert.equal(calls,4);assert.deepEqual(s.delays,[500,1000,1500]);assert.equal(s.logs.at(-1).retry,false);
});
test('certificate and unrelated navigation aborts are not retried',async()=>{
  for(const code of ['ERR_CERT_AUTHORITY_INVALID','ERR_ABORTED','ERR_INVALID_URL']){
    const s=setup(async()=>{throw failure(code);});
    await assert.rejects(s.recovery.load(s.win,'http://127.0.0.1/'));assert.deepEqual(s.delays,[]);
  }
});
test('an abort during network service crash recovers and records only safe diagnostics',async()=>{
  let calls=0;const s=setup(async()=>{if(++calls===1){s.app.emit('child-process-gone',{}, {...gone,secret:'token'});throw failure('ERR_ABORTED');}});
  assert.equal(await s.recovery.load(s.win,'http://127.0.0.1/?secret=token'),true);
  assert.equal(s.logs[0].exitCode,7);assert.ok(!JSON.stringify(s.logs).includes('token'));
  s.app.emit('child-process-gone',{},gone);assert.equal(calls,2); // No reload after startup.
});
test('quitting or closing during backoff prevents further navigation',async()=>{
  for(const close of [false,true]){
    let calls=0;const s=setup(async()=>{calls++;if(close)s.win.isDestroyed=()=>true;else s.app.emit('before-quit');throw failure('ERR_FAILED');});
    assert.equal(await s.recovery.load(s.win,'http://127.0.0.1/'),false);assert.equal(calls,1);
  }
});
test('other utility exits and normal shutdown are ignored',()=>{
  const s=setup(async()=>{});
  s.app.emit('child-process-gone',{}, {...gone,serviceName:'audio.mojom.AudioService'});
  s.app.emit('child-process-gone',{}, {...gone,reason:'clean-exit'});
  s.app.emit('before-quit');s.app.emit('child-process-gone',{},gone);
  assert.equal(s.logs.length,0);
});
