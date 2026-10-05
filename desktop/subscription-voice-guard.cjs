// A stalled renderer cannot execute track.stop(). Releasing its WebContents
// releases only this app's owned microphone/screen tracks, not other apps.
function attachSubscriptionVoiceGuard({ window, voice, onRelease = () => {}, intervalMs = 1000 }) {
  let released = false;
  const release = () => {
    if (released || window.isDestroyed()) return;
    const s = voice.session;
    if (!s || (!s.active && s.stopReason !== 'heartbeat-timeout')) return;
    released = true;
    voice.error = '화면 응답이 멈춰 마이크와 화면 공유를 해제했습니다.';
    void voice.stop('renderer-unresponsive');
    onRelease();
    window.destroy();
  };
  const contents = window.webContents;
  contents.on('unresponsive', release);
  contents.on('render-process-gone', release);
  const timer = setInterval(() => {
    if (voice.session?.stopReason === 'heartbeat-timeout') release();
  }, intervalMs);
  timer.unref?.();
  const dispose = () => {
    clearInterval(timer);
    contents.removeListener('unresponsive', release);
    contents.removeListener('render-process-gone', release);
  };
  window.once('closed', dispose);
  return dispose;
}
module.exports = { attachSubscriptionVoiceGuard };
