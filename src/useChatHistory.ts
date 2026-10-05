import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Message, State } from './types';

type Page = { sessionId: string; revision: number; messages: Message[]; hasMore: boolean };
type History = {
  key: string;
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
  error: string;
  pausedTail: boolean;
};
const empty: Message[] = [];
const sequence = (message?: Message) => message?.historySequence || 0;

export function useChatHistory(state: State | null, enabled: boolean, preserve: () => void) {
  const sessionId = state?.sessionId || '';
  const revision = state?.chatHistory?.revision || 0;
  const key = `${sessionId}:${revision}`;
  const live = state?.messages || empty;
  const initial = (): History => ({
    key,
    messages: live.slice(-100),
    hasMore: !!state?.chatHistory?.hasMore,
    loading: false,
    error: '',
    pausedTail: false,
  });
  const [history, setHistory] = useState<History>(initial);
  const currentKey = useRef(key);
  currentKey.current = key;
  const request = useRef<AbortController | null>(null);
  const current = history.key === key ? history : initial();
  const latest = useRef(current);
  latest.current = current;

  useLayoutEffect(() => {
    request.current?.abort();
    request.current = null;
    setHistory(initial());
  }, [key]);
  useEffect(() => () => request.current?.abort(), []);
  useLayoutEffect(() => {
    if (!enabled) return;
    setHistory((previous) => {
      if (
        previous.key !== key ||
        !previous.messages.length ||
        live.some((message) => !sequence(message))
      )
        return initial();
      const last = sequence(previous.messages.at(-1));
      // A disconnected renderer can miss more than the live window. Do not
      // join distant ranges and pretend there is no gap.
      if (!previous.pausedTail && live.length && sequence(live[0]) > last + 1)
        return {
          ...initial(),
          error: '다시 연결되어 최근 채팅을 표시합니다. 이전 채팅은 더보기로 불러올 수 있어요.',
        };
      const messages = new Map(previous.messages.map((message) => [message.id, message]));
      for (const message of live)
        if (messages.has(message.id) || (!previous.pausedTail && sequence(message) > last))
          messages.set(message.id, message);
      const ordered = [...messages.values()].sort((a, b) => sequence(a) - sequence(b));
      return {
        ...previous,
        messages: ordered.slice(0, 4500),
        pausedTail: previous.pausedTail || ordered.length > 4500,
      };
    });
  }, [live, key, enabled]);

  const loadMore = useCallback(async () => {
    const previous = latest.current;
    if (!enabled || !sessionId || request.current || previous.key !== key || !previous.hasMore)
      return;
    const controller = new AbortController();
    request.current = controller;
    setHistory((value) => ({ ...value, loading: true, error: '' }));
    try {
      const query = new URLSearchParams({ sessionId, revision: String(revision), limit: '100' });
      const before = sequence(previous.messages[0]);
      if (before) query.set('before', String(before));
      const response = await fetch('/api/chat/history?' + query, {
        signal: controller.signal,
        headers: { 'X-Backseat-Client': 'studio' },
      });
      const page: Page & { error?: string } = await response.json();
      if (!response.ok) throw Error(page.error || '이전 채팅을 불러오지 못했습니다.');
      if (
        controller.signal.aborted ||
        currentKey.current !== key ||
        page.sessionId !== sessionId ||
        page.revision !== revision
      )
        return;
      preserve();
      setHistory((value) => {
        if (value.key !== key) return value;
        const messages = new Map(page.messages.map((message) => [message.id, message]));
        for (const message of value.messages) messages.set(message.id, message);
        const ordered = [...messages.values()].sort((a, b) => sequence(a) - sequence(b));
        return {
          ...value,
          messages: ordered.slice(0, 4500),
          pausedTail: value.pausedTail || ordered.length > 4500,
          hasMore: page.hasMore,
          loading: false,
          error: '',
        };
      });
    } catch (error) {
      if (!controller.signal.aborted && currentKey.current === key)
        setHistory((value) => ({
          ...value,
          loading: false,
          error: error instanceof Error ? error.message : '이전 채팅을 불러오지 못했습니다.',
        }));
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [enabled, sessionId, revision, key, preserve]);
  const showLatest = () => {
    if (!latest.current.pausedTail) return;
    request.current?.abort();
    request.current = null;
    setHistory(initial());
  };
  return { ...current, loadMore, showLatest };
}
