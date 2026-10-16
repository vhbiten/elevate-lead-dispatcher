import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../../src/db';
import { resetDatabase } from './helpers';

// Vale para todo arquivo de teste de integração: cada teste começa com o banco limpo,
// e as conexões são fechadas no fim do arquivo.
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());
