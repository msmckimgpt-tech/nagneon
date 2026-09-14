import {useCallback,useLayoutEffect,useRef,useState,type RefObject} from 'react';

// Keep the reader's place while messages arrive. The viewport owns scrolling;
// message generation and the history limit are independent of this preference.
export function useChatFollow(end:RefObject<HTMLDivElement|null>,revision:string,sessionKey:string){
  const following=useRef(true),pane=useRef<HTMLElement|null>(null),cleanup=useRef<()=>void>(()=>{});
  const previous=useRef({revision,sessionKey});
  const [unread,setUnread]=useState(false);
  const jump=useCallback(()=>{following.current=true;setUnread(false);const p=end.current?.parentElement;if(p)p.scrollTop=p.scrollHeight;},[end]);
  useLayoutEffect(()=>{
    const next=end.current?.parentElement||null;
    if(next!==pane.current){
      cleanup.current();pane.current=next;following.current=true;setUnread(false);
      if(next){
        const scroll=()=>{following.current=next.scrollHeight-next.clientHeight-next.scrollTop<=48;if(following.current)setUnread(false);};
        next.addEventListener('scroll',scroll,{passive:true});
        const resize=new ResizeObserver(()=>{if(following.current)next.scrollTop=next.scrollHeight;});resize.observe(next);
        cleanup.current=()=>{next.removeEventListener('scroll',scroll);resize.disconnect();};
        next.scrollTop=next.scrollHeight;
      }
    }
    if(previous.current.sessionKey!==sessionKey)jump();
    else if(previous.current.revision!==revision){if(following.current)jump();else setUnread(true);}
    previous.current={revision,sessionKey};
  });
  useLayoutEffect(()=>()=>{cleanup.current();pane.current=null;},[]);
  return {unread,jump};
}
