import { Router } from 'express';
import { requireAdmin, requireAuth } from '../auth/require-auth';
import { getMetrics } from './metrics.service';

export const metricsRouter = Router();

metricsRouter.get('/api/metrics', requireAuth, requireAdmin, async (_req, res) => {
  res.json({ success: true, ...(await getMetrics()) });
});
