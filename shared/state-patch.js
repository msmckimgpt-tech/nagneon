// Preserve unchanged references so memoized chat lines keep their DOM nodes.
export function applyStatePatch(state,patch){
  if(!state)throw Error('State patch requires an initial snapshot');
  const next={...state,...patch.set};
  if(patch.messages){
    const {removed,upsert,order}=patch.messages,deleted=new Set(removed),updates=new Map(upsert.map(m=>[m.id,m]));
    const existing=new Set(state.messages.map(m=>m.id));
    let messages=state.messages.filter(m=>!deleted.has(m.id)).map(m=>updates.get(m.id)||m);
    messages.push(...upsert.filter(m=>!existing.has(m.id)));
    if(order){const byId=new Map(messages.map(m=>[m.id,m]));messages=order.map(id=>{const m=byId.get(id);if(!m)throw Error('Missing message in patch');return m;});}
    next.messages=messages;
  }
  return next;
}
