import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { ADMIN, loginAs, OPERATOR_A, OPERATOR_B, validLead } from './helpers';

const app = createApp();
let admin: string;
let operatorA: string;
let operatorB: string;

beforeAll(async () => {
  admin = await loginAs(app, ADMIN);
  operatorA = await loginAs(app, OPERATOR_A);
  operatorB = await loginAs(app, OPERATOR_B);
});

// O primeiro lead vai para o cc-a e o segundo para o cc-b.
async function createLeadsForAandB(): Promise<{ leadA: string; leadB: string }> {
  const first = await request(app).post('/api/leads').send(validLead({ email: 'a@email.com' }));
  const second = await request(app).post('/api/leads').send(validLead({ email: 'b@email.com' }));
  return { leadA: first.body.lead_id, leadB: second.body.lead_id };
}

// As checagens são feitas pela API, sem passar pela tela: é o que impede um OPERATOR de contornar o painel.
describe('permissões por perfil e call center', () => {
  it('OPERATOR lista só os leads do próprio call center, mesmo pedindo outro', async () => {
    const { leadA } = await createLeadsForAandB();

    const own = await request(app).get('/api/leads').set('Cookie', operatorA);
    const askingForB = await request(app).get('/api/leads?call_center=cc-b').set('Cookie', operatorA);

    expect(own.body.data.map((lead: { id: string }) => lead.id)).toEqual([leadA]);
    expect(askingForB.body.data.map((lead: { id: string }) => lead.id)).toEqual([leadA]);
  });

  it('OPERATOR recebe 404 ao abrir lead de outro call center, igual a um lead que não existe', async () => {
    const { leadB } = await createLeadsForAandB();

    const otherCallCenter = await request(app).get(`/api/leads/${leadB}`).set('Cookie', operatorA);
    const missing = await request(app).get('/api/leads/0199e3a0-0000-7000-8000-000000000000').set('Cookie', operatorA);
    const owner = await request(app).get(`/api/leads/${leadB}`).set('Cookie', operatorB);

    expect(otherCallCenter.status).toBe(404);
    expect(otherCallCenter.body).toEqual(missing.body);
    expect(owner.status).toBe(200);
  });

  it('OPERATOR recebe 404 ao mudar status de lead de outro call center, e o lead não muda', async () => {
    const { leadB } = await createLeadsForAandB();

    const response = await request(app).patch(`/api/leads/${leadB}/status`).set('Cookie', operatorA).send({ status: 'sale' });

    expect(response.status).toBe(404);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadB } });
    expect(lead.status).toBe('new');
  });

  it('ADMIN vê e altera leads de qualquer call center', async () => {
    const { leadA, leadB } = await createLeadsForAandB();

    const list = await request(app).get('/api/leads').set('Cookie', admin);
    const change = await request(app).patch(`/api/leads/${leadB}/status`).set('Cookie', admin).send({ status: 'qualified' });

    expect(list.body.data.map((lead: { id: string }) => lead.id).sort()).toEqual([leadA, leadB].sort());
    expect(change.status).toBe(200);
  });
});
