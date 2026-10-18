import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { errorMessage, EVENT_SOURCE_LABELS, formatDateTime, REASON_LABELS, STATUS_LABELS } from '../format';
import type { LeadDetail, LeadStatus } from '../types';

const ALL_STATUSES = Object.keys(STATUS_LABELS) as LeadStatus[];

type Props = { leadId: string; onClose: () => void; onStatusChanged: () => void };

// Detalhe do lead: contato, rastreamento, distribuição e histórico de status, com a mudança de status pelo painel.
export function LeadDetailPanel({ leadId, onClose, onStatusChanged }: Props) {
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [newStatus, setNewStatus] = useState<LeadStatus | ''>('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function load() {
    const result = await api<{ data: LeadDetail }>(`/api/leads/${leadId}`);
    if (result.ok) setLead(result.data.data);
    else setNotFound(true);
  }

  useEffect(() => {
    setLead(null);
    setMessage(null);
    load();
  }, [leadId]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  async function changeStatus(event: FormEvent) {
    event.preventDefault();
    if (!newStatus) return;
    const result = await api<{ status: LeadStatus }>(`/api/leads/${leadId}/status`, { method: 'PATCH', body: { status: newStatus } });
    // A regra é decidida pela API; a tela só mostra o resultado. A tentativa barrada também entra no histórico.
    setMessage(
      result.ok
        ? { kind: 'ok', text: `Status alterado para ${STATUS_LABELS[newStatus]}.` }
        : { kind: 'error', text: errorMessage(result.error) },
    );
    setNewStatus('');
    await load();
    onStatusChanged();
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()} aria-label="Detalhe do lead">
        <button className="drawer-close" onClick={onClose} aria-label="Fechar">
          ×
        </button>

        {notFound && <p className="empty">Lead não encontrado.</p>}
        {!lead && !notFound && <p className="empty">Carregando…</p>}

        {lead && (
          <>
            <header className="drawer-header">
              <h2>{lead.name}</h2>
              <StatusBadge status={lead.status} />
            </header>

            <dl className="facts">
              <dt>E-mail</dt>
              <dd>{lead.email}</dd>
              <dt>Telefone</dt>
              <dd>{lead.phone}</dd>
              <dt>Produto</dt>
              <dd>
                {lead.product.name} · {lead.funnel.name}
              </dd>
              <dt>Recebido em</dt>
              <dd>{formatDateTime(lead.created_at)}</dd>
              <dt>Call center</dt>
              <dd>
                {lead.call_center?.name ?? '—'}
                {lead.distributions[0]?.external_id && <span className="muted"> · id externo {lead.distributions[0].external_id}</span>}
              </dd>
            </dl>

            <h3>Rastreamento</h3>
            <dl className="facts">
              <dt>Origem</dt>
              <dd>{lead.source ?? '—'}</dd>
              <dt>Campanha</dt>
              <dd>{lead.campaign ?? '—'}</dd>
              <dt>Afiliado</dt>
              <dd>{lead.affiliate?.code ?? '—'}</dd>
              <dt>UTM</dt>
              <dd className="utm">
                {(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const).map((key) => (
                  <span key={key}>
                    <span className="muted">{key.replace('utm_', '')}</span> {lead[key] ?? '—'}
                  </span>
                ))}
              </dd>
            </dl>

            <h3>Mudar status</h3>
            <form className="status-form" onSubmit={changeStatus}>
              <select value={newStatus} onChange={(event) => setNewStatus(event.target.value as LeadStatus)}>
                <option value="">Escolha o novo status</option>
                {ALL_STATUSES.filter((status) => status !== lead.status && status !== 'new').map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
              <button className="button primary" type="submit" disabled={!newStatus}>
                Salvar
              </button>
            </form>
            {message && <p className={message.kind === 'ok' ? 'form-ok' : 'form-error'}>{message.text}</p>}

            <h3>Histórico</h3>
            <ol className="timeline">
              {lead.status_events.map((event, index) => (
                <li key={index} className={event.applied ? 'applied' : 'not-applied'}>
                  <div className="timeline-head">
                    <strong>{STATUS_LABELS[event.status]}</strong>
                    <span className="muted">{formatDateTime(event.occurred_at)}</span>
                  </div>
                  <div className="timeline-meta">
                    {EVENT_SOURCE_LABELS[event.source]}
                    {event.call_center && ` · ${event.call_center.slug}`}
                    {event.user && ` · ${event.user.email}`}
                    {event.external_id && ` · id externo ${event.external_id}`}
                  </div>
                  {!event.applied && event.reason && (
                    <div className="timeline-reason">Não aplicado: {REASON_LABELS[event.reason]}</div>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </aside>
    </div>
  );
}
