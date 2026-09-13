// Keep the selected mode separate from the temporary toolbar input exception.
function createOverlayInput(win,onChange=()=>{}){
  let through=false,interactive=false,lastIgnore;
  function apply(){
    if(win.isDestroyed())return;
    const ignore=through&&!interactive;
    if(ignore!==lastIgnore){win.setIgnoreMouseEvents(ignore,{forward:true});lastIgnore=ignore;}
  }
  return {
    toggle(){through=!through;apply();onChange(through);return through;},
    interactive(value){if(typeof value!=='boolean')return;interactive=value;apply();},
    reset(){interactive=false;apply();},
    state(){return through;}
  };
}
module.exports={createOverlayInput};
