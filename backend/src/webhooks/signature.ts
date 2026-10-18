import { createHmac, timingSafeEqual } from 'node:crypto';

// Diferença máxima aceita entre o X-Timestamp e o relógio do servidor (docs/spec.md, seção 8).
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

// "sha256=" + HMAC-SHA256 de "<timestamp>.<corpo bruto>", com o segredo do call center.
// O corpo entra como bytes, exatamente como chegou: qualquer alteração no caminho muda a assinatura.
export function signWebhook(secret: string, timestamp: string, rawBody: Buffer | string): string {
  const hmac = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody);
  return `sha256=${hmac.digest('hex')}`;
}

// Compara em tempo constante: uma comparação comum para no primeiro caractere diferente,
// e medir esse tempo ajudaria a adivinhar a assinatura aos poucos.
export function isValidSignature(secret: string, timestamp: string, rawBody: Buffer, signature: string): boolean {
  const expected = Buffer.from(signWebhook(secret, timestamp, rawBody));
  const received = Buffer.from(signature);
  // timingSafeEqual exige o mesmo tamanho; o tamanho da assinatura não é segredo.
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// X-Timestamp em segundos (Unix), a no máximo 5 minutos do relógio do servidor, para os dois lados.
// Quem copiar uma requisição verdadeira não consegue reenviá-la depois.
export function isRecentTimestamp(timestamp: string, now: Date): boolean {
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  return Math.abs(now.getTime() / 1000 - Number(timestamp)) <= MAX_CLOCK_SKEW_SECONDS;
}
