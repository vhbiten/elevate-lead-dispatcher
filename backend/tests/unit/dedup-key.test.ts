import { describe, expect, it } from 'vitest';
import { buildDedupKey } from '../../src/leads/dedup-key';

const lead = { email: 'joao@email.com', product: 'nutralean', funnel: 'vsl-01' };
const morning = new Date('2026-10-15T09:00:00Z');
const night = new Date('2026-10-15T23:59:00Z');
const nextDay = new Date('2026-10-16T00:01:00Z');

describe('buildDedupKey', () => {
  it('dá a mesma chave para o mesmo e-mail, produto e funil no mesmo dia', () => {
    expect(buildDedupKey(lead, morning)).toBe(buildDedupKey(lead, night));
  });

  it('dá chaves diferentes em dias diferentes (UTC)', () => {
    expect(buildDedupKey(lead, night)).not.toBe(buildDedupKey(lead, nextDay));
  });

  it('dá chaves diferentes para outro funil ou outro e-mail', () => {
    const base = buildDedupKey(lead, morning);

    expect(buildDedupKey({ ...lead, funnel: 'quiz-01' }, morning)).not.toBe(base);
    expect(buildDedupKey({ ...lead, email: 'maria@email.com' }, morning)).not.toBe(base);
  });

  it('com Idempotency-Key, a chave depende só do cabeçalho', () => {
    const other = { email: 'maria@email.com', product: 'restwell', funnel: 'vsl-01' };

    expect(buildDedupKey(lead, morning, 'abc-123')).toBe(buildDedupKey(other, nextDay, 'abc-123'));
    expect(buildDedupKey(lead, morning, 'abc-123')).not.toBe(buildDedupKey(lead, morning, 'abc-124'));
  });

  it('ignora Idempotency-Key vazia ou só com espaços', () => {
    expect(buildDedupKey(lead, morning, '   ')).toBe(buildDedupKey(lead, morning));
  });

  it('não guarda o e-mail em texto puro e tem tamanho fixo', () => {
    const auto = buildDedupKey(lead, morning);
    const fromHeader = buildDedupKey(lead, morning, 'x'.repeat(5000));

    expect(auto).not.toContain('joao');
    expect(auto).toMatch(/^auto:[0-9a-f]{64}$/);
    expect(fromHeader).toMatch(/^key:[0-9a-f]{64}$/);
  });
});
