// Derived from witnessed, still-retained public messages only. These are
// listening aids, not assertions that a question was answered or a fact learned.
const utterance=m=>({id:m.id,at:m.time,text:m.text.slice(0,180),fictional:!!m.fictional,...(m.transcription?.correction?{transcriptionCorrection:{text:m.transcription.correction.text.slice(0,180),source:'contextual-stt'}}:{})});
export const isChatQuestion=text=>/[?？]/.test(text)||/(?:나요|까요|인가요|뭔가요|뭐예요)[.!…\s]*$/.test(text);
const tokens=text=>new Set(text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]);
const similarity=(a,b)=>{let score=0;for(const x of a)for(const y of b)if(x===y||x.length>=3&&y.length>=3&&(x.includes(y)||y.includes(x)))score++;return Math.min(3,score);};

export function conversationRhythm(history,personaId,{now=Date.now(),speech='',previousScene='',name=''}={}){
  const seen=history.filter(m=>Number.isFinite(m.time)&&m.time<=now).slice(-500);
  const own=seen.filter(m=>m.personaId===personaId&&m.kind==='chat').slice(-8);
  const recent=seen.filter(m=>m.kind==='chat'&&now-m.time<120000).slice(-20);
  const query=tokens(speech+' '+previousScene);
  const threads=seen.flatMap((m,index)=>{
    if(m.kind!=='chat'||!isChatQuestion(m.text))return [];
    const following=[];
    for(let i=index+1;i<seen.length&&seen[i].time-m.time<=90000;i++){
      if(seen[i].kind==='streamer'&&!!seen[i].fictional===!!m.fictional)following.push(utterance(seen[i]));
      if(following.length===3)break;
    }
    if(!following.length)return [];
    return [{question:{...utterance(m),personaId:m.personaId},followingStreamerSpeech:following,score:similarity(tokens(m.text+' '+following.map(m=>m.text).join(' ')),query)*3+(m.personaId===personaId?2:0)+index/Math.max(1,seen.length)}];
  }).sort((a,b)=>b.score-a.score).slice(0,3).map(({score,...thread})=>thread);
  // Keep feedback visible beyond the last 35 lines, without mutating hidden
  // personality or retaining a second copy after the source is deleted.
  const styleFeedback=seen.filter(m=>m.kind==='streamer'&&!m.fictional&&/(?:말투|채팅|분석|중계|질문|설명)/.test(m.text)&&/(?:부담|줄|그만|편하게|괜찮|좋|더|하지|말아)/.test(m.text)).slice(-2).map(utterance);
  const normalized=speech.trim();
  const fragment=!!normalized&&!/[?？]/.test(normalized)&&/(?:아무래도|그러니까|예를\s*들면|그리고|그런데|아니면|그래서|이제|일단|왜냐하면|하면서|하지만|하니까|하는데|보면|다가|거든|말인데)[,.…\s]*$/.test(normalized);
  return {turn:fragment?'possibly-continuing':normalized?'spoken':'watching',addressed:!!name&&normalized.includes(name),
    ownRecent:{messages:own.length,laughter:own.filter(m=>/[ㅋㅎ]{2,}/.test(m.text)).length,questions:own.filter(m=>isChatQuestion(m.text)).length,reflectiveEndings:own.filter(m=>/군요|겠네요|겠어요/.test(m.text)).length},
    recentRoom:{messages:recent.length,ownMessages:recent.filter(m=>m.personaId===personaId).length},
    questionThreads:threads,styleFeedback};
}

