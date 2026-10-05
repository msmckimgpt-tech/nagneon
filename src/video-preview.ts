export type PreviewStatus = 'waiting' | 'live' | 'paused' | 'stale' | 'error';

// Own only the display player. The shared tracks, analysis player, and recorder
// remain live when the display is detached, hidden, replaced, or closed.
export function startVideoPreview(
  video: HTMLVideoElement,
  stream: MediaStream,
  onStatus: (status: PreviewStatus) => void,
  {
    now = () => performance.now(),
    schedule = (fn: () => void) => setTimeout(fn, 1000),
    cancel = (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  } = {},
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false,
    visible = false,
    generation = 0;
  let lastMediaTime = -1,
    lastFrameAt = now(),
    status: PreviewStatus | undefined;
  const report = (value: PreviewStatus) => {
    if (status !== value) {
      status = value;
      onStatus(value);
    }
  };
  const clearTimer = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  };
  const tick = () => {
    timer = undefined;
    if (stopped || !visible) return;
    if (video.readyState >= 2 && video.videoWidth && !video.paused && !video.ended) {
      if (video.currentTime !== lastMediaTime) {
        lastMediaTime = video.currentTime;
        lastFrameAt = now();
        report('live');
      } else if (now() - lastFrameAt >= 2500) report('stale');
    } else report(lastMediaTime < 0 ? 'waiting' : 'stale');
    if (!stopped && visible) timer = schedule(tick);
  };
  const detach = () => {
    video.pause();
    video.srcObject = null;
  };
  report('paused');
  return {
    setVisible(value: boolean) {
      if (stopped || visible === value) return;
      visible = value;
      const ticket = ++generation;
      clearTimer();
      if (!value) {
        detach();
        report('paused');
        return;
      }
      lastMediaTime = -1;
      lastFrameAt = now();
      video.srcObject = stream;
      report('waiting');
      try {
        void Promise.resolve(video.play()).then(
          () => {
            if (!stopped && visible && ticket === generation) tick();
          },
          () => {
            if (!stopped && visible && ticket === generation) {
              visible = false;
              detach();
              report('error');
            }
          },
        );
      } catch {
        if (!stopped && ticket === generation) {
          visible = false;
          detach();
          report('error');
        }
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      generation++;
      clearTimer();
      detach();
    },
  };
}
