// Timing comes from witnessed capture, never a model's guessed event boundary.
export const CLIP_PRE_MS = 8000,
  CLIP_POST_MS = 6000,
  CLIP_WINDOW_MAX_MS = 45000;
export function clipWindow(at, capture, sessionStartedAt) {
  const trusted =
    capture &&
    Number.isFinite(capture.startedAt) &&
    Number.isFinite(capture.endedAt) &&
    capture.startedAt <= at &&
    capture.endedAt >= at &&
    capture.endedAt > capture.startedAt &&
    capture.endedAt - capture.startedAt <= 30000;
  const eventStartedAt = trusted ? capture.startedAt : at;
  const eventEndedAt = trusted ? capture.endedAt : at;
  return {
    startedAt: Math.max(
      Number.isFinite(sessionStartedAt) ? sessionStartedAt : 0,
      eventStartedAt - CLIP_PRE_MS,
    ),
    endedAt: eventEndedAt + CLIP_POST_MS,
    eventStartedAt,
    eventEndedAt,
    basis: trusted ? 'capture' : 'moment',
  };
}
export function mergeClipWindows(a, b) {
  if (!a || !b || a.startedAt > b.endedAt || b.startedAt > a.endedAt) return null;
  const startedAt = Math.min(a.startedAt, b.startedAt),
    endedAt = Math.max(a.endedAt, b.endedAt);
  if (endedAt - startedAt > CLIP_WINDOW_MAX_MS) return null;
  return {
    startedAt,
    endedAt,
    eventStartedAt: Math.min(a.eventStartedAt, b.eventStartedAt),
    eventEndedAt: Math.max(a.eventEndedAt, b.eventEndedAt),
    basis: a.basis === b.basis ? a.basis : 'mixed',
  };
}
