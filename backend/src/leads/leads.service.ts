import { prisma } from '../db';
import { buildDedupKey } from './dedup-key';
import type { LeadInput } from './leads.schema';

export type CreateLeadResult =
  | { ok: true; leadId: string }
  | { ok: false; error: 'unknown_product' | 'unknown_funnel' };

export async function createLead(input: LeadInput, idempotencyKey?: string): Promise<CreateLeadResult> {
  const product = await prisma.product.findUnique({ where: { slug: input.product } });
  if (!product || !product.active) return { ok: false, error: 'unknown_product' };

  // O funil é buscado dentro do produto: vsl-01 de outro produto não serve.
  const funnel = await prisma.funnel.findUnique({
    where: { product_id_slug: { product_id: product.id, slug: input.funnel } },
  });
  if (!funnel || !funnel.active) return { ok: false, error: 'unknown_funnel' };

  // Um horário só para o lead, o primeiro evento do histórico e a chave de duplicidade.
  const now = new Date();

  const lead = await prisma.$transaction(async (tx) => {
    // upsert vira INSERT ... ON CONFLICT no banco: dois leads simultâneos com o mesmo afiliado novo não colidem.
    const affiliate = input.affiliate_id
      ? await tx.affiliate.upsert({
          where: { code: input.affiliate_id },
          update: {},
          create: { code: input.affiliate_id },
        })
      : null;

    return tx.lead.create({
      data: {
        dedup_key: buildDedupKey(input, now, idempotencyKey),
        name: input.name,
        email: input.email,
        phone: input.phone,
        product_id: product.id,
        funnel_id: funnel.id,
        affiliate_id: affiliate?.id,
        source: input.source,
        campaign: input.campaign,
        utm_source: input.utm?.source,
        utm_medium: input.utm?.medium,
        utm_campaign: input.utm?.campaign,
        utm_content: input.utm?.content,
        utm_term: input.utm?.term,
        status: 'new',
        status_updated_at: now,
        created_at: now,
        // O histórico começa junto com o lead.
        status_events: {
          create: { status: 'new', occurred_at: now, source: 'system', applied: true },
        },
      },
    });
  });

  return { ok: true, leadId: lead.id };
}
