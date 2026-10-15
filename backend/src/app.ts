import express from 'express';

// Monta a aplicação sem abrir porta: o servidor (server.ts) e os testes usam a mesma função.
export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
