import express, { Router } from 'express';
import { formatValidationError } from '../validation';
import { verifyWebhookSignature } from './verify-signature';
import { statusEventSchema } from './webhooks.schema';
import { recordWebhookEvent } from './webhooks.service';

export const webhooksRouter = Router();

// Atualização de status enviada pelo call center (docs/spec.md, seção 8).
// O corpo chega bruto (Buffer), porque a assinatura é conferida sobre os bytes exatos enviados;
// só depois dela o JSON é lido.
webhooksRouter.post(
  '/api/webhooks/callcenter',
  express.raw({ type: () => true, limit: '10kb' }),
  verifyWebhookSignature,
  async (req, res) => {
    let body: unknown;
    try {
      body = JSON.parse(req.body.toString('utf8'));
    } catch {
      res.status(400).json({
        success: false,
        error: 'validation_error',
        details: [{ field: 'body', message: 'Invalid JSON' }],
      });
      return;
    }

    const parsed = statusEventSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'validation_error', details: formatValidationError(parsed.error) });
      return;
    }

    const result = await recordWebhookEvent(res.locals.callCenterId, parsed.data);
    if (!result.ok) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }

    if (result.duplicate) {
      res.status(200).json({ success: true, duplicate: true });
      return;
    }

    // Evento barrado pelas regras também responde 200: ele foi recebido e registrado.
    // Com erro, o call center reenviaria o mesmo evento indefinidamente.
    res.status(200).json({ success: true, ...result.decision, status: result.status });
  },
);
