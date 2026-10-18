import type { SessionUser } from '../auth/session';
import { prisma } from '../db';
import { assignCallCenter } from '../dispatcher/dispatcher.service';
import { Prisma } from '../generated/prisma/client';
import { LeadStatus } from '../generated/prisma/enums';
import { addDays, appTimezone, startOfDay } from '../timezone';
import { buildDedupKey } from './dedup-key';
import type { LeadInput, LeadListQuery } from './leads.schema';
import { recordStatusEvent } from './status-events.service';

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

      // O afiliado vem antes: o bloqueio dos call centers vale daqui até o fim da transação,
      // então quanto mais tarde ele começa, menos tempo as outras requisições esperam.
      const callCenterId = await assignCallCenter(tx);

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
          call_center_id: callCenterId,
          status: 'new',
          status_updated_at: now,
          created_at: now,
          // O histórico de status e o de distribuições começam junto com o lead.
          status_events: {
            create: { status: 'new', occurred_at: now, source: 'system', applied: true },
          },
          distributions: {
            create: { call_center_id: callCenterId, distributed_at: now },
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

// Restrição de escopo do OPERATOR: só os leads do próprio call center (docs/spec.md, seção 10).
// Fica aqui no serviço, e não na tela, para nenhuma rota esquecer de aplicar.
function scopeOf(user: SessionUser): Prisma.LeadWhereInput {
  return user.role === 'OPERATOR' ? { call_center_id: user.call_center_id } : {};
}

export async function listLeads(user: SessionUser, query: LeadListQuery) {
  const timeZone = appTimezone();
  const where: Prisma.LeadWhereInput = {
    status: query.status,
    source: query.source,
    product: query.product ? { slug: query.product } : undefined,
    funnel: query.funnel ? { slug: query.funnel } : undefined,
    created_at: {
      gte: query.from ? startOfDay(query.from, timeZone) : undefined,
      // "Até o dia 18" inclui o dia 18 inteiro: vai até o começo do dia 19.
      lt: query.to ? startOfDay(addDays(query.to, 1), timeZone) : undefined,
    },
    ...scopeOf(user),
  };
  // O filtro de call center só vale para o ADMIN; o do OPERATOR é fixo.
  if (user.role === 'ADMIN' && query.call_center) where.call_center = { slug: query.call_center };

  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        id: true,
        name: true,
        source: true,
        status: true,
        created_at: true,
        product: { select: { slug: true, name: true } },
        funnel: { select: { slug: true, name: true } },
        call_center: { select: { slug: true, name: true } },
      },
    }),
  ]);

  return {
    leads,
    pagination: { page: query.page, page_size: query.page_size, total, total_pages: Math.ceil(total / query.page_size) },
  };
}

// Detalhe com contato, rastreamento e histórico. Lead fora do escopo devolve null, como se não existisse.
export async function getLeadDetail(user: SessionUser, leadId: string) {
  return prisma.lead.findFirst({
    where: { id: leadId, ...scopeOf(user) },
    omit: { dedup_key: true, product_id: true, funnel_id: true, affiliate_id: true, call_center_id: true },
    include: {
      product: { select: { slug: true, name: true } },
      funnel: { select: { slug: true, name: true } },
      affiliate: { select: { code: true } },
      call_center: { select: { slug: true, name: true } },
      distributions: {
        orderBy: { id: 'asc' },
        select: { distributed_at: true, external_id: true, call_center: { select: { slug: true, name: true } } },
      },
      status_events: {
        orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
        select: {
          status: true,
          occurred_at: true,
          received_at: true,
          source: true,
          applied: true,
          reason: true,
          external_id: true,
          call_center: { select: { slug: true } },
          user: { select: { email: true } },
        },
      },
    },
  });
}

// Mudança de status pelo painel: as mesmas regras e o mesmo histórico do webhook (docs/spec.md, seção 9).
export async function changeStatusFromPanel(user: SessionUser, leadId: string, status: LeadStatus) {
  return recordStatusEvent({
    leadId,
    status,
    occurredAt: new Date(),
    scopeCallCenterId: user.role === 'OPERATOR' ? user.call_center_id : null,
    source: 'panel',
    userId: user.id,
  });
}

// Opções dos filtros da tabela. O OPERATOR só vê o próprio call center.
export async function getFilterOptions(user: SessionUser) {
  const [products, callCenters] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { slug: true, name: true, funnels: { where: { active: true }, orderBy: { slug: 'asc' }, select: { slug: true, name: true } } },
    }),
    prisma.callCenter.findMany({
      where: user.role === 'OPERATOR' ? { id: user.call_center_id ?? -1 } : {},
      orderBy: { id: 'asc' },
      select: { slug: true, name: true },
    }),
  ]);
  return { products, call_centers: callCenters, statuses: Object.values(LeadStatus) };
}
