// Envia um webhook de status assinado, como o call center faria. Para demonstração e testes manuais.
//
// Uso (com o docker compose no ar):
//   docker compose exec backend npm run webhook -- <lead_id> <status> [opções]
//
// Opções:
//   --at <ISO 8601>        data e hora do evento (padrão: agora)
//   --external-id <id>     id do lead no sistema do call center
//   --times <n>            envia a mesma requisição n vezes ao mesmo tempo (padrão: 1)
//   --url <url>            endereço da API (padrão: http://localhost:3000)
//
// O call center e o segredo são lidos do banco, a partir do lead.
import { parseArgs } from 'node:util';
import { prisma } from '../src/db';
import { signWebhook } from '../src/webhooks/signature';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    at: { type: 'string' },
    'external-id': { type: 'string' },
    times: { type: 'string', default: '1' },
    url: { type: 'string', default: 'http://localhost:3000' },
  },
});

const [leadId, status] = positionals;
if (!leadId || !status) {
  console.error('Uso: npm run webhook -- <lead_id> <status> [--at ISO] [--external-id id] [--times n] [--url url]');
  process.exit(1);
}

const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { call_center: true } });
await prisma.$disconnect();
if (!lead?.call_center) {
  console.error(`Lead ${leadId} não encontrado ou sem call center.`);
  process.exit(1);
}

const body = JSON.stringify({
  lead_id: leadId,
  external_id: values['external-id'],
  status,
  timestamp: values.at ?? new Date().toISOString(),
});
const timestamp = String(Math.floor(Date.now() / 1000));
const headers = {
  'Content-Type': 'application/json',
  'X-Call-Center': lead.call_center.slug,
  'X-Timestamp': timestamp,
  'X-Signature': signWebhook(lead.call_center.webhook_secret, timestamp, body),
};

console.log(`POST /api/webhooks/callcenter como ${lead.call_center.slug}: ${body}`);

// A mesma requisição, byte a byte, enviada várias vezes ao mesmo tempo (para demonstrar a idempotência).
const responses = await Promise.all(
  Array.from({ length: Number(values.times) }, () =>
    fetch(`${values.url}/api/webhooks/callcenter`, { method: 'POST', headers, body }),
  ),
);
for (const response of responses) {
  console.log(response.status, await response.text());
}
