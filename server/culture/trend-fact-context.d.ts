export type Metric = {
  kind: 'views' | 'comments' | 'reactions' | 'concurrent-players';
  scope: 'topic' | 'game';
  value: number;
  sourceUrl: string;
  observedAt: number;
};
export type CommunityFactRecord = {
  id: string;
  evidenceKind: 'official-api' | 'synthetic';
  sourceUrl: string;
  headline: string;
  publishedAt: number;
  observedAt: number;
  expiresAt: number;
  tags: string[];
  metrics: Metric[];
};

export function publicStoredTrendFact(value: unknown): CommunityFactRecord | undefined;
export function isCurrentStoredTrendFact(value: unknown, now: number): boolean;
export const STORED_TREND_INSTRUCTION: string;
