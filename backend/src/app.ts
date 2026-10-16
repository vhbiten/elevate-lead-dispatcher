import express from 'express';
import { errorHandler } from './errors';
import { leadsRouter } from './leads/leads.routes';

// Monta a aplicação sem abrir porta: o servidor (server.ts) e os testes usam a mesma função.
export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(leadsRouter);

  app.use(errorHandler);
  return app;
}
