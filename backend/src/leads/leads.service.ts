import { Prisma } from '../generated/prisma/client';
import { prisma } from '../db';
import { buildDedupKey } from './dedup-key';
import type { LeadInput } from './leads.schema';

export type CreateLeadResult =
  | { ok: true; leadId: string; duplicate: boolean }
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
  const dedupKey = buildDedupKey(input, now, idempotencyKey);

  try {
    const lead = await prisma.$transaction(async (tx) => {
      let affiliateId: number | undefined;
      if (input.affiliate_id) {
        // SQL à mão: o upsert do Prisma faz SELECT e depois INSERT, e dois leads simultâneos com o
        // mesmo afiliado novo colidiriam no unique. O ON CONFLICT deixa o banco resolver a corrida.
        await tx.$executeRaw`INSERT INTO affiliates (code) VALUES (${input.affiliate_id}) ON CONFLICT (code) DO NOTHING`;
        const affiliate = await tx.affiliate.findUniqueOrThrow({ where: { code: input.affiliate_id } });
        affiliateId = affiliate.id;
      }

      return tx.lead.create({
        data: {
          dedup_key: dedupKey,
          name: input.name,
          email: input.email,
          phone: input.phone,
          product_id: product.id,
          funnel_id: funnel.id,
          affiliate_id: affiliateId,
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

    return { ok: true, leadId: lead.id, duplicate: false };
  } catch (error) {
    // Lead repetido: o unique da dedup_key recusou a gravação e a transação inteira foi desfeita.
    // Quem decide é o banco, então duas requisições iguais ao mesmo tempo também caem aqui.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.lead.findUnique({ where: { dedup_key: dedupKey } });
      if (existing) return { ok: true, leadId: existing.id, duplicate: true };
    }
    throw error;
  }
}
