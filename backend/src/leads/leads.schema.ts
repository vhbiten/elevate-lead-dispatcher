import { z } from 'zod';

// Telefone no formato internacional E.164: "+", código do país (não começa com 0) e até 15 dígitos.
const E164_PHONE = /^\+[1-9]\d{7,14}$/;

// Campo de texto opcional. Vazio, só espaços ou null contam como não enviado:
// formulários de páginas de vendas costumam mandar "" em campos escondidos sem valor.
function optionalText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .nullish()
    .transform((value) => value || undefined);
}

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
