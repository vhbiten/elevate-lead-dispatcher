import { Router } from 'express';
import { formatValidationError } from '../validation';
import { loginSchema } from './auth.schema';
import { authenticate, getProfile } from './auth.service';
import { requireAuth } from './require-auth';
import { createSessionToken, currentUser, SESSION_COOKIE, sessionCookieOptions } from './session';

export const authRouter = Router();

// Login (docs/spec.md, seção 10). A sessão vai num cookie httpOnly, e não no corpo da resposta.
authRouter.post('/api/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'validation_error', details: formatValidationError(parsed.error) });
    return;
  }

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) {
    // A mesma resposta para e-mail inexistente e senha errada.
    res.status(401).json({ success: false, error: 'invalid_credentials' });
    return;
  }

  res.cookie(SESSION_COOKIE, createSessionToken(user), sessionCookieOptions());
  res.json({ success: true, user: await getProfile(user.id) });
});

authRouter.post('/api/auth/logout', requireAuth, (_req, res) => {
  // O clearCookie precisa das mesmas opções do cookie (path, sameSite) para o navegador apagá-lo.
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.json({ success: true });
});

authRouter.get('/api/auth/me', requireAuth, async (_req, res) => {
  const profile = await getProfile(currentUser(res).id);
  if (!profile) {
    // Usuário removido depois do login: a sessão deixa de valer.
    res.status(401).json({ success: false, error: 'unauthorized' });
    return;
  }
  res.json({ success: true, user: profile });
});
