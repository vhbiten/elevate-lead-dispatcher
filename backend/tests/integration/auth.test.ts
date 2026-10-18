import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { ADMIN, DEV_PASSWORD, loginAs, OPERATOR_A } from './helpers';

const app = createApp();

describe('login e sessão', () => {
  it('login certo devolve o usuário e grava a sessão num cookie httpOnly e SameSite=Strict', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: OPERATOR_A, password: DEV_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      user: { id: expect.any(Number), email: OPERATOR_A, role: 'OPERATOR', call_center: { slug: 'cc-a', name: 'Call Center A' } },
    });
    const cookie = response.get('Set-Cookie')?.[0] ?? '';
    expect(cookie).toMatch(/^session=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    // O token não aparece no corpo: o JavaScript da página nunca tem acesso a ele.
    expect(JSON.stringify(response.body)).not.toContain(cookie.split(';')[0].slice('session='.length));
  });

  it('aceita o e-mail com maiúsculas e espaços', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: '  Admin@Elevate.test ', password: DEV_PASSWORD });

    expect(response.status).toBe(200);
  });

  it('responde 401 igual para senha errada e para e-mail que não existe', async () => {
    const wrongPassword = await request(app).post('/api/auth/login').send({ email: ADMIN, password: 'errada' });
    const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'ninguem@elevate.test', password: 'errada' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual({ success: false, error: 'invalid_credentials' });
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(wrongPassword.get('Set-Cookie')).toBeUndefined();
  });

  it('responde 400 para corpo sem e-mail válido', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: 'admin', password: '' });

    expect(response.status).toBe(400);
    expect(response.body.details.map((detail: { field: string }) => detail.field)).toEqual(['email', 'password']);
  });

  it('GET /api/auth/me devolve o usuário da sessão, sem o hash da senha', async () => {
    const cookie = await loginAs(app, ADMIN);

    const response = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({ id: expect.any(Number), email: ADMIN, role: 'ADMIN', call_center: null });
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  it('recusa com 401 sessão ausente, adulterada, expirada ou assinada com outro segredo', async () => {
    const cookie = await loginAs(app, OPERATOR_A);
    const token = cookie.slice('session='.length);
    const [header, , signature] = token.split('.');
    // Mesmo token com o perfil trocado para ADMIN: a assinatura deixa de bater.
    const forgedPayload = Buffer.from(JSON.stringify({ sub: '1', role: 'ADMIN', call_center_id: null })).toString('base64url');
    const expired = jwt.sign({ role: 'ADMIN' }, 'test-only-secret', { subject: '1', expiresIn: -10 });
    const otherSecret = jwt.sign({ role: 'ADMIN' }, 'outro-segredo', { subject: '1', expiresIn: 60 });

    const cookies = [undefined, `session=${header}.${forgedPayload}.${signature}`, `session=${expired}`, `session=${otherSecret}`];
    for (const value of cookies) {
      const call = request(app).get('/api/auth/me');
      const response = await (value ? call.set('Cookie', value) : call);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ success: false, error: 'unauthorized' });
    }
  });

  it('logout apaga o cookie da sessão', async () => {
    const cookie = await loginAs(app, ADMIN);

    const response = await request(app).post('/api/auth/logout').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.get('Set-Cookie')?.[0]).toMatch(/^session=;.*Expires=Thu, 01 Jan 1970/);
  });
});
