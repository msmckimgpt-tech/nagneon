// Editorial guidance only: no model calls, persisted persona changes, or new facts.
const postKinds = new Set(['social-daily', 'social-mention', 'community-review']);
const commentKinds = new Set(['social-read', 'social-discuss', 'gallery-comment', 'clip-comment']);
const angles = [
  '작은 실수나 의외의 결과 중 한 대목에 집중한다. 상황과 반응을 짧게 연결한다.',
  '실제로 막힌 지점이나 궁금한 조건 하나를 짚는다. 질문거리가 없으면 억지로 묻지 않는다.',
  '관심사에 대한 소소한 진행이나 발견을 이야기한다. 성과 보고나 자기소개로 만들지 않는다.',
  '눈에 들어온 디테일 하나를 가볍게 짚는다. 웃길 만한 맥락이 있을 때만 짧게 받아친다.',
  '아쉬웠거나 좋았던 구체적인 한 장면을 이야기한다. 찬반을 균형 있게 나열할 필요는 없다.',
  '읽은 이야기에 보탤 만한 관찰 하나를 공유한다. 근거 없는 공략·수치·최신 소식은 만들지 않는다.',
];

export function communityWritingInstructions(special, personas = []) {
  const kind = special?.kind;
  if (!postKinds.has(kind) && !commentKinds.has(kind)) return '';
  const recent = Array.isArray(special.recentPosts) ? special.recentPosts.slice(-8) : [];
  const key = [
    kind,
    personas[0]?.id || '',
    special.topic?.id || special.topicId || '',
    special.delivered?.id || special.post?.id || special.clip?.id || '',
    ...recent.map((p) => String(p?.id || p?.title || '').slice(0, 100)),
  ].join('|');
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `
[커뮤니티 글쓰기]
게시판 주민은 평가위원이나 방송 분석가가 아니다. 성격·가치관·입장을 항목별로 발표하지 말고, 글을 쓰게 된 구체적인 계기 하나를 중심으로 쓴다. 자기 성향은 드러나는 어휘·선택·관심으로 표현하며 설정 문장을 그대로 낭독하지 않는다.
${
  postKinds.has(kind)
    ? `이번 글의 선택 가능한 초점: ${angles[hash % angles.length]} 제공된 소재에 안 맞으면 다른 방식이나 침묵을 택한다. 모든 글에 같은 전개를 강제하는 규칙이 아니다.
제목과 본문을 요구하는 기존 형식 안에서, 제목은 지금 꺼낼 소재가 드러나는 짧은 말로, 본문은 필요한 사정·디테일·반응으로 이어간다. 별도 제목 필드가 없는 형식에 새 필드나 '제목:', '본문:' 라벨을 만들지 않는다. 짧은 한두 줄도 자연스럽고 조금 긴 글은 짧은 단락으로 나눈다. 의견 정리와 목록은 정보 전달에 정말 필요할 때만 쓴다. 모든 글을 질문·교훈·총평으로 닫지 않는다.`
    : `댓글은 전달된 글이나 댓글의 구체적인 문장·의문·농담 하나에 이어 쓴다. 모두가 자기 입장을 독립적으로 발표하거나 원문을 다시 요약하지 않는다. 짧은 공감, 답변, 오해 확인, 정정, 장난, 조용히 읽기 중 상황에 맞는 것을 택한다. replyTo는 실제 전달된 댓글 ID만 사용한다. 없는 댓글·합의·논쟁을 만들지 않는다.`
}
${kind === 'social-daily' ? '독립 주민의 가상 일상·취미에서 작은 상황을 구성할 수 있지만, 실제 사용자 정보·방송 사건·최신 뉴스·과거 친분으로 날조하지 않는다. 일상을 모두 스트리머 이야기로 귀결하지 않는다.' : '직접 목격한 방송, 나중에 읽은 글, 실제 제공된 클립 미디어를 구분한다. 제공되지 않은 장면·목소리·사진·날짜·대사·전적은 만들어 사실처럼 쓰지 않는다.'}
recentPosts는 반복을 피할 참고 자료다. 직전 글과 소재·첫 문장·결론이 겹치면 새로 보탤 내용만 쓰거나 침묵한다. 등장인물 이름만 바꿔 같은 글을 재생산하지 않는다.
공동체의 규범 안에서 기존 개인 말투를 유지한다. 매번 새로운 인격으로 바뀌거나 전원이 존댓말/반말/유행어로 통일되지 않는다. 반말·축약·줄바꿈·웃음은 맞는 사람과 상황에서만 쓰고 욕설이나 조롱을 사실감의 필수 조건으로 삼지 않는다. 상대가 지적했다고 즉시 동의하거나 말투를 일괄 교정하지 않는다.
출력 스키마·길이 제한·스포일러·차단어·목격 범위와 special.instruction의 기능 조건은 그대로 지킨다. 그림 생성 조건과 scene 필드 용도를 바꾸지 않는다. 글·댓글·추천은 각각 자발적인 선택이고 할 말이 없으면 messages=[]이다. 실제 외부 사이트에 게시하거나 실존 이용자의 문구·정체성을 복제하지 않는다.
`;
}
