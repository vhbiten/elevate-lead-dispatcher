import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { signWebhook } from '../../src/webhooks/signature';
import { validLead } from './helpers';

const app = createApp();

// Data e hora do evento, em segundos a partir de agora. Os eventos precisam ser depois da criação do lead.
function at(secondsFromNow: number): string {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString();
}

// O primeiro lead do banco vai para o cc-a (maior peso).
async function createLeadForCallCenterA(): Promise<string> {
  const response = await request(app).post('/api/leads').send(validLead());
  return response.body.lead_id;
}

type SendOptions = {
  callCenter?: string;
  secret?: string;
  timestamp?: string;
  signature?: string;
  rawBody?: string;
};

// Envia um webhook assinado como o call center faria. As opções permitem estragar cada parte.
function sendWebhook(body: unknown, options: SendOptions = {}) {
  const callCenter = options.callCenter ?? 'cc-a';
  const secret = options.secret ?? `dev-secret-${callCenter}`;
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const rawBody = options.rawBody ?? JSON.stringify(body);

  return request(app)
    .post('/api/webhooks/callcenter')
    .set('Content-Type', 'application/json')
    .set('X-Call-Center', callCenter)
    .set('X-Timestamp', timestamp)
    .set('X-Signature', options.signature ?? signWebhook(secret, timestamp, rawBody))
    .send(rawBody);
}

