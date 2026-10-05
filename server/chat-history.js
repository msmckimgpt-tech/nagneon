import { JOURNAL_LIMIT } from './conversation-journal.js';

export const CHAT_PAGE_SIZE = 100;

// The journal retains public chat; this index only orders this process's current
// broadcast. No new copy of conversation text is persisted or sent to a model.
export class ChatHistory {
  constructor(studio) {
    this.studio = studio;
    this.reset();
  }
  reset() {
    this.sequence = 0;
    this.floor = 0;
    this.revision = 0;
    this.positions = new Map();
  }
  record(message) {
    if (this.positions.has(message.id)) return;
    this.positions.set(message.id, ++this.sequence);
    if (this.positions.size > JOURNAL_LIMIT + 500) {
      const active = new Set(
        [...this.studio.journal.data.entries, ...this.studio.messages, message].map((m) => m.id),
      );
      for (const id of this.positions.keys()) if (!active.has(id)) this.positions.delete(id);
    }
  }
  invalidate({ clear = false } = {}) {
    this.revision++;
    if (clear) this.floor = this.sequence;
  }
  message(message) {
    const historySequence = this.positions.get(message.id);
    return historySequence ? { ...message, historySequence } : message;
  }
  rows() {
    const s = this.studio;
    const entries = new Map(
      s.journal.data.entries
        .filter((e) => e.sessionId === s.sessionId && this.positions.get(e.id) > this.floor)
        .map((e) => [e.id, e]),
    );
    for (const message of s.messages)
      if (this.positions.get(message.id) > this.floor) entries.set(message.id, message);
    return [...entries.values()].sort(
      (a, b) => this.positions.get(a.id) - this.positions.get(b.id),
    );
  }
  snapshot() {
    const ids = new Set();
    const s = this.studio;
    for (const message of s.messages) {
      if (this.positions.get(message.id) > this.floor) ids.add(message.id);
      if (ids.size > CHAT_PAGE_SIZE) return { revision: this.revision, hasMore: true };
    }
    for (const entry of s.journal.data.entries) {
      if (entry.sessionId === s.sessionId && this.positions.get(entry.id) > this.floor)
        ids.add(entry.id);
      if (ids.size > CHAT_PAGE_SIZE) break;
    }
    return { revision: this.revision, hasMore: ids.size > CHAT_PAGE_SIZE };
  }
  page({ sessionId, revision, before, limit = CHAT_PAGE_SIZE }) {
    const s = this.studio;
    if (!sessionId || sessionId !== s.sessionId || revision !== this.revision)
      throw Error('방송이나 채팅 기록이 바뀌었습니다. 현재 채팅에서 다시 불러와주세요.');
    const rows = this.rows().filter(
      (m) => before === undefined || this.positions.get(m.id) < before,
    );
    const messages = rows.slice(-limit).map((m) => {
      const live = Object.hasOwn(m, 'time');
      return {
        id: m.id,
        personaId: m.personaId,
        name: m.name,
        text: m.text,
        time: live ? m.time : m.at,
        kind: m.kind || (m.personaId === 'streamer' ? 'streamer' : 'chat'),
        color: live
          ? m.color
          : s.settings.personas.find((p) => p.id === m.personaId)?.color || '#ffffff',
        historySequence: this.positions.get(m.id),
        ...(m.transcription ? { transcription: structuredClone(m.transcription) } : {}),
        ...(m.donation ? { donation: { ...m.donation } } : {}),
      };
    });
    return { sessionId, revision, messages, hasMore: rows.length > messages.length };
  }
}
