// Domain policies own eligibility and lifecycle; JEV only chooses from short,
// versioned text projections. Nothing here creates witnesses or stored facts.
const short = (value, size = 240) => String(value || '').slice(0, size);
const choice = (instructions, candidates) => ({
  type: 'choice',
  instructions,
  criteria: { 'keep-existing': '불확실하거나 기존 선택을 유지한다.', ...candidates },
});
const noul = (instructions) => ({ type: 'noul', instructions });
export function confidentChoice(answer, allowed) {
  if (
    answer?.type !== 'choice' ||
    !Number.isFinite(answer.confidence) ||
    answer.confidence < 0.9 ||
    answer.confidence > 1 ||
    !allowed.includes(answer.choice)
  )
    return null;
  const p = answer.probabilities?.[answer.choice];
  if (!Number.isFinite(p) || p < 0.9 || p > 1) return null;
  return answer.choice;
}
export function certainNoul(answer) {
  const p = answer?.type === 'noul' ? answer.noul : null;
  return Number.isFinite(p) && p >= 0 && p <= 1
    ? p >= 0.95
      ? true
      : p <= 0.05
        ? false
        : null
    : null;
}
function current(decision, result, valid) {
  if (result?.kind !== 'proposal' || !valid()) return false;
  try {
    decision.assertCurrent(result);
    return true;
  } catch {
    return false;
  }
}
const interest = (p) => ({
  personality: short(p?.personality, 180),
  values: short(p?.values, 120),
});
const enabled = (s, task, feature = 'reaction') => !!s.decision?.enabled(task, feature);
const recallExclusions = (packet) => packet.chatHistory.map((m) => m.id);
export const liveDecisionEnabled = (s, phase, feature) =>
  (phase === 'before'
    ? ['live-plan', 'memory-rerank', 'intent-hint', 'route-hint']
    : ['reaction-check', 'clip-relevance']
  ).some((t) => enabled(s, t, feature));

