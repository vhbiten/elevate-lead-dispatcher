import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './tests/integration/test-database.ts';

export default defineConfig({
  test: {
    projects: [
      {
        // Regras puras: sem banco e sem HTTP. Rodam sem Docker (npm run test:unit).
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] },
      },
      {
        // API de verdade contra o Postgres do compose, no banco elevate_test.
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          env: {
            DATABASE_URL: TEST_DATABASE_URL,
            JWT_SECRET: 'test-only-secret',
          },
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          // Os arquivos dividem o mesmo banco, então rodam um de cada vez.
          fileParallelism: false,
        },
      },
    ],
  },
});
