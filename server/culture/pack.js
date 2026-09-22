export const CULTURE_PACK_SCHEMA_VERSION = 1;

const cultureClasses = new Set(['classic', 'trend', 'hybrid']);
const trendStates = new Set(['emerging', 'active', 'declining', 'dormant', 'evergreen']);
const surfaces = new Set(['live', 'community']);
const spoilerLevels = new Set(['none', 'implicit', 'explicit']);

export class CulturePackValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'CulturePackValidationError';
    this.path = path;
  }
}

const fail = (path, message) => {
  throw new CulturePackValidationError(path, message);
};

const objectAt = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'object가 필요합니다');
  }
  return value;
};

const stringAt = (value, path) => {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(path, '비어 있지 않은 문자열이 필요합니다');
  }
  return value.trim();
};

const stringList = (value, path) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(path, '문자열 배열이 필요합니다');
  const result = value.map((item, index) => stringAt(item, `${path}[${index}]`));
  return [...new Set(result)];
};

const timestamp = (value, path, { required = false } = {}) => {
  if (value === undefined) {
    if (required) fail(path, 'UTC epoch milliseconds 값이 필요합니다');
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0) {
    fail(path, 'UTC epoch milliseconds 형식의 0 이상 유한 숫자가 필요합니다');
  }
  return value;
};

const integerAt = (value, path, { minimum = 0 } = {}) => {
  if (!Number.isInteger(value) || value < minimum) {
    fail(path, `${minimum} 이상의 정수가 필요합니다`);
  }
  return value;
};

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normalizeScope(input, path) {
  const scope = input === undefined ? {} : objectAt(input, path);
  const normalized = {
    languages: stringList(scope.languages, `${path}.languages`),
    regions: stringList(scope.regions, `${path}.regions`),
    games: stringList(scope.games, `${path}.games`),
    surfaces: stringList(scope.surfaces, `${path}.surfaces`),
    streamTags: stringList(scope.streamTags, `${path}.streamTags`),
    communityTags: stringList(scope.communityTags, `${path}.communityTags`),
  };
  for (const [index, surface] of normalized.surfaces.entries()) {
    if (!surfaces.has(surface))
      fail(`${path}.surfaces[${index}]`, 'live 또는 community만 허용됩니다');
  }
  return normalized;
}

function normalizeVariant(input, path) {
  const variant = objectAt(input, path);
  return {
    id: stringAt(variant.id, `${path}.id`),
    language: stringAt(variant.language, `${path}.language`),
    text: stringAt(variant.text, `${path}.text`),
    games: stringList(variant.games, `${path}.games`),
    tags: stringList(variant.tags, `${path}.tags`),
  };
}

function normalizeTrend(input, path) {
  const trend = objectAt(input, path);
  const state = stringAt(trend.state, `${path}.state`);
  if (!trendStates.has(state)) fail(`${path}.state`, '알 수 없는 trend state입니다');

  const observedFrom = timestamp(trend.observedFrom, `${path}.observedFrom`);
  const observedUntil = timestamp(trend.observedUntil, `${path}.observedUntil`, { required: true });
  const verifiedAt = timestamp(trend.verifiedAt, `${path}.verifiedAt`, { required: true });
  const validUntil = timestamp(trend.validUntil, `${path}.validUntil`, { required: true });

  if (observedFrom !== undefined && observedFrom > observedUntil) {
    fail(path, 'observedFrom은 observedUntil보다 늦을 수 없습니다');
  }
  if (validUntil < observedUntil) {
    fail(path, 'validUntil은 observedUntil보다 빠를 수 없습니다');
  }

  return {
    state,
    population:
      trend.population === undefined ? undefined : stringAt(trend.population, `${path}.population`),
    language:
      trend.language === undefined ? undefined : stringAt(trend.language, `${path}.language`),
    region: trend.region === undefined ? undefined : stringAt(trend.region, `${path}.region`),
    game: trend.game === undefined ? undefined : stringAt(trend.game, `${path}.game`),
    observedFrom,
    observedUntil,
    verifiedAt,
    validUntil,
  };
}

function normalizeSourceEvidence(input, path) {
  const source = objectAt(input, path);
  const provenance = stringAt(source.provenance, `${path}.provenance`);
  if (provenance !== 'real-external') {
    fail(`${path}.provenance`, 'CulturePack 근거는 real-external만 허용됩니다');
  }
  const rights = source.rights === undefined ? {} : objectAt(source.rights, `${path}.rights`);
  return {
    id: stringAt(source.id, `${path}.id`),
    kind: stringAt(source.kind, `${path}.kind`),
    provenance,
    contentPublishedAt: timestamp(source.contentPublishedAt, `${path}.contentPublishedAt`),
    firstObservedAt: timestamp(source.firstObservedAt, `${path}.firstObservedAt`),
    fetchedAt: timestamp(source.fetchedAt, `${path}.fetchedAt`),
    observedUntil: timestamp(source.observedUntil, `${path}.observedUntil`),
    rights: {
      referenceAllowed: rights.referenceAllowed === true,
      generationAllowed: rights.generationAllowed === true,
      redistributionAllowed: rights.redistributionAllowed === true,
    },
  };
}

