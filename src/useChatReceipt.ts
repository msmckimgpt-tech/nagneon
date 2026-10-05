import { useEffect, useRef } from 'react';
import { api } from './api';

// A visible renderer acknowledged a React update after two animation frames.
// This is a display-stage observation, not proof that the user read the chat.
export function useChatReceipt(sessionId: string | null, ids: string[], enabled: boolean) {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    seen.current.clear();
  }, [sessionId]);
  const key = ids.join(',');
  useEffect(() => {
    if (!enabled || !sessionId || document.visibilityState !== 'visible') return;
    const fresh = ids.filter((id) => !seen.current.has(id)).slice(-100);
    if (!fresh.length) return;
    let second = 0,
      disposed = false;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (disposed || document.visibilityState !== 'visible') return;
        for (const id of fresh) seen.current.add(id);
        while (seen.current.size > 500) seen.current.delete(seen.current.values().next().value!);
        void api('diagnostics/input-latency/rendered', {
          sessionId,
          ids: fresh,
          at: Date.now(),
        }).catch(() => {
          for (const id of fresh) seen.current.delete(id);
        });
      });
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [sessionId, key, enabled]);
}
