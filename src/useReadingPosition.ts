import { useLayoutEffect, useReducer, useRef } from 'react';

// Navigation owns the scroll adjustment; ordinary data refreshes do not.
export function useReadingPosition(key: string, ready = true, active = true) {
  const ref = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { top: number; focus?: string }>());
  const pending = useRef<{ top: number; preserve: boolean; start: boolean } | null>(null);
  const [, commitNavigation] = useReducer((n: number) => n + 1, 0);
  function scroller() {
    let parent = ref.current?.parentElement;
    while (parent && parent !== document.body) {
      if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
      parent = parent.parentElement;
    }
    return document.scrollingElement as HTMLElement;
  }
  function move(change: () => void, preserve = false, start = false) {
    if (!ref.current?.getClientRects().length) {
      change();
      return;
    }
    const top = scroller().scrollTop;
    positions.current.set(key, {
      top,
      focus: (document.activeElement as HTMLElement)?.dataset.readingId,
    });
    if (positions.current.size > 100)
      positions.current.delete(positions.current.keys().next().value!);
    pending.current = { top, preserve, start };
    change();
    // A click on the already selected tab must not leave a delayed scroll request.
    commitNavigation();
  }
  useLayoutEffect(() => {
    if (!pending.current || !ready || !active || !ref.current) return;
    const request = pending.current;
    pending.current = null;
    const target = scroller();
    const saved = request.start ? undefined : positions.current.get(key);
    const viewportTop =
      target === document.scrollingElement ? 0 : target.getBoundingClientRect().top;
    const top = request.preserve
      ? request.top
      : (saved?.top ??
        target.scrollTop + ref.current.getBoundingClientRect().top - viewportTop - 16);
    target.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
    if (!request.preserve) {
      const focus = saved?.focus
        ? ref.current.querySelector<HTMLElement>(`[data-reading-id="${CSS.escape(saved.focus)}"]`)
        : null;
      (focus || ref.current).focus({ preventScroll: true });
    }
  });
  return { ref, move };
}
