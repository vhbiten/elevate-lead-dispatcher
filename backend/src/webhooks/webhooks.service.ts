import { prisma } from '../db';
import { recordStatusEvent, type StatusEventResult } from '../leads/status-events.service';
import type { StatusEventInput } from './webhooks.schema';

export async function findCallCenterBySlug(slug: string) {
  return prisma.callCenter.findUnique({ where: { slug }, select: { id: true, webhook_secret: true } });
}

// Evento do call center: só para leads distribuídos a ele (docs/spec.md, seção 8).
export async function recordWebhookEvent(callCenterId: number, event: StatusEventInput): Promise<StatusEventResult> {
  return recordStatusEvent({
    leadId: event.lead_id,
    status: event.status,
    occurredAt: event.timestamp,
    scopeCallCenterId: callCenterId,
    source: 'webhook',
    callCenterId,
    externalId: event.external_id,
  });
}
