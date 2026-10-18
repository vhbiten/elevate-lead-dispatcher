import { prisma } from '../db';
import type { Prisma } from '../generated/prisma/client';
import type { DispatcherConfigInput } from './dispatcher.schema';
import { pickCallCenter, type CallCenterLoad } from './pick-call-center';

// Escolhe o call center do lead e soma 1 no contador dele (docs/spec.md, seção 7).
// Roda dentro da transação do lead: se o lead não for gravado (ex.: repetido), o contador volta junto.
export async function assignCallCenter(tx: Prisma.TransactionClient): Promise<number> {
  // FOR UPDATE: uma segunda transação que chegue aqui espera esta terminar e então lê os contadores
  // já atualizados, então duas requisições nunca escolhem com base no mesmo estado. A ordem por id é
  // sempre a mesma, o que evita duas transações travadas uma esperando a outra (deadlock).
  const callCenters = await tx.$queryRaw<CallCenterLoad[]>`
    SELECT id, weight, assigned_count FROM call_centers WHERE active ORDER BY id FOR UPDATE`;

  const chosen = pickCallCenter(callCenters);
  // A configuração exige pelo menos um call center ativo com peso maior que zero.
  if (!chosen) throw new Error('No active call center with weight > 0');

  await tx.callCenter.update({ where: { id: chosen.id }, data: { assigned_count: { increment: 1 } } });
  return chosen.id;
}

// Tela de distribuição do ADMIN (docs/spec.md, seção 11): configuração e a parte real de cada call center.
export async function getDispatcherOverview() {
  const callCenters = await prisma.callCenter.findMany({
    orderBy: { id: 'asc' },
    select: { slug: true, name: true, weight: true, active: true, assigned_count: true, _count: { select: { leads: true } } },
  });
  const activeWeight = callCenters.filter((cc) => cc.active).reduce((sum, cc) => sum + cc.weight, 0);
  const assignedTotal = callCenters.reduce((sum, cc) => sum + cc.assigned_count, 0);

  return callCenters.map(({ _count, ...cc }) => ({
    ...cc,
    total_leads: _count.leads,
    // Parte configurada (peso entre os ativos) e parte real (leads recebidos desde a última mudança).
    target_share: cc.active && activeWeight > 0 ? cc.weight / activeWeight : 0,
    actual_share: assignedTotal > 0 ? cc.assigned_count / assignedTotal : 0,
  }));
}

export type DispatcherConfigResult = { ok: true } | { ok: false; error: 'unknown_call_center' | 'no_active_call_center' };

// Muda pesos e ativo/pausado. Os contadores voltam a zero e a nova proporção vale dali em diante.
export async function updateDispatcherConfig(input: DispatcherConfigInput): Promise<DispatcherConfigResult> {
  return prisma.$transaction(async (tx) => {
    // O mesmo bloqueio da distribuição, na mesma ordem (por id): nenhum lead é distribuído no meio da mudança.
    const current = await tx.$queryRaw<{ id: number; slug: string; weight: number; active: boolean }[]>`
      SELECT id, slug, weight, active FROM call_centers ORDER BY id FOR UPDATE`;

    if (input.call_centers.some((change) => !current.some((cc) => cc.slug === change.slug))) {
      return { ok: false, error: 'unknown_call_center' };
    }

    const next = current.map((cc) => {
      const change = input.call_centers.find((item) => item.slug === cc.slug);
      return change ? { ...cc, weight: change.weight, active: change.active } : cc;
    });
    // Sem nenhum call center apto, um lead novo não teria para onde ir.
    if (!next.some((cc) => cc.active && cc.weight > 0)) return { ok: false, error: 'no_active_call_center' };

    for (const cc of next) {
      await tx.callCenter.update({
        where: { id: cc.id },
        data: { weight: cc.weight, active: cc.active, assigned_count: 0 },
      });
    }
    return { ok: true };
  });
}
