import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isRecentTimestamp, isValidSignature, signWebhook } from '../../src/webhooks/signature';

const body = Buffer.from('{"status":"sale"}');

describe('signWebhook e isValidSignature', () => {
  it('assina "<timestamp>.<corpo>" com HMAC-SHA256 e prefixo sha256=', () => {
    const expected = createHmac('sha256', 'segredo').update('1760000000.{"status":"sale"}').digest('hex');

    expect(signWebhook('segredo', '1760000000', body)).toBe(`sha256=${expected}`);
  });

  it('aceita a assinatura certa e recusa outro segredo, outro timestamp ou outro corpo', () => {
    const signature = signWebhook('segredo', '1760000000', body);

    expect(isValidSignature('segredo', '1760000000', body, signature)).toBe(true);
    expect(isValidSignature('outro', '1760000000', body, signature)).toBe(false);
    expect(isValidSignature('segredo', '1760000001', body, signature)).toBe(false);
    expect(isValidSignature('segredo', '1760000000', Buffer.from('{"status":"refund"}'), signature)).toBe(false);
  });

  it('recusa assinatura de tamanho diferente sem lançar erro', () => {
    expect(isValidSignature('segredo', '1760000000', body, 'sha256=abc')).toBe(false);
  });
});

describe('isRecentTimestamp', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const nowSeconds = now.getTime() / 1000;

  it('aceita até 5 minutos de diferença, para trás e para frente', () => {
    expect(isRecentTimestamp(String(nowSeconds - 300), now)).toBe(true);
    expect(isRecentTimestamp(String(nowSeconds + 300), now)).toBe(true);
    expect(isRecentTimestamp(String(nowSeconds - 301), now)).toBe(false);
    expect(isRecentTimestamp(String(nowSeconds + 301), now)).toBe(false);
  });

  it('recusa o que não é um número de segundos', () => {
    expect(isRecentTimestamp('2026-10-18T12:00:00Z', now)).toBe(false);
    expect(isRecentTimestamp('', now)).toBe(false);
    expect(isRecentTimestamp(`${nowSeconds}.5`, now)).toBe(false);
  });
});
