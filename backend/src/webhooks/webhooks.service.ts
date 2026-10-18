import { prisma } from '../db';
import type { LeadStatus } from '../generated/prisma/enums';
import { decideStatusChange, type StatusDecision } from '../leads/status-rules';
import type { StatusEventInput } from './webhooks.schema';

export async function findCallCenterBySlug(slug: string) {
  return prisma.callCenter.findUnique({ where: { slug }, select: { id: true, webhook_secret: true } });
}

export type StatusEventResult =
  | { ok: false; error: 'lead_not_found' }
  | { ok: true; duplicate: true }
  | { ok: true; duplicate: false; decision: StatusDecision; status: LeadStatus };

// Registra um evento de status vindo do call center e decide se ele muda o lead (docs/spec.md, seções 8 e 9).
export async function recordStatusEvent(callCenterId: number, event: StatusEventInput): Promise<StatusEventResult> {
  return prisma.$transaction(async (tx) => {
    // FOR UPDATE no lead: webhooks do mesmo lead ao mesmo tempo são processados um de cada vez,
    // e cada um decide a partir do status que o anterior deixou.
    const [lead] = await tx.$queryRaw<{ status: LeadStatus; status_updated_at: Date; call_center_id: number | null }[]>`
      SELECT status, status_updated_at, call_center_id FROM leads WHERE id = ${event.lead_id}::uuid FOR UPDATE`;

    // Lead de outro call center recebe a mesma resposta de lead inexistente, para não revelar que ele existe.
    if (!lead || lead.call_center_id !== callCenterId) return { ok: false, error: 'lead_not_found' };

    const decision = decideStatusChange(lead, { status: event.status, occurred_at: event.timestamp });

    // O evento é identificado por lead + status + horário. O mesmo webhook de novo bate no unique
    // e não grava nada; o RETURNING vazio diz que ele é repetido.
    const inserted = await tx.$queryRaw<{ id: number }[]>`
      INSERT INTO lead_status_events (lead_id, status, occurred_at, source, call_center_id, external_id, applied, reason)
      VALUES (
        ${event.lead_id}::uuid, ${event.status}::lead_status, ${event.timestamp}::timestamptz, 'webhook',
        ${callCenterId}, ${event.external_id ?? null}, ${decision.applied}, ${decision.applied ? null : decision.reason}
      )
      ON CONFLICT (lead_id, status, occurred_at) DO NOTHING
      RETURNING id`;
    if (inserted.length === 0) return { ok: true, duplicate: true };

    if (decision.applied) {
      await tx.lead.update({
        where: { id: event.lead_id },
        data: { status: event.status, status_updated_at: event.timestamp },
      });
    }

    // O id do lead no sistema do call center fica também na distribuição, a partir do primeiro webhook que o informa.
    if (event.external_id) {
      await tx.distribution.updateMany({
        where: { lead_id: event.lead_id, call_center_id: callCenterId, external_id: null },
        data: { external_id: event.external_id },
      });
    }

    return { ok: true, duplicate: false, decision, status: decision.applied ? event.status : lead.status };
  });
}
