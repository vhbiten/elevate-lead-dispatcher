import type { RequestHandler } from 'express';
import { isRecentTimestamp, isValidSignature } from './signature';
import { findCallCenterBySlug } from './webhooks.service';

// Confere quem enviou o webhook antes de qualquer outra coisa (docs/spec.md, seção 8).
// Qualquer falha tem a mesma resposta, para não indicar o que estava errado.
export const verifyWebhookSignature: RequestHandler = async (req, res, next) => {
  const slug = req.get('X-Call-Center');
  const timestamp = req.get('X-Timestamp');
  const signature = req.get('X-Signature');
  // O express.raw() da rota entrega o corpo como Buffer; sem corpo, assina-se o vazio.
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  const callCenter = slug ? await findCallCenterBySlug(slug) : null;
  const valid =
    callCenter !== null &&
    timestamp !== undefined &&
    signature !== undefined &&
    isRecentTimestamp(timestamp, new Date()) &&
    isValidSignature(callCenter.webhook_secret, timestamp, rawBody, signature);

  if (!valid) {
    res.status(401).json({ success: false, error: 'invalid_signature' });
    return;
  }

  res.locals.callCenterId = callCenter.id;
  next();
};
