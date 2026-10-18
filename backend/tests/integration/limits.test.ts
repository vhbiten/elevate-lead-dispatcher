import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { ADMIN, DEV_PASSWORD, OPERATOR_A, validLead } from './helpers';

describe('limite de tentativas no login', () => {
  it('depois de 5 senhas erradas, bloqueia o mesmo e-mail com 429, mesmo com a senha certa', async () => {
    const app = createApp();
    for (let i = 0; i < 5; i++) {
      const wrong = await request(app).post('/api/auth/login').send({ email: ADMIN, password: 'errada' });
      expect(wrong.status).toBe(401);
    }

    const blocked = await request(app).post('/api/auth/login').send({ email: ADMIN, password: DEV_PASSWORD });
    const otherUser = await request(app).post('/api/auth/login').send({ email: OPERATOR_A, password: DEV_PASSWORD });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ success: false, error: 'rate_limited' });
    expect(otherUser.status).toBe(200);
  });

  it('login certo não conta como tentativa', async () => {
    const app = createApp();
    for (let i = 0; i < 6; i++) {
      const response = await request(app).post('/api/auth/login').send({ email: ADMIN, password: DEV_PASSWORD });
      expect(response.status).toBe(200);
    }
  });
});

describe('limite por IP no recebimento de leads', () => {
  it('passa do limite e recebe 429', async () => {
    process.env.LEADS_RATE_LIMIT_PER_MINUTE = '3';
    const app = createApp();
    process.env.LEADS_RATE_LIMIT_PER_MINUTE = '0';

    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const response = await request(app).post('/api/leads').send(validLead({ email: `lead${i}@email.com` }));
      statuses.push(response.status);
    }

    expect(statuses).toEqual([201, 201, 201, 429]);
  });
});

describe('CORS e cabeçalhos de segurança', () => {
  const app = createApp();

  it('POST /api/leads aceita qualquer origem, inclusive o preflight', async () => {
    const preflight = await request(app)
      .options('/api/leads')
      .set('Origin', 'https://pagina-de-vendas.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    const post = await request(app).post('/api/leads').set('Origin', 'https://pagina-de-vendas.com').send(validLead());

    expect(preflight.status).toBe(204);
    expect(preflight.get('Access-Control-Allow-Origin')).toBe('*');
    expect(post.status).toBe(201);
    expect(post.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('as rotas do painel não liberam outras origens', async () => {
    const response = await request(app).post('/api/auth/login').set('Origin', 'https://site-qualquer.com').send({ email: ADMIN, password: DEV_PASSWORD });

    expect(response.get('Access-Control-Allow-Origin')).toBeUndefined();
  });

  it('responde com os cabeçalhos do helmet e sem X-Powered-By', async () => {
    const response = await request(app).get('/api/health');

    expect(response.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.get('X-Powered-By')).toBeUndefined();
  });

  it('rota que não existe responde 404 em JSON', async () => {
    const response = await request(app).get('/api/nao-existe');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, error: 'not_found' });
  });
});
