import { createHash } from 'node:crypto';
import { z } from 'zod';

// These are simulation defaults, not fitted human behaviour or retention targets.
export const PRESENCE_GRACE_SECONDS = 120;
export const PRESENCE_MAX_GAP_SECONDS = 30;
const finite = z.number().finite().nonnegative();
export const PresenceMemory = z.object({
  version: z.literal(1),
  visits: finite.int(),
  departures: finite.int(),
  cooldownSeconds: finite.max(86400),
  lastDeparture: z.object({
    at: finite.max(8.64e15),
    reason: z.enum(['personal-schedule', 'rest', 'satisfied', 'exploring', 'overstimulated']),
    watchedSeconds: finite,
    mayReturn: z.boolean(),
  }).optional(),
}).strict();

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));
const present = (s) => s === 'active' || s === 'lurking';
const emptyMemory = () => ({ version: 1, visits: 0, departures: 0, cooldownSeconds: 0 });
const unit = (id, salt) => (createHash('sha256').update(`${id}\0${salt}`).digest().readUInt32BE(0) + .5) / 4294967296;
const threshold = (id, salt) => -Math.log1p(-unit(id, salt));

// Identity, not display name, model selection, request cadence or current mood.
export function presenceDisposition(persona, member = {}) {
  const id = persona.id, origin = member.origin?.key;
  const motive = origin === 'guide' ? 'information' : origin === 'fan' ? 'company'
    : origin === 'discussion' ? 'participation' : ['browse', 'clip'].includes(origin) ? 'curiosity' : 'familiarity';
  return {
    motive,
    typicalSeconds: (8 + 42 * unit(id, 'stay')) * 60 * (motive === 'company' ? 1.25 : motive === 'information' ? .75 : 1),
    sociability: clamp(persona.sociability ?? .5),
    availability: unit(id, 'availability'),
    stimulationTolerance: .45 + .45 * unit(id, 'stimulation'),
    returnInterest: .25 + .6 * unit(id, 'return'),
  };
}

// Competing causes: liking the room never cancels outside obligations.
// Existing peer weights are mentions/co-addresses, NOT proof of close friendship.
export function departureRates(traits, { seconds = 0, affinity = 0, peers = 0, stimulation = 0, switchInterest = 0, satisfied = false } = {}) {
  if (seconds <= PRESENCE_GRACE_SECONDS) return {};
  const anchor = 1 + .75 * clamp(affinity) + .25 * clamp(peers);
  const fatigue = Math.max(0, seconds / traits.typicalSeconds - .6);
  const purpose = ['curiosity', 'information'].includes(traits.motive) ? 1 : .35;
  return {
    'personal-schedule': .00012 + .00018 * (1 - traits.availability),
    rest: Math.min(.008, fatigue * fatigue * .0012) / anchor,
    satisfied: (Math.min(2, seconds / traits.typicalSeconds) * .0002 + (satisfied ? .0008 : 0)) * purpose / anchor,
    exploring: (.00012 + clamp(switchInterest) * .0007) * purpose / anchor,
    overstimulated: Math.max(0, stimulation - traits.stimulationTolerance) * .001 / anchor,
  };
}

export function resetPresenceRuntime(audience, now) {
  audience.presenceRuntime = { members: {}, savedAt: now };
}

function newVisit(id, joinedAt, memory, traits) {
  const visit = memory.visits + 1, salt = `visit:${visit}:${joinedAt}`;
  return {
    joinedAt, seconds: 0, phaseSeconds: 0, attentionIndex: 0,
    hazard: 0, target: threshold(id, `${salt}:leave`),
    attentionHazard: 0, attentionTarget: threshold(id, `${salt}:attention:0`),
    salt, traits, lastSignalAt: -1, stimulation: 0, signalStimulation: 0,
    satisfiedUntil: 0, switchInterest: 0, lastGame: '', closed: false,
  };
}

function peerSupport(member, visible) {
  let total = 0, together = 0;
  for (const [id, value] of Object.entries(member.peers || {})) {
    const weight = clamp(value, 0, 20); total += weight;
    if (visible.has(id)) together += weight;
  }
  return total ? together / total : 0;
}

