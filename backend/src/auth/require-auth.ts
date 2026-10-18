import type { RequestHandler } from 'express';
import { currentUser, readSessionToken, SESSION_COOKIE } from './session';

// Rotas do painel: exige sessão válida. Sem ela, 401.
export const requireAuth: RequestHandler = (req, res, next) => {
  const user = readSessionToken(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ success: false, error: 'unauthorized' });
    return;
  }
  res.locals.user = user;
  next();
};

// Rotas do ADMIN: vem depois do requireAuth. OPERATOR recebe 403.
export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (currentUser(res).role !== 'ADMIN') {
    res.status(403).json({ success: false, error: 'forbidden' });
    return;
  }
  next();
};
