const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('backseat',{
  accountStatus:()=>ipcRenderer.invoke('account:status'),startAccountLogin:method=>ipcRenderer.invoke('account:start',method),cancelAccountLogin:()=>ipcRenderer.invoke('account:cancel'),openAccountLogin:()=>ipcRenderer.invoke('account:open'),
  onAccountState:fn=>{const listener=(_event,value)=>fn(value);ipcRenderer.on('account:state',listener);return()=>ipcRenderer.removeListener('account:state',listener);},
  sources:()=>ipcRenderer.invoke('capture:sources'),sourcePreviews:type=>ipcRenderer.invoke('capture:previews',type),selectSource:(id,systemAudio=false)=>ipcRenderer.invoke('capture:select',id,systemAudio),
  openOverlay:()=>ipcRenderer.invoke('overlay:open'),toggleClickThrough:()=>ipcRenderer.invoke('overlay:through'),closeOverlay:()=>ipcRenderer.invoke('overlay:close'),
  onOverlayState:fn=>{const listener=(_event,value)=>fn(value);ipcRenderer.on('overlay:state',listener);return()=>ipcRenderer.removeListener('overlay:state',listener);},
  onPanic:fn=>{const listener=()=>fn();ipcRenderer.on('studio:panic',listener);return()=>ipcRenderer.removeListener('studio:panic',listener);}
});
