import { prisma } from '../../src/db';

// Volta o banco de teste ao estado do seed: sem leads e com os contadores do dispatcher zerados.
export async function resetDatabase() {
  await prisma.$executeRaw`TRUNCATE lead_status_events, distributions, leads, affiliates RESTART IDENTITY CASCADE`;
  await prisma.callCenter.updateMany({ data: { assigned_count: 0 } });
}
