import { prisma } from '../db';
import type { LeadStatus } from '../generated/prisma/enums';
import { decideStatusChange, type StatusDecision } from './status-rules';

// Um evento de status, venha do call center (webhook) ou do painel.
export type NewStatusEvent = {
  leadId: string;
  status: LeadStatus;
  occurredAt: Date;
  // Só leads deste call center podem ser alterados. null = qualquer lead (ADMIN no painel).
  scopeCallCenterId: number | null;
  source: 'webhook' | 'panel';
  callCenterId?: number; // quem enviou o webhook
  userId?: number; // quem mudou pelo painel
  externalId?: string;
};

export type StatusEventResult =
  | { ok: false; error: 'lead_not_found' }
  | { ok: true; duplicate: true }
  | { ok: true; duplicate: false; decision: StatusDecision; status: LeadStatus };

// Registra o evento no histórico e decide se ele muda o lead (docs/spec.md, seções 8 e 9).
export async function recordStatusEvent(event: NewStatusEvent): Promise<StatusEventResult> {
  return prisma.$transaction(async (tx) => {
    // FOR UPDATE no lead: eventos do mesmo lead ao mesmo tempo são processados um de cada vez,
    // e cada um decide a partir do status que o anterior deixou.
    const [lead] = await tx.$queryRaw<{ status: LeadStatus; status_updated_at: Date; call_center_id: number | null }[]>`
      SELECT status, status_updated_at, call_center_id FROM leads WHERE id = ${event.leadId}::uuid FOR UPDATE`;

    // Lead fora do escopo recebe a mesma resposta de lead inexistente, para não revelar que ele existe.
    if (!lead || (event.scopeCallCenterId !== null && lead.call_center_id !== event.scopeCallCenterId)) {
      return { ok: false, error: 'lead_not_found' };
    }

    const decision = decideStatusChange(lead, { status: event.status, occurred_at: event.occurredAt });

    // O evento é identificado por lead + status + horário. O mesmo evento de novo bate no unique
    // e não grava nada; o RETURNING vazio diz que ele é repetido.
    const inserted = await tx.$queryRaw<{ id: number }[]>`
      INSERT INTO lead_status_events (lead_id, status, occurred_at, source, call_center_id, user_id, external_id, applied, reason)
      VALUES (
        ${event.leadId}::uuid, ${event.status}::lead_status, ${event.occurredAt}::timestamptz, ${event.source}::event_source,
        ${event.callCenterId ?? null}, ${event.userId ?? null}, ${event.externalId ?? null},
        ${decision.applied}, ${decision.applied ? null : decision.reason}
      )
      ON CONFLICT (lead_id, status, occurred_at) DO NOTHING
      RETURNING id`;
    if (inserted.length === 0) return { ok: true, duplicate: true };

    if (decision.applied) {
      await tx.lead.update({
        where: { id: event.leadId },
        data: { status: event.status, status_updated_at: event.occurredAt },
      });
    }

    // O id do lead no sistema do call center fica também na distribuição, a partir do primeiro webhook que o informa.
    if (event.externalId && event.callCenterId) {
      await tx.distribution.updateMany({
        where: { lead_id: event.leadId, call_center_id: event.callCenterId, external_id: null },
        data: { external_id: event.externalId },
      });
    }

    return { ok: true, duplicate: false, decision, status: decision.applied ? event.status : lead.status };
  });
}
