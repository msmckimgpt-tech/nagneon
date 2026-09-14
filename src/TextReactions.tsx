import {useEffect,useRef,useState} from 'react';
import {Smile} from 'lucide-react';
import './text-reactions.css';

const reactions=[['웃음','ㅋㅋㅋ'],['박수','👏'],['놀람','😮'],['눈물','ㅠㅠ'],['좋아요','👍'],['응원','💪'],['축하','🎉'],['집중','👀']];
export function TextReactions({disabled,onSelect}:{disabled:boolean;onSelect:(text:string)=>void}){
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  return <div className="text-reactions" ref={root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false);}}>
    <button ref={trigger} type="button" className="icon" aria-label="문자 반응 선택" aria-expanded={open} aria-controls="text-reaction-options" disabled={disabled} onClick={()=>setOpen(!open)}><Smile size={17}/></button>
    {open&&<div id="text-reaction-options" className="text-reaction-options" role="group" aria-label="문자 반응"><span>입력창에 넣기</span><div>{reactions.map(([label,text])=><button type="button" key={label} title={label} aria-label={label} onClick={()=>{setOpen(false);onSelect(text);}}>{text}</button>)}</div></div>}
  </div>;
}
