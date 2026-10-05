// A projection for the audience, never a replacement for the original receipt.
// Only known provider annotations are separated; bracketed ordinary words stay.
const labels = new Map([
  ['tongue click', 'tongue-click'],
  ['clicks tongue', 'tongue-click'],
  ['clear throat', 'throat-clear'],
  ['clears throat', 'throat-clear'],
  ['throat clearing', 'throat-clear'],
  ['laugh', 'laughter'],
  ['laughs', 'laughter'],
  ['laughter', 'laughter'],
  ['sigh', 'sigh'],
  ['sighs', 'sigh'],
  ['cough', 'cough'],
  ['coughs', 'cough'],
]);
export function speechContent(text) {
  const nonverbal = [];
  const spoken = text.replace(/\[([^\]\r\n]{1,40})(\]|$)/gu, (raw, value, end) => {
    const kind = labels.get(value.trim().toLowerCase());
    if (!kind) return raw;
    nonverbal.push({ kind, complete: end === ']', source: 'provider-transcript-annotation' });
    return '';
  });
  return { text: spoken, nonverbal };
}

export function projectSpeech(source) {
  if (source.source !== 'microphone' || source.capture?.voice?.provider !== 'chatgpt-subscription')
    return source;
  const projection = speechContent(source.text);
  return {
    ...source,
    text: projection.text,
    ...(projection.nonverbal.length ? { nonverbal: projection.nonverbal } : {}),
  };
}

export function assembleSpeech(items) {
  const parts = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      previous = items[i - 1];
    const before = previous?.capture?.voice,
      after = item.capture?.voice;
    const continuation =
      (before?.providerTurnId && before.providerTurnId === after?.providerTurnId) ||
      /\s$/u.test(previous?.text || '') ||
      /^\s/u.test(item.text) ||
      /^(?:네요|니다|습니다|려고|려\s)/u.test(item.text);
    const contiguous =
      continuation &&
      before?.provider === 'chatgpt-subscription' &&
      after?.provider === before.provider &&
      before.kind === 'transcript' &&
      after.kind === 'transcript' &&
      before.sourceInputEpoch === after.sourceInputEpoch &&
      before.runId === after.runId &&
      before.recovered === after.recovered &&
      previous.capture.screen?.sourceId === item.capture.screen?.sourceId &&
      after.sourceFrameStart >= before.sourceFrameEnd &&
      after.sourceFrameStart - before.sourceFrameEnd <= 16000 * 1.2;
    if (i && !contiguous) parts.push('\n');
    parts.push(item.text);
  }
  // Join before separating annotations so a tag split between packets remains
  // one annotation, without inventing a missing word or changing negation.
  const text = parts.join('');
  return items.every(
    (item) =>
      item.source === 'microphone' && item.capture?.voice?.provider === 'chatgpt-subscription',
  )
    ? speechContent(text)
    : { text, nonverbal: [] };
}
