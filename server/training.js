// Bounded broadcast practice ("연습") module for BACKSEAT.
//
// A local, offline rehearsal tool that lets a streamer practice handling common
// live-chat situations. Every audience line here is a *pre-written fictional*
// prompt — there are NO model calls, NO economy/points, NO permanent audience
// memory, and NO filesystem writes. The clock is injected so behaviour is
// deterministic under test. See docs/TRAINING.md for scope and limitations.

// Staged prompts are released one at a time, no faster than this real-time gap.
// Delivering at most one prompt per tick and rescheduling from "now" prevents a
// catch-up flood after the machine sleeps or a request stalls.
export const STAGE_INTERVAL_MS = 9000;

// Each scenario carries fictional staged prompts (2–4) and self-review
// questions. `prompts`/`reflection` stay internal; snapshot() exposes only the
// public {id,title,description,objective} projection.
export const SCENARIOS = [
  {
    id: 'opening',
    title: '오프닝 · 첫 인사와 뉴비 맞이',
    description: '방송을 막 켠 순간, 처음 온 시청자와 단골이 뒤섞여 인사를 건넵니다.',
    objective: '누구도 소외되지 않게 인사를 나누고, 처음 온 사람에게 방송 분위기를 짧게 안내하는 연습.',
    prompts: ['안녕하세요~ 오늘 처음 왔어요!', '오 방송 켰다 ㅋㅋ 기다렸어요', '여기 무슨 게임 하는 방이에요?', '첫 방문인데 분위기 좋네요 :)'],
    reflection: ['처음 온 시청자의 이름이나 질문에 반응했나요?', '단골과 뉴비 모두에게 인사가 닿았나요?']
  },
  {
    id: 'quiet',
    title: '조용한 채팅 · 반응이 없을 때',
    description: '채팅이 거의 멈추고 시청자들이 조용히 지켜보기만 합니다.',
    objective: '침묵을 자연스럽게 받아들이면서, 부담 없는 질문이나 상황 중계로 대화를 여는 연습.',
    prompts: ['...', '(조용히 시청 중)', '보고 있어요 그냥 말 없이 ㅎㅎ'],
    reflection: ['침묵을 억지로 메우려 하지 않았나요?', '시청자가 답하기 쉬운 열린 질문을 던졌나요?']
  },
  {
    id: 'repeated-failure',
    title: '반복 실패 · 같은 구간에서 계속 죽을 때',
    description: '같은 구간에서 여러 번 실패하자 채팅의 반응이 갈립니다.',
    objective: '조급함과 자책을 다스리고, 순수 응원과 훈수 요청을 구분해 대응하는 연습.',
    prompts: ['앗 또 죽었다 ㅠㅠ', '괜찮아요 천천히 해요!', '아까랑 똑같이 하시는데 방법을 바꿔보는 건 어때요?', '이번엔 될 것 같은데!'],
    reflection: ['실패에 대한 내 반응(자책·유머)을 어떻게 조절했나요?', '요청하지 않은 훈수와 순수 응원을 구분했나요?']
  },
  {
    id: 'backseat-advice',
    title: '원치 않는 훈수 · 시키지 않은 참견',
    description: '요청하지 않았는데 계속해서 플레이 방법을 지시하는 시청자가 있습니다.',
    objective: '훈수 정책을 분명히 하며 다른 시청자와의 균형을 지키고, 조언한 사람을 무안하지 않게 경계하는 연습.',
    prompts: ['거기서 왼쪽으로 가야죠', '아니 그거 말고 이거 먼저 사세요', '제 말대로 하면 되는데 왜 안 들으세요?', '훈수 죄송 ㅎㅎ 근데 진짜 이게 맞아요'],
    reflection: ['훈수에 대한 내 방송의 규칙을 분명히 전달했나요?', '조언한 시청자를 무안하지 않게 경계를 그었나요?']
  },
  {
    id: 'disagreement',
    title: '의견 충돌 · 시청자끼리 논쟁',
    description: '두 시청자가 플레이 방향을 두고 서로 다른 주장을 하며 부딪힙니다.',
    objective: '어느 편도 무시하지 않고 논쟁을 진정시키며 방송의 결정권을 스트리머가 쥐는 연습.',
    prompts: ['이건 무조건 공격템이 맞지', '아닌데요? 지금은 방어가 국룰인데', '님 게임 잘 모르시는 듯 ㅋㅋ', '싸우지들 마세요 ㅠㅠ'],
    reflection: ['양쪽 의견을 각각 인정했나요?', '논쟁이 인신공격으로 번지기 전에 개입했나요?']
  },
  {
    id: 'influx',
    title: '시청자 급증 · 갑자기 몰려들 때',
    description: '어딘가에서 방송이 알려져 짧은 시간에 많은 인사와 질문이 쏟아집니다.',
    objective: '모든 채팅에 답하려 애쓰기보다 흐름을 정리하고 우선순위를 정하는 연습.',
    prompts: ['헐 사람 갑자기 많아졌다', '님들 어디서 오셨어요?', '처음 왔는데 지금 무슨 상황이에요?', '안녕하세요 안녕하세요!!'],
    reflection: ['모든 메시지에 답하지 못해도 괜찮다고 받아들였나요?', '반복되는 질문을 한 번에 정리해 안내했나요?']
  },
  {
    id: 'spoiler-boundary',
    title: '스포일러 경계 · 앞선 내용 언급',
    description: '한 시청자가 아직 겪지 않은 내용을 흘리려 합니다. (실제 스포일러는 등장하지 않습니다.)',
    objective: '스포일러 기준을 분명히 세우고, 알려주려는 시청자를 부드럽게 막는 연습.',
    prompts: ['아 이 다음에 나오는 거 진짜 대박인데', '살짝만 말해도 돼요? 아주 조금만!', '스포 아니고 팁인데... 말해도 되나요?'],
    reflection: ['스포일러 기준을 시청자에게 명확히 전달했나요?', '알려주려는 호의를 존중하면서 경계를 지켰나요?']
  },
  {
    id: 'personal-boundary',
    title: '사적 질문 · 파라소셜 경계',
    description: '방송과 무관한 사생활을 파고드는 개인적인 질문이 이어집니다.',
    objective: '따뜻함을 유지하면서도 공개하고 싶지 않은 선을 편안하게 지키는 연습.',
    prompts: ['혹시 몇 살이세요? 사는 곳은요?', '애인 있어요? 진지하게 궁금해요', '개인 연락처 알려주시면 안 돼요?'],
    reflection: ['답하고 싶지 않은 질문을 불쾌감 없이 넘겼나요?', '공개 범위에 대한 내 기준이 일관됐나요?']
  },
  {
    id: 'donation-pressure',
    title: '후원 압박 · 대가를 요구할 때 (가상)',
    description: '가상의 후원을 언급하며 특정 행동을 요구합니다. 실제 후원·포인트·보상은 전혀 발생하지 않습니다.',
    objective: '후원과 방송 결정권을 분리하고, 압박에 휘둘리지 않으면서 감사를 표현하는 연습.',
    prompts: ['제가 후원하면 지금 그 캐릭터 바꿔줄 거죠?', '만원 쏠 테니까 제 말대로 해요', '후원했는데 왜 안 해줘요?'],
    reflection: ['후원과 방송 진행 결정을 분리해 설명했나요?', '감사는 표하되 무리한 요구는 정중히 거절했나요?']
  },
  {
    id: 'criticism',
    title: '비판과 악플 · 날 선 반응',
    description: '플레이나 방송 방식을 날카롭게 비판하는 시청자가 나타납니다.',
    objective: '건설적 비판과 단순 시비를 구분하고, 감정적으로 휘말리지 않는 연습.',
    prompts: ['이걸 이렇게밖에 못 해요?', '방송 좀 재미없네요 솔직히', '실력이 좀... 연습 더 하셔야 할 듯', '에이 그것도 못 깨요?'],
    reflection: ['비판에서 새겨들을 부분과 흘려보낼 부분을 나눴나요?', '감정이 상해도 방송 톤을 유지했나요?']
  },
  {
    id: 'technical-glitch',
    title: '기술 문제 (시뮬레이션) · 소리·화면 이슈',
    description: '시청자들이 소리나 화면 문제를 알립니다. 이 연습은 시뮬레이션이며 실제 장비를 멈추지 않습니다.',
    objective: '당황하지 않고 상황을 안내하며, 대기 멘트로 분위기를 유지하는 연습.',
    prompts: ['어? 소리가 안 들려요', '화면이 잠깐 멈춘 것 같아요', '저만 그런가요? 저는 잘 보여요', '괜찮아요 기다릴게요~'],
    reflection: ['문제 상황을 시청자에게 침착하게 안내했나요?', '기다리는 시청자를 위한 멘트를 준비했나요?']
  },
  {
    id: 'ending',
    title: '엔딩 · 방송 마무리',
    description: '방송을 마칠 시간, 시청자들이 인사와 아쉬움을 남깁니다.',
    objective: '오늘 함께한 시간을 정리하고, 다음을 기약하며 따뜻하게 마무리하는 연습.',
    prompts: ['오늘도 잘 봤어요~ 수고하셨어요!', '벌써 끝이에요? 아쉽다', '다음 방송 언제예요?', '잘 자요 다음에 또 올게요!'],
    reflection: ['함께한 시청자에게 감사를 전했나요?', '다음 방송에 대한 기대를 자연스럽게 남겼나요?']
  },
  {
    id: 'spam-flood',
    title: '도배 대응 · 규칙 위반',
    description: '한 시청자가 같은 말을 반복하거나 규칙을 어기며 채팅을 어지럽힙니다.',
    objective: '규칙을 일관되게 안내하고, 필요하면 매니저와 함께 단계적으로 대응하는 연습.',
    prompts: ['ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ', 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ', '봇인가? 계속 같은 말이네', '도배 좀 그만해요...'],
    reflection: ['경고 → 안내 → 조치의 단계를 지켰나요?', '규칙 적용이 특정인에게 치우치지 않았나요?']
  },
  {
    id: 'pacing',
    title: '방송 리듬 · 지치지 않게',
    description: '방송이 길어지며 집중력과 텐션이 떨어지는 신호가 보입니다.',
    objective: '무리하지 않고 휴식과 전환으로 지속 가능한 리듬을 만드는 연습.',
    prompts: ['오래 하셨는데 좀 쉬어도 돼요', '목 안 아프세요? 물 좀 드세요', '텐션 떨어져도 괜찮아요 편하게 해요'],
    reflection: ['스스로의 컨디션 신호를 알아차렸나요?', '쉬어가는 것을 시청자에게 편하게 전했나요?']
  }
];

const DISCLAIMER = '이 보고서는 관찰 가능한 행동 횟수와 진행 시간만 기록합니다. 공감·성공·실력을 의미적으로 평가하지 않으며, 점수·후원·영구 기억에 영향을 주지 않습니다.';
const publicScenario = (s) => ({ id: s.id, title: s.title, description: s.description, objective: s.objective });

export class TrainingRun {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.catalog = SCENARIOS;
    this.active = false;
    this.scenario = null;      // full internal scenario while active, else null
    this.participants = [];     // enabled non-manager personas captured at start
    this.stage = [];            // scenario.prompts for the active run
    this.deliveredCount = 0;    // staged prompts released so far
    this.nextDue = 0;           // earliest clock time the next prompt may appear
    this.startedAt = null;
    this.eventsSent = 0;
    this.actions = [];
    this.report = null;
  }

  snapshot() {
    return {
      active: this.active,
      scenario: this.active && this.scenario ? publicScenario(this.scenario) : null,
      catalog: this.catalog.map(publicScenario),
      startedAt: this.active ? this.startedAt : null,
      eventsSent: this.eventsSent,
      actions: this.actions.map((a) => ({ ...a })),
      report: this.report
    };
  }

  // start(id, personas) — begin a run. Refuses if one is already active and if
  // the scenario id is unknown. Only enabled, non-manager personas may speak.
  start(id, personas = []) {
    if (this.active) throw new Error('연습이 이미 진행 중입니다. 먼저 종료하세요.');
    const scenario = this.catalog.find((s) => s.id === id);
    if (!scenario) throw new Error('연습 시나리오를 찾을 수 없습니다.');
    this.participants = (Array.isArray(personas) ? personas : [])
      .filter((p) => p && p.enabled && p.role !== 'manager')
      .map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.scenario = scenario;
    this.stage = scenario.prompts;
    this.deliveredCount = 0;
    this.eventsSent = 0;
    this.actions = [];
    this.report = null;
    this.startedAt = this.now();
    this.nextDue = this.startedAt; // first line may appear on the first tick
    this.active = true;
    return this.snapshot();
  }

  // tick() — release staged fictional chat based on elapsed time. Returns at
  // most one event per call, so a long sleep cannot flood the chat on wake.
  tick() {
    if (!this.active) return [];
    if (this.deliveredCount >= this.stage.length) return [];
    if (!this.participants.length) return [];
    const now = this.now();
    if (now < this.nextDue) return [];
    const text = this.stage[this.deliveredCount];
    const speaker = this.participants[this.deliveredCount % this.participants.length];
    this.deliveredCount++;
    this.eventsSent++;
    this.nextDue = now + STAGE_INTERVAL_MS;
    return [{ personaId: speaker.id, text, kind: 'chat' }];
  }

  // action(name, text) — record an operator response / moderation / checklist
  // action. Text is stored only for the operator's own review; it is never
  // graded.
  action(name, text = '') {
    if (!this.active) throw new Error('진행 중인 연습이 없습니다. 먼저 연습을 시작하세요.');
    const action = String(name ?? '').trim();
    if (!action) throw new Error('행동 이름이 필요합니다.');
    const entry = { action, text: String(text ?? '').slice(0, 600), at: this.now() };
    this.actions.push(entry);
    this.actions = this.actions.slice(-200);
    return entry;
  }

  // stop() — end the run and produce a purely observational report: counts and
  // duration plus self-review questions. It deliberately makes no quality,
  // empathy or success judgement.
  stop() {
    if (!this.active) throw new Error('진행 중인 연습이 없습니다.');
    const now = this.now();
    const counts = new Map();
    for (const a of this.actions) counts.set(a.action, (counts.get(a.action) || 0) + 1);
    const actionCounts = Object.fromEntries(counts);
    const report = {
      scenarioId: this.scenario.id,
      scenarioTitle: this.scenario.title,
      startedAt: this.startedAt,
      endedAt: now,
      durationMs: Math.max(0, now - this.startedAt),
      eventsSent: this.eventsSent,
      participants: this.participants.length,
      totalActions: this.actions.length,
      actionCounts,
      responses: actionCounts.response || 0,
      moderations: actionCounts.moderation || 0,
      checklist: actionCounts.checklist || 0,
      reflection: this.scenario.reflection,
      disclaimer: DISCLAIMER
    };
    this.active = false;
    this.scenario = null;
    this.report = report;
    // eventsSent / actions are kept for review until the next run's start().
    return report;
  }
}