export async function prepareLiveDecision(s, context, args, { signal, epoch, operation }) {
  const tasks = ['live-plan', 'memory-rerank', 'intent-hint', 'route-hint'].filter((t) =>
    enabled(s, t, args.aiFeature),
  );
  if (!tasks.length) return;
  const questions = {},
    state = { speech: short(args.speech, 1000), viewers: [] },
    plans = [];
  const journalRevision = s.journal.data.revision;
  const valid = () =>
    !signal.aborted &&
    s.running &&
    epoch === s.epoch &&
    !operation.superseded &&
    s.journal.data.revision === journalRevision &&
    plans.every((plan) => plan.current()) &&
    context.eligiblePersonas.every(
      (p) =>
        s.settings.personas.some((v) => v.id === p.id && v.enabled) &&
        s.audience.data.members[p.id]?.joinedAt === context.visits.get(p.id),
    );
  context.eligiblePersonas.slice(0, 20).forEach((p, i) => {
    state.viewers.push({ id: `v${i}`, ...interest(p) });
  });
  if (tasks.includes('live-plan') && state.viewers.length > 1 && args.speech.trim())
    questions.target = choice(
      '현재 발언에 자연스럽게 먼저 응답할 수 있는 관객. 직접 호명은 기존 규칙이 우선하며 다른 관객을 제외하지 않는다.',
      Object.fromEntries(
        state.viewers.map((v, i) => [v.id, short(context.eligiblePersonas[i].personality)]),
      ),
    );
  if (tasks.includes('intent-hint') && args.speech.trim())
    questions.intent = choice(
      '현재 streamer 발언의 대화 의도만 분류한다. 과거 인용은 현재 요청이 아니다. 훈수·검색 권한이나 설정을 변경하지 않는다.',
      {
        response: '현재 질문에 답하기',
        clarification: '현재 표현의 의미를 확인하기',
        acknowledge: '감정·말에 짧게 호응하기',
      },
    );
  const routes = tasks.includes('route-hint') ? s.provider.decisionRoutes?.(args) : null;
  if (routes?.candidates.length > 1) {
    state.routes = routes.candidates;
    questions.route = choice(
      '사용자가 이 역할에 지정하고 필요한 기능을 지원하는 연결만 선택한다. 비교 근거가 없으면 기존 경로를 유지한다.',
      Object.fromEntries(routes.candidates.map((c) => [c.id, { model: c.model, kind: c.kind }])),
    );
  }
  if (tasks.includes('memory-rerank') && args.speech.trim()) {
    // Separate source quotas prevent one library from consuming the whole live
    // request. Other enabled questions are already reserved. Oversized bundles
    // keep their original recall; no second request or partial bundle is sent.
    const remaining = { journal: 24, clip: 24, social: 24 };
    const perViewer = Math.max(1, Math.floor(24 / Math.min(20, context.eligiblePersonas.length)));
    const add = (i, kind, candidates, apply, isCurrent) => {
      const bounded = candidates.slice(
        0,
        Math.min(kind === 'journal' ? 12 : 8, perViewer, remaining[kind]),
      );
      if (!bounded.length) return;
      const id = kind === 'journal' ? `memory_${i}` : `${kind}_memory_${i}`;
      const field = kind === 'journal' ? 'memories' : `${kind}Memories`;
      const refs = bounded.map((c, j) => ({
        id: kind === 'journal' ? `r${j}` : `${kind === 'clip' ? 'c' : 's'}${i}_${j}`,
        text: short(c.text, 160),
      }));
      state.viewers[i][field] = refs;
      questions[id] = choice(
        `viewers[${i}] 본인에게 허용된 ${kind} 기억 중 현재 발언에 가장 관련 있는 항목 하나. 소개·읽은 글은 직접 보거나 들은 경험이 아니며 원문을 바꾸지 않는다.`,
        Object.fromEntries(refs.map((r) => [r.id, r.text])),
      );
      if (
        JSON.stringify(state).length > 22000 ||
        JSON.stringify({ state, questions }).length > 44000
      ) {
        delete state.viewers[i][field];
        delete questions[id];
        return;
      }
      remaining[kind] -= bounded.length;
      plans.push({ id, refs, candidates: bounded, apply, current: () => isCurrent(bounded) });
    };
    context.eligiblePersonas.slice(0, 20).forEach((p, i) => {
      const packet = context.personalContext.viewerContext[p.id];
      const journalBaseline = new Set(packet.recollections.map((entry) => entry.sourceId));
      const journal = s.journal.recallCandidates(p.id, args.speech, recallExclusions(packet));
      add(
        i,
        'journal',
        journal.optional.filter((entry) => !journalBaseline.has(entry.id)),
        (id) => {
          packet.recollections = s.journal
            .recall(p.id, args.speech, recallExclusions(packet), { preferredIds: [id] })
            .map((e) => ({
              ...e,
              experience:
                e.kind === 'donation'
                  ? 'witnessed-donation'
                  : e.speakerId === p.id
                    ? 'own-words'
                    : 'witnessed-words',
            }));
        },
        () => s.journal.data.revision === journalRevision,
      );
      // Baseline entries are represented by keep-existing. Spend limited room
      // only on alternatives, so even one slot can expand a later viewer's recall.
      const clipBaseline = new Set(packet.clipMemories.map((c) => c.clipId));
      const clips = s.clips
        .recallCandidates(p.id, args.speech, context.capturedAt)
        .filter((c) => !clipBaseline.has(c.id));
      add(
        i,
        'clip',
        clips,
        (id) => {
          packet.clipMemories = s.clips.recall(p.id, args.speech, context.capturedAt, {
            preferredIds: [id],
          });
        },
        (candidates) => s.clips.recallCandidatesCurrent(p.id, candidates),
      );
      const social = s.social.memoryCandidates(p.id).slice(0, -3).reverse();
      add(
        i,
        'social',
        social,
        (id) => {
          packet.heardFromCommunity = s.social.memory(p.id, { preferredIds: [id] });
        },
        (candidates) => s.social.memoryCandidatesCurrent(p.id, candidates),
      );
    });
  }
  if (!Object.keys(questions).length || !valid()) return valid;
  const result = await s.decision.advise(
    tasks[0],
    { state, questions },
    {
      signal,
      aiFeature: args.aiFeature,
      questionVersion: 1,
      scopeToken: {
        epoch,
        session: s.sessionId,
        at: context.capturedAt,
        journalRevision,
        visits: [...context.visits],
        speech: short(args.speech, 1000),
      },
    },
  );
  if (!current(s.decision, result, valid)) return valid;
  const answers = result.value.answers;
  let applied = false;
  for (const plan of plans) {
    const id = confidentChoice(
      answers[plan.id],
      plan.refs.map((r) => r.id),
    );
    if (id) {
      plan.apply(plan.candidates[plan.refs.findIndex((r) => r.id === id)].id);
      applied = true;
    }
  }
  const target = confidentChoice(
    answers.target,
    state.viewers.map((v) => v.id),
  );
  if (target) {
    const p = context.eligiblePersonas[Number(target.slice(1))];
    context.eligibleSettings = {
      ...context.eligibleSettings,
      personas: [p, ...context.eligiblePersonas.filter((v) => v.id !== p.id)],
    };
    args.settings = context.eligibleSettings;
    applied = true;
  }
  const intent = confidentChoice(answers.intent, ['response', 'clarification', 'acknowledge']);
  if (intent) {
    for (const packet of Object.values(context.personalContext.viewerContext))
      packet.intentHint = intent;
    applied = true;
  }
  const route =
    routes &&
    confidentChoice(
      answers.route,
      routes.candidates.map((c) => c.id),
    );
  if (route) {
    args.decisionRouteHint = { token: routes.token, id: route };
    applied = true;
  }
  if (applied) s.decision.accepted(result);
  return valid;
}

