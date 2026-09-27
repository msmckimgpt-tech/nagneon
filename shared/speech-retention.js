import { z } from 'zod';

export const SpeechRetentionConfig = z
  .object({
    retentionHours: z.union([
      z.literal(1),
      z.literal(6),
      z.literal(24),
      z.literal(72),
      z.literal(168),
    ]),
    maxBytes: z.union([
      z.literal(256 * 1024 ** 2),
      z.literal(1024 ** 3),
      z.literal(2 * 1024 ** 3),
      z.literal(4 * 1024 ** 3),
    ]),
  })
  .strict();

export const defaultSpeechRetention = () => ({ retentionHours: 24, maxBytes: 2 * 1024 ** 3 });
