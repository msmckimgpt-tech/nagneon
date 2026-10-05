export type PageRoute = {
  tab: string;
  section?: 'broadcast' | 'outside';
  post?: string;
  clip?: string;
  community?: string;
  filter?: string;
  q?: string;
  page?: string;
  write?: string;
  bookmarked?: string;
  settings?: string;
};
export const pageTabs: string[];
export const settingsTabs: string[];
export function parsePageRoute(hash?: string): PageRoute;
export function formatPageRoute(route: PageRoute): string;
export function updatePageRoute(route: PageRoute, patch: Partial<PageRoute>): PageRoute;
