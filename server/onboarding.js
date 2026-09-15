import {z} from 'zod';
import {Settings} from './schema.js';

export const OnboardingData=z.object({version:z.literal(1),status:z.enum(['new','completed','existing','skipped']),completedAt:z.number().finite().nonnegative().nullable()});
export const WelcomeSettings=z.object(Object.fromEntries(['streamer','title','category','crowdStyle','streamerStyle','adviceMode','mode'].map(key=>[key,Settings.shape[key]]))).strict();
export function initialOnboarding(existing=false){return {version:1,status:existing?'existing':'new',completedAt:null};}
export function finishOnboarding(studio,store,value,now=Date.now()){
  if(studio.running||studio.busy)throw new Error('방송을 종료한 뒤 시작 안내를 완료하세요.');
  const input=z.union([z.object({skip:z.literal(true)}).strict(),WelcomeSettings]).parse(value);
  // Persist configuration before completion. A failed completion write keeps
  // the guide available and can be retried without resetting any other data.
  if(!('skip' in input))studio.configure({...studio.settings,...input});
  const next={version:1,status:'skip' in input?'skipped':'completed',completedAt:now};store.save(next);store.data=next;studio.publish();return next;
}
