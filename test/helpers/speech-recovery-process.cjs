// Synthetic stdin/stdout protocol fixture. No audio decoder or device access.
const readline=require('node:readline');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const ready=()=>emit({ready:true,model:'synthetic-process'});
if(process.env.BACKSEAT_TEST_MANUAL_READY!=='1')ready();
readline.createInterface({input:process.stdin}).on('line',line=>{
  const job=JSON.parse(line);if(job.control==='ready'){ready();return;}
  const text=Buffer.from(job.audio,'base64').toString();
  if(text==='crash'){process.exit(17);return;}
  if(text==='hang')return;
  if(text==='invalid'){emit({id:job.id,error:'로컬 음성 인식에 실패했습니다.'});return;}
  emit({id:job.id,text,cues:{delivery:'합성 시험'},timing:{processingMs:1}});
});