function selectReason(id, state, rates) {
  let n = unit(id, `${state.salt}:reason`) * Object.values(rates).reduce((a, b) => a + b, 0);
  for (const [reason, rate] of Object.entries(rates)) { n -= rate; if (n < 0) return reason; }
  return 'personal-schedule';
}

// Only accepted, recent, actually witnessed input can affect this visit.
// No sentiment extraction from streamer commands, feedback, silence or raw words.
export function observePresence(audience, observation, witnesses, capturedAt, now, { visual = false } = {}) {
  if (!audience.autonomous || !Number.isFinite(capturedAt) || !Number.isFinite(now) || now < capturedAt || now - capturedAt > 45000) return;
  for (const id of new Set(witnesses || [])) {
    const member = audience.data.members[id], state = audience.presenceRuntime?.members[id];
    if (!state || state.closed || !present(audience.presence[id]) || state.joinedAt !== member?.joinedAt || capturedAt < member.joinedAt || capturedAt <= state.lastSignalAt) continue;
    state.lastSignalAt = capturedAt;
    state.signalStimulation = clamp(observation.excitement);
    if (observation.positiveMoment?.positive && observation.positiveMoment.supporters?.includes(id)) state.satisfiedUntil = state.seconds + 120;
    // A different game offers exploration, not evidence that this person dislikes it.
    if (visual && observation.confidence >= .7 && typeof observation.game === 'string' && observation.game.trim()) {
      if (state.lastGame && state.lastGame !== observation.game) state.switchInterest = 1;
      state.lastGame = observation.game.slice(0, 150);
    }
  }
}

