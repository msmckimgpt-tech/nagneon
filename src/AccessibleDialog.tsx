import {useEffect,useRef,type ReactNode,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';

// Tabbable elements inside the dialog. Disabled controls and explicit tabindex=-1
// (including the dialog container itself) are excluded so they never trap focus.
const FOCUSABLE='a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Shared across every open dialog so a nested/second dialog closing does not
// prematurely re-enable the background while another dialog is still open.
let openDialogs=0;
function setBackgroundInert(on:boolean){
  const root=document.getElementById('root');
  if(!root)return;
  if(on){
    if(openDialogs===0){root.setAttribute('inert','');root.setAttribute('aria-hidden','true');}
    openDialogs++;
  }else{
    openDialogs=Math.max(0,openDialogs-1);
    if(openDialogs===0){root.removeAttribute('inert');root.removeAttribute('aria-hidden');}
  }
}

function tabbable(dialog:HTMLElement){
  // offsetParent is null only when an element (or an ancestor) is display:none,
  // so this keeps controls that are merely scrolled out of the settings area.
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el=>el.offsetParent!==null);
}

export function AccessibleDialog({onClose,className='',labelledBy,describedBy,initialFocus,children}:{
  onClose:()=>void;
  className?:string;
  labelledBy:string;
  describedBy?:string;
  initialFocus?:{current:HTMLElement|null};
  children:ReactNode;
}){
  const dialogRef=useRef<HTMLDivElement|null>(null);
  const restoreRef=useRef<HTMLElement|null>(null);
  const onCloseRef=useRef(onClose);onCloseRef.current=onClose;

  useEffect(()=>{
    // Remember the trigger so focus can return to it when the dialog closes.
    restoreRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const dialog=dialogRef.current;
    // Move focus into the dialog BEFORE marking the background inert, otherwise
    // the still-focused trigger would sit inside an aria-hidden/inert subtree.
    const target=initialFocus?.current||dialog;
    target?.focus();
    setBackgroundInert(true);
    return ()=>{
      // Re-enable the background first; focusing into an inert subtree is ignored.
      setBackgroundInert(false);
      const prev=restoreRef.current;
      // The trigger may have been unmounted while the dialog was open (e.g. the
      // login/onboarding flow replaced the whole shell). Only restore if it is
      // still connected and focusable; otherwise leave focus where it is.
      if(prev&&prev.isConnected&&document.contains(prev)){
        try{prev.focus();}catch{/* element no longer focusable — safe to ignore */}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  function onKeyDown(e:KeyboardEvent<HTMLElement>){
    if(e.key==='Escape'){e.stopPropagation();onCloseRef.current();return;}
    if(e.key!=='Tab')return;
    const dialog=dialogRef.current;if(!dialog)return;
    const items=tabbable(dialog);
    if(!items.length){e.preventDefault();dialog.focus();return;}
    const first=items[0],last=items[items.length-1],active=document.activeElement;
    if(e.shiftKey){
      // Wrap to the end from the first control, the container, or anything outside.
      if(active===first||active===dialog||!dialog.contains(active)){e.preventDefault();last.focus();}
    }else if(active===last||!dialog.contains(active)){
      e.preventDefault();first.focus();
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      <section ref={dialogRef} className={('modal '+className).trim()} role="dialog" aria-modal="true"
        aria-labelledby={labelledBy} aria-describedby={describedBy} tabIndex={-1} onKeyDown={onKeyDown}>
        {children}
      </section>
    </div>,
    document.body
  );
}
