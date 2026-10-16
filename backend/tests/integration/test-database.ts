// Banco usado pelos testes de integração. Fora do Docker, aponta para o Postgres do compose.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://elevate:elevate@localhost:5432/elevate_test';
