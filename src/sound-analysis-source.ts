// The analyser owns clones, never the display-capture tracks used by hotclips.
export function createSoundAnalysisSource(
  source: MediaStream | null,
  makeStream = (tracks: MediaStreamTrack[]) => new MediaStream(tracks),
) {
  const owned: MediaStreamTrack[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const track of owned) track.stop();
  };
  try {
    for (const track of source?.getAudioTracks() || []) {
      if (track.readyState === 'live') owned.push(track.clone());
    }
    return { stream: owned.length ? makeStream(owned) : null, close };
  } catch (error) {
    close();
    throw error;
  }
}
