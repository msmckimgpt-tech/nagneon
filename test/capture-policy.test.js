import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {attachCapture}=createRequire(import.meta.url)('../desktop/capture.cjs');
function fixture(getSources=async()=>[{id:'window:1',name:'Game',thumbnail:{toDataURL:()=>''}}]){const frame={},main={webContents:{mainFrame:frame}},handlers={};let request;attachCapture({main,session:{setDisplayMediaRequestHandler:f=>request=f},ipcMain:{handle:(name,f)=>handlers[name]=f},desktopCapturer:{getSources},platform:'win32'});return {handlers,event:{sender:main.webContents,senderFrame:frame},call:async(audioRequested=true,otherFrame=false)=>{let result;await request({frame:otherFrame?{}:frame,audioRequested},v=>result=v);return result;}};}
test('system output loopback requires both explicit selection and a browser audio request',async()=>{const f=fixture();f.handlers['capture:select'](f.event,'window:1',false);assert.equal((await f.call()).audio,undefined);f.handlers['capture:select'](f.event,'window:1',true);assert.equal((await f.call(false)).audio,undefined);f.handlers['capture:select'](f.event,'window:1',true);assert.equal((await f.call()).audio,'loopback');assert.deepEqual(await f.call(),{});});
test('overlay and subframe selection/capture are rejected without consuming the main selection',async()=>{const f=fixture();await assert.rejects(()=>f.handlers['capture:select']({...f.event,senderFrame:{}},'window:1',true));f.handlers['capture:select'](f.event,'window:1',true);assert.deepEqual(await f.call(true,true),{});assert.equal((await f.call()).audio,'loopback');});
test('disappearing screen source never grants audio and malformed audio choice is rejected',async()=>{const f=fixture();await assert.rejects(()=>f.handlers['capture:select'](f.event,'window:1','true'));f.handlers['capture:select'](f.event,'missing',true);assert.deepEqual(await f.call(),{});});

test('names arrive without pixel capture while window previews remain unresolved',async()=>{
  let finish;const calls=[];
  const f=fixture(options=>{calls.push(options);if(options.thumbnailSize.width)return new Promise(r=>finish=r);return [{id:'window:1',name:'Game',thumbnail:{toDataURL:()=>{throw Error('Metadata must not read pixels');}}},{id:'window:2',name:'Nagneon'},{id:'window:3',name:'BACKSEAT Studio'}];});
  const previews=f.handlers['capture:previews'](f.event,'window');
  assert.deepEqual(await f.handlers['capture:sources'](f.event),[{id:'window:1',name:'Game',kind:'window',thumbnail:''}]);
  assert.deepEqual(calls.map(c=>c.thumbnailSize.width),[300,0]);
  finish([]);assert.deepEqual(await previews,[]);
});

test('reopening coalesces native previews; screens and source selection remain independent',async()=>{
  let finish;const calls=[];const source={id:'screen:1',name:'화면 1',thumbnail:{isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,fixture'}};
  const f=fixture(options=>{calls.push(options);if(options.types[0]==='window'&&options.thumbnailSize.width)return new Promise(r=>finish=r);return [source];});
  const a=f.handlers['capture:previews'](f.event,'window'),b=f.handlers['capture:previews'](f.event,'window');
  assert.equal((await f.handlers['capture:previews'](f.event,'screen'))[0].thumbnail,source.thumbnail.toDataURL());
  await f.handlers['capture:select'](f.event,'screen:1',true);assert.equal((await f.call()).audio,'loopback');
  assert.equal(calls.filter(c=>c.types[0]==='window').length,1);finish([]);await Promise.all([a,b]);
});

test('failed preview work can be retried and malformed or foreign frame requests never enumerate',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;if(calls===1)throw Error('Native preview failed');return [];});
  await assert.rejects(()=>f.handlers['capture:previews']({...f.event,senderFrame:{}},'window'));
  await assert.rejects(()=>f.handlers['capture:sources']({...f.event,sender:{}}));
  await assert.rejects(()=>f.handlers['capture:previews'](f.event,'all'));assert.equal(calls,0);
  await assert.rejects(()=>f.handlers['capture:previews'](f.event,'window'));assert.deepEqual(await f.handlers['capture:previews'](f.event,'window'),[]);assert.equal(calls,2);
});
