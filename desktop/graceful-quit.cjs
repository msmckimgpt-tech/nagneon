// Electron does not await async event handlers. Prevent every premature quit,
// then permit one final quit after the service has drained its owned work.
function installGracefulQuit(app,close,{onError=error=>console.error('Nagneon 종료 정리 실패:',error.message)}={}){
  let quitting=false,finished=false,pending;
  app.on('will-quit',event=>{
    if(finished)return;
    event.preventDefault();
    if(quitting)return;
    quitting=true;
    pending=Promise.resolve().then(close).then(async()=>{
      // A fast drain can finish in the will-quit microtask checkpoint, before
      // Electron resets its native is_quitting_ flag after preventDefault().
      // Quit() ignores reentrant calls while that flag is set. Leave the event
      // callback completely before issuing the final, fully drained quit.
      await new Promise(resolve=>setImmediate(resolve));
      finished=true;app.quit();
    },error=>{
      // Do not report a failed drain as a successful, clean exit.
      try{onError(error);}finally{app.exit(1);}
    });
  });
  return {get quitting(){return quitting;},get pending(){return pending;}};
}
module.exports={installGracefulQuit};
