import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {createOverlayInput}=createRequire(import.meta.url)('../desktop/overlay-input.cjs');

test('toolbar temporarily accepts clicks without changing the selected through mode',()=>{
  const calls=[],states=[];let destroyed=false;
  const input=createOverlayInput({isDestroyed:()=>destroyed,setIgnoreMouseEvents:(...args)=>calls.push(args)},value=>states.push(value));
  assert.equal(input.toggle(),true);assert.deepEqual(calls.at(-1),[true,{forward:true}]);
  input.interactive(true);assert.equal(input.state(),true);assert.equal(calls.at(-1)[0],false);
  input.interactive(false);assert.equal(calls.at(-1)[0],true);
  input.interactive('yes');assert.equal(calls.at(-1)[0],true);
  input.interactive(true);assert.equal(input.toggle(),false);input.interactive(false);assert.equal(calls.at(-1)[0],false);
  input.toggle();input.interactive(true);input.reset();assert.equal(calls.at(-1)[0],true);
  assert.deepEqual(states,[true,false,true]);destroyed=true;assert.doesNotThrow(()=>input.toggle());
});

test('forwarded movement restores toolbar input and slider dragging keeps input until release',()=>{
  const listeners={},sent=[];const control={closest:()=>({})},chat={closest:()=>null};let hit=chat;
  const listen=(name,fn)=>listeners[name]=fn;
  vm.runInNewContext(readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{
    require:()=>({contextBridge:{exposeInMainWorld(){}},ipcRenderer:{send:(...args)=>sent.push(args)}}),
    location:{pathname:'/overlay'},window:{addEventListener:listen},document:{addEventListener:listen,elementFromPoint:()=>hit}
  });
  listeners.mousemove({target:control,buttons:0});assert.deepEqual(sent.at(-1),['overlay:interactive',true]);
  listeners.pointerdown({target:control});listeners.mousemove({target:chat,buttons:1});assert.equal(sent.at(-1)[1],true);
  listeners.pointerup({clientX:0,clientY:0});assert.equal(sent.at(-1)[1],false);
  listeners.mousemove({target:control,buttons:0});listeners.mouseleave();assert.equal(sent.at(-1)[1],false);
  listeners.mousemove({target:control,buttons:0});listeners.blur();assert.equal(sent.at(-1)[1],false);
  listeners.pointerdown({target:control});listeners.pointercancel();assert.equal(sent.at(-1)[1],false);
  listeners.pointerdown({target:control});listeners.mousemove({target:chat,buttons:0});assert.equal(sent.at(-1)[1],false);
});
