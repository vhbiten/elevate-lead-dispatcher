import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { UserRole } from '../generated/prisma/enums';

export const SESSION_COOKIE = 'session';
const SESSION_MS = 8 * 60 * 60 * 1000;

// O que a sessão guarda: o suficiente para conferir permissão sem ir ao banco a cada requisição.
export type SessionUser = { id: number; role: UserRole; call_center_id: number | null };

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

export function createSessionToken(user: SessionUser): string {
  return jwt.sign({ role: user.role, call_center_id: user.call_center_id }, jwtSecret(), {
    subject: String(user.id),
    expiresIn: SESSION_MS / 1000,
  });
}

// Devolve null para token ausente, expirado, adulterado ou assinado com outro algoritmo.
export function readSessionToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  try {
    // O algoritmo fica fixo: um token que declare outro (ex.: "none") é recusado.
    const payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
    if (typeof payload === 'string') return null;
    return { id: Number(payload.sub), role: payload.role, call_center_id: payload.call_center_id ?? null };
  } catch {
    return null;
  }
}

// httpOnly: o JavaScript da página não lê o cookie (proteção contra roubo por XSS).
// SameSite=Strict: o navegador não envia o cookie em requisições vindas de outro site (proteção contra CSRF).
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: SESSION_MS,
    path: '/',
  };
}

// Usuário da sessão, colocado em res.locals pelo requireAuth.
export function currentUser(res: Response): SessionUser {
  return res.locals.user as SessionUser;
}