export async function checkLiveDecision(
  s,
  context,
  result,
  { speech, signal, epoch, operation, aiFeature, clipContext },
) {
  const reactions = enabled(s, 'reaction-check', aiFeature),
    clips = enabled(s, 'clip-relevance', aiFeature) && s.autonomy && s.settings.autoHighlights;
  if (!reactions && !clips) return result;
  const observation = result.observation,
    questions = {},
    state = { speech: short(speech, 1000), messages: [], clips: [] };
  const addressed = s.audience.addressing(s.settings, s.now())(speech);
  const duplicateEvidence = new Map();
  // Explicit user turns may have only one candidate that survives admission.
  // Keep every candidate for the existing hard filters instead of duplicating
  // their evolving rules (spoilers, blocked text, advice, visits and pacing).
  if (reactions && !speech.trim())
    observation.messages.slice(0, 12).forEach((m, i) => {
      const packet = context.personalContext.viewerContext[m.personaId];
      if (!packet || m.kind !== 'chat' || addressed.has(m.personaId)) return;
      // Only another utterance by this same speaker can support omission; a
      // different viewer's memory is never evidence that this viewer repeated it.
      const evidence = [
        ...packet.chatHistory.filter((e) => e.personaId === m.personaId).slice(-3),
        ...observation.messages.slice(0, i).filter((e) => e.personaId === m.personaId),
      ].slice(-4);
      if (!evidence.length) return;
      const refs = evidence.map((e, j) => ({ id: `e${j}`, text: short(e.text) }));
      state.messages.push({ id: `m${i}`, text: short(m.text), evidence: refs });
      duplicateEvidence.set(i, refs);
      questions[`message_${i}`] = choice(
        `messages의 m${i}가 새 정보나 현재 질문의 답 없이 이미 한 말을 반복하는 경우에만 정확한 evidence ID를 고른다. 짧은 감탄·새 답변·불확실한 경우 keep-existing. 화면 사실은 판단하지 않는다.`,
        Object.fromEntries(refs.map((e) => [e.id, e.text])),
      );
    });
  const picks = clips ? s.clipFeatures.eligiblePicks(observation, clipContext()) : [];
  if (picks.length > 1) {
    state.clips = picks.map((p, i) => ({
      id: `c${i}`,
      title: short(p.title),
      reason: short(p.reason),
    }));
    questions.clip = choice(
      '적격 핫클립 후보 중 구체적이고 중복이 적은 소개 하나를 우선한다. 픽셀·소리를 봤다고 추측하지 않는다.',
      Object.fromEntries(state.clips.map((c) => [c.id, { title: c.title, reason: c.reason }])),
    );
  }
  if (!Object.keys(questions).length) return result;
  const journalRevision = s.journal.data.revision;
  const valid = () =>
    !signal.aborted &&
    s.running &&
    s.epoch === epoch &&
    !operation.superseded &&
    s.journal.data.revision === journalRevision;
  if (!valid()) return result;
  const judged = await s.decision.advise(
    reactions ? 'reaction-check' : 'clip-relevance',
    { state, questions },
    {
      signal,
      aiFeature,
      questionVersion: 1,
      scopeToken: {
        epoch,
        session: s.sessionId,
        at: context.capturedAt,
        journalRevision,
        visits: [...context.visits],
      },
    },
  );
  if (!current(s.decision, judged, valid)) return result;
  const drop = new Set();
  for (const [i, refs] of duplicateEvidence)
    if (
      confidentChoice(
        judged.value.answers[`message_${i}`],
        refs.map((e) => e.id),
      )
    )
      drop.add(i);
  const pick = confidentChoice(
    judged.value.answers.clip,
    state.clips.map((c) => c.id),
  );
  if (!drop.size && !pick) return result;
  const updated = { ...observation, messages: observation.messages.filter((_, i) => !drop.has(i)) };
  if (pick) {
    const first = picks[Number(pick.slice(1))];
    updated.clipPicks = [first, ...(observation.clipPicks || []).filter((p) => p !== first)];
  }
  s.decision.accepted(judged);
  return { ...result, observation: updated };
}

