import {mkdirSync,writeFileSync,statSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ConversationJournal,emptyJournal} from '../server/conversation-journal.js';
import {JournalStore} from '../server/journal-store.js';
const folder='artifacts/journal-capacity-final-'+Date.now();mkdirSync(folder);
const sessionId=randomUUID(),data={...emptyJournal(),entries:Array.from({length:4000},(_,i)=>({id:randomUUID(),sessionId,at:i+1,personaId:'momo',name:'모모',text:'최대 용량 검증용 대화 원문. '.repeat(130),witnesses:['momo','gg','luna'],fictional:false,title:'부하 시험',pinned:false}))};
const store=new JournalStore(folder);store.load();store.save(data);const journal=new ConversationJournal(store.load(),v=>store.save(v));const writeMs=[];
for(let i=0;i<12;i++){const started=performance.now();journal.record({id:randomUUID(),personaId:'streamer',name:'플레이어',time:Date.now(),text:'새로운 약속 '+i},{sessionId,witnesses:['momo','gg'],title:'부하 시험'});writeMs.push(performance.now()-started);}
const started=performance.now();const recalled=journal.recall('momo','새로운 약속');const recallMs=performance.now()-started;
const result={folder,entryCount:new JournalStore(folder).load().entries.length,indexBytes:statSync(folder+'/conversation-journal-index.json').size,chunkFiles:readdirSync(folder+'/conversation-journal-chunks').length,writeMs,meanWriteMs:writeMs.reduce((a,b)=>a+b,0)/writeMs.length,recallMs,recalled:recalled.length,syntheticWorstCase:true};
writeFileSync('artifacts/journal-capacity-final-test.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
