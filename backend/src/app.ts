import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { authRouter } from './auth/auth.routes';
import { dispatcherRouter } from './dispatcher/dispatcher.routes';
import { errorHandler } from './errors';
import { leadsRouter } from './leads/leads.routes';
import { metricsRouter } from './metrics/metrics.routes';
import { leadsRateLimit, loginRateLimit } from './rate-limits';
import { webhooksRouter } from './webhooks/webhooks.routes';

// Monta a aplicação sem abrir porta: o servidor (server.ts) e os testes usam a mesma função.
export function createApp() {
  const app = express();
  // Atrás do nginx, o IP do cliente vem no X-Forwarded-For. Sem isso, todos teriam o IP do nginx
  // e dividiriam o mesmo limite de requisições.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
  // Cabeçalhos de segurança (nosniff, frameguard etc.) e sem o X-Powered-By.
  app.use(helmet());

  // O webhook vem antes do express.json(): ele precisa do corpo bruto para conferir a assinatura.
  app.use(webhooksRouter);
  app.use(express.json());
  app.use(cookieParser());

  // CORS aberto só no recebimento de leads: as páginas de vendas ficam em outros domínios.
  // A rota não usa cookie, então aceitar qualquer origem não abre brecha de CSRF.
  app.options('/api/leads', cors());
  app.post('/api/leads', cors());

  const leadsLimit = leadsRateLimit();
  if (leadsLimit) app.post('/api/leads', leadsLimit);
  app.post('/api/auth/login', loginRateLimit());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(authRouter);
  app.use(leadsRouter);
  app.use(metricsRouter);
  app.use(dispatcherRouter);

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'not_found' });
  });
  app.use(errorHandler);
  return app;
}
