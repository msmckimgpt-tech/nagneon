import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function useChatFollow(
  end: RefObject<HTMLDivElement | null>,
  revision: string,
  sessionKey: string,
) {
  const following = useRef(true),
    pane = useRef<HTMLElement | null>(null),
    cleanup = useRef<() => void>(() => {});
  const previous = useRef({ revision, sessionKey, rendered: '' });
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const lastScrollTop = useRef(0);
  const [unread, setUnread] = useState(false);
  const remember = useCallback(() => {
    const p = end.current?.parentElement;
    const top = p?.getBoundingClientRect().top || 0;
    const line =
      p &&
      [...p.querySelectorAll<HTMLElement>('[data-message-id]')].find(
        (element) => element.getBoundingClientRect().bottom > top,
      );
    anchor.current = line
      ? { id: line.dataset.messageId!, offset: line.getBoundingClientRect().top - top }
      : null;
  }, [end]);
  const preserve = useCallback(() => {
    following.current = false;
    remember();
  }, [remember]);
  const jump = useCallback(() => {
    following.current = true;
    anchor.current = null;
    setUnread(false);
    const p = end.current?.parentElement;
    if (p) p.scrollTop = p.scrollHeight;
  }, [end]);
  useLayoutEffect(() => {
    const next = end.current?.parentElement || null;
    const rendered = end.current?.previousElementSibling?.getAttribute('data-message-id') || '';
    if (next !== pane.current) {
      cleanup.current();
      pane.current = next;
      following.current = true;
      anchor.current = null;
      setUnread(false);
      if (next) {
        const scroll = () => {
          following.current = next.scrollHeight - next.clientHeight - next.scrollTop <= 48;
          if (following.current) {
            anchor.current = null;
            setUnread(false);
          } else remember();
          lastScrollTop.current = next.scrollTop;
        };
        next.addEventListener('scroll', scroll, { passive: true });
        const resize = new ResizeObserver(() => {
          if (following.current) next.scrollTop = next.scrollHeight;
        });
        resize.observe(next);
        cleanup.current = () => {
          next.removeEventListener('scroll', scroll);
          resize.disconnect();
        };
        next.scrollTop = next.scrollHeight;
      }
    }
    if (previous.current.sessionKey !== sessionKey) jump();
    else {
      // A browser scroll event may still be queued when another React update
      // commits. Respect the reader's already changed position immediately.
      if (next && Math.abs(next.scrollTop - lastScrollTop.current) > 1) {
        following.current = next.scrollHeight - next.clientHeight - next.scrollTop <= 48;
        if (following.current) anchor.current = null;
        else remember();
      }
      if (!following.current && anchor.current && next) {
        const saved = anchor.current;
        const line = [...next.querySelectorAll<HTMLElement>('[data-message-id]')].find(
          (element) => element.dataset.messageId === saved.id,
        );
        if (line)
          next.scrollTop +=
            line.getBoundingClientRect().top - next.getBoundingClientRect().top - saved.offset;
      }
      if (previous.current.revision !== revision) {
        if (!following.current) setUnread(true);
      }
      // The history hook commits incoming messages separately from the live
      // snapshot. Follow only after their actual DOM update, never on a clock
      // render while the browser is still dispatching the reader's scroll.
      if (following.current && previous.current.rendered !== rendered) jump();
    }
    previous.current = { revision, sessionKey, rendered };
    if (next) lastScrollTop.current = next.scrollTop;
    if (!following.current) remember();
  });
  useLayoutEffect(
    () => () => {
      cleanup.current();
      pane.current = null;
    },
    [],
  );
  return { unread, jump, preserve };
}
