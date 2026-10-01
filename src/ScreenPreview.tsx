import { memo, useEffect, useRef, useState } from 'react';
import { startVideoPreview, type PreviewStatus } from './video-preview';

const labels: Record<PreviewStatus, string> = {
  waiting: '미리보기 · 새 화면 대기',
  live: '선택한 화면 미리보기',
  paused: '미리보기 일시정지 · 화면 연결 유지',
  stale: '마지막 화면 · 새 프레임 대기',
  error: '미리보기 표시 실패 · 화면 연결 유지',
};

export const ScreenPreview = memo(function ScreenPreview({
  source,
}: {
  source: MediaStream | null;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<PreviewStatus>('waiting');
  useEffect(() => {
    const target = video.current;
    if (!source || !target) return;
    const bridge = window.backseat;
    let disposed = false,
      nativeVisible = !bridge?.previewVisibility,
      receivedEvent = false;
    const rect = target.getBoundingClientRect();
    let onscreen =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < innerHeight &&
      rect.right > 0 &&
      rect.left < innerWidth;
    const preview = startVideoPreview(target, source, setStatus);
    const refresh = () => preview.setVisible(nativeVisible && onscreen && !document.hidden);
    const unsubscribe = bridge?.onPreviewVisibility?.((value) => {
      if (disposed) return;
      receivedEvent = true;
      nativeVisible = value;
      refresh();
    });
    if (bridge?.previewVisibility)
      void bridge
        .previewVisibility()
        .then((value) => {
          if (!disposed && !receivedEvent) {
            nativeVisible = value;
            refresh();
          }
        })
        .catch(() => {
          if (!disposed) {
            nativeVisible = false;
            refresh();
          }
        });
    const intersection = new IntersectionObserver(([entry]) => {
      onscreen = entry.isIntersecting;
      refresh();
    });
    intersection.observe(target);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      disposed = true;
      preview.stop();
      unsubscribe?.();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [source]);
  return (
    <>
      <video ref={video} muted playsInline aria-label="선택한 화면 미리보기" />
      {source && (
        <span className={'preview-state ' + status} role="status">
          {labels[status]}
        </span>
      )}
    </>
  );
});
