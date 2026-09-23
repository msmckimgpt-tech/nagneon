const normalize=value=>typeof value==='string'?value.normalize('NFKC').toLowerCase().trim():'';
const ascii=char=>!!char&&/[a-z0-9_]/.test(char);

// Resolve public names to stable IDs before eligibility narrows the roster.
// Disabled/absent current owners still reserve their name. This is a mention
// cue, not proof of hearing, intent, friendship or an obligation to answer.
export function createViewerAddressResolver(personas=[],members={},now=Date.now()){
  const names=new Map();
  const add=(name,id,current)=>{
    const key=normalize(name);if(!key)return;
    if(!names.has(key))names.set(key,{current:new Set(),former:new Set()});
    names.get(key)[current?'current':'former'].add(id);
  };
  for(const p of personas){
    add(p.name,p.id,true);
    const member=Array.isArray(members)?members.find(m=>m.id===p.id):members[p.id];
    for(const alias of Array.isArray(member?.aliases)?member.aliases:[]){
      if(Number.isFinite(alias?.at)&&alias.at>now)continue;
      add(alias?.name,p.id,false);
    }
  }
  const entries=[...names].map(([name,owners])=>{
    const ids=owners.current.size?owners.current:owners.former;
    return {name,id:ids.size===1?[...ids][0]:null};
  });
  return text=>{
    const line=normalize(text),matches=[];
    for(const {name,id} of entries){
      let start=line.indexOf(name);
      while(start!==-1){
        const end=start+name.length;
        // Do not find Cat in Catalog; Korean particles and honorifics remain
        // valid suffixes. No fuzzy correction of names or streamer speech.
        if(!(ascii(name[0])&&ascii(line[start-1]))&&!(ascii(name.at(-1))&&ascii(line[end])))matches.push({start,end,id});
        start=line.indexOf(name,start+1);
      }
    }
    const covered=[],ids=new Set();
    // A longer nickname also reserves its span when ownership is ambiguous.
    // A separate occurrence of the shorter nickname can still address it.
    for(const match of matches.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start)){
      if(covered.some(span=>match.start<span.end&&match.end>span.start))continue;
      covered.push(match);if(match.id!==null)ids.add(match.id);
    }
    return ids;
  };
}
