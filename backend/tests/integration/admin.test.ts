import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { ADMIN, loginAs, validLead } from './helpers';

const app = createApp();
let admin: string;

beforeAll(async () => {
  admin = await loginAs(app, ADMIN);
});

async function createLeads(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const response = await request(app).post('/api/leads').send(validLead({ email: `lead${i}@email.com` }));
    ids.push(response.body.lead_id);
  }
  return ids;
}

function setStatus(leadId: string, status: string) {
  return request(app).patch(`/api/leads/${leadId}/status`).set('Cookie', admin).send({ status });
}

describe('métricas', () => {
  it('calcula total, hoje, distribuídos, pendentes, vendas e conversão', async () => {
    const [first, second, , fourth] = await createLeads(4);
    await setStatus(first, 'sale');
    await setStatus(second, 'contacted');
    // Um lead de dois dias atrás não conta em "hoje".
    await prisma.lead.update({ where: { id: fourth }, data: { created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });

    const response = await request(app).get('/api/metrics').set('Cookie', admin);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      total: 4,
      today: 3,
      distributed: 4,
      pending: 2,
      sales: 1,
      conversion_rate: 0.25,
    });
  });

  it('venda que vira refund sai da conta de vendas', async () => {
    const [leadId] = await createLeads(1);
    await setStatus(leadId, 'sale');
    await setStatus(leadId, 'refund');

    const response = await request(app).get('/api/metrics').set('Cookie', admin);

    expect(response.body.sales).toBe(0);
    expect(response.body.conversion_rate).toBe(0);
  });
});

describe('configuração do dispatcher', () => {
  it('mostra peso, contador e a parte configurada e real de cada call center', async () => {
    await createLeads(10);

    const response = await request(app).get('/api/dispatcher').set('Cookie', admin);

    expect(response.status).toBe(200);
    expect(response.body.call_centers[0]).toEqual({
      slug: 'cc-a',
      name: 'Call Center A',
      weight: 50,
      active: true,
      assigned_count: 5,
      total_leads: 5,
      target_share: 0.5,
      actual_share: 0.5,
    });
    expect(response.body.call_centers.map((cc: { assigned_count: number }) => cc.assigned_count)).toEqual([5, 3, 2]);
  });

  it('salvar muda os pesos, pausa, zera os contadores e a nova proporção vale para os próximos leads', async () => {
    await createLeads(3);

    const response = await request(app)
      .put('/api/dispatcher')
      .set('Cookie', admin)
      .send({
        call_centers: [
          { slug: 'cc-a', weight: 1, active: true },
          { slug: 'cc-b', weight: 1, active: true },
          { slug: 'cc-c', weight: 20, active: false },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.call_centers.map((cc: { assigned_count: number }) => cc.assigned_count)).toEqual([0, 0, 0]);
    expect(response.body.call_centers[2]).toMatchObject({ active: false, target_share: 0 });

    // Com 1/1 e o C pausado, os próximos leads alternam entre A e B.
    const next = [];
    for (let i = 0; i < 4; i++) {
      const lead = await request(app).post('/api/leads').send(validLead({ email: `depois${i}@email.com` }));
      const saved = await prisma.lead.findUniqueOrThrow({ where: { id: lead.body.lead_id }, include: { call_center: true } });
      next.push(saved.call_center?.slug);
    }
    expect(next).toEqual(['cc-a', 'cc-b', 'cc-a', 'cc-b']);
  });

  it('recusa com 422 deixar todos pausados ou com peso zero, sem mudar nada', async () => {
    const response = await request(app)
      .put('/api/dispatcher')
      .set('Cookie', admin)
      .send({
        call_centers: [
          { slug: 'cc-a', weight: 0, active: true },
          { slug: 'cc-b', weight: 30, active: false },
          { slug: 'cc-c', weight: 20, active: false },
        ],
      });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ success: false, error: 'no_active_call_center' });
    const callCenters = await prisma.callCenter.findMany({ orderBy: { id: 'asc' } });
    expect(callCenters.map((cc) => [cc.weight, cc.active])).toEqual([
      [50, true],
      [30, true],
      [20, true],
    ]);
  });

  it('recusa call center desconhecido (422) e peso inválido (400)', async () => {
    const unknown = await request(app)
      .put('/api/dispatcher')
      .set('Cookie', admin)
      .send({ call_centers: [{ slug: 'cc-x', weight: 10, active: true }] });
    const negative = await request(app)
      .put('/api/dispatcher')
      .set('Cookie', admin)
      .send({ call_centers: [{ slug: 'cc-a', weight: -1, active: true }] });

    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toBe('unknown_call_center');
    expect(negative.status).toBe(400);
  });
});