export function tickAutonomousPresence(audience, settings, now) {
  if (!Number.isFinite(now) || now - audience.lastTick < 1000) return [];
  const gap = (now - audience.lastTick) / 1000;
  // Suspend/blocked event loop is not a roomful of people watching for hours.
  // Rebase without advancing dwell, cooldowns, or drawing catch-up transitions.
  if (gap > PRESENCE_MAX_GAP_SECONDS) { audience.lastTick = now; return []; }
  const runtime = audience.presenceRuntime || { members: {}, savedAt: now };
  const states = { ...runtime.members }, people = { ...audience.data.members };
  const presence = { ...audience.presence }, events = [];
  const visible = new Set(settings.personas.filter(p => p.enabled && present(presence[p.id])).map(p => p.id));
  let revision = audience.presenceRevision, changed = false;
  const transition = (id, value) => {
    if (presence[id] !== value) { presence[id] = value; revision++; changed = true; }
  };
  for (const p of settings.personas) {
    const previous = people[p.id];
    if (!previous) continue;
    if (!p.enabled) { transition(p.id, 'away'); delete states[p.id]; continue; }
    if (p.system || p.id === settings.managerId) {
      if (present(presence[p.id])) people[p.id] = { ...previous, seconds: previous.seconds + gap };
      transition(p.id, 'active'); continue;
    }
    if (!previous.sessions || presence[p.id] === 'waiting') continue;
    const memory = PresenceMemory.parse(previous.presenceMemory || emptyMemory());
    const member = { ...previous, presenceMemory: { ...memory } };
    people[p.id] = member;
    let state = states[p.id] ? { ...states[p.id] } : null;
    const traits = state?.traits || presenceDisposition(p, member);
    if (present(presence[p.id])) {
      if (!state || state.closed || state.joinedAt !== member.joinedAt) {
        state = newVisit(p.id, member.joinedAt, memory, traits);
        member.presenceMemory.visits++;
        member.presenceMemory.cooldownSeconds = 0;
        changed = true;
      }
      // A paid/community admission can happen between ticks: do not backdate viewing.
      const dt = Math.min(gap, Math.max(0, (now - member.joinedAt) / 1000));
      member.seconds += dt;
      const oldSeconds = state.seconds;
      state.seconds += dt; state.phaseSeconds += dt;
      const recent = now >= state.lastSignalAt && now - state.lastSignalAt <= 45000;
      const targetStimulation = recent ? state.signalStimulation : 0;
      state.stimulation += (targetStimulation - state.stimulation) * (1 - Math.exp(-dt / 90));
      state.switchInterest *= Math.exp(-dt / 180);
      const rates = departureRates(traits, {
        seconds: state.seconds, affinity: member.affinity,
        peers: peerSupport(member, visible), stimulation: state.stimulation,
        switchInterest: state.switchInterest, satisfied: state.satisfiedUntil > state.seconds,
      });
      // Integrate one exponential clock instead of a new lottery every UI tick.
      const eligibleSeconds = Math.max(0, state.seconds - Math.max(oldSeconds, PRESENCE_GRACE_SECONDS));
      state.hazard += Object.values(rates).reduce((a, b) => a + b, 0) * eligibleSeconds;
      if (state.hazard >= state.target && eligibleSeconds > 0) {
        const reason = selectReason(p.id, state, rates);
        const mayReturn = reason === 'rest' || reason === 'exploring' || reason === 'overstimulated';
        const minutes = reason === 'rest' ? 4 : reason === 'overstimulated' ? 6 : reason === 'exploring' ? 2 : 10;
        member.presenceMemory.departures++;
        member.presenceMemory.cooldownSeconds = (minutes + 6 * unit(p.id, `${state.salt}:cooldown`)) * 60;
        member.presenceMemory.lastDeparture = { at: now, reason, watchedSeconds: state.seconds, mayReturn };
        state = { ...state, closed: true, done: !mayReturn, returnHazard: 0,
          returnTarget: threshold(p.id, `${state.salt}:return`) };
        transition(p.id, 'away');
        // An internal operational record, never a forged public farewell or mind reading.
        events.push(`${p.name} ${mayReturn ? '자리 비움' : '시청 마침'} · 관계와 기록은 유지됩니다.`);
      } else if (state.phaseSeconds >= 60) {
        const fatigue = clamp(state.seconds / traits.typicalSeconds - .5);
        const rate = presence[p.id] === 'active'
          ? (.0005 + settings.lurkRatio * .001 + fatigue * .001 + state.stimulation * .0003) * (1.2 - traits.sociability * .5)
          : .0004 + traits.sociability * .0012;
        state.attentionHazard += dt * rate;
        if (state.attentionHazard >= state.attentionTarget) {
          transition(p.id, presence[p.id] === 'active' ? 'lurking' : 'active');
          state.phaseSeconds = 0; state.attentionHazard = 0; state.attentionIndex++;
          state.attentionTarget = threshold(p.id, `${state.salt}:attention:${state.attentionIndex}`);
        }
      }
    } else {
      // External moderation/removal is not a fabricated social grievance.
      if (state && !state.closed) state = null;
      state ||= { closed: true, done: false, traits, returnHazard: 0,
        returnTarget: threshold(p.id, `opening-return:${audience.lastStart}:${memory.visits}`) };
      const cooldown = member.presenceMemory.cooldownSeconds;
      member.presenceMemory.cooldownSeconds = Math.max(0, cooldown - gap);
      if (!state.done && member.presenceMemory.cooldownSeconds === 0) {
        const eligibleSeconds = Math.max(0, gap - cooldown);
        state.returnHazard += eligibleSeconds * (.00025 + traits.returnInterest * .0008 + clamp(member.affinity) * .00035);
        if (state.returnHazard >= state.returnTarget) {
          if (!(member.joinedAt >= audience.lastStart)) member.sessions++;
          member.joinedAt = Math.max(now, (member.joinedAt ?? -1) + 1);
          transition(p.id, unit(p.id, `return-mode:${member.joinedAt}`) < settings.lurkRatio ? 'lurking' : 'active');
          state = newVisit(p.id, member.joinedAt, memory, traits);
          member.presenceMemory.visits++;
          events.push(`${p.name} 재방문`);
        }
      }
    }
    states[p.id] = state;
  }
  // Drop runtime-only state of retired IDs, without deleting their durable history.
  const enabledIds = new Set(settings.personas.filter(p => p.enabled).map(p => p.id));
  for (const id of Object.keys(states)) if (!enabledIds.has(id)) delete states[id];
  const before = audience.data, next = { ...before, members: people };
  const checkpoint = changed || now - runtime.savedAt >= 60000;
  // Save before publishing transitions. World.part may replace audience.data with
  // its validated copy; never overwrite that authoritative copy with a stale one.
  if (checkpoint) audience.save(next);
  if (audience.data === before) audience.data = next;
  audience.presence = presence; audience.presenceRevision = revision;
  audience.presenceRuntime = { members: states, savedAt: checkpoint ? now : runtime.savedAt };
  audience.lastTick = now;
  return events;
}
