export type AiUsage = {
  calls: number;
  failed: number;
  cancelled: number;
  unknown: number;
  input: number;
  cached: number;
  output: number;
  total: number;
  estimatedUsd: number;
  priced: number;
  apiUncertaintyUsd: number;
  referenceUsd: number;
  referenceUncertaintyUsd: number;
  referencePriced: number;
  localCalls: number;
};
export type AiRate = {
  connection: string;
  model: string;
  input: number;
  cached: number;
  output: number;
};
export type AiPricing = {
  kind: 'api' | 'reference' | 'local' | 'unavailable';
  reason:
    | 'calculated'
    | 'missing-rate'
    | 'missing-usage'
    | 'invalid-usage'
    | 'unsupported'
    | 'running'
    | 'local';
  usd: number | null;
  uncertaintyUsd: number;
  source: 'official' | 'manual' | 'legacy' | 'none';
  checkedAt: string;
  longContext: boolean;
  backfilled?: boolean;
  rates?: { input: number; cached: number; cacheWrite: number; output: number };
  audioRates?: { input: number; cached: number; output: number };
};
export type AiPolicy = {
  paused: boolean;
  background: boolean;
  features: Record<string, boolean>;
  rates: AiRate[];
};
export type AiFeature = {
  id: string;
  name: string;
  group: string;
  scope: string;
  trigger: string;
  destination: string;
  retired?: boolean;
  enabled: boolean;
  reason: string;
  ready: boolean;
  nextAt: number | null;
};
export type AiState = {
  policy: AiPolicy;
  timezone: string;
  day: string;
  storageError: string;
  active: { id: string; featureId: string; status: string }[];
  features: AiFeature[];
  usage: Record<'today' | 'week' | 'session', Record<string, AiUsage>>;
  pricingCatalog?: {
    checkedAt: string;
    source: string;
    models: Omit<AiRate, 'connection'>[];
  };
  recent: {
    id: string;
    featureId: string;
    at: number;
    provider: string;
    model: string;
    connection: string;
    status: string;
    usage: {
      input: number | null;
      cached: number | null;
      output: number | null;
      total: number | null;
      cacheWrite?: number | null;
      modalities?: {
        textInput: number | null;
        audioInput: number | null;
        imageInput: number | null;
        textCached: number | null;
        audioCached: number | null;
        imageCached: number | null;
        textOutput: number | null;
        audioOutput: number | null;
      };
    } | null;
    estimatedUsd: number | null;
    pricing?: AiPricing;
    application: string;
    activityKind?: string;
    activityResult?: string;
  }[];
};
