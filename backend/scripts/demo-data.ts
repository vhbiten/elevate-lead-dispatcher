// Gera dados de demonstração passando pela API de verdade: os leads entram por POST /api/leads
// (e passam pelo dispatcher) e os status chegam por webhooks assinados, como num dia de operação.
//
// Uso (com o docker compose no ar):
//   docker compose exec backend npm run demo
//
// Opções:
//   --leads <n>   quantos leads enviar (padrão: 40)
//   --url <url>   endereço da API (padrão: http://localhost:3000)
import { parseArgs } from 'node:util';
import { prisma } from '../src/db';
import { signWebhook } from '../src/webhooks/signature';

const { values } = parseArgs({
  options: {
    leads: { type: 'string', default: '40' },
    url: { type: 'string', default: 'http://localhost:3000' },
  },
});

const FIRST_NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabriela', 'Heitor', 'Isabela', 'João', 'Larissa', 'Marcos'];
const LAST_NAMES = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Pereira', 'Costa', 'Almeida'];
const OFFERS = [
  { product: 'nutralean', funnel: 'vsl-01' },
  { product: 'nutralean', funnel: 'quiz-01' },
  { product: 'glucoshield', funnel: 'vsl-01' },
  { product: 'glucoshield', funnel: 'tsl-01' },
  { product: 'restwell', funnel: 'vsl-01' },
];
const SOURCES = ['facebook', 'google', 'tiktok', 'youtube'];

// Caminhos possíveis de um lead no call center; o último status é onde ele para.
const JOURNEYS = [
  [],
  ['contacted'],
  ['no_answer', 'no_answer'],
  ['contacted', 'callback'],
  ['contacted', 'qualified'],
  ['contacted', 'qualified', 'sale'],
  ['contacted', 'sale', 'refund'],
  ['invalid'],
];

function pick<T>(list: T[], index: number): T {
  return list[index % list.length];
}

async function post(path: string, body: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${values.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  return { status: response.status, body: await response.json() };
}

const total = Number(values.leads);
const runId = Date.now().toString(36);
const leadIds: string[] = [];

for (let i = 0; i < total; i++) {
  const offer = pick(OFFERS, i * 7 + 3);
  const source = pick(SOURCES, i * 5 + 1);
  const name = `${pick(FIRST_NAMES, i * 3)} ${pick(LAST_NAMES, i * 5 + 2)}`;
  const response = await post(
    '/api/leads',
    JSON.stringify({
      name,
      email: `demo-${runId}-${i}@exemplo.com`,
      phone: `+55119${String(10000000 + i * 7919).slice(0, 8)}`,
      ...offer,
      affiliate_id: String(900 + (i % 6)),
      utm: { source, medium: 'cpc', campaign: `${offer.product}-${source}`, content: `ad-${(i % 4) + 1}` },
    }),
  );
  if (response.status !== 201) throw new Error(`lead ${i}: ${response.status} ${JSON.stringify(response.body)}`);
  const leadId: string = response.body.lead_id;
  leadIds.push(leadId);

  // Espalha os leads pelos últimos 7 dias (um quarto deles nas últimas horas), para o painel e o filtro
  // de período terem o que mostrar. É um ajuste direto no banco, só para demonstração.
  const minutesAgo = i < total / 4 ? 10 + i * 7 : 60 + ((i * 1373) % (7 * 24 * 60));
  const createdAt = new Date(Date.now() - minutesAgo * 60 * 1000);
  await prisma.$transaction([
    prisma.lead.update({ where: { id: leadId }, data: { created_at: createdAt, status_updated_at: createdAt } }),
    prisma.leadStatusEvent.updateMany({ where: { lead_id: leadId, source: 'system' }, data: { occurred_at: createdAt } }),
    prisma.distribution.updateMany({ where: { lead_id: leadId }, data: { distributed_at: createdAt } }),
  ]);
}
console.log(`${leadIds.length} leads enviados`);

let events = 0;
for (const [index, leadId] of leadIds.entries()) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { call_center: true } });
  const callCenter = lead.call_center!;
  const journey = pick(JOURNEYS, index * 3 + 1);

  // Os passos ficam entre a criação do lead e agora, no máximo 30 minutos um do outro.
  const interval = Math.min(30 * 60 * 1000, (Date.now() - lead.created_at.getTime()) / (journey.length + 1));
  for (const [step, status] of journey.entries()) {
    const occurredAt = new Date(lead.created_at.getTime() + (step + 1) * interval).toISOString();
    const body = JSON.stringify({ lead_id: leadId, external_id: `${callCenter.slug.toUpperCase()}-${1000 + index}`, status, timestamp: occurredAt });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await post('/api/webhooks/callcenter', body, {
      'X-Call-Center': callCenter.slug,
      'X-Timestamp': timestamp,
      'X-Signature': signWebhook(callCenter.webhook_secret, timestamp, body),
    });
    if (response.status !== 200) throw new Error(`webhook: ${response.status} ${JSON.stringify(response.body)}`);
    events++;
  }
}
console.log(`${events} webhooks de status enviados`);
await prisma.$disconnect();
