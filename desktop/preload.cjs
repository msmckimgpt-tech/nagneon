const {contextBridge,ipcRenderer}=require('electron');
// Windows forwards mouse movement even while the rest of the overlay ignores clicks.
// Controls opt back into input; dragging and focused text entry retain it.
if(location.pathname==='/overlay'){
  let held=false,hovered=false,focused=false,last;
  const control=target=>Boolean(target?.closest?.('[data-overlay-interactive]'));
  const update=()=>{const value=held||hovered||focused;if(value!==last){last=value;ipcRenderer.send('overlay:interactive',value);}};
  window.addEventListener('mousemove',event=>{hovered=control(event.target);if(!event.buttons)held=false;update();},true);
  window.addEventListener('pointerdown',event=>{if(control(event.target)){held=true;hovered=true;update();}},true);
  window.addEventListener('pointerup',event=>{held=false;hovered=control(document.elementFromPoint(event.clientX,event.clientY));update();},true);
  window.addEventListener('pointercancel',()=>{held=false;hovered=false;update();},true);
  document.addEventListener('mouseleave',()=>{hovered=false;update();});
  document.addEventListener('focusin',event=>{focused=control(event.target)&&Boolean(event.target?.matches?.('input:not([type=range]),textarea,[contenteditable=true]'));update();});
  document.addEventListener('focusout',event=>{focused=control(event.relatedTarget)&&Boolean(event.relatedTarget?.matches?.('input:not([type=range]),textarea,[contenteditable=true]'));update();});
  window.addEventListener('focus',()=>{focused=control(document.activeElement)&&Boolean(document.activeElement?.matches?.('input:not([type=range]),textarea,[contenteditable=true]'));update();});
  window.addEventListener('blur',()=>{held=false;hovered=false;focused=false;update();});
}
contextBridge.exposeInMainWorld('backseat',{
  microphoneState:()=>ipcRenderer.invoke('microphone:state'),
  toggleMicrophone:()=>ipcRenderer.invoke('microphone:toggle'),
  publishMicrophoneState:value=>ipcRenderer.send('microphone:update',value),
  onMicrophoneState:fn=>{const listener=(_event,value)=>fn(value);ipcRenderer.on('microphone:state',listener);return()=>ipcRenderer.removeListener('microphone:state',listener);},
  microphoneShortcut:()=>ipcRenderer.invoke('microphone:shortcut'),
  onMicrophoneToggle:fn=>{const listener=()=>fn();ipcRenderer.on('microphone:toggle',listener);return()=>ipcRenderer.removeListener('microphone:toggle',listener);},
  storageStatus:()=>ipcRenderer.invoke('storage:status'),
  changeStorage:useDefault=>ipcRenderer.invoke('storage:change',useDefault),
  appendSpeechRaw:entry=>ipcRenderer.invoke('speech:raw',entry),
  accountStatus:()=>ipcRenderer.invoke('account:status'),startAccountLogin:method=>ipcRenderer.invoke('account:start',method),cancelAccountLogin:()=>ipcRenderer.invoke('account:cancel'),openAccountLogin:()=>ipcRenderer.invoke('account:open'),
  openDecisionKeyConsole:provider=>ipcRenderer.invoke('decision:key-console',provider),
  onAccountState:fn=>{const listener=(_event,value)=>fn(value);ipcRenderer.on('account:state',listener);return()=>ipcRenderer.removeListener('account:state',listener);},
  sources:()=>ipcRenderer.invoke('capture:sources'),sourcePreviews:type=>ipcRenderer.invoke('capture:previews',type),selectSource:(id,systemAudio=false)=>ipcRenderer.invoke('capture:select',id,systemAudio),
  openOverlay:()=>ipcRenderer.invoke('overlay:open'),toggleClickThrough:()=>ipcRenderer.invoke('overlay:through'),closeOverlay:()=>ipcRenderer.invoke('overlay:close'),
  onOverlayState:fn=>{const listener=(_event,value)=>fn(value);ipcRenderer.on('overlay:state',listener);return()=>ipcRenderer.removeListener('overlay:state',listener);},
  onNavigationHistory:fn=>{const listener=(_event,value)=>{if(value==='back'||value==='forward')fn(value);};ipcRenderer.on('navigation:history',listener);return()=>ipcRenderer.removeListener('navigation:history',listener);},
});
