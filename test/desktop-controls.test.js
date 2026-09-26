import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {configureOverlayWorkspaces,registerMicrophoneShortcut}=createRequire(import.meta.url)('../desktop/desktop-controls.cjs');
test('Mac overlay follows desktops including full-screen without changing app identity',()=>{
 const calls=[];const win={setVisibleOnAllWorkspaces:(...args)=>calls.push(args)};
 configureOverlayWorkspaces(win,'darwin');
 assert.deepEqual(calls,[[true,{visibleOnFullScreen:true,skipTransformProcessType:true}]]);
 configureOverlayWorkspaces(win,'win32');assert.equal(calls.length,1);
});
test('global mic shortcut only sends to the living main renderer and reports collisions',()=>{
 let callback,dead=false;const sent=[];
 assert.equal(registerMicrophoneShortcut({register:(key,fn)=>{assert.equal(key,'CommandOrControl+Shift+M');callback=fn;return true;}},()=>({isDestroyed:()=>dead,webContents:{send:(...args)=>sent.push(args)}})),true);
 callback();assert.deepEqual(sent,[['microphone:toggle']]);dead=true;callback();assert.equal(sent.length,1);
 assert.equal(registerMicrophoneShortcut({register:()=>false},()=>undefined),false);
});

test('preload microphone bridge forwards state and toggles with removable listeners',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 const handlers=new Map(),calls=[];let bridge;
 vm.runInNewContext(readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{
  require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {enabled:true};},send:(...args)=>calls.push(args),on:(name,fn)=>handlers.set(name,fn),removeListener:(name,fn)=>{if(handlers.get(name)===fn)handlers.delete(name);}}}),location:{pathname:'/'}
 });
 let received;const unsubscribe=bridge.onMicrophoneState(value=>received=value);
 handlers.get('microphone:state')({}, {enabled:true,preparing:false,available:true,error:false});
 assert.equal(received.enabled,true);await bridge.toggleMicrophone();assert.deepEqual(calls.at(-1),['microphone:toggle']);
 bridge.publishMicrophoneState(received);assert.equal(calls.at(-1)[0],'microphone:update');
 assert.equal((await bridge.microphoneState()).enabled,true);unsubscribe();assert.equal(handlers.has('microphone:state'),false);
});
