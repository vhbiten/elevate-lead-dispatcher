import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Uma instância para a aplicação inteira: ela mantém o pool de conexões com o banco.
export const prisma = new PrismaClient({ adapter });
