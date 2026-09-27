import { z } from 'zod';

const millis = z
  .number()
  .int()
  .min(0)
  .max(24 * 3600000);
const providerId = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[A-Za-z0-9_-]+$/);
const interval = (value, ctx) => {
  if (value.end_ms < value.start_ms)
    ctx.addIssue({ code: 'custom', message: '음성 제공처의 시간 구간이 올바르지 않습니다.' });
};
const Fragment = z
  .object({
    type: z.literal('input_transcript.added'),
    start_ms: millis,
    end_ms: millis,
    item: z.object({
      id: providerId,
      type: z.literal('input_transcript'),
      text: z.string().max(4000),
    }),
  })
  .superRefine(interval);
const Turn = z.object({
  type: z.enum(['turn.created', 'turn.done']),
  turn: z
    .object({
      id: providerId,
      role: z.literal('user'),
      start_ms: millis,
      end_ms: millis,
      transcript: z.string().max(16000),
    })
    .superRefine(interval),
});
export const SubscriptionInputEvent = z.union([Fragment, Turn]);
export const normalizedTranscript = (text) =>
  text.normalize('NFC').replace(/[\s.,!?…。，！？]+/gu, '');

// Provider times describe approximate audio intervals. They remain separate
// from both the local source clock and the moment a packet was observed.
export class SubscriptionTranscript {
  constructor({ now = Date.now, maxFragments = 20000 } = {}) {
    this.now = now;
    this.maxFragments = maxFragments;
    this.fragments = new Map();
    this.turns = new Map();
    this.pending = [];
    this.sequence = 0;
    this.revision = 0;
  }
  accept(value, receivedAt = this.now()) {
    const event = SubscriptionInputEvent.parse(value);
    if (event.type === 'input_transcript.added') {
      const { id, text } = event.item;
      const prior = this.fragments.get(id);
      if (prior) {
        if (prior.text !== text || prior.startMs !== event.start_ms || prior.endMs !== event.end_ms)
          throw new Error('같은 제공처 음성 항목의 원문 또는 시간 구간이 달라졌습니다.');
        return { duplicate: true };
      }
      if (this.fragments.size >= this.maxFragments)
        throw new Error('음성 연결의 항목 보관 한도에 도달했습니다. 마이크를 다시 연결해주세요.');
      const fragment = {
        id,
        text,
        startMs: event.start_ms,
        endMs: event.end_ms,
        receivedAt,
        sequence: ++this.sequence,
      };
      this.fragments.set(id, fragment);
      const alreadyFinal = [...this.turns.values()].some(
        (turn) =>
          turn.finalPublished && turn.startMs <= fragment.startMs && turn.endMs >= fragment.endMs,
      );
      if (alreadyFinal) return { duplicate: false, fragment, coveredByFinal: true };
      this.pending.push(fragment);
      this.pending.sort((a, b) => a.startMs - b.startMs || a.sequence - b.sequence);
      return { duplicate: false, fragment };
    }
    const turn = event.turn,
      prior = this.turns.get(turn.id);
    if (
      prior?.final &&
      (prior.text !== turn.transcript ||
        prior.startMs !== turn.start_ms ||
        prior.endMs !== turn.end_ms)
    )
      throw new Error('확정된 제공처 발언이 다른 내용으로 다시 도착했습니다.');
    // A repeated final notification must retain its delivery/review receipt.
    if (prior?.final) return { duplicate: true, turn: prior };
    const next = {
      id: turn.id,
      text: turn.transcript,
      startMs: turn.start_ms,
      endMs: turn.end_ms,
      receivedAt,
      final: event.type === 'turn.done' || !!prior?.final,
      revision: (prior?.revision || 0) + 1,
    };
    this.turns.set(turn.id, next);
    if (this.turns.size > 256) {
      const oldest = this.turns.keys().next().value;
      if (this.turns.get(oldest).final) this.turns.delete(oldest);
      else throw new Error('확정되지 않은 음성 발언이 너무 많이 남았습니다.');
    }
    return { duplicate: !!prior?.final, turn: next };
  }
  ready(at = this.now()) {
    const first = this.pending[0];
    if (!first) {
      const final = [...this.turns.values()].find(
        (turn) =>
          turn.final &&
          !turn.reviewed &&
          !turn.finalPublished &&
          turn.text.trim() &&
          at - turn.receivedAt >= 1000 &&
          ![...this.fragments.values()].some(
            (item) => item.startMs >= turn.startMs && item.endMs <= turn.endMs,
          ),
      );
      return final
        ? {
            ids: [],
            text: final.text,
            startMs: final.startMs,
            endMs: final.endMs,
            observedAt: final.receivedAt,
            observedThroughAt: final.receivedAt,
            final: true,
            providerTurnId: final.id,
            finalFallback: true,
          }
        : null;
    }
    const group = [];
    let size = 0;
    for (const item of this.pending) {
      if (
        group.length &&
        (group.length >= 64 ||
          item.startMs - group.at(-1).endMs > 900 ||
          item.endMs - first.startMs > 6000 ||
          size + item.text.length > 2800)
      )
        break;
      group.push(item);
      size += item.text.length;
    }
    const last = group.at(-1);
    const finalTurn = [...this.turns.values()].find(
      (turn) => turn.final && turn.startMs <= first.startMs && turn.endMs >= last.endMs,
    );
    if (
      group.length === this.pending.length &&
      !finalTurn &&
      at - last.receivedAt < 1000 &&
      last.endMs - first.startMs < 4000
    )
      return null;
    return {
      ids: group.map((item) => item.id),
      text: group.map((item) => item.text).join(''),
      startMs: first.startMs,
      endMs: last.endMs,
      observedAt: Math.min(...group.map((item) => item.receivedAt)),
      observedThroughAt: Math.max(...group.map((item) => item.receivedAt)),
      final: !!finalTurn,
      providerTurnId: finalTurn?.id,
    };
  }
  acknowledge(ids, finalTurnId) {
    if (finalTurnId) {
      const turn = this.turns.get(finalTurnId);
      if (turn) {
        turn.finalPublished = true;
        turn.reviewed = true;
      }
    }
    const accepted = new Set(ids);
    this.pending = this.pending.filter((item) => !accepted.has(item.id));
  }
  canonicalChanges(publications) {
    const changes = [];
    for (const turn of this.turns.values()) {
      if (!turn.final || turn.reviewed) continue;
      const fragments = [...this.fragments.values()]
        .filter((item) => item.startMs >= turn.startMs && item.endMs <= turn.endMs)
        .sort((a, b) => a.startMs - b.startMs || a.sequence - b.sequence);
      const ids = new Set(fragments.map((item) => item.id));
      if (!fragments.length || this.pending.some((item) => ids.has(item.id))) continue;
      turn.reviewed = true;
      if (
        normalizedTranscript(fragments.map((item) => item.text).join('')) ===
        normalizedTranscript(turn.text)
      )
        continue;
      const revises = publications
        .filter((item) => item.fragmentIds.some((id) => ids.has(id)))
        .map((item) => item.id);
      changes.push({
        text: turn.text,
        observedAt: turn.receivedAt,
        observedThroughAt: turn.receivedAt,
        startMs: turn.startMs,
        endMs: turn.endMs,
        providerTurnId: turn.id,
        revises,
        revision: ++this.revision,
      });
    }
    return changes;
  }
}
