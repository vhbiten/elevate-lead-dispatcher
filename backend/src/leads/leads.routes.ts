import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth';
import { currentUser } from '../auth/session';
import { formatValidationError } from '../validation';
import { leadListQuerySchema, leadSchema, statusChangeSchema } from './leads.schema';
import { changeStatusFromPanel, createLead, getFilterOptions, getLeadDetail, listLeads } from './leads.service';

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

  if (result.duplicate) {
    // Repetição da mesma requisição: devolve o lead original, sem criar outro (docs/spec.md, seção 6).
    res.status(200).json({ success: true, lead_id: result.leadId, duplicate: true });
    return;
  }

  res.status(201).json({ success: true, lead_id: result.leadId });
});

// Painel: lista de leads com filtros e paginação no servidor (docs/spec.md, seção 11).
leadsRouter.get('/api/leads', requireAuth, async (req, res) => {
  const parsed = leadListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'validation_error', details: formatValidationError(parsed.error) });
    return;
  }

  const { leads, pagination } = await listLeads(currentUser(res), parsed.data);
  res.json({ success: true, data: leads, pagination });
});

// Opções dos filtros da tabela (produtos, funis, call centers e status).
leadsRouter.get('/api/options', requireAuth, async (_req, res) => {
  res.json({ success: true, ...(await getFilterOptions(currentUser(res))) });
});

leadsRouter.get('/api/leads/:id', requireAuth, async (req, res) => {
  // Id que nem é um UUID não existe: 404, como qualquer lead que o usuário não pode ver.
  const id = z.uuid().safeParse(req.params.id);
  const lead = id.success ? await getLeadDetail(currentUser(res), id.data) : null;
  if (!lead) {
    res.status(404).json({ success: false, error: 'lead_not_found' });
    return;
  }
  res.json({ success: true, data: lead });
});

leadsRouter.patch('/api/leads/:id/status', requireAuth, async (req, res) => {
  const parsed = statusChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'validation_error', details: formatValidationError(parsed.error) });
    return;
  }

  const id = z.uuid().safeParse(req.params.id);
  const result = id.success ? await changeStatusFromPanel(currentUser(res), id.data, parsed.data.status) : null;
  if (!result || !result.ok) {
    res.status(404).json({ success: false, error: 'lead_not_found' });
    return;
  }
  if (result.duplicate) {
    res.json({ success: true, duplicate: true });
    return;
  }
  if (!result.decision.applied) {
    // No painel quem pede é uma pessoa: a mudança barrada volta como erro, com o motivo e o status atual.
    // O pedido fica registrado no histórico, como todo evento.
    res.status(422).json({ success: false, error: result.decision.reason, status: result.status });
    return;
  }
  res.json({ success: true, status: result.status });
});
