import type { NavigationDirection } from './navigation-history.js';
export declare function subscribeNavigationInputs(
  target: EventTarget,
  subscribeNative: ((listener: (direction: NavigationDirection) => void) => () => void) | undefined,
  navigate: (direction: NavigationDirection) => void,
  now?: () => number,
): () => void;
