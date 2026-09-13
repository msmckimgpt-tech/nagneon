import {readFile,writeFile} from 'node:fs/promises';
import {LocalSpeech} from '../server/local-speech.js';
const speech=new LocalSpeech();speech.start();
try{
  const limit=Date.now()+60000;while(!speech.ready&&Date.now()<limit){if(speech.error)throw new Error(speech.error);await new Promise(r=>setTimeout(r,250));}
  if(!speech.ready)throw new Error('speech startup timeout');const start=Date.now();
  const result=await speech.transcribe(await readFile('artifacts/korean-fixture.wav'),new AbortController().signal);
  const evidence={latencyMs:Date.now()-start,...result};await writeFile('artifacts/speech-result.json',JSON.stringify(evidence,null,2));console.log(evidence);
  if(!/안녕|게임|이야기/.test(result.text)||!Number.isFinite(result.cues?.volumeDb))throw new Error('Korean transcription or acoustic descriptors missing');
}finally{speech.close();}
