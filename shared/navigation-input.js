// Some Windows mice emit DOM button 3/4 without an Electron app-command.
// Others emit both. Pair different sources, never debounce repeated clicks.
export function subscribeNavigationInputs(
  target,
  subscribeNative,
  navigate,
  now = () => performance.now(),
) {
  const held = new Map();
  const capture = { capture: true };
  let recent = [];
  const trim = () => {
    recent = recent.filter((event) => now() - event.time <= 250);
  };
  const pair = (direction, source) => {
    trim();
    const index = recent.findIndex(
      (event) => event.direction === direction && event.source !== source,
    );
    if (index < 0) return false;
    recent.splice(index, 1);
    return true;
  };
  const deliver = (direction, source) => {
    if (pair(direction, source)) return;
    recent.push({ direction, source, time: now() });
    recent = recent.slice(-64);
    navigate(direction);
  };
  const directionOf = (event) =>
    event.button === 3 ? 'back' : event.button === 4 ? 'forward' : null;
  const down = (event) => {
    const direction = directionOf(event);
    if (!direction) return;
    event.preventDefault();
    // A native command can arrive just before mousedown. Keep the match for
    // the entire press, even when the button is held longer than 250ms.
    held.set(direction, pair(direction, 'dom'));
  };
  const up = (event) => {
    const direction = directionOf(event);
    if (!direction) return;
    event.preventDefault();
    if (!held.get(direction)) deliver(direction, 'dom');
    held.delete(direction);
  };
  const auxiliary = (event) => {
    if (directionOf(event)) event.preventDefault();
  };
  const reset = () => {
    held.clear();
    recent = [];
  };
  target.addEventListener('mousedown', down, capture);
  target.addEventListener('mouseup', up, capture);
  target.addEventListener('auxclick', auxiliary, capture);
  target.addEventListener('blur', reset);
  const unsubscribe = subscribeNative?.((direction) => {
    if (direction !== 'back' && direction !== 'forward') return;
    if (held.has(direction)) {
      if (!held.get(direction)) {
        held.set(direction, true);
        navigate(direction);
      }
    } else deliver(direction, 'native');
  });
  return () => {
    target.removeEventListener('mousedown', down, capture);
    target.removeEventListener('mouseup', up, capture);
    target.removeEventListener('auxclick', auxiliary, capture);
    target.removeEventListener('blur', reset);
    unsubscribe?.();
    reset();
  };
}
