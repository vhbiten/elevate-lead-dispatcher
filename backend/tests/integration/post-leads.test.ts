import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { validLead } from './helpers';

const app = createApp();

describe('POST /api/leads', () => {
  it('grava o lead com produto, funil, afiliado e origem e responde 201', async () => {
    const response = await request(app).post('/api/leads').send(validLead());

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ success: true, lead_id: expect.any(String) });

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: response.body.lead_id },
      include: { product: true, funnel: true, affiliate: true, status_events: true },
    });
    expect(lead).toMatchObject({
      name: 'João Silva',
      email: 'joao@email.com',
      phone: '+5511999999999',
      source: 'facebook',
      campaign: 'campaign-123',
      utm_source: 'facebook',
      utm_medium: 'cpc',
      utm_campaign: 'campaign-123',
      utm_content: 'ad-01',
      utm_term: null,
      status: 'new',
    });
    expect(lead.product.slug).toBe('nutralean');
    expect(lead.funnel.slug).toBe('vsl-01');
    expect(lead.affiliate?.code).toBe('999');
  });

  it('abre o histórico com o evento de criação, no mesmo horário do lead', async () => {
    const response = await request(app).post('/api/leads').send(validLead());

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: response.body.lead_id },
      include: { status_events: true },
    });
    expect(lead.status_events).toHaveLength(1);
    expect(lead.status_events[0]).toMatchObject({ status: 'new', source: 'system', applied: true });
    expect(lead.status_events[0].occurred_at).toEqual(lead.created_at);
  });

  it('reaproveita o afiliado que já existe e aceita lead sem afiliado', async () => {
    await request(app).post('/api/leads').send(validLead({ email: 'a@email.com' }));
    await request(app).post('/api/leads').send(validLead({ email: 'b@email.com' }));
    const withoutAffiliate = await request(app)
      .post('/api/leads')
      .send(validLead({ email: 'c@email.com', affiliate_id: undefined }));

    expect(await prisma.affiliate.count()).toBe(1);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: withoutAffiliate.body.lead_id } });
    expect(lead.affiliate_id).toBeNull();
  });

  it('responde 400 com os campos inválidos', async () => {
    const response = await request(app).post('/api/leads').send(validLead({ email: 'joao', phone: '123' }));

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('validation_error');
    expect(response.body.details.map((detail: { field: string }) => detail.field)).toEqual(['email', 'phone']);
    expect(await prisma.lead.count()).toBe(0);
  });

  it('responde 400 para JSON quebrado', async () => {
    const response = await request(app)
      .post('/api/leads')
      .set('Content-Type', 'application/json')
      .send('{"name": "João"');

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual([{ field: 'body', message: 'Invalid JSON' }]);
  });

  it('responde 422 para produto que não existe', async () => {
    const response = await request(app).post('/api/leads').send(validLead({ product: 'nao-existe' }));

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ success: false, error: 'unknown_product' });
  });

  it('responde 422 para funil que existe, mas é de outro produto', async () => {
    // tsl-01 existe só no glucoshield.
    const response = await request(app).post('/api/leads').send(validLead({ funnel: 'tsl-01' }));

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ success: false, error: 'unknown_funnel' });
    expect(await prisma.lead.count()).toBe(0);
  });

  it('aceita leads simultâneos com o mesmo afiliado novo e cria o afiliado uma vez', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app).post('/api/leads').send(validLead({ email: `lead${i}@email.com`, affiliate_id: 'novo-777' })),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(Array(10).fill(201));
    expect(await prisma.affiliate.count({ where: { code: 'novo-777' } })).toBe(1);
  });
});

describe('POST /api/leads com lead repetido', () => {
  it('devolve 200 com o lead original quando a mesma requisição chega de novo', async () => {
    const first = await request(app).post('/api/leads').send(validLead());
    const second = await request(app).post('/api/leads').send(validLead());

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ success: true, lead_id: first.body.lead_id, duplicate: true });
    expect(await prisma.lead.count()).toBe(1);
    expect(await prisma.leadStatusEvent.count()).toBe(1);
  });

  it('trata como repetido o mesmo e-mail no mesmo funil, mesmo com outros dados', async () => {
    const first = await request(app).post('/api/leads').send(validLead());
    const second = await request(app)
      .post('/api/leads')
      .send(validLead({ name: 'João S.', email: 'JOAO@email.com', phone: '+5511888888888' }));

    expect(second.status).toBe(200);
    expect(second.body.lead_id).toBe(first.body.lead_id);
  });

  it('cria outro lead quando muda o funil', async () => {
    await request(app).post('/api/leads').send(validLead());
    const otherFunnel = await request(app).post('/api/leads').send(validLead({ funnel: 'quiz-01' }));

    expect(otherFunnel.status).toBe(201);
    expect(await prisma.lead.count()).toBe(2);
  });

  it('com Idempotency-Key, repete pelo cabeçalho e não pelo conteúdo', async () => {
    const first = await request(app).post('/api/leads').set('Idempotency-Key', 'pedido-1').send(validLead());
    // Mesma chave e outro conteúdo: devolve o original.
    const sameKey = await request(app)
      .post('/api/leads')
      .set('Idempotency-Key', 'pedido-1')
      .send(validLead({ email: 'maria@email.com' }));
    // Mesmo conteúdo e outra chave: lead novo.
    const otherKey = await request(app).post('/api/leads').set('Idempotency-Key', 'pedido-2').send(validLead());

    expect(sameKey.status).toBe(200);
    expect(sameKey.body.lead_id).toBe(first.body.lead_id);
    expect(otherKey.status).toBe(201);
    expect(await prisma.lead.count()).toBe(2);
  });

  it('com 10 requisições iguais ao mesmo tempo, grava um lead só', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post('/api/leads').send(validLead())),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(responses.map((response) => response.body.lead_id)).size).toBe(1);
    expect(await prisma.lead.count()).toBe(1);
  });
});