describe('POST /api/webhooks/callcenter', () => {
  it('aplica o evento, grava no histórico e guarda o external_id na distribuição', async () => {
    const leadId = await createLeadForCallCenterA();
    const timestamp = at(60);

    const response = await sendWebhook({ lead_id: leadId, external_id: 'CC-123', status: 'contacted', timestamp });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, applied: true, status: 'contacted' });

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      include: { status_events: { orderBy: { id: 'asc' } }, distributions: true },
    });
    expect(lead.status).toBe('contacted');
    expect(lead.status_updated_at.toISOString()).toBe(timestamp);
    expect(lead.status_events).toHaveLength(2);
    expect(lead.status_events[1]).toMatchObject({
      status: 'contacted',
      source: 'webhook',
      external_id: 'CC-123',
      applied: true,
      reason: null,
      call_center_id: lead.call_center_id,
    });
    expect(lead.distributions[0].external_id).toBe('CC-123');
  });

  describe('assinatura', () => {
    it('recusa com 401 assinatura errada, segredo de outro call center ou call center desconhecido', async () => {
      const leadId = await createLeadForCallCenterA();
      const body = { lead_id: leadId, status: 'contacted', timestamp: at(60) };

      const responses = await Promise.all([
        sendWebhook(body, { signature: 'sha256=0000' }),
        sendWebhook(body, { secret: 'dev-secret-cc-b' }),
        sendWebhook(body, { callCenter: 'cc-x', secret: 'qualquer' }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(response.body).toEqual({ success: false, error: 'invalid_signature' });
      }
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.status).toBe('new');
    });

    it('recusa com 401 corpo alterado depois de assinado', async () => {
      const leadId = await createLeadForCallCenterA();
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signedBody = JSON.stringify({ lead_id: leadId, status: 'contacted', timestamp: at(60) });
      const tamperedBody = JSON.stringify({ lead_id: leadId, status: 'sale', timestamp: at(60) });

      const response = await sendWebhook(null, {
        timestamp,
        rawBody: tamperedBody,
        signature: signWebhook('dev-secret-cc-a', timestamp, signedBody),
      });

      expect(response.status).toBe(401);
    });

    it('recusa com 401 X-Timestamp com mais de 5 minutos, mesmo com assinatura correta', async () => {
      const leadId = await createLeadForCallCenterA();
      const sixMinutesAgo = String(Math.floor(Date.now() / 1000) - 6 * 60);

      const response = await sendWebhook({ lead_id: leadId, status: 'contacted', timestamp: at(60) }, { timestamp: sixMinutesAgo });

      expect(response.status).toBe(401);
    });

    it('recusa com 401 requisição sem os cabeçalhos', async () => {
      const response = await request(app).post('/api/webhooks/callcenter').send({ status: 'sale' });

      expect(response.status).toBe(401);
    });
  });

  describe('corpo e lead', () => {
    it('responde 400 para corpo inválido, com os campos', async () => {
      const response = await sendWebhook({ lead_id: 'abc', status: 'vendido', timestamp: 'ontem' });

      expect(response.status).toBe(400);
      expect(response.body.details.map((detail: { field: string }) => detail.field)).toEqual([
        'lead_id',
        'status',
        'timestamp',
      ]);
    });

    it('responde 400 para JSON quebrado assinado corretamente', async () => {
      const response = await sendWebhook(null, { rawBody: '{"status": ' });

      expect(response.status).toBe(400);
      expect(response.body.details).toEqual([{ field: 'body', message: 'Invalid JSON' }]);
    });

    it('responde 400 para evento com data mais de 5 minutos no futuro', async () => {
      const leadId = await createLeadForCallCenterA();

      const response = await sendWebhook({ lead_id: leadId, status: 'sale', timestamp: at(10 * 60) });

      expect(response.status).toBe(400);
      expect(response.body.details[0].field).toBe('timestamp');
    });

    it('responde 404 igual para lead de outro call center e para lead que não existe', async () => {
      const leadId = await createLeadForCallCenterA();

      const otherCallCenter = await sendWebhook({ lead_id: leadId, status: 'sale', timestamp: at(60) }, { callCenter: 'cc-b' });
      const missing = await sendWebhook({
        lead_id: '0199e3a0-0000-7000-8000-000000000000',
        status: 'sale',
        timestamp: at(60),
      });

      expect(otherCallCenter.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(otherCallCenter.body).toEqual(missing.body);
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.status).toBe('new');
    });
  });

  describe('webhook repetido e fora de ordem', () => {
    it('o mesmo webhook duas vezes grava um evento só e responde duplicate na segunda', async () => {
      const leadId = await createLeadForCallCenterA();
      const body = { lead_id: leadId, status: 'contacted', timestamp: at(60) };

      const first = await sendWebhook(body);
      const second = await sendWebhook(body);

      expect(first.body.applied).toBe(true);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ success: true, duplicate: true });
      expect(await prisma.leadStatusEvent.count({ where: { lead_id: leadId, source: 'webhook' } })).toBe(1);
    });

    it('exemplo do enunciado: contacted das 11h50 que chega depois da sale das 12h00 não desfaz a venda', async () => {
      const leadId = await createLeadForCallCenterA();

      await sendWebhook({ lead_id: leadId, status: 'sale', timestamp: at(120) });
      const late = await sendWebhook({ lead_id: leadId, status: 'contacted', timestamp: at(60) });

      expect(late.status).toBe(200);
      expect(late.body).toEqual({ success: true, applied: false, reason: 'stale', status: 'sale' });
      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: leadId },
        include: { status_events: { orderBy: { id: 'asc' } } },
      });
      expect(lead.status).toBe('sale');
      // O histórico guarda tudo, aplicado ou não.
      expect(lead.status_events.map((event) => [event.status, event.applied, event.reason])).toEqual([
        ['new', true, null],
        ['sale', true, null],
        ['contacted', false, 'stale'],
      ]);
    });

    it('contacted com horário depois da venda é registrado como transição inválida', async () => {
      const leadId = await createLeadForCallCenterA();

      await sendWebhook({ lead_id: leadId, status: 'sale', timestamp: at(60) });
      const response = await sendWebhook({ lead_id: leadId, status: 'contacted', timestamp: at(120) });

      expect(response.body).toEqual({ success: true, applied: false, reason: 'invalid_transition', status: 'sale' });
    });

    it('o mesmo webhook 10 vezes ao mesmo tempo gera um único evento e muda o status uma vez', async () => {
      const leadId = await createLeadForCallCenterA();
      const body = { lead_id: leadId, status: 'qualified', timestamp: at(60) };

      const responses = await Promise.all(Array.from({ length: 10 }, () => sendWebhook(body)));

      expect(responses.map((response) => response.status)).toEqual(Array(10).fill(200));
      expect(responses.filter((response) => response.body.applied === true)).toHaveLength(1);
      expect(responses.filter((response) => response.body.duplicate === true)).toHaveLength(9);
      expect(await prisma.leadStatusEvent.count({ where: { lead_id: leadId, source: 'webhook' } })).toBe(1);
    });

    it('sale e contacted antigo chegando ao mesmo tempo terminam sempre em sale', async () => {
      // Repete para cobrir as duas ordens de chegada.
      for (let round = 0; round < 20; round++) {
        const response = await request(app).post('/api/leads').send(validLead({ email: `rodada${round}@email.com` }));
        const leadId = response.body.lead_id;
        // Cada lead da rodada vai para um call center diferente; o webhook sai do call center certo.
        const { call_center } = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { call_center: true } });
        const callCenter = call_center?.slug;

        await Promise.all([
          sendWebhook({ lead_id: leadId, status: 'contacted', timestamp: at(60) }, { callCenter }),
          sendWebhook({ lead_id: leadId, status: 'sale', timestamp: at(120) }, { callCenter }),
        ]);

        const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
        expect(lead.status).toBe('sale');
      }
    });
  });
});
