import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePageRoute, formatPageRoute, updatePageRoute } from '../shared/page-route.js';

test('deep links round-trip Korean search/filter and preserve background settings page', () => {
  const route = {
    tab: 'community',
    section: 'outside',
    community: 'indie',
    q: '돌아가는 길 & 퍼즐?',
    page: '2',
    bookmarked: '1',
    settings: 'media',
  };
  assert.deepEqual(parsePageRoute(formatPageRoute(route)), route);
  assert.deepEqual(updatePageRoute(route, { settings: undefined }), {
    tab: 'community',
    section: 'outside',
    community: 'indie',
    q: '돌아가는 길 & 퍼즐?',
    page: '2',
    bookmarked: '1',
  });
});
test('unknown pages/categories and unrelated editor data never become navigation state', () => {
  assert.deepEqual(
    parsePageRoute('#/missing?settings=missing&title=private&apiKey=secret&clip=bad'),
    { tab: 'studio' },
  );
  assert.equal(
    formatPageRoute({ tab: 'clips', q: 'unrelated', settings: 'connection', title: 'private' }),
    '#/clips?settings=connection',
  );
});
test('invalid paging and default page zero normalize without duplicate page identities', () => {
  for (const page of ['0', '-1', 'NaN', '1.5'])
    assert.deepEqual(parsePageRoute('#/community/broadcast?page=' + page), {
      tab: 'community',
      section: 'broadcast',
    });
  assert.equal(formatPageRoute({ tab: 'community', page: '0' }), '#/community/broadcast');
  assert.equal(parsePageRoute('#/community/outside?page=99999999').page, '100000');
});
