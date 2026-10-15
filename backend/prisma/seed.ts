import bcrypt from 'bcryptjs';
import { prisma } from '../src/db';
import type { UserRole } from '../src/generated/prisma/client';

// Dados fictícios para desenvolvimento e avaliação. Senha e segredos abaixo valem só para uso local.
const DEV_PASSWORD = 'elevate123';

const products = [
  {
    slug: 'nutralean',
    name: 'NutraLean',
    funnels: [
      { slug: 'vsl-01', name: 'VSL 01' },
      { slug: 'quiz-01', name: 'Quiz 01' },
    ],
  },
  {
    slug: 'glucoshield',
    name: 'GlucoShield',
    funnels: [
      { slug: 'vsl-01', name: 'VSL 01' },
      { slug: 'tsl-01', name: 'TSL 01' },
    ],
  },
  {
    slug: 'restwell',
    name: 'RestWell',
    funnels: [{ slug: 'vsl-01', name: 'VSL 01' }],
  },
];

const callCenters = [
  { slug: 'cc-a', name: 'Call Center A', weight: 50, webhook_secret: 'dev-secret-cc-a' },
  { slug: 'cc-b', name: 'Call Center B', weight: 30, webhook_secret: 'dev-secret-cc-b' },
  { slug: 'cc-c', name: 'Call Center C', weight: 20, webhook_secret: 'dev-secret-cc-c' },
];

const users: { email: string; role: UserRole; call_center_slug?: string }[] = [
  { email: 'admin@elevate.test', role: 'ADMIN' },
  { email: 'operador.a@elevate.test', role: 'OPERATOR', call_center_slug: 'cc-a' },
  { email: 'operador.b@elevate.test', role: 'OPERATOR', call_center_slug: 'cc-b' },
  { email: 'operador.c@elevate.test', role: 'OPERATOR', call_center_slug: 'cc-c' },
];

// Todo upsert usa "update: {}": rodar o seed de novo não altera o que já existe,
// como pesos mudados pelo ADMIN. Por isso ele roda em toda subida do container.

for (const product of products) {
  const savedProduct = await prisma.product.upsert({
    where: { slug: product.slug },
    update: {},
    create: { slug: product.slug, name: product.name },
  });

  for (const funnel of product.funnels) {
    await prisma.funnel.upsert({
      where: { product_id_slug: { product_id: savedProduct.id, slug: funnel.slug } },
      update: {},
      create: { product_id: savedProduct.id, slug: funnel.slug, name: funnel.name },
    });
  }
}

for (const callCenter of callCenters) {
  await prisma.callCenter.upsert({
    where: { slug: callCenter.slug },
    update: {},
    create: callCenter,
  });
}

const password_hash = await bcrypt.hash(DEV_PASSWORD, 10);

for (const user of users) {
  const callCenter = user.call_center_slug
    ? await prisma.callCenter.findUniqueOrThrow({ where: { slug: user.call_center_slug } })
    : null;

  await prisma.user.upsert({
    where: { email: user.email },
    update: {},
    create: {
      email: user.email,
      password_hash,
      role: user.role,
      call_center_id: callCenter?.id ?? null,
    },
  });
}

await prisma.$disconnect();
console.log('Seed concluído');