function normalizeEntry(input, path) {
  const entry = objectAt(input, path);
  const cultureClass = stringAt(entry.cultureClass, `${path}.cultureClass`);
  if (!cultureClasses.has(cultureClass)) {
    fail(`${path}.cultureClass`, 'classic, trend, hybrid 중 하나여야 합니다');
  }

  const status = entry.status === undefined ? 'active' : stringAt(entry.status, `${path}.status`);
  if (!['active', 'withdrawn'].includes(status)) {
    fail(`${path}.status`, 'active 또는 withdrawn만 허용됩니다');
  }

  if (!Array.isArray(entry.variants) || entry.variants.length === 0) {
    fail(`${path}.variants`, '하나 이상의 표현 변형이 필요합니다');
  }
  const variants = entry.variants.map((variant, index) =>
    normalizeVariant(variant, `${path}.variants[${index}]`),
  );
  const variantIds = new Set();
  for (const [index, variant] of variants.entries()) {
    if (variantIds.has(variant.id))
      fail(`${path}.variants[${index}].id`, 'entry 안에서 중복된 variant id입니다');
    variantIds.add(variant.id);
  }

  const usageInput = entry.usage === undefined ? {} : objectAt(entry.usage, `${path}.usage`);
  const policyInput = entry.policy === undefined ? {} : objectAt(entry.policy, `${path}.policy`);
  const spoilerLevel =
    policyInput.spoilerLevel === undefined
      ? 'none'
      : stringAt(policyInput.spoilerLevel, `${path}.policy.spoilerLevel`);
  if (!spoilerLevels.has(spoilerLevel)) {
    fail(`${path}.policy.spoilerLevel`, 'none, implicit, explicit 중 하나여야 합니다');
  }

  const trendSnapshots =
    entry.trendSnapshots === undefined
      ? []
      : (() => {
          if (!Array.isArray(entry.trendSnapshots))
            fail(`${path}.trendSnapshots`, '배열이 필요합니다');
          return entry.trendSnapshots.map((trend, index) =>
            normalizeTrend(trend, `${path}.trendSnapshots[${index}]`),
          );
        })();

  const sourceEvidence =
    entry.sourceEvidence === undefined
      ? []
      : (() => {
          if (!Array.isArray(entry.sourceEvidence))
            fail(`${path}.sourceEvidence`, '배열이 필요합니다');
          return entry.sourceEvidence.map((source, index) =>
            normalizeSourceEvidence(source, `${path}.sourceEvidence[${index}]`),
          );
        })();

  return {
    id: stringAt(entry.id, `${path}.id`),
    familyId: stringAt(entry.familyId, `${path}.familyId`),
    meaning: stringAt(entry.meaning, `${path}.meaning`),
    cultureClass,
    status,
    scope: normalizeScope(entry.scope, `${path}.scope`),
    variants,
    usage: {
      functions: stringList(usageInput.functions, `${path}.usage.functions`),
      avoidSituationTags: stringList(
        usageInput.avoidSituationTags,
        `${path}.usage.avoidSituationTags`,
      ),
    },
    policy: {
      generationAllowed: policyInput.generationAllowed === true,
      spoilerLevel,
    },
    trendSnapshots,
    sourceEvidence,
  };
}

export function compileCulturePack(input) {
  const pack = objectAt(structuredClone(input), 'pack');
  if (pack.schemaVersion !== CULTURE_PACK_SCHEMA_VERSION) {
    fail('pack.schemaVersion', `지원 schemaVersion은 ${CULTURE_PACK_SCHEMA_VERSION}입니다`);
  }
  if (!Array.isArray(pack.entries)) fail('pack.entries', '배열이 필요합니다');

  const entries = pack.entries.map((entry, index) =>
    normalizeEntry(entry, `pack.entries[${index}]`),
  );
  const entryIds = new Set();
  for (const [index, entry] of entries.entries()) {
    if (entryIds.has(entry.id))
      fail(`pack.entries[${index}].id`, 'pack 안에서 중복된 entry id입니다');
    entryIds.add(entry.id);
  }

  const normalized = {
    schemaVersion: CULTURE_PACK_SCHEMA_VERSION,
    packId: stringAt(pack.packId, 'pack.packId'),
    revision: integerAt(pack.revision, 'pack.revision', { minimum: 1 }),
    publishedAt: timestamp(pack.publishedAt, 'pack.publishedAt', { required: true }),
    sourcePolicyRevision:
      pack.sourcePolicyRevision === undefined
        ? undefined
        : stringAt(pack.sourcePolicyRevision, 'pack.sourcePolicyRevision'),
    entries,
  };

  return deepFreeze(normalized);
}
