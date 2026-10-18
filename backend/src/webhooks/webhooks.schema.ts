import { z } from 'zod';
import { LeadStatus } from '../generated/prisma/enums';
import { optionalText } from '../validation';

// Um evento com data adiantada passaria a ser "o mais recente" e travaria o lead (docs/spec.md, seção 8).
const MAX_FUTURE_MS = 5 * 60 * 1000;

// Corpo de POST /api/webhooks/callcenter.
export const statusEventSchema = z.object({
  lead_id: z.uuid(),
  external_id: optionalText(100),
  status: z.enum(LeadStatus),
  timestamp: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .refine((date) => date.getTime() <= Date.now() + MAX_FUTURE_MS, 'Timestamp cannot be in the future'),
});

export type StatusEventInput = z.infer<typeof statusEventSchema>;
