import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Fora do Docker, carrega o .env com o recurso nativo do Node (sem dotenv).
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Só as migrations precisam da URL; o "prisma generate" roda sem ela no build da imagem.
    url: process.env.DATABASE_URL ?? '',
  },
});
