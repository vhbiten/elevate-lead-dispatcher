import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { validLead } from './helpers';

const app = createApp();

// Slug do call center de cada distribuição, na ordem em que aconteceram (o id é sequencial).
async function callCentersInOrder(): Promise<string[]> {
  const distributions = await prisma.distribution.findMany({ orderBy: { id: 'asc' }, include: { call_center: true } });
  return distributions.map((distribution) => distribution.call_center.slug);
}

// Quantos leads cada call center recebeu, contando pela tabela de leads.
async function leadsPerCallCenter(): Promise<Record<string, number>> {
  const callCenters = await prisma.callCenter.findMany({ include: { _count: { select: { leads: true } } } });
  return Object.fromEntries(callCenters.map((callCenter) => [callCenter.slug, callCenter._count.leads]));
}

describe('dispatcher na gravação do lead', () => {
  it('distribui os leads em sequência na ordem A, B, C, A, B, A, C, A, B, A', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/leads').send(validLead({ email: `lead${i}@email.com` }));
    }

    expect(await callCentersInOrder()).toEqual(['cc-a', 'cc-b', 'cc-c', 'cc-a', 'cc-b', 'cc-a', 'cc-c', 'cc-a', 'cc-b', 'cc-a']);
  });

  it('grava a distribuição e soma no contador do call center escolhido', async () => {
    const response = await request(app).post('/api/leads').send(validLead());

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: response.body.lead_id },
      include: { call_center: true, distributions: true },
    });
    expect(lead.call_center?.slug).toBe('cc-a');
    expect(lead.distributions).toHaveLength(1);
    expect(lead.distributions[0].call_center_id).toBe(lead.call_center_id);
    expect(lead.call_center?.assigned_count).toBe(1);
  });

  it('não conta lead repetido no dispatcher', async () => {
    await request(app).post('/api/leads').send(validLead());
    await request(app).post('/api/leads').send(validLead());

    const counters = await prisma.callCenter.findMany({ orderBy: { id: 'asc' } });
    expect(counters.map((callCenter) => callCenter.assigned_count)).toEqual([1, 0, 0]);
    expect(await prisma.distribution.count()).toBe(1);
  });

  it('com 100 leads simultâneos, grava 100 leads divididos exatamente 50/30/20', async () => {
    const responses = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        request(app).post('/api/leads').send(validLead({ email: `simultaneo${i}@email.com` })),
      ),
    );

    expect(responses.filter((response) => response.status === 201)).toHaveLength(100);
    expect(new Set(responses.map((response) => response.body.lead_id)).size).toBe(100);
    expect(await prisma.lead.count()).toBe(100);
    expect(await prisma.distribution.count()).toBe(100);
    expect(await leadsPerCallCenter()).toEqual({ 'cc-a': 50, 'cc-b': 30, 'cc-c': 20 });

    // O contador do dispatcher bate com os leads gravados.
    const counters = await prisma.callCenter.findMany({ orderBy: { id: 'asc' } });
    expect(counters.map((callCenter) => callCenter.assigned_count)).toEqual([50, 30, 20]);
  });
});
