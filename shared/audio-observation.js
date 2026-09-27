// Amplitude measurements describe the captured signal, not a person's emotion.
export function observePcmAmplitude(pcm) {
  if (!pcm?.length || pcm.length % 2) throw new Error('PCM16 audio is required');
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let power = 0,
    peak = 0,
    clipped = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const value = Math.abs(view.getInt16(i, true) / 32768);
    power += value * value;
    peak = Math.max(peak, value);
    if (value >= 0.999) clipped++;
  }
  const frames = pcm.length / 2;
  const db = (value) =>
    Math.max(-120, Math.round(20 * Math.log10(Math.max(0.000001, value)) * 10) / 10);
  return {
    measurement: 'pcm-amplitude',
    rmsDb: db(Math.sqrt(power / frames)),
    peakDb: db(peak),
    clippedFraction: clipped / frames,
  };
}
