type ReactionState = {
  running: boolean;
  sessionId: string | null;
  busy: boolean;
  settings: { intervalSeconds: number };
  ambient?: { nextConversationAt?: number | null } | null;
};
export type ReactionResult = { ok?: boolean; skipped?: string; transcriptionNeedsReview?: boolean };
type Options<S extends ReactionState, R extends ReactionResult> = {
  sessionId: string;
  current: () => S | null;
  flushSpeech: (delivered: () => void) => Promise<void>;
  react: (state: S) => Promise<R>;
  onResult: (result: R) => void;
  onSpeechError: (error: unknown) => void;
  onReactionError: (error: unknown) => void;
};

// Poll eligibility frequently; successful cadence and failed-request backoff
// remain separate so an unanswered speech item cannot turn polling into retries.
export function startReactionSchedule<S extends ReactionState, R extends ReactionResult>(
  options: Options<S, R>,
  {
    now = Date.now,
    schedule = (fn: () => void, ms: number) => setInterval(fn, ms),
    cancel = (id: ReturnType<typeof setInterval>) => clearInterval(id),
  } = {},
) {
  let disposed = false,
    inFlight = false,
    delivering = false;
  let nextAttemptAt = 0,
    retryAt = 0,
    speechRetryAt = 0,
    speechVersion = 0,
    answeredVersion = 0,
    handledCompanyAt: number | undefined;
  const active = () => {
    const state = options.current();
    return !disposed && state?.running && state.sessionId === options.sessionId ? state : null;
  };
  const tick = async () => {
    if (!active()) return;
    if (!delivering && now() >= speechRetryAt) {
      delivering = true;
      try {
        await options.flushSpeech(() => {
          if (active()) speechVersion++;
        });
      } catch (error) {
        if (active()) {
          speechRetryAt = now() + 1500;
          options.onSpeechError(error);
        }
      } finally {
        delivering = false;
      }
    }
    const current = active();
    if (!current || inFlight || current.busy || now() < retryAt) return;
    const companyAt = current.ambient?.nextConversationAt;
    const companyDue =
      typeof companyAt === 'number' && companyAt !== handledCompanyAt && now() >= companyAt;
    if (speechVersion === answeredVersion && now() < nextAttemptAt && !companyDue) return;
    inFlight = true;
    const requestedAt = now(),
      requestSpeechVersion = speechVersion;
    try {
      const result = await options.react(current);
      if (!active()) return;
      if (result.ok || ['unchanged-input', 'stale-screen'].includes(result.skipped || '')) {
        answeredVersion = requestSpeechVersion;
        nextAttemptAt = requestedAt + current.settings.intervalSeconds * 1000;
        if (companyDue) handledCompanyAt = companyAt;
      } else retryAt = now() + 1500;
      options.onResult(result);
    } catch (error) {
      if (active()) {
        retryAt = now() + 1500;
        options.onReactionError(error);
      }
    } finally {
      inFlight = false;
    }
  };
  const wake = () => {
    void tick();
  };
  const timer = schedule(wake, 250);
  wake();
  return {
    wake,
    dispose: () => {
      disposed = true;
      cancel(timer);
    },
  };
}
