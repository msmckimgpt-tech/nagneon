import { z } from 'zod';
import {
  isSpeechStyleBoundary,
  isSpeechStyleFeedback,
  isSpeechStylePreference,
} from './viewer-speech-style.js';

const axis = z.enum(['register', 'messageLength', 'laughter', 'banter']);
const target = z.enum(['polite', 'casual', 'brief', 'rare', 'restrained']);
const scene = z
  .object({ id: z.string().min(1).max(200), at: z.number().finite().nonnegative() })
  .strict();
export const SpeechStyleAdaptation = z
  .object({
    version: z.literal(1),
    stage: z.enum(['heard', 'considering', 'trial', 'adopted']),
    axis,
    target,
    heard: scene,
    visitJoinedAt: z.number().finite().nonnegative(),
    scenes: z.array(scene).max(4),
    trialRequested: z.boolean().optional(),
    trialMessageId: z.string().max(100).optional(),
    trialAt: z.number().finite().nonnegative().optional(),
    adoptedAt: z.number().finite().nonnegative().optional(),
  })
  .strict();
export const SpeechStyleBoundary = z
  .object({
    version: z.literal(1),
    axis,
    target,
    sourceId: z.string().min(1).max(200),
  })
  .strict();
export const SpeechStyleOverlay = z
  .object({
    register: z.enum(['polite', 'casual']).optional(),
    messageLength: z.literal('brief').optional(),
    laughter: z.literal('rare').optional(),
    banter: z.literal('restrained').optional(),
  })
  .strict();

// Requests quoted as an example, or attributed to someone else, are not a
// direct correction from the streamer. Only a final accepted streamer speech
// event with a unique source ID may enter this state machine.
export function styleIntent(text) {
  if (
    !isSpeechStyleFeedback(text) ||
    /[“"'][^”"']*(?:말투|반말|존댓말|ㅋㅋ|ㅎㅎ|비꼬)[^”"']*[”"']|(?:라고\s*했|라는\s*말)/u.test(
      text,
    )
  )
    return null;
  const stop = isSpeechStyleBoundary(text);
  if (/(?:비꼬|빈정|놀리|괴롭|장난)/u.test(text) && stop)
    return { axis: 'banter', target: 'restrained', boundary: true };
  if (
    /(?:ㅋㅋ|ㅎㅎ|웃음(?:표현)?)/u.test(text) &&
    /(?:줄|그만|하지|말아|쓰지|부담|불편)/u.test(text)
  )
    return { axis: 'laughter', target: 'rare', boundary: stop };
  if (/(?:반말|말을?\s*놓)/u.test(text) && /(?:부담|불편|싫|그만|하지|말아|쓰지)/u.test(text))
    return { axis: 'register', target: 'polite', boundary: stop };
  if (/(?:존댓말|높임말|존대)/u.test(text) && /(?:부담|불편|싫|그만|하지|말아|쓰지)/u.test(text))
    return { axis: 'register', target: 'casual', boundary: stop };
  if (/(?:반말|말을?\s*놓)/u.test(text) && /(?:해|써|편하|바꿔)/u.test(text))
    return { axis: 'register', target: 'casual', boundary: false };
  if (/(?:존댓말|높임말|존대)/u.test(text) && /(?:해|써|편하|바꿔)/u.test(text))
    return { axis: 'register', target: 'polite', boundary: false };
  if (/(?:짧게|간단히)/u.test(text) && /(?:말|채팅|설명)/u.test(text))
    return { axis: 'messageLength', target: 'brief', boundary: stop };
  return null;
}

export function preferenceMatches(preference, adaptation) {
  if (!isSpeechStylePreference(preference) || !adaptation) return false;
  const value = String(preference);
  if (adaptation.axis === 'register')
    return adaptation.target === 'casual'
      ? /반말|말을?\s*놓/u.test(value)
      : /존댓말|높임말|존대/u.test(value);
  if (adaptation.axis === 'laughter')
    return /(?:ㅋㅋ|ㅎㅎ|웃음)/u.test(value) && /(?:줄|적|드물|가끔)/u.test(value);
  if (adaptation.axis === 'banter')
    return /(?:장난|비꼬|빈정|놀리)/u.test(value) && /(?:줄|적|드물|그만|안\s*함)/u.test(value);
  return /(?:짧|간단|간결)/u.test(value);
}

export function witnessedStyleScene(state, { id, at, visitJoinedAt, feedback, directlyAddressed }) {
  if (!id || !Number.isFinite(at) || !Number.isFinite(visitJoinedAt) || at < visitJoinedAt)
    return state;
  const prior = state ? SpeechStyleAdaptation.parse(state) : null;
  if (feedback && directlyAddressed) {
    if (prior?.heard.id === id || prior?.scenes.some((item) => item.id === id)) return state;
    return {
      version: 1,
      stage: 'heard',
      axis: feedback.axis,
      target: feedback.target,
      heard: { id, at },
      visitJoinedAt,
      scenes: [],
    };
  }
  if (
    !prior ||
    ['trial', 'adopted'].includes(prior.stage) ||
    prior.visitJoinedAt !== visitJoinedAt ||
    at <= prior.heard.at ||
    prior.heard.id === id ||
    prior.scenes.some((item) => item.id === id)
  )
    return state;
  const scenes = [...prior.scenes, { id, at }].slice(-4);
  return { ...prior, scenes, stage: prior.stage === 'heard' ? 'considering' : prior.stage };
}

