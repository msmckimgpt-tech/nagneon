import type {SpeechTimelineItem} from '../shared/speech-listening.js';

export type RecognitionJob={
  sessionId:string;inputEpoch:string;sequence:number;utteranceId:string;
  frameStart:number;frameEnd:number;sourceRef:string;attemptId:string;attemptNo:number;
  signal:AbortSignal;publish:(update:{status:'partial'|'final'|'empty'|'failed'|'cancelled';text?:string;cues?:unknown})=>unknown;
};
export declare class SpeechListeningController{
  constructor(options:{sessionId:string;inputEpoch:string;
    recognize:(job:RecognitionJob)=>Promise<{status:'final'|'empty'|'cancelled';text?:string;cues?:unknown}>;
    concurrency?:number;maxAttempts?:number;idFactory?:()=>string;onCommit?:(item:SpeechTimelineItem)=>void;now?:()=>number});
  enqueue(value:{sequence:number;utteranceId:string;frameStart:number;frameEnd:number;sourceRef:string}):{accepted:boolean;duplicate:boolean};
  retryFailed():number;
  close():void;
  takeCommitted():SpeechTimelineItem[];
  snapshot():unknown;
  whenIdle():Promise<void>;
}
