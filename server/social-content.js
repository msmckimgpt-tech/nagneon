import { digest } from './social-runtime-state.js';

// Preserve the original v2 receipt hash; later conversation is not a new broadcast witness.
export function socialContentHash(thread) {
  const { comments, votes, attachments, activityReads, ...content } = thread;
  return digest(content);
}
export function socialDiscussionHash(thread, residentId) {
  return digest({
    content: socialContentHash(thread),
    comments: (thread.comments || []).filter((c) => c.residentId !== residentId),
    attachments: thread.attachments || [],
  });
}
const words = (text) =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
export function similarSocialText(a, b) {
  const compact = (text) => words(text).join('');
  const x = compact(a),
    y = compact(b);
  if (!x || !y) return false;
  if (x === y || (Math.min(x.length, y.length) >= 12 && (x.includes(y) || y.includes(x))))
    return true;
  const grams = (text) =>
    new Set(Array.from({ length: Math.max(0, text.length - 2) }, (_, i) => text.slice(i, i + 3)));
  const left = grams(x),
    right = grams(y);
  const shared = [...left].filter((v) => right.has(v)).length;
  const wx = new Set(words(a).map((w) => w.slice(0, 3))),
    wy = new Set(words(b).map((w) => w.slice(0, 3)));
  const overlap = [...wx].filter((w) => wy.has(w)).length;
  return (
    shared / Math.max(1, Math.min(left.size, right.size)) >= 0.65 ||
    (overlap >= 4 && overlap / Math.max(1, Math.min(wx.size, wy.size)) >= 0.7)
  );
}
