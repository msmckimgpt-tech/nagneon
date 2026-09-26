import {useEffect,useState} from 'react';
import {applyStatePatch} from '../shared/state-patch.js';
import type {State} from './types';

export function useStudioState(){
  const [state,setState]=useState<State|null>(null),[connected,setConnected]=useState(false);
  useEffect(()=>{
    let current:State|null=null,source:EventSource|undefined,retry:ReturnType<typeof setTimeout>|undefined,disposed=false;
    const recover=()=>{source?.close();setConnected(false);if(!disposed&&!retry)retry=setTimeout(()=>{retry=undefined;connect();},250);};
    const connect=()=>{
      if(disposed)return;current=null;source=new EventSource('/api/events?transport=patches'+(location.pathname==='/overlay'?'&surface=overlay':''));
      source.onmessage=e=>{try{current=JSON.parse(e.data);setState(current);setConnected(true);}catch{recover();}};
      source.addEventListener('state-patch',e=>{try{current=applyStatePatch(current!,JSON.parse((e as MessageEvent).data));setState(current);setConnected(true);}catch{recover();}});
      source.addEventListener('chat-display',e=>{try{const {showStreamerMessages}=JSON.parse((e as MessageEvent).data);if(current&&typeof showStreamerMessages==='boolean'){current={...current,settings:{...current.settings,showStreamerMessages}};setState(current);}}catch{recover();}});
      source.onerror=()=>setConnected(false);
    };
    connect();return()=>{disposed=true;source?.close();clearTimeout(retry);};
  },[]);
  return {state,connected};
}
