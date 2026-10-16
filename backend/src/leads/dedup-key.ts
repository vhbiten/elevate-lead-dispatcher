import { createHash } from 'node:crypto';
import type { LeadInput } from './leads.schema';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// Chave que identifica um lead repetido (docs/spec.md, seção 6).
// Com o cabeçalho Idempotency-Key, vale o valor que a página mandou.
// Sem ele, o mesmo e-mail no mesmo produto e funil, no mesmo dia (UTC), é o mesmo lead.
// O hash deixa a chave com tamanho fixo e sem dado pessoal em texto puro.
export function buildDedupKey(
  lead: Pick<LeadInput, 'email' | 'product' | 'funnel'>,
  receivedAt: Date,
  idempotencyKey?: string,
): string {
  const key = idempotencyKey?.trim();
  if (key) return `key:${sha256(key)}`;

  const day = receivedAt.toISOString().slice(0, 10);
  return `auto:${sha256(JSON.stringify([lead.email, lead.product, lead.funnel, day]))}`;
}
