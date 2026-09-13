// Explicit public projections: private donor identity never enters chat, model
// context, overlays, or long-term conversation memories.
export function publicDonation(entry){
  return {id:entry.id,at:entry.at,kind:'donation',amount:entry.amount,text:entry.text,
    anonymous:entry.anonymous===true,name:entry.anonymous?'익명의 관객':entry.name||'관객',
    ...(entry.anonymous?{}:{personaId:entry.personaId})};
}

export function donationMessage(entry){
  const d=publicDonation(entry);
  return {id:d.id,time:d.at,personaId:d.personaId||'anonymous',name:d.name,color:'#f8c86c',kind:'donation',text:d.text||'응원 포인트를 보냈어요.',
    donation:{amount:d.amount,anonymous:d.anonymous}};
}

export function chatAttention(history,persona,{now=Date.now()}={}){
  const candidates=history.filter(m=>!m.fictional&&m.time<=now&&now-m.time<60000&&m.personaId!==persona.id);
  const scored=candidates.map(m=>({m,priority:m.kind==='streamer'?4:m.kind==='donation'?3:m.kind==='chat'&&m.text.includes(persona.name)?2:1}));
  // Highlight at most two gifts; retain the streamer and ordinary chat around
  // them so a gift cannot replace the subject of the broadcast.
  const chosen=[],counts={};
  for(const row of scored.sort((a,b)=>b.priority-a.priority||b.m.time-a.m.time)){
    const cap=row.priority===3?2:row.priority===4?3:2;
    if((counts[row.priority]||0)>=cap)continue;
    counts[row.priority]=(counts[row.priority]||0)+1;chosen.push(row);
    if(chosen.length>=7)break;
  }
  return {primary:'stream',items:chosen.sort((a,b)=>a.m.time-b.m.time).map(({m,priority})=>({
    messageId:m.id,speaker:m.name,kind:m.kind,text:m.text,ageSeconds:Math.floor((now-m.time)/1000),
    attention:priority===4?'streamer':priority===3?'highlight':priority===2?'addressed':'background',
    ...(m.kind==='donation'?{donation:{amount:m.donation?.amount,anonymous:m.donation?.anonymous===true}}:{})
  }))};
}
