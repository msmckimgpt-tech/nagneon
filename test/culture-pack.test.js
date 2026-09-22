import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CulturePackValidationError,
  compileCulturePack,
  selectCultureCandidates,
} from '../server/culture/index.js';

const HOUR = 60 * 60 * 1000;

function entry(overrides = {}) {
  return {
    id: 'global-classic',
    familyId: 'global-classic-family',
    meaning: '상황을 가볍게 받아치는 고전형 표현',
    cultureClass: 'classic',
    scope: { languages: ['ko-KR'], surfaces: ['live', 'community'] },
    variants: [{ id: 'ko', language: 'ko-KR', text: '고전형 반응' }],
    usage: { functions: ['failure'], avoidSituationTags: ['serious'] },
    policy: { generationAllowed: true, spoilerLevel: 'none' },
    sourceEvidence: [
      {
        id: 'curated-1',
        kind: 'curated',
        provenance: 'real-external',
        rights: {
          referenceAllowed: true,
          generationAllowed: true,
          redistributionAllowed: false,
        },
      },
    ],
    ...overrides,
  };
}

function pack(entries) {
  return compileCulturePack({
    schemaVersion: 1,
    packId: 'test-pack',
    revision: 3,
    publishedAt: 10 * HOUR,
    sourcePolicyRevision: 'test-policy-r1',
    entries,
  });
}

test('CulturePack은 최신성의 validUntil을 fetchedAt과 분리한다', () => {
  assert.throws(
    () =>
      pack([
        entry({
          cultureClass: 'trend',
          trendSnapshots: [
            {
              state: 'active',
              language: 'ko-KR',
              observedUntil: 8 * HOUR,
              verifiedAt: 9 * HOUR,
            },
          ],
          sourceEvidence: [
            {
              id: 'feed-1',
              kind: 'feed',
              provenance: 'real-external',
              fetchedAt: 10 * HOUR,
              rights: { referenceAllowed: true, generationAllowed: true },
            },
          ],
        }),
      ]),
    (error) =>
      error instanceof CulturePackValidationError &&
      error.path.endsWith('.trendSnapshots[0].validUntil'),
  );
});

test('게임/방송 성향과 검증된 최신성을 함께 사용하되 최신성이 맥락 제약을 덮지 않는다', () => {
  const compiled = pack([
    entry(),
    entry({
      id: 'game-trend',
      familyId: 'game-trend-family',
      meaning: '특정 게임의 실패 상황에서 쓰는 최신 표현',
      cultureClass: 'trend',
      scope: {
        languages: ['ko-KR'],
        games: ['Game-A'],
        surfaces: ['live'],
        streamTags: ['competitive'],
      },
      variants: [
        {
          id: 'game-ko',
          language: 'ko-KR',
          text: '게임 전용 최신 반응',
          games: ['Game-A'],
          tags: ['failure'],
        },
      ],
      trendSnapshots: [
        {
          state: 'active',
          population: 'ko-game-community',
          language: 'ko-KR',
          game: 'Game-A',
          observedUntil: 9 * HOUR,
          verifiedAt: 9 * HOUR,
          validUntil: 12 * HOUR,
        },
      ],
    }),
  ]);

  const selected = selectCultureCandidates(compiled, {
    now: 10 * HOUR,
    language: 'ko-KR',
    game: 'Game-A',
    surface: 'live',
    streamTags: ['competitive'],
    situationTags: ['failure'],
    limit: 2,
  });
  assert.equal(selected[0].id, 'game-trend');
  assert.equal(selected[0].trend.state, 'active');
  assert.equal(selected[1].id, 'global-classic');

  assert.deepEqual(
    selectCultureCandidates(compiled, {
      now: 10 * HOUR,
      language: 'ko-KR',
      game: 'Game-A',
      surface: 'live',
      streamTags: ['competitive'],
      situationTags: ['failure', 'serious'],
      latestMode: 'fresh-only',
    }),
    [],
    'avoidSituationTags는 active trend보다 우선한다',
  );
});

test('trend 전용 밈은 validUntil이 지나면 최신 후보에서 탈락하고 fetchedAt으로 부활하지 않는다', () => {
  const compiled = pack([
    entry({
      id: 'expired-trend',
      familyId: 'expired-family',
      cultureClass: 'trend',
      trendSnapshots: [
        {
          state: 'active',
          language: 'ko-KR',
          observedUntil: 3 * HOUR,
          verifiedAt: 4 * HOUR,
          validUntil: 5 * HOUR,
        },
      ],
      sourceEvidence: [
        {
          id: 'late-fetch',
          kind: 'feed',
          provenance: 'real-external',
          fetchedAt: 10 * HOUR,
          rights: { referenceAllowed: true, generationAllowed: true },
        },
      ],
    }),
  ]);

  assert.deepEqual(selectCultureCandidates(compiled, { now: 10 * HOUR, language: 'ko-KR' }), []);
});