export async function communityInterest(s, { state, scope, signal, valid }) {
  if (!enabled(s, 'community-affinity', 'community') || !valid()) return null;
  const result = await s.decision.advise(
    'community-affinity',
    {
      state,
      questions: {
        interested: noul(
          '이 관객의 공개 성격·가치관과 실제 제공된 글이 관련 있어 자발적으로 관심을 가질지 판단한다. 글 밖의 방송 경험·관계는 추측하지 않는다.',
        ),
      },
    },
    { signal, aiFeature: 'community', questionVersion: 1, scopeToken: scope },
  );
  if (!current(s.decision, result, valid)) return null;
  const interested = certainNoul(result.value.answers.interested);
  return interested === null ? null : { interested, result };
}
export function communityProjection(viewer, delivered) {
  return { viewer: interest(viewer), delivered };
}

export async function selectCultureDocuments(s, documents, { signal, valid, scope }) {
  if (!documents.length || !enabled(s, 'culture-relevance', 'culture') || !valid())
    return { documents };
  const bounded = documents.slice(0, 3),
    questions = Object.fromEntries(
      bounded.map((_, i) => [
        `document_${i}`,
        noul(
          `documents의 d${i}는 한국어 게임·인터넷 대화의 표현 방식·농담·사용 맥락을 배우는 데 관련된 공개 글인가? 로그인·광고·탐색 메뉴뿐인 내용은 관련 없다.`,
        ),
      ]),
    );
  const result = await s.decision.advise(
    'culture-relevance',
    {
      state: { documents: bounded.map((d, i) => ({ id: `d${i}`, text: short(d.text, 1600) })) },
      questions,
    },
    { signal, aiFeature: 'culture', questionVersion: 1, scopeToken: scope },
  );
  if (!current(s.decision, result, valid)) return { documents };
  const selected = documents.filter(
    (d, i) => i >= bounded.length || certainNoul(result.value.answers[`document_${i}`]) !== false,
  );
  return selected.length === documents.length ? { documents } : { documents: selected, result };
}
