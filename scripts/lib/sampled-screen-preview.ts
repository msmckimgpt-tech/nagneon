// Experimental canvas display; the production UI keeps native video composition.
export type PreviewStatus = 'waiting' | 'live' | 'paused' | 'stale' | 'error';

// Display-only sampling of the existing decoder. Never clone, constrain, pause,
// or stop its stream: analysis and recording own their independent requirements.
export function startScreenPreview(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  onStatus: (status: PreviewStatus) => void,
  {
    now = () => performance.now(),
    schedule = (fn: () => void, ms: number) => setTimeout(fn, ms),
    cancel = (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    visible = false,
    width = 960,
  } = {},
) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false,
    lastMediaTime = -1,
    lastFrameAt = now(),
    cost = 0,
    needsPaint = true;
  let status: PreviewStatus | undefined;
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
    const started = now();
    try {
      if (!ctx) throw Error('Preview canvas unavailable');
      if (
        video.readyState >= 2 &&
        video.videoWidth &&
        video.videoHeight &&
        !video.paused &&
        !video.ended
      ) {
        const advanced = video.currentTime !== lastMediaTime;
        if (advanced || needsPaint) {
          const scale = Math.min(
            1,
            Math.max(1, width) / video.videoWidth,
            960 / Math.max(video.videoWidth, video.videoHeight),
          );
          const w = Math.max(1, Math.round(video.videoWidth * scale));
          const h = Math.max(1, Math.round(video.videoHeight * scale));
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          ctx.drawImage(video, 0, 0, w, h);
          if (advanced) {
            lastMediaTime = video.currentTime;
            lastFrameAt = started;
          }
          needsPaint = false;
          report(started - lastFrameAt >= 2500 ? 'stale' : 'live');
          cost = cost * 0.75 + (now() - started) * 0.25;
        } else if (started - lastFrameAt >= 2500) report('stale');
      } else report(lastMediaTime < 0 ? 'waiting' : 'stale');
    } catch {
      report('error');
      visible = false;
      return;
    }
    // Slow paints lower only the display cadence. Missed frames are never queued.
    if (!stopped && visible) timer = schedule(tick, Math.max(125, Math.min(500, cost * 8)));
  };
  report(visible ? 'waiting' : 'paused');
  if (visible) tick();
  return {
    setVisible(value: boolean) {
      if (stopped || visible === value) return;
      visible = value;
      clearTimer();
      if (!value) {
        report('paused');
        return;
      }
      needsPaint = true;
      report('waiting');
      tick();
    },
    setWidth(value: number) {
      if (stopped || width === value) return;
      width = value;
      // Repaint the latest decoded frame after resize even for a still source.
      needsPaint = true;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimer();
      canvas.width = canvas.height = 0;
    },
  };
}
