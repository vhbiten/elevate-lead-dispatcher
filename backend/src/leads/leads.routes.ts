import { Router } from 'express';
import { formatValidationError } from '../validation';
import { leadSchema } from './leads.schema';
import { createLead } from './leads.service';

export const leadsRouter = Router();

// Recebimento de leads das páginas de vendas (docs/spec.md, seção 5).
leadsRouter.post('/api/leads', async (req, res) => {
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: 'validation_error',
      details: formatValidationError(parsed.error),
    });
    return;
  }

  const result = await createLead(parsed.data, req.get('Idempotency-Key'));
  if (!result.ok) {
    // Formato certo, mas produto ou funil que não existem: 422, e não 400.
    res.status(422).json({ success: false, error: result.error });
    return;
  }

  res.status(201).json({ success: true, lead_id: result.leadId });
});
