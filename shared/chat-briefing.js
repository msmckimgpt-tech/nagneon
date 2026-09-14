// An extractive listening aid, never an inferred answer/intent or another copy
// of the journal. Callers supply only currently retained, public messages.
export function chatBriefing(messages,{now=Date.now(),startedAt=0,mode='live',enabledIds=[]}={}){
  const since=Math.max(startedAt||0,now-60_000),enabled=new Set(enabledIds);
  const recent=messages.filter(m=>m.time>=since&&m.time<=now&&m.kind==='chat'&&!m.fictional&&enabled.has(m.personaId));
  if(mode!=='live')return {since,until:now,count:0,speakers:0,items:[]};
  const groups=new Map();
  for(const m of recent){
    const text=m.text.normalize('NFKC').trim().replace(/\s+/g,' ');
    const key=text.toLocaleLowerCase('ko-KR');
    if(!key)continue;
    const prior=groups.get(key);
    if(prior){prior.ids.push(m.id);prior.lastAt=m.time;continue;}
    groups.set(key,{ids:[m.id],lastAt:m.time,question:/[?？]|(?:나요|까요|인가요|뭔가요|뭐예요)[.!…\s]*$/.test(text),donation:!!m.donation});
  }
  const candidates=[...groups.values()];
  // Questions and donations deserve attention, without burying all other chat.
  const priority=candidates.filter(m=>m.question||m.donation).sort((a,b)=>b.lastAt-a.lastAt).slice(0,3);
  const selected=new Set(priority);
  const reactions=candidates.filter(m=>!selected.has(m)&&!m.question&&!m.donation).sort((a,b)=>b.ids.length-a.ids.length||b.lastAt-a.lastAt).slice(0,2);
  return {since,until:now,count:recent.length,speakers:new Set(recent.map(m=>m.personaId)).size,items:[...priority,...reactions].sort((a,b)=>a.lastAt-b.lastAt).map(({lastAt,...item})=>item)};
}
