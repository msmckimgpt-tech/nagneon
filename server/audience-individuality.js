// These are broad creative directions, not waiting viewers or demographic
// claims. A person is still composed by the model only when an arrival occurs.
// Only aggregate matches leave this function: no names, notes or experiences.
const interests = [
  ['게임의 규칙·조작을 만지는 재미', /게임|퍼즐|공략|빌드|속도 기록|타임어택|조작/],
  ['이야기·인물·작품 감상', /서사|소설|영화|만화|이야기|캐릭터|드라마/],
  ['음악·소리·리듬', /음악|악기|리듬|노래|음반|밴드|작곡/],
  ['먹는 즐거움·요리', /음식|요리|간식|맛집|커피|베이킹|차를/],
  ['몸을 움직이는 여가', /운동|스포츠|달리기|자전거|수영|등산|클라이밍/],
  ['밖에서 발견하는 풍경·장소', /산책|여행|동네|사진|풍경|골목|캠핑/],
  ['손으로 만드는 작은 것들', /문구|수첩|다이어리|책갈피|종이|공예|그림|뜨개|프라모델/],
  ['도구·기술을 고치거나 바꾸기', /기계|전자|키보드|코딩|수리|도구|조립|컴퓨터/],
  ['자연·생물 관찰', /식물|동물|새 관찰|곤충|반려|생물|어항|원예/],
  ['수집·배치·꾸미기', /수집|진열|인테리어|빈티지|소품|옷|패션|정리/],
  ['사람마다 다른 생활 방식', /생활 습관|일상 루틴|사람 구경|생활 방식|아침형|밤형/],
  ['아직 한 취미로 굳지 않은 호기심', /찍먹|새 취미|아직.*취미|이것저것|관심사.*자주/]
];
const voices = [
  ['말수는 적고 결론부터 짧게 말한다. 관심 없는 때에는 듣는다.', /말수.*적|단답|결론부터|조용|짧게/],
  ['자기 선택을 담백하게 밝힌다. 동의하지 않아도 싸움을 걸지 않는다.', /담백|직설|단호|선택.*밝|의견.*분명/],
  ['상황의 엉뚱한 면을 가끔 받아친다. 웃음이나 비유를 매번 붙이지 않는다.', /엉뚱|받아치|능청|장난|드립|농담/],
  ['궁금한 한 부분만 구체적으로 묻는다. 답을 들으면 질문을 끝낸다.', /질문|궁금|이유.*묻|호기심/],
  ['흥미가 붙은 주제에는 자신의 작은 경험이나 생각을 조금 풀어 말한다.', /풀어 말|수다|이야기.*덧붙|경험.*말|말이.*길/],
  ['호불호가 순간 반응에 드러난다. 모든 장면에 호들갑을 떨지는 않는다.', /감탄|호불호|즉각|반응.*빠|호들갑/]
];
const tensions = [
  ['익숙한 것을 편하게 반복하는 즐거움과 새로운 것을 놓치기 싫은 마음', /익숙|반복|안정|새로운/],
  ['끝까지 잘 해내는 만족과 중간 과정에서 놀고 싶은 마음', /완성|성취|끝까지|과정|완벽/],
  ['실용적인 선택과 쓸모없어도 마음에 드는 것 사이의 취향', /실용|쓸모|효율|낭만|감성/],
  ['혼자 몰입하는 시간과 가끔 같이 웃고 싶은 마음', /혼자|몰입|함께|같이/],
  ['직접 시행착오를 겪는 재미와 시간을 아끼고 싶은 마음', /시행착오|직접|시간.*아끼|지름길/],
  ['내 취향을 지키는 만족과 남의 취향을 시험해 보는 호기심', /내 취향|자기 취향|다른 취향|남의 취향|타협/]
];
const naming = [
  '발음이나 어감에서 떠오른 닉네임. 취미 이름을 그대로 쓰지 않아도 된다.',
  '일상적인 단어를 살짝 비튼 닉네임. 반드시 두 명사를 합치지는 않는다.',
  '게임에서 부르기 쉬운 짧은 닉네임. 직업·성격 소개처럼 만들지 않는다.',
  '별뜻 없이 마음에 든 별명. 시적이거나 예쁜 이름일 필요는 없다.'
];
const socialBands = [[.12,.34],[.35,.57],[.58,.79],[.8,.95]];
const skillBands = [[.08,.28],[.29,.49],[.5,.7],[.71,.9]];

