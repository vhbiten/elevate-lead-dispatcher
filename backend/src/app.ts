import express from 'express';
import { errorHandler } from './errors';
import { leadsRouter } from './leads/leads.routes';
import { webhooksRouter } from './webhooks/webhooks.routes';

// Monta a aplicação sem abrir porta: o servidor (server.ts) e os testes usam a mesma função.
export function createApp() {
  const app = express();

  // O webhook vem antes do express.json(): ele precisa do corpo bruto para conferir a assinatura.
  app.use(webhooksRouter);
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(leadsRouter);

  app.use(errorHandler);
  return app;
}
