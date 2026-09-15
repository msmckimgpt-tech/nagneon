function applyOverlayPrivacy(win,settings){
  if(!win||win.isDestroyed())return;
  const protectedContent=settings.overlayMode!=='public';
  if(win.isContentProtected()!==protectedContent)win.setContentProtection(protectedContent);
}
module.exports={applyOverlayPrivacy};