export function requestStyleTrial(state, preference) {
  if (
    !state ||
    state.stage !== 'considering' ||
    state.trialRequested ||
    !state.scenes.length ||
    !preferenceMatches(preference, state)
  )
    return state;
  return { ...state, trialRequested: true };
}

export function trialOutputMatches(text, state) {
  if (!state || typeof text !== 'string' || !text.trim()) return false;
  if (state.axis === 'laughter') return !/[ㅋㅎ]{2,}/u.test(text);
  if (state.axis === 'banter') return !/(?:놀리|비꼬|빈정|약올리)/u.test(text);
  if (state.axis === 'messageLength') return text.trim().length <= 80;
  if (state.target === 'casual')
    return (
      /(?:네|어|야|지|자|다|냐|임|ㅋㅋ)[.!?~\s]*$/u.test(text) &&
      !/(?:요|니다)[.!?~\s]*$/u.test(text)
    );
  return /(?:요|니다|세요)[.!?~\s]*$/u.test(text);
}

export function recordStyleTrial(state, { id, at, text }) {
  if (
    !state ||
    state.stage !== 'considering' ||
    !state.trialRequested ||
    !id ||
    !Number.isFinite(at) ||
    at <= state.heard.at ||
    !trialOutputMatches(text, state)
  )
    return state;
  return { ...state, stage: 'trial', trialMessageId: id, trialAt: at };
}

export function adoptStyle(state, { sourceId, at, preference, reason, resultSpeech, member }) {
  if (
    !state ||
    state.stage !== 'trial' ||
    !state.trialMessageId ||
    !Number.isFinite(at) ||
    at <= state.trialAt ||
    state.heard.id === sourceId ||
    state.scenes.some((item) => item.id === sourceId) ||
    !preferenceMatches(preference, state) ||
    !/(?:직접|써\s*보|해\s*보|느껴|편해|맞는|마음|자연스러)/u.test(String(reason)) ||
    !/(?:말투|어투|말한|반응|웃음|장난)/u.test(String(resultSpeech)) ||
    !/(?:좋|괜찮|편|자연|불편|부담|고마|적당)/u.test(String(resultSpeech)) ||
    (member?.seconds ?? 0) < 900 ||
    ((member?.sessions ?? 0) < 2 && (member?.affinity ?? 0) < 0.4) ||
    !Array.isArray(member?.memories) ||
    !member.memories.length
  )
    return state;
  return {
    ...state,
    stage: 'adopted',
    adoptedAt: at,
    scenes: [...state.scenes, { id: sourceId, at }].slice(-4),
  };
}

export function violatesStyleBoundary(text, boundary) {
  if (!boundary || typeof text !== 'string') return false;
  if (boundary.axis === 'laughter') return /[ㅋㅎ]{2,}/u.test(text);
  if (boundary.axis === 'banter') return /(?:놀리|비꼬|빈정|약올리)/u.test(text);
  if (boundary.axis === 'messageLength') return text.length > 120;
  if (boundary.target === 'polite')
    return /(?:야|냐|임|ㅋㅋ)[.!?~\s]*$/u.test(text) && !/(?:요|니다)[.!?~\s]*$/u.test(text);
  return false;
}

export const isPlayfulPushbackText = (text) =>
  typeof text === 'string' && /(?:놀리|비꼬|빈정|약올리)/u.test(text);

export function playfulPushbackAllowed(history, personaId, addressViewers, now, member) {
  if (
    member?.speechStyleBoundary ||
    (Number.isFinite(member?.lastBanterAt) && now - member.lastBanterAt < 120000)
  )
    return false;
  const recent = history.filter(
    (m) => Number.isFinite(m.time) && m.time <= now && now - m.time <= 60000,
  );
  if (recent.some((m) => /(?:그만|불편|싫어|진지|중단|하지\s*마|말아)/u.test(m.text))) return false;
  const own = recent.findLast(
    (m) =>
      m.personaId === personaId && m.kind === 'chat' && /(?:ㅋㅋ|ㅎㅎ|장난|농담)/u.test(m.text),
  );
  if (!own) return false;
  const answer = recent.findLast(
    (m) =>
      m.kind === 'streamer' &&
      m.time > own.time &&
      now - m.time <= 45000 &&
      addressViewers(m.text).has(personaId) &&
      /(?:ㅋㅋ|ㅎㅎ|장난|농담|웃기)/u.test(m.text),
  );
  return !!answer;
}
