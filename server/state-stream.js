// Wire optimization only: no generated response, screen or remembered fact is
// cached. A new connection always receives the entire current public snapshot.
export class StateStream {
  constructor(){this.previous=null;}
  encode(state){
    const serialized=JSON.stringify(state),current=JSON.parse(serialized);
    if(!this.previous||Object.keys(this.previous).some(key=>!(key in current))){this.previous=current;return `data: ${serialized}\n\n`;}
    const set={};let messages;
    for(const [key,value] of Object.entries(current)){
      if(JSON.stringify(value)===JSON.stringify(this.previous[key]))continue;
      if(key!=='messages'){set[key]=value;continue;}
      const before=this.previous.messages||[],after=value;
      const old=new Map(before.map(m=>[m.id,m])),next=new Set(after.map(m=>m.id));
      if(old.size!==before.length||next.size!==after.length){set.messages=after;continue;}
      const removed=before.filter(m=>!next.has(m.id)).map(m=>m.id);
      const upsert=after.filter(m=>JSON.stringify(m)!==JSON.stringify(old.get(m.id)));
      const expected=[...before.filter(m=>next.has(m.id)).map(m=>m.id),...after.filter(m=>!old.has(m.id)).map(m=>m.id)];
      const order=after.map(m=>m.id);
      const delta={removed,upsert,...(JSON.stringify(order)===JSON.stringify(expected)?{}:{order})};
      if(JSON.stringify(delta).length<JSON.stringify(after).length)messages=delta;else set.messages=after;
    }
    this.previous=current;
    if(!Object.keys(set).length&&!messages)return '';
    const patch=JSON.stringify({set,...(messages?{messages}:{})});
    return patch.length<serialized.length?`event: state-patch\ndata: ${patch}\n\n`:`data: ${serialized}\n\n`;
  }
}

// A stalled window gets the latest snapshot after drain, not an unbounded
// backlog of historical snapshots. The last accepted frame remains the base.
export class StateFeed {
  constructor(response,{patches=false,currentState}){
    this.response=response;this.currentState=currentState;this.encoder=patches?new StateStream():null;this.blocked=false;this.dirty=false;this.closed=false;
    this.drain=()=>{this.blocked=false;if(this.dirty){this.dirty=false;this.send(this.currentState());}};
    response.on('drain',this.drain);
  }
  write(frame){if(this.closed||!frame)return;if(this.blocked){this.dirty=true;return;}this.blocked=!this.response.write(frame);}
  send(state){if(this.closed)return;if(this.blocked){this.dirty=true;return;}this.write(this.encoder?this.encoder.encode(state):`data: ${JSON.stringify(state)}\n\n`);}
  display(value){this.write(`event: chat-display\ndata: ${JSON.stringify(value)}\n\n`);}
  heartbeat(){if(!this.blocked)this.write(': heartbeat\n\n');}
  close(){this.closed=true;this.response.off('drain',this.drain);}
}
