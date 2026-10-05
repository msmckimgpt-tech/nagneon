import { z } from 'zod';

// Empty means the user's first explicit start may resolve the OS default once.
// Persist a concrete device afterwards; never save moving default aliases.
export const MicrophoneConfig = z
  .object({
    deviceId: z
      .string()
      .max(512)
      .refine((value) => !['default', 'communications'].includes(value)),
    label: z.string().max(200),
  })
  .strict();
export const defaultMicrophoneConfig = () => ({ deviceId: '', label: '' });
