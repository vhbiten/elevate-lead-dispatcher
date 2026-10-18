import type { Express } from 'express';
import request from 'supertest';
import { prisma } from '../../src/db';

// Pesos do seed. Alguns testes mudam a configuração do dispatcher, que precisa voltar ao original.
const SEED_WEIGHTS: Record<string, number> = { 'cc-a': 50, 'cc-b': 30, 'cc-c': 20 };

// Volta o banco de teste ao estado do seed: sem leads e com o dispatcher na configuração original.
export async function resetDatabase() {
  await prisma.$executeRaw`TRUNCATE lead_status_events, distributions, leads, affiliates RESTART IDENTITY CASCADE`;
  for (const [slug, weight] of Object.entries(SEED_WEIGHTS)) {
    await prisma.callCenter.update({ where: { slug }, data: { weight, active: true, assigned_count: 0 } });
  }
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

// Usuários do seed; todos com a senha de desenvolvimento.
export const DEV_PASSWORD = 'elevate123';
export const ADMIN = 'admin@elevate.test';
export const OPERATOR_A = 'operador.a@elevate.test';
export const OPERATOR_B = 'operador.b@elevate.test';

// Faz login e devolve o cabeçalho Cookie da sessão, para as próximas requisições.
export async function loginAs(app: Express, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: DEV_PASSWORD });
  if (response.status !== 200) throw new Error(`login de ${email} falhou: ${response.status}`);
  const cookie = response.get('Set-Cookie')?.[0];
  if (!cookie) throw new Error('login sem cookie');
  return cookie.split(';')[0];
}
