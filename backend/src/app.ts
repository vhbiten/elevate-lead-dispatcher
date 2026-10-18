import cookieParser from 'cookie-parser';
import express from 'express';
import { authRouter } from './auth/auth.routes';
import { errorHandler } from './errors';
import { leadsRouter } from './leads/leads.routes';
import { webhooksRouter } from './webhooks/webhooks.routes';

// Monta a aplicação sem abrir porta: o servidor (server.ts) e os testes usam a mesma função.
export function createApp() {
  const app = express();

  // O webhook vem antes do express.json(): ele precisa do corpo bruto para conferir a assinatura.
  app.use(webhooksRouter);
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(authRouter);
  app.use(leadsRouter);

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'not_found' });
  });
  app.use(errorHandler);
  return app;
}
