import { prisma } from '../../src/db';

// Volta o banco de teste ao estado do seed: sem leads e com os contadores do dispatcher zerados.
export async function resetDatabase() {
  await prisma.$executeRaw`TRUNCATE lead_status_events, distributions, leads, affiliates RESTART IDENTITY CASCADE`;
  await prisma.callCenter.updateMany({ data: { assigned_count: 0 } });
}

// Payload do exemplo do enunciado.
export function validLead(overrides: Record<string, unknown> = {}) {
  return {
    name: 'João Silva',
    email: 'joao@email.com',
    phone: '+5511999999999',
    product: 'nutralean',
    funnel: 'vsl-01',
    source: 'facebook',
    campaign: 'campaign-123',
    affiliate_id: '999',
    utm: { source: 'facebook', medium: 'cpc', campaign: 'campaign-123', content: 'ad-01' },
    ...overrides,
  };
}
