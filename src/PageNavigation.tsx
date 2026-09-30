import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  formatPageRoute,
  parsePageRoute,
  updatePageRoute,
  type PageRoute,
} from '../shared/page-route.js';
import './page-navigation.css';

type Position = { top: number; focus?: string };
type Entry = { key: string; index: number; origin?: number; position?: Position };
type Navigation = {
  batch: (change: () => void) => void;
  route: PageRoute;
  navigate: (route: PageRoute, replace?: boolean) => void;
  patch: (patch: Partial<PageRoute>, replace?: boolean) => void;
  move: (direction: 'back' | 'forward') => void;
  closeSettings: () => void;
  drafts: Map<string, unknown>;
};
const Context = createContext<Navigation | null>(null);
export const usePageNavigation = () => useContext(Context);
const stamp = () => crypto.randomUUID();
function scroller() {
  const main = document.querySelector<HTMLElement>('.workspace > main');
  return main && /auto|scroll/.test(getComputedStyle(main).overflowY)
    ? main
    : (document.scrollingElement as HTMLElement | null);
}
function position(): Position {
  const focused = document.activeElement as HTMLElement | null;
  const focus = focused?.dataset.readingId
    ? `[data-reading-id="${CSS.escape(focused.dataset.readingId)}"]`
    : focused?.dataset.tutorial
      ? `[data-tutorial="${CSS.escape(focused.dataset.tutorial)}"]`
      : undefined;
  return { top: scroller()?.scrollTop || 0, focus };
}
export function PageNavigation({ children }: { children: ReactNode }) {
  const overlay = location.pathname === '/overlay';
  const [route, setRoute] = useState(() => parsePageRoute(location.hash));
  const current = useRef(route);
  const entry = useRef<Entry>(history.state?.nagneonPage || { key: stamp(), index: 0 });
  const positions = useRef(new Map<string, Position>());
  const drafts = useRef(new Map<string, unknown>());
  const restore = useRef<Position | null>(null);
  const [revision, setRevision] = useState(0);
  const transaction = useRef<PageRoute | null>(null);
  function patch(patch: Partial<PageRoute>, replace = false) {
    if (transaction.current) {
      transaction.current = updatePageRoute(transaction.current, patch);
      return;
    }
    navigate(updatePageRoute(current.current, patch), replace);
  }
  function batch(change: () => void) {
    transaction.current = current.current;
    try {
      change();
      const next = transaction.current;
      transaction.current = null;
      navigate(next);
    } finally {
      transaction.current = null;
    }
  }
  function persist() {
    if (overlay) return;
    const saved = position();
    positions.current.set(formatPageRoute(current.current), saved);
    if (positions.current.size > 100)
      positions.current.delete(positions.current.keys().next().value!);
    entry.current = { ...entry.current, position: saved };
    history.replaceState({ ...history.state, nagneonPage: entry.current }, '');
  }
  function accept(next: PageRoute, saved?: Position) {
    current.current = next;
    restore.current = saved || { top: 0 };
    setRoute(next);
    setRevision((n) => n + 1);
  }
  function navigate(next: PageRoute, replace = false) {
    if (transaction.current) {
      transaction.current = next;
      return;
    }
    const hash = formatPageRoute(next);
    next = parsePageRoute(hash);
    if (hash === formatPageRoute(current.current)) return;
    persist();
    const old = entry.current;
    const origin = next.settings ? (current.current.settings ? old.origin : old.index) : undefined;
    entry.current = { key: stamp(), index: replace ? old.index : old.index + 1, origin };
    history[replace ? 'replaceState' : 'pushState']({ nagneonPage: entry.current }, '', hash);
    const samePage = current.current.tab === next.tab && current.current.section === next.section;
    accept(
      next,
      next.settings || current.current.settings
        ? position()
        : samePage
          ? positions.current.get(hash)
          : undefined,
    );
  }
  function move(direction: 'back' | 'forward') {
    if (direction === 'back') {
      const event = new CustomEvent('nagneon:navigation-back', { cancelable: true });
      if (!window.dispatchEvent(event)) return;
    }
    // Temporary device/confirmation dialogs own navigation while they are open.
    if (document.querySelector('[role="dialog"]:not([data-history-owned])')) return;
    if (direction === 'back' && entry.current.index === 0) {
      if (current.current.settings) closeSettings();
      return;
    }
    persist();
    history.go(direction === 'back' ? -1 : 1);
  }
  function closeSettings() {
    const origin = entry.current.origin;
    if (origin !== undefined && origin < entry.current.index) {
      persist();
      history.go(origin - entry.current.index);
    } else navigate({ ...current.current, settings: undefined }, true);
  }
  useEffect(() => {
    if (overlay) return;
    history.scrollRestoration = 'manual';
    history.replaceState(
      { ...history.state, nagneonPage: entry.current },
      '',
      formatPageRoute(current.current),
    );
    const pop = () => {
      entry.current = history.state?.nagneonPage || { key: stamp(), index: 0 };
      accept(parsePageRoute(location.hash), entry.current.position);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        ['ArrowLeft', 'ArrowRight'].includes(event.key)
      ) {
        event.preventDefault();
        move(event.key === 'ArrowLeft' ? 'back' : 'forward');
      }
    };
    const scroll = () => {
      if (!restore.current) persist();
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('hashchange', pop);
    window.addEventListener('keydown', keyboard);
    document.addEventListener('scroll', scroll, true);
    restore.current = entry.current.position || { top: 0 };
    setRevision((n) => n + 1);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('hashchange', pop);
      window.removeEventListener('keydown', keyboard);
      document.removeEventListener('scroll', scroll, true);
    };
  }, []);
  useLayoutEffect(() => {
    if (overlay || !restore.current) return;
    const saved = restore.current;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    let focused = false;
    const deadline = Date.now() + 4000;
    const apply = () => {
      if (cancelled) return;
      const target = scroller();
      if (!target || !document.querySelector('.page-heading')) return;
      const dialog = document.querySelector<HTMLElement>('.settings-dialog');
      if (!focused) {
        const focus = route.settings
          ? dialog?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
          : saved.focus
            ? document.querySelector<HTMLElement>(saved.focus)
            : null;
        const heading = document.querySelector<HTMLElement>('[data-page-title]');
        const element =
          focus ||
          (!saved.focus && !route.settings && !document.querySelector('[role="dialog"]')
            ? heading
            : null);
        if (element) {
          element.focus({ preventScroll: true });
          focused = true;
        }
      }
      target.scrollTop = saved.top;
      if (target.scrollTop >= saved.top - 2 || Date.now() > deadline) {
        restore.current = null;
        if (focused || Date.now() > deadline) observer.disconnect();
      }
    };
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    const cancel = () => {
      cancelled = true;
      restore.current = null;
      observer.disconnect();
      clearTimeout(timer);
    };
    document.addEventListener('wheel', cancel, { once: true });
    apply();
    timer = setTimeout(() => {
      apply();
      observer.disconnect();
      restore.current = null;
    }, 4100);
    return () => {
      cancelled = true;
      observer.disconnect();
      clearTimeout(timer);
      document.removeEventListener('wheel', cancel);
    };
  }, [revision]);
  return (
    <Context.Provider
      value={{ route, navigate, patch, batch, move, closeSettings, drafts: drafts.current }}
    >
      {children}
    </Context.Provider>
  );
}
