export function createNavigationHistory(initial, limit = 100) {
  if (typeof initial !== 'string' || !initial)
    throw new TypeError('initial navigation entry required');
  const capacity = Number.isInteger(limit) && limit > 1 ? limit : 100;
  let entries = [initial];
  let index = 0;

  const snapshot = () => ({
    entries: [...entries],
    index,
    current: entries[index],
    canBack: index > 0,
    canForward: index < entries.length - 1,
  });

  return {
    snapshot,
    push(destination) {
      if (typeof destination !== 'string' || !destination)
        throw new TypeError('navigation destination required');
      if (destination === entries[index]) return snapshot();
      entries = [...entries.slice(0, index + 1), destination];
      if (entries.length > capacity) entries = entries.slice(entries.length - capacity);
      index = entries.length - 1;
      return snapshot();
    },
    move(direction) {
      if (direction !== 'back' && direction !== 'forward')
        throw new TypeError('navigation direction must be back or forward');
      const delta = direction === 'back' ? -1 : 1;
      index = Math.max(0, Math.min(entries.length - 1, index + delta));
      return snapshot();
    },
  };
}
