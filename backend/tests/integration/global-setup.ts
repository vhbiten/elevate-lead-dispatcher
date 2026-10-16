import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-database';

// Roda uma vez antes dos testes de integração: deixa o banco de teste com o schema e o seed atuais.
export default function setup() {
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };
  execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });
  execSync('npx prisma db seed', { env, stdio: 'pipe' });
}
