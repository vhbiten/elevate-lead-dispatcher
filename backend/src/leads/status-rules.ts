import type { LeadStatus } from '../generated/prisma/enums';

// Status de trabalho: o call center pode ir e voltar entre eles (ex.: duas tentativas sem resposta).
const WORKING: LeadStatus[] = ['contacted', 'no_answer', 'callback', 'qualified'];

// Para onde cada status pode ir (docs/spec.md, seção 9). Nenhum status volta para "new",
// então um evento "new" é só registrado, como confirmação de recebimento.
const ALLOWED_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: [...WORKING, 'sale', 'invalid'],
  contacted: [...WORKING, 'sale', 'invalid'],
  no_answer: [...WORKING, 'sale', 'invalid'],
  callback: [...WORKING, 'sale', 'invalid'],
  qualified: [...WORKING, 'sale', 'invalid'],
  sale: ['refund'],
  refund: [],
  invalid: [],
};

export type StatusDecision = { applied: true } | { applied: false; reason: 'stale' | 'invalid_transition' };

// Decide se um evento muda o status atual do lead. As duas condições precisam valer:
// o evento é mais recente que o último aplicado, e a transição é permitida.
// A data vem primeiro: um "contacted" das 11h50 que chega depois de uma "sale" das 12h00 é antigo (stale).
export function decideStatusChange(
  lead: { status: LeadStatus; status_updated_at: Date },
  event: { status: LeadStatus; occurred_at: Date },
): StatusDecision {
  if (event.occurred_at.getTime() <= lead.status_updated_at.getTime()) {
    return { applied: false, reason: 'stale' };
  }
  if (!ALLOWED_TRANSITIONS[lead.status].includes(event.status)) {
    return { applied: false, reason: 'invalid_transition' };
  }
  return { applied: true };
}