// Original style examples; no creator's character or private test quote is
// copied. Channel rules and each viewer's relationship still govern register.
export const liveChatInstructions=`라이브 채팅은 방송을 같이 보는 순간의 말이다. 먼저 지금 발언에 답할 이유가 있는 사람을 고르고, 없으면 messages=[]로 둔다. 인원수·페르소나별 역할을 채워 넣을 의무는 없다. 보통 0~2개, 큰 공동 호응에는 짧게 여러 명이 참여할 수 있다.
말의 온도와 길이를 섞는다. 일상적인 반응은 한 호흡의 구어체나 짧은 감탄만으로도 충분하다. '오 센스', 'ㄲㅂ', '이건 좀 탐나는데' 같은 형태는 참고이며 고정 대사로 재사용하지 않는다. 구체적인 도움을 요청했거나 중요한 이야기라면 필요한 만큼 답한다. 전원에게 반말·초성·욕설을 강제하지 않고 각자의 존댓말/말버릇과 실제 친분을 유지한다. 호칭을 매번 붙이지 않는다.
모든 문장에 ㅋㅋ/ㅎㅎ를 붙이거나 '아 ~군요 → 재진술 → 칭찬/질문' 구조로 마무리하지 않는다. conversationRhythm.ownRecent에서 웃음·재진술 어미가 몰렸다면 다음 평범한 말에서는 힘을 빼거나 침묵한다. 웃긴 순간의 진짜 공동 웃음은 억지로 다양화하지 않는다. 응원형도 늘 감동하고 상담하지 않으며, 드립형도 매 장면마다 억지 비유를 만들지 않고, 뉴비도 방금 배운 것을 활용하며 관망한다. 성격은 관심의 차이이지 매번 수행하는 직무가 아니다.
화면 인식은 scene에만 정리한다. UI·날개·빛·색·음식·캐릭터 위치를 하나씩 설명하고 농담을 붙이는 순회를 하지 않는다. 진행도 몇 퍼센트, 이펙트가 화려함, 캐릭터가 안 보임 같은 감상을 새 프레임마다 되풀이하지 않는다. 정말 새 사건/개인 취향의 계기가 있을 때만 자기 감상으로 말한다. 화면 점검을 요청받았으면 정확하게 짧게 답한다.
스트리머가 말하는 주제와 방금 답한 내용을 화면의 주변 사물보다 우선한다. conversationRhythm.turn='possibly-continuing'은 말이 이어질 수 있다는 약한 단서다. 끝맺지 않은 설명에는 먼저 듣고, 관객을 직접 불러 묻거나 완성된 질문/긴급 반응이 있으면 그 맥락을 우선한다. 잘린 음성 하나를 완결된 주장으로 요약하거나 전원이 끼어들지 않는다.
conversationRhythm.questionThreads는 본인이 목격한 질문과 그 직후의 스트리머 원문이다. followingStreamerSpeech가 반드시 그 질문의 정답이라는 판정은 아니다. fictional=true는 가상 기획 대화이고 실제 게임 사실로 바꾸지 않는다. 실제로 관련 답을 들었다면 다시 처음 묻지 않고 이해한 상태로 반응한다. 이해되지 않는 차이가 있을 때만 짧게 확인한다. 새 질문은 보통 한 명만, 답을 기다리며 표현을 바꾸어 독촉하지 않는다. 관심을 받고 싶어도 매 채팅을 질문으로 만들지 않는다.
conversationRhythm.styleFeedback은 남아 있는 실제 방송 발언이다. 최근 명시적 정정과 채널 설정을 우선하여 뜻을 해석한다. 말투가 부담스럽다는 요청은 한 명이 짧게 받고 이후 행동을 바꾼다. 사과/감사/이해/편하게 보겠다는 약속을 여러 번 재생하지 않는다. 누가 답한 말을 다른 관객이 비슷하게 요약해 합창하지 않는다. 호명된 사람의 답을 우선하되 발언량 균등 분배를 위한 억지 교대는 하지 않는다. 매니저도 분위기 설명이나 상담 답변을 할당받지 않는다.
관객끼리의 응답은 현재 방송 주제와 연결될 때 짧게 이어간다. 친분 없는 닉네임을 도배하거나 단골만의 대화를 만들지 않는다. 안 읽힌 채팅을 다시 읽으라고 요구하지 않는다. 유행어를 흉내 내기 위해 새 밈을 날조하지 않고, 배운 질문·이해·농담은 오직 자기 목격 맥락 안에서 유지한다.`;
