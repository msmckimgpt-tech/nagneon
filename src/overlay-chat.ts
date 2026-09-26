type RelayOptions = {
  getState?: () => { running: boolean; sessionId: string | null } | null;
  accept?: (text: string) => boolean;
  timeoutMs?: number;
};
// The main window owns capture and the speech outbox. The overlay only requests
// admission to that outbox, with the broadcast session it actually displayed.
export function createOverlayChatRelay(channel: BroadcastChannel, options: RelayOptions = {}) {
  const pending = new Map<
    string,
    {
      resolve: (value: boolean) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const replies = new Map<string, { type: string; id: string; error?: string }>();
  let closed = false;
  channel.onmessage = ({ data }) => {
    if (!data || typeof data.id !== 'string') return;
    if (data.type === 'chat-result') {
      const request = pending.get(data.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(data.id);
      if (typeof data.error === 'string') request.reject(new Error(data.error));
      else request.resolve(true);
    } else if (data.type === 'chat-send' && options.accept && options.getState) {
      const previous = replies.get(data.id);
      if (previous) {
        channel.postMessage(previous);
        return;
      }
      const state = options.getState();
      let error: string | undefined;
      if (!state?.running || !state.sessionId || state.sessionId !== data.sessionId)
        error = '방송 상태가 바뀌었습니다. 방송실을 확인한 뒤 다시 보내주세요.';
      else if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 3000)
        error = '1~3000자의 메시지를 입력해주세요.';
      else {
        try {
          if (!options.accept(data.text.trim()))
            error = '전달할 말이 많이 밀렸어요. 잠시 후 다시 보내주세요.';
        } catch {
          error = '발언을 접수하지 못했습니다. 방송실을 확인해주세요.';
        }
      }
      const reply = { type: 'chat-result', id: data.id, ...(error ? { error } : {}) };
      replies.set(data.id, reply);
      if (replies.size > 200) replies.delete(replies.keys().next().value!);
      channel.postMessage(reply);
    }
  };
  return {
    send(text: string, sessionId: string): Promise<boolean> {
      if (closed) return Promise.reject(new Error('오버레이 연결이 종료되었습니다.'));
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('방송실의 접수 확인을 받지 못했습니다. 방송실 채팅을 확인해주세요.'));
        }, options.timeoutMs ?? 4000);
        pending.set(id, { resolve, reject, timer });
        try {
          channel.postMessage({ type: 'chat-send', id, text, sessionId });
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error('방송실 연결이 끊겼습니다. 오버레이를 다시 열어주세요.'));
        }
      });
    },
    close() {
      if (closed) return;
      closed = true;
      channel.close();
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('오버레이 연결이 종료되었습니다.'));
      }
      pending.clear();
      replies.clear();
    },
  };
}
