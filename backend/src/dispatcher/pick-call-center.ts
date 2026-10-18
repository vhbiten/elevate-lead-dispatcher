export type CallCenterLoad = {
  id: number;
  weight: number;
  assigned_count: number;
};

// Ordem de preferência entre dois call centers: primeiro o mais atrasado em relação à sua parte;
// no empate, o de maior peso; se ainda empatar, o de menor id.
function comesBefore(a: CallCenterLoad, b: CallCenterLoad): boolean {
  // Compara a.assigned_count / a.weight com b.assigned_count / b.weight. Multiplicando os dois lados
  // pelos dois pesos, a comparação fica só com inteiros, sem arredondamento de divisão.
  const aShare = a.assigned_count * b.weight;
  const bShare = b.assigned_count * a.weight;
  if (aShare !== bShare) return aShare < bShare;
  if (a.weight !== b.weight) return a.weight > b.weight;
  return a.id < b.id;
}

// Regra do dispatcher (docs/spec.md, seção 7). Recebe os call centers ativos com seus contadores e
// devolve quem recebe o próximo lead. Peso zero não recebe lead; sem nenhum elegível, devolve null.
export function pickCallCenter(callCenters: CallCenterLoad[]): CallCenterLoad | null {
  let chosen: CallCenterLoad | null = null;

  for (const candidate of callCenters) {
    if (candidate.weight <= 0) continue;
    if (chosen === null || comesBefore(candidate, chosen)) chosen = candidate;
  }

  return chosen;
}
