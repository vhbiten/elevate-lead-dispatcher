import { Router } from 'express';
import { requireAdmin, requireAuth } from '../auth/require-auth';
import { formatValidationError } from '../validation';
import { dispatcherConfigSchema } from './dispatcher.schema';
import { getDispatcherOverview, updateDispatcherConfig } from './dispatcher.service';

export const dispatcherRouter = Router();

dispatcherRouter.get('/api/dispatcher', requireAuth, requireAdmin, async (_req, res) => {
  res.json({ success: true, call_centers: await getDispatcherOverview() });
});

dispatcherRouter.put('/api/dispatcher', requireAuth, requireAdmin, async (req, res) => {
  const parsed = dispatcherConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'validation_error', details: formatValidationError(parsed.error) });
    return;
  }

  const result = await updateDispatcherConfig(parsed.data);
  if (!result.ok) {
    res.status(422).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, call_centers: await getDispatcherOverview() });
});