function draw(random){const n=random();return Number.isFinite(n)?Math.max(0,Math.min(.999999999,n)):.5;}
function pick(items,counts,random,priors=items.map(()=>1)){
  // Soft pressure only: shared interests remain possible. No equal-speech quota.
  const weights=items.map((_,i)=>priors[i]/(1+counts[i])**2),total=weights.reduce((a,b)=>a+b,0);
  let n=draw(random)*total;
  for(let i=0;i<items.length;i++){n-=weights[i];if(n<0)return items[i];}
  return items.at(-1);
}
function direction(options,people,random){
  const counts=options.map(([,pattern])=>people.filter(p=>pattern.test(p.personality+' '+p.values)).length);
  return pick(options,counts,random)[0];
}
function trait(bands,people,key,random,priors){
  const counts=bands.map(([low,high])=>people.filter(p=>p[key]>=low&&p[key]<=high).length);
  const [low,high]=pick(bands,counts,random,priors);
  return Math.round((low+(high-low)*draw(random))*100)/100;
}

export function arrivalIndividuality(personas,source,random=Math.random){
  const people=personas.filter(p=>!p.system&&p.role!=='manager').slice(0,40).map(p=>({
    personality:String(p.personality||'').slice(0,1200),values:String(p.values||'').slice(0,1000),sociability:p.sociability,expertise:p.expertise
  }));
  return {
    interest:direction(interests,people,random),
    conversation:direction(voices,people,random),
    preference:direction(tensions,people,random),
    nameStyle:naming[Math.floor(draw(random)*naming.length)],
    sociability:trait(socialBands,people,'sociability',random,source==='browse'?[2,2,1,.5]:source==='clip'?[1,1.5,2,1]:[1,2,2,1]),
    expertise:trait(skillBands,people,'expertise',random,source==='guide'?[1,1.5,2,1.5]:[2,2,1,.5])
  };
}

export const individualityInstructions=`special.individuality는 이번 첫 만남에서만 사용하는 내부 창작 방향이다. 이미 만들어 둔 관객이나 실제 인구 통계가 아니다. 유입 동기는 source와 intent를 따르고, interest 안에서 한 가지 구체적인 취향을 새로 정한다. conversation은 관심 있는 순간의 반응 방식이다. preference의 양쪽 중 어디에 더 기우는지와 가끔 반대로 행동할 만한 조건을 하나 정한다. 모든 관객에게 같은 '존중·재촉 안 함'을 개성 대신 쓰지 않는다. 방송 규칙은 별도로 항상 지킨다.
personality에는 무엇에 관심을 두고 언제 말하거나 조용해지는지, values에는 어떤 선택을 왜 선호하는지 담는다. 똑같은 문장을 반복하는 고정 유행어·직무·금지 목록으로 성격을 만들지 않는다. 취미는 관심의 배경이며 모든 대화를 자기 취미 비유로 끌고 가지 않는다. nameStyle을 참고하되 고유한 별명을 스스로 정한다. special.usedNames는 이미 사용 중인 공개 닉네임이다. 같은 이름이나 숫자·기호만 덧붙인 변형은 피하고 별개의 이름을 만든다. 다른 관객의 성격·친분은 이 목록으로 알 수 없다. sociability와 expertise는 제시된 수치로 두고 그 정도에 맞게 구성한다. expertise는 실제 특정 게임을 알거나 방송을 봤다는 증거가 아니다. 이 방향의 제목이나 제작 과정을 관객의 말로 읽지 않는다. 기존 사람·스트리머와의 친분·구체적 과거 방송 경험을 만들지 않는다.`;
