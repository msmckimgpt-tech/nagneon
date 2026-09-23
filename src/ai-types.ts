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
};
export type AiRate = {
  connection: string;
  model: string;
  input: number;
  cached: number;
  output: number;
};
export type AiPolicy = {
  paused: boolean;
  background: boolean;
  dailyLimit: number | null;
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
    } | null;
    estimatedUsd: number | null;
    application: string;
  }[];
};
