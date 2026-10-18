import { z } from 'zod';
import { LeadStatus } from '../generated/prisma/enums';
import { optionalText } from '../validation';

// Telefone no formato internacional E.164: "+", código do país (não começa com 0) e até 15 dígitos.
const E164_PHONE = /^\+[1-9]\d{7,14}$/;

const utmSchema = z.object({
  source: optionalText(255),
  medium: optionalText(255),
  campaign: optionalText(255),
  content: optionalText(255),
  term: optionalText(255),
});

// Regras de cada campo de POST /api/leads (docs/spec.md, seção 5).
// Campos fora da lista são descartados.
export const leadSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    phone: z
      .string()
      .overwrite((value) => value.replace(/[\s\-()]/g, ''))
      .regex(E164_PHONE, 'Phone must be in international format, e.g. +5511999999999'),
    product: z.string().trim().min(1).max(100),
    funnel: z.string().trim().min(1).max(100),
    source: optionalText(50),
    campaign: optionalText(120),
    affiliate_id: optionalText(64),
    utm: utmSchema.nullish().transform((value) => value ?? undefined),
  })
  .transform((lead) => ({
    ...lead,
    // Sem source ou campaign no corpo, vale o que veio na UTM.
    source: lead.source ?? lead.utm?.source,
    campaign: lead.campaign ?? lead.utm?.campaign,
  }));

export type LeadInput = z.infer<typeof leadSchema>;

const slug = z.string().trim().min(1).max(100);

// Filtros e página de GET /api/leads (docs/spec.md, seção 11). Vêm na query string, então os números chegam como texto.
export const leadListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(LeadStatus).optional(),
  product: slug.optional(),
  funnel: slug.optional(),
  source: slug.optional(),
  call_center: slug.optional(),
  // Período em datas (AAAA-MM-DD) no fuso do negócio, com os dois dias incluídos.
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

export const statusChangeSchema = z.object({
  status: z.enum(LeadStatus),
});
