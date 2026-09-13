import {transcriptAnomaly} from './transcript-correction.js';

// Recomputed from this viewer's retained, witnessed words. No inferred profile
// or durable copy of the streamer's personality is created.
export function streamerExpression(history,{now=Date.now()}={}){
  const heard=history.filter(m=>m.kind==='streamer'&&!m.fictional&&m.time<=now&&now-m.time<1200000&&!transcriptAnomaly(m.text));
  const groups=[];
  for(const m of heard){
    let group=groups.at(-1);
    if(!group||m.time-group.through>8000||group.text.length+m.text.length>360){group={sourceIds:[],text:'',at:m.time,through:m.time,source:'witnessed-streamer-words'};groups.push(group);}
    group.sourceIds.push(m.id);group.text+=(group.text?'\n':'')+m.text;group.through=m.time;
  }
  const expressive=groups.filter(g=>/농담|장난|믿어|자신|기대|기쁘|아쉽|무섭|긴장|좋아|싫|취향|감사|고마|여러분|[ㅋㅎ]{2,}|하하/.test(g.text));
  return {recentPhrasing:groups.slice(-3),expressiveMoments:expressive.filter(g=>!groups.slice(-3).includes(g)).slice(-3),interpretation:'tentative-not-personality'};
}

// Only explicit reversals / outcomes supersede an in-flight speech reaction.
// Ordinary narration stays in order and does not continually abort inference.
export const revisesLiveSituation=text=>/(?:아니[,.!\s]|정정|잘못\s*(?:말|들)|그게\s*아니|취소|그만\s*해|조용히|말.{0,8}걸지|이제\s*(?:끝|됐)|(?:드디어|아\s*|어[?!]\s*).{0,15}(?:나왔|찾았|잡았)|클리어\s*했|처치\s*했|성공\s*했)/.test(text);
