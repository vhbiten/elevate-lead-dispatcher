import type { LeadStatus, StatusEvent } from './types';

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Novo',
  contacted: 'Contatado',
  no_answer: 'Sem resposta',
  callback: 'Retornar',
  qualified: 'Qualificado',
  sale: 'Venda',
  refund: 'Reembolso',
  invalid: 'Inválido',
};

export const EVENT_SOURCE_LABELS: Record<StatusEvent['source'], string> = {
  system: 'Sistema',
  webhook: 'Call center',
  panel: 'Painel',
};

// Por que um evento não mudou o status (docs/spec.md, seção 9).
export const REASON_LABELS: Record<string, string> = {
  stale: 'chegou fora de ordem (mais antigo que o status atual)',
  invalid_transition: 'transição não permitida',
};

// Mensagens dos erros que a API devolve para as ações do painel.
export const ERROR_LABELS: Record<string, string> = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  rate_limited: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  invalid_transition: 'Essa mudança de status não é permitida a partir do status atual.',
  stale: 'O status foi atualizado por um evento mais recente.',
  no_active_call_center: 'Deixe pelo menos um call center ativo com peso maior que zero.',
  network_error: 'Sem conexão com a API.',
};

export function errorMessage(error: string): string {
  return ERROR_LABELS[error] ?? 'Algo deu errado. Tente de novo.';
}

// Datas sempre no fuso do negócio, independente do fuso de quem abre o painel.
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR');
}

export function formatPercent(share: number): string {
  return `${(share * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
