export type NavigationDirection = 'back' | 'forward';

export type NavigationSnapshot = {
  entries: string[];
  index: number;
  current: string;
  canBack: boolean;
  canForward: boolean;
};

export declare function createNavigationHistory(
  initial: string,
  limit?: number,
): {
  snapshot: () => NavigationSnapshot;
  push: (destination: string) => NavigationSnapshot;
  move: (direction: NavigationDirection) => NavigationSnapshot;
};
