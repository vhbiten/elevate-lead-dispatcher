import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import type { SessionUser } from './session';

// Hash de uma senha qualquer, com o mesmo custo do seed. Com um e-mail que não existe, o bcrypt roda
// do mesmo jeito, e o tempo de resposta não revela quais e-mails estão cadastrados.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) return null;
  return { id: user.id, role: user.role, call_center_id: user.call_center_id };
}

// Dados do usuário para a tela. Nunca inclui o hash da senha.
export async function getProfile(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, call_center: { select: { slug: true, name: true } } },
  });
}
