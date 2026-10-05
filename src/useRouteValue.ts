import { useState } from 'react';
import { usePageNavigation } from './PageNavigation';
import type { PageRoute } from '../shared/page-route.js';
// Standalone component fixtures keep their local behavior. App pages share one route.
export function useRouteValue(key: keyof PageRoute, initial = '') {
  const navigation = usePageNavigation();
  const [local, setLocal] = useState(initial);
  const value = navigation ? navigation.route[key] || initial : local;
  const setValue = (next: string | ((previous: string) => string), replace = false) => {
    const result = typeof next === 'function' ? next(value) : next;
    if (navigation) navigation.patch({ [key]: result || undefined }, replace);
    else setLocal(result);
  };
  return [value, setValue] as const;
}
