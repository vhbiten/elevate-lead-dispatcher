import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { ADMIN, loginAs, OPERATOR_A, validLead } from './helpers';

const app = createApp();
let admin: string;
let operatorA: string;

beforeAll(async () => {
  admin = await loginAs(app, ADMIN);
  operatorA = await loginAs(app, OPERATOR_A);
});

async function createLead(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app).post('/api/leads').send(validLead(overrides));
  return response.body.lead_id;
}

function listAs(cookie: string, query = '') {
  return request(app).get(`/api/leads${query}`).set('Cookie', cookie);
}

describe('painel de leads', () => {
  it('exige login em todas as rotas do painel', async () => {
    const leadId = await createLead();

    const responses = await Promise.all([
      request(app).get('/api/leads'),
      request(app).get(`/api/leads/${leadId}`),
      request(app).patch(`/api/leads/${leadId}/status`).send({ status: 'contacted' }),
      request(app).get('/api/options'),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
  });

  it('lista os leads do mais novo para o mais antigo, sem contato nem dados internos', async () => {
    await createLead({ email: 'primeiro@email.com' });
    await createLead({ email: 'segundo@email.com', name: 'Maria Souza' });

    const response = await listAs(admin);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0]).toEqual({
      id: expect.any(String),
      name: 'Maria Souza',
      source: 'facebook',
      status: 'new',
      created_at: expect.any(String),
      product: { slug: 'nutralean', name: 'NutraLean' },
      funnel: { slug: 'vsl-01', name: 'VSL 01' },
      call_center: { slug: 'cc-b', name: 'Call Center B' },
    });
  });

  it('pagina no servidor: 20 por padrão e no máximo 100', async () => {
    for (let i = 0; i < 25; i++) await createLead({ email: `lead${i}@email.com` });

    const first = await listAs(admin);
    const second = await listAs(admin, '?page=2');
    const tooBig = await listAs(admin, '?page_size=101');

    expect(first.body.data).toHaveLength(20);
    expect(first.body.pagination).toEqual({ page: 1, page_size: 20, total: 25, total_pages: 2 });
    expect(second.body.data).toHaveLength(5);
    expect(tooBig.status).toBe(400);
  });

  it('filtra por status, produto, funil, origem e call center', async () => {
    const contacted = await createLead({ email: 'a@email.com' });
    await createLead({ email: 'b@email.com', product: 'glucoshield', funnel: 'tsl-01' });
    await createLead({ email: 'c@email.com', source: 'google', utm: undefined });
    await request(app).patch(`/api/leads/${contacted}/status`).set('Cookie', admin).send({ status: 'contacted' });

    const count = async (query: string) => (await listAs(admin, query)).body.pagination.total;

    expect(await count('?status=contacted')).toBe(1);
    expect(await count('?product=glucoshield')).toBe(1);
    expect(await count('?funnel=tsl-01')).toBe(1);
    expect(await count('?source=google')).toBe(1);
    expect(await count('?call_center=cc-a')).toBe(1);
    expect(await count('?product=nutralean&call_center=cc-c')).toBe(1);
  });

  it('filtra por período no fuso de São Paulo, com os dois dias incluídos', async () => {
    const lateNight = await createLead({ email: 'noite@email.com' });
    const earlyMorning = await createLead({ email: 'madrugada@email.com' });
    // 23h30 do dia 17 em São Paulo (já dia 18 em UTC) e 00h30 do dia 18 em São Paulo.
    await prisma.lead.update({ where: { id: lateNight }, data: { created_at: new Date('2026-10-18T02:30:00Z') } });
    await prisma.lead.update({ where: { id: earlyMorning }, data: { created_at: new Date('2026-10-18T03:30:00Z') } });

    const day18 = await listAs(admin, '?from=2026-10-18&to=2026-10-18');
    const day17 = await listAs(admin, '?from=2026-10-17&to=2026-10-17');

    expect(day18.body.data.map((lead: { id: string }) => lead.id)).toEqual([earlyMorning]);
    expect(day17.body.data.map((lead: { id: string }) => lead.id)).toEqual([lateNight]);
  });

  it('o detalhe traz contato, rastreamento, distribuição e histórico, sem a chave de duplicidade', async () => {
    const leadId = await createLead();

    const response = await request(app).get(`/api/leads/${leadId}`).set('Cookie', admin);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: leadId,
      email: 'joao@email.com',
      phone: '+5511999999999',
      utm_source: 'facebook',
      utm_content: 'ad-01',
      affiliate: { code: '999' },
      call_center: { slug: 'cc-a' },
      distributions: [{ call_center: { slug: 'cc-a' }, external_id: null }],
      status_events: [{ status: 'new', source: 'system', applied: true }],
    });
    expect(response.body.data).not.toHaveProperty('dedup_key');
  });

  it('responde 404 para id que não existe ou que nem é um UUID', async () => {
    const missing = await request(app).get('/api/leads/0199e3a0-0000-7000-8000-000000000000').set('Cookie', admin);
    const notUuid = await request(app).get('/api/leads/abc').set('Cookie', admin);

    expect(missing.status).toBe(404);
    expect(notUuid.status).toBe(404);
  });

  describe('mudança de status pelo painel', () => {
    it('aplica a mudança e registra no histórico quem mudou', async () => {
      const leadId = await createLead();

      const response = await request(app).patch(`/api/leads/${leadId}/status`).set('Cookie', operatorA).send({ status: 'contacted' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, status: 'contacted' });
      const detail = await request(app).get(`/api/leads/${leadId}`).set('Cookie', operatorA);
      expect(detail.body.data.status).toBe('contacted');
      expect(detail.body.data.status_events[1]).toMatchObject({
        status: 'contacted',
        source: 'panel',
        applied: true,
        user: { email: OPERATOR_A },
      });
    });

    it('barra transição proibida com 422 e guarda a tentativa no histórico', async () => {
      const leadId = await createLead();
      await request(app).patch(`/api/leads/${leadId}/status`).set('Cookie', operatorA).send({ status: 'invalid' });

      const response = await request(app).patch(`/api/leads/${leadId}/status`).set('Cookie', operatorA).send({ status: 'sale' });

      expect(response.status).toBe(422);
      expect(response.body).toEqual({ success: false, error: 'invalid_transition', status: 'invalid' });
      const events = await prisma.leadStatusEvent.findMany({ where: { lead_id: leadId }, orderBy: { id: 'asc' } });
      expect(events.map((event) => [event.status, event.applied])).toEqual([
        ['new', true],
        ['invalid', true],
        ['sale', false],
      ]);
    });

    it('responde 400 para status desconhecido', async () => {
      const leadId = await createLead();

      const response = await request(app).patch(`/api/leads/${leadId}/status`).set('Cookie', admin).send({ status: 'vendido' });

      expect(response.status).toBe(400);
    });
  });

  it('as opções dos filtros mostram ao OPERATOR só o próprio call center', async () => {
    const asAdmin = await request(app).get('/api/options').set('Cookie', admin);
    const asOperator = await request(app).get('/api/options').set('Cookie', operatorA);

    expect(asAdmin.body.products).toHaveLength(3);
    expect(asAdmin.body.products[0]).toEqual({
      slug: 'glucoshield',
      name: 'GlucoShield',
      funnels: [
        { slug: 'tsl-01', name: 'TSL 01' },
        { slug: 'vsl-01', name: 'VSL 01' },
      ],
    });
    expect(asAdmin.body.call_centers.map((callCenter: { slug: string }) => callCenter.slug)).toEqual(['cc-a', 'cc-b', 'cc-c']);
    expect(asOperator.body.call_centers).toEqual([{ slug: 'cc-a', name: 'Call Center A' }]);
    expect(asAdmin.body.statuses).toContain('sale');
  });
});
