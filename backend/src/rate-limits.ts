import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

// Limites de requisição (docs/spec.md, seção 13). Ficam na memória do processo: com várias instâncias,
// cada uma contaria separado, e o contador iria para um armazenamento compartilhado (ex.: Redis).

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : Number(value);
}

const respondRateLimited: RequestHandler = (_req, res) => {
  res.status(429).json({ success: false, error: 'rate_limited' });
};

// Recebimento de leads, por IP. O padrão é folgado porque operadoras móveis põem muitos clientes
// atrás do mesmo IP (CGNAT). Zero desliga, como nos testes de concorrência.
export function leadsRateLimit(): RequestHandler | null {
  const limit = numberFromEnv('LEADS_RATE_LIMIT_PER_MINUTE', 120);
  if (limit <= 0) return null;
  return rateLimit({ windowMs: 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false, handler: respondRateLimited });
}

// Login: 5 tentativas erradas a cada 15 minutos para o mesmo IP e e-mail. Login certo não conta,
// e errar a senha de um e-mail não bloqueia outro usuário no mesmo IP.
export function loginRateLimit(): RequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: numberFromEnv('LOGIN_RATE_LIMIT', 5),
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.email ?? '').trim().toLowerCase()}`,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: respondRateLimited,
  });
}
