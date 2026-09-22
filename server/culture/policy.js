const normalize = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ko-KR');
const setOf = (values) =>
  new Set((Array.isArray(values) ? values : []).map(normalize).filter(Boolean));

const exactOrBaseLanguage = (candidate, requested) => {
  const left = normalize(candidate);
  const right = normalize(requested);
  if (!left || !right) return 0;
  if (left === right) return 2;
  if (left.split('-')[0] === right.split('-')[0]) return 1;
  return 0;
};

const intersects = (left, right) => {
  for (const value of left) if (right.has(value)) return true;
  return false;
};

const listMatchesScalar = (values, requested) => {
  if (!values.length) return true;
  const normalizedRequested = normalize(requested);
  if (!normalizedRequested) return false;
  return values.some((value) => normalize(value) === normalizedRequested);
};

const listMatchesLanguage = (values, requested) => {
  if (!values.length) return true;
  return values.some((value) => exactOrBaseLanguage(value, requested) > 0);
};

function scopeMatches(entry, context) {
  const { scope } = entry;
  if (scope.surfaces.length && !scope.surfaces.includes(context.surface)) return false;
  if (!listMatchesLanguage(scope.languages, context.language)) return false;
  if (!listMatchesScalar(scope.regions, context.region)) return false;
  if (!listMatchesScalar(scope.games, context.game)) return false;

  const streamTags = setOf(context.streamTags);
  const communityTags = setOf(context.communityTags);
  if (
    context.surface === 'live' &&
    scope.streamTags.length &&
    !intersects(setOf(scope.streamTags), streamTags)
  ) {
    return false;
  }
  if (
    context.surface === 'community' &&
    scope.communityTags.length &&
    !intersects(setOf(scope.communityTags), communityTags)
  ) {
    return false;
  }
  return true;
}

function variantFor(entry, context) {
  return (
    entry.variants
      .map((variant) => {
        const languageScore = exactOrBaseLanguage(variant.language, context.language);
        if (!languageScore) return null;
        if (!listMatchesScalar(variant.games, context.game)) return null;
        const situationTags = setOf(context.situationTags);
        const tagScore = [...setOf(variant.tags)].filter((tag) => situationTags.has(tag)).length;
        return { variant, score: languageScore * 4 + tagScore };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.variant.id.localeCompare(b.variant.id))[0]?.variant ||
    null
  );
}

function matchingTrend(entry, context, now) {
  const matches = entry.trendSnapshots.filter((trend) => {
    if (trend.validUntil < now) return false;
    if (trend.language && !exactOrBaseLanguage(trend.language, context.language)) return false;
    if (trend.region && normalize(trend.region) !== normalize(context.region)) return false;
    if (trend.game && normalize(trend.game) !== normalize(context.game)) return false;
    return true;
  });
  return (
    matches.sort((a, b) => b.observedUntil - a.observedUntil || b.verifiedAt - a.verifiedAt)[0] ||
    null
  );
}

const trendScore = (state) =>
  ({
    active: 5,
    emerging: 4,
    evergreen: 3,
    declining: 1,
    dormant: 0,
  })[state] ?? 0;

function relevanceScore(entry, variant, trend, context) {
  let score = 0;
  if (entry.scope.games.length && listMatchesScalar(entry.scope.games, context.game)) score += 8;
  if (variant.games.length && listMatchesScalar(variant.games, context.game)) score += 4;

  const situationTags = setOf(context.situationTags);
  const functions = setOf(entry.usage.functions);
  for (const tag of functions) if (situationTags.has(tag)) score += 3;

  const surfaceTags =
    context.surface === 'community' ? setOf(context.communityTags) : setOf(context.streamTags);
  const scopedTags =
    context.surface === 'community'
      ? setOf(entry.scope.communityTags)
      : setOf(entry.scope.streamTags);
  for (const tag of scopedTags) if (surfaceTags.has(tag)) score += 2;

  score += exactOrBaseLanguage(variant.language, context.language) * 2;
  score += trend ? trendScore(trend.state) : 0;
  if (entry.cultureClass === 'classic') score += 1;
  return score;
}

function modeAllows(entry, trend, latestMode) {
  if (latestMode === 'fresh-only') return Boolean(trend);
  if (latestMode === 'classic-only') return entry.cultureClass !== 'trend';
  if (entry.cultureClass === 'trend') return Boolean(trend);
  return true;
}

function generationAllowed(entry) {
  if (!entry.policy.generationAllowed || !entry.sourceEvidence.length) return false;
  return entry.sourceEvidence.some((source) => source.rights.generationAllowed);
}

export function selectCultureCandidates(pack, input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const context = {
    surface: input.surface === 'community' ? 'community' : 'live',
    language: input.language || 'ko-KR',
    region: input.region || '',
    game: input.game || '',
    streamTags: input.streamTags || [],
    communityTags: input.communityTags || [],
    situationTags: input.situationTags || [],
  };
  const latestMode = ['balanced', 'fresh-only', 'classic-only'].includes(input.latestMode)
    ? input.latestMode
    : 'balanced';
  const blockedFamilies = setOf(input.blockedFamilies);
  const situationTags = setOf(context.situationTags);
  const limit = Math.max(0, Math.min(5, Number.isInteger(input.limit) ? input.limit : 2));

  if (input.enabled === false || limit === 0) return [];

  const ranked = [];
  for (const entry of pack.entries) {
    if (entry.status !== 'active' || !generationAllowed(entry)) continue;
    if (blockedFamilies.has(normalize(entry.familyId))) continue;
    if (intersects(setOf(entry.usage.avoidSituationTags), situationTags)) continue;
    if (entry.policy.spoilerLevel !== 'none' && input.allowSpoilers !== true) continue;
    if (!scopeMatches(entry, context)) continue;

    const variant = variantFor(entry, context);
    if (!variant) continue;
    const trend = matchingTrend(entry, context, now);
    if (!modeAllows(entry, trend, latestMode)) continue;

    ranked.push({
      score: relevanceScore(entry, variant, trend, context),
      candidate: {
        id: entry.id,
        familyId: entry.familyId,
        variantId: variant.id,
        text: variant.text,
        meaning: entry.meaning,
        cultureClass: entry.cultureClass,
        functions: [...entry.usage.functions],
        trend: trend
          ? {
              state: trend.state,
              population: trend.population,
              observedUntil: trend.observedUntil,
              validUntil: trend.validUntil,
            }
          : null,
        sourceEvidenceIds: entry.sourceEvidence
          .filter((source) => source.rights.generationAllowed)
          .map((source) => source.id),
        pack: {
          id: pack.packId,
          revision: pack.revision,
          publishedAt: pack.publishedAt,
        },
      },
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));

  const selected = [];
  const families = new Set();
  for (const item of ranked) {
    const family = normalize(item.candidate.familyId);
    if (families.has(family)) continue;
    families.add(family);
    selected.push(item.candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}
