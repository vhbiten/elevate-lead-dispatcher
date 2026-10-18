import type { Prisma } from '../generated/prisma/client';
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
