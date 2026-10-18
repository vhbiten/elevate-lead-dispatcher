import { prisma } from '../db';
import { appTimezone, dateIn, startOfDay } from '../timezone';

// Números do painel do ADMIN (docs/spec.md, seção 11). Cinco contagens em paralelo, cada uma
// atendida por um índice de leads; o volume de dados que sai do banco é só o número.
export async function getMetrics() {
  const timeZone = appTimezone();
  const todayStart = startOfDay(dateIn(timeZone, new Date()), timeZone);

  const [total, today, distributed, pending, sales] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { created_at: { gte: todayStart } } }),
    prisma.lead.count({ where: { call_center_id: { not: null } } }),
    // Pendente = ainda não trabalhado. Venda = status atual (um refund sai da conta).
    prisma.lead.count({ where: { status: 'new' } }),
    prisma.lead.count({ where: { status: 'sale' } }),
  ]);

  return { total, today, distributed, pending, sales, conversion_rate: total === 0 ? 0 : sales / total };
}