test('hybrid 밈은 최신성 만료 뒤에도 고전 경로로 남고 fresh-only에서는 빠진다', () => {
  const compiled = pack([
    entry({
      id: 'hybrid',
      familyId: 'hybrid-family',
      cultureClass: 'hybrid',
      trendSnapshots: [
        {
          state: 'declining',
          language: 'ko-KR',
          observedUntil: 3 * HOUR,
          verifiedAt: 4 * HOUR,
          validUntil: 5 * HOUR,
        },
      ],
    }),
  ]);

  const balanced = selectCultureCandidates(compiled, {
    now: 10 * HOUR,
    language: 'ko-KR',
  });
  assert.equal(balanced.length, 1);
  assert.equal(balanced[0].trend, null);

  assert.deepEqual(
    selectCultureCandidates(compiled, {
      now: 10 * HOUR,
      language: 'ko-KR',
      latestMode: 'fresh-only',
    }),
    [],
  );
});

test('live와 community 성향 범위를 분리하고 밈 비사용/차단을 정상 경로로 둔다', () => {
  const compiled = pack([
    entry({
      id: 'community-only',
      familyId: 'community-family',
      scope: {
        languages: ['ko-KR'],
        surfaces: ['community'],
        communityTags: ['retro'],
      },
      variants: [{ id: 'community-ko', language: 'ko-KR', text: '커뮤니티 전용 반응' }],
    }),
  ]);

  assert.deepEqual(
    selectCultureCandidates(compiled, {
      language: 'ko-KR',
      surface: 'live',
      streamTags: ['retro'],
    }),
    [],
  );

  assert.equal(
    selectCultureCandidates(compiled, {
      language: 'ko-KR',
      surface: 'community',
      communityTags: ['retro'],
    })[0].id,
    'community-only',
  );

  assert.deepEqual(
    selectCultureCandidates(compiled, {
      language: 'ko-KR',
      surface: 'community',
      communityTags: ['retro'],
      blockedFamilies: ['community-family'],
    }),
    [],
  );
  assert.deepEqual(selectCultureCandidates(compiled, { enabled: false }), []);
});

test('권리 또는 spoiler 정책이 허용되지 않은 항목은 후보가 되지 않는다', () => {
  const compiled = pack([
    entry({
      id: 'no-rights',
      familyId: 'no-rights-family',
      sourceEvidence: [
        {
          id: 'source-no-rights',
          kind: 'feed',
          provenance: 'real-external',
          rights: { referenceAllowed: true, generationAllowed: false },
        },
      ],
    }),
    entry({
      id: 'missing-evidence',
      familyId: 'missing-evidence-family',
      sourceEvidence: [],
    }),
    entry({
      id: 'spoiler',
      familyId: 'spoiler-family',
      policy: { generationAllowed: true, spoilerLevel: 'implicit' },
    }),
  ]);

  assert.deepEqual(selectCultureCandidates(compiled, { language: 'ko-KR' }), []);
  assert.deepEqual(
    selectCultureCandidates(compiled, {
      language: 'ko-KR',
      allowSpoilers: true,
      blockedFamilies: ['no-rights-family'],
    }).map((candidate) => candidate.id),
    ['spoiler'],
  );
});

test('가상 세계의 공개 근거를 현실 인터넷 CulturePack 근거로 승격하지 않는다', () => {
  assert.throws(
    () =>
      pack([
        entry({
          sourceEvidence: [
            {
              id: 'virtual-post',
              kind: 'community-post',
              provenance: 'virtual-world',
              rights: { referenceAllowed: true, generationAllowed: true },
            },
          ],
        }),
      ]),
    (error) =>
      error instanceof CulturePackValidationError &&
      error.path.endsWith('.sourceEvidence[0].provenance'),
  );
});

test('컴파일된 pack은 입력과 분리된 불변 snapshot이다', () => {
  const input = {
    schemaVersion: 1,
    packId: 'immutable',
    revision: 1,
    publishedAt: 1,
    entries: [entry()],
  };
  const compiled = compileCulturePack(input);
  input.entries[0].meaning = '변조';
  assert.notEqual(compiled.entries[0].meaning, '변조');
  assert.ok(Object.isFrozen(compiled));
  assert.ok(Object.isFrozen(compiled.entries[0]));
  assert.throws(() => {
    compiled.entries.push(entry({ id: 'x' }));
  });
});
