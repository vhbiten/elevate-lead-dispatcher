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
});
