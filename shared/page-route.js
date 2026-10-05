// Only navigation identities belong in URLs/history. Never serialize editor drafts.
export const pageTabs = [
  'studio',
  'ai',
  'audience',
  'knowledge',
  'manager',
  'community',
  'special',
  'clips',
];
export const settingsTabs = [
  'broadcast',
  'mood',
  'connection',
  'manager',
  'media',
  'games',
  'debug',
];
const fields = [
  'post',
  'clip',
  'community',
  'filter',
  'q',
  'page',
  'write',
  'bookmarked',
  'settings',
];
export function parsePageRoute(hash = '') {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const [tab, section] = path.split('/').filter(Boolean);
  const route = { tab: pageTabs.includes(tab) ? tab : 'studio' };
  if (route.tab === 'community') route.section = section === 'outside' ? 'outside' : 'broadcast';
  const params = new URLSearchParams(query);
  for (const field of fields) {
    const value = params.get(field);
    if (!value) continue;
    if (field === 'settings' && settingsTabs.includes(value)) route.settings = value;
    else if (field === 'clip' && route.tab === 'clips') route.clip = value.slice(0, 160);
    else if (['post', 'community', 'filter', 'q'].includes(field) && route.tab === 'community')
      route[field] = value.slice(0, field === 'q' ? 120 : 160);
    else if (field === 'page' && route.tab === 'community' && /^\d+$/.test(value)) {
      if (Number(value) > 0) route.page = String(Math.min(100000, Number(value)));
    } else if (
      ['write', 'bookmarked'].includes(field) &&
      route.tab === 'community' &&
      value === '1'
    )
      route[field] = value;
  }
  return route;
}
export function formatPageRoute(route) {
  const tab = pageTabs.includes(route.tab) ? route.tab : 'studio';
  const path =
    '/' +
    tab +
    (tab === 'community' ? '/' + (route.section === 'outside' ? 'outside' : 'broadcast') : '');
  const query = new URLSearchParams();
  for (const field of fields) if (route[field]) query.set(field, String(route[field]));
  const result = '#' + path + (query.size ? '?' + query.toString() : '');
  // Round-trip normalization removes fields that do not belong to this page.
  const clean = parsePageRoute(result);
  const normalized = new URLSearchParams();
  for (const field of fields) if (clean[field]) normalized.set(field, clean[field]);
  return '#' + path + (normalized.size ? '?' + normalized.toString() : '');
}
export function updatePageRoute(route, patch) {
  return parsePageRoute(formatPageRoute({ ...route, ...patch }));
}
