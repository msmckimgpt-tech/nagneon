function configureOverlayWorkspaces(win,platform=process.platform){
  if(platform==='darwin')win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true,skipTransformProcessType:true});
}
function registerMicrophoneShortcut(shortcuts,getMain){
  return shortcuts.register('CommandOrControl+Shift+M',()=>{
    const main=getMain();
    if(main&&!main.isDestroyed())main.webContents.send('microphone:toggle');
  });
}
module.exports={configureOverlayWorkspaces,registerMicrophoneShortcut};
