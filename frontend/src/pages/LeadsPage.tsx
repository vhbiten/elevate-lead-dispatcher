import { useEffect, useState } from 'react';
import { api, toQuery } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, formatNumber, STATUS_LABELS } from '../format';
import type { LeadRow, Options, Pagination, User } from '../types';
import { LeadDetailPanel } from './LeadDetailPanel';

type Filters = {
  from: string;
  to: string;
  product: string;
  funnel: string;
  source: string;
  call_center: string;
  status: string;
};

const EMPTY_FILTERS: Filters = { from: '', to: '', product: '', funnel: '', source: '', call_center: '', status: '' };

// Tabela de leads (docs/spec.md, seção 11). Filtro e página vão para a API: o navegador só recebe a página atual.
export function LeadsPage({ user }: { user: User }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Muda quando um status é alterado no detalhe, para a tabela recarregar.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<Options>('/api/options').then((result) => result.ok && setOptions(result.data));
  }, []);

  useEffect(() => {
    api<{ data: LeadRow[]; pagination: Pagination }>(`/api/leads${toQuery({ ...filters, page })}`).then((result) => {
      if (!result.ok) return;
      setLeads(result.data.data);
      setPagination(result.data.pagination);
    });
  }, [filters, page, version]);

  function changeFilter(name: keyof Filters, value: string) {
    // Trocar de produto limpa o funil, que pertence ao produto.
    setFilters((current) => ({ ...current, [name]: value, ...(name === 'product' ? { funnel: '' } : {}) }));
    setPage(1);
  }

  const funnels = options?.products.find((product) => product.slug === filters.product)?.funnels ?? [];
  const isAdmin = user.role === 'ADMIN';

  return (
    <section>
      <h1 className="page-title">
        Leads{!isAdmin && <span className="page-scope"> · {user.call_center?.name}</span>}
      </h1>

      <div className="filters">
        <label>
          De
          <input type="date" value={filters.from} onChange={(event) => changeFilter('from', event.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={filters.to} onChange={(event) => changeFilter('to', event.target.value)} />
        </label>
        <label>
          Produto
          <select value={filters.product} onChange={(event) => changeFilter('product', event.target.value)}>
            <option value="">Todos</option>
            {options?.products.map((product) => (
              <option key={product.slug} value={product.slug}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Funil
          <select value={filters.funnel} onChange={(event) => changeFilter('funnel', event.target.value)} disabled={!filters.product}>
            <option value="">Todos</option>
            {funnels.map((funnel) => (
              <option key={funnel.slug} value={funnel.slug}>
                {funnel.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Origem
          <input
            type="text"
            placeholder="ex.: facebook"
            value={filters.source}
            onChange={(event) => changeFilter('source', event.target.value.trim())}
          />
        </label>
        {isAdmin && (
          <label>
            Call center
            <select value={filters.call_center} onChange={(event) => changeFilter('call_center', event.target.value)}>
              <option value="">Todos</option>
              {options?.call_centers.map((callCenter) => (
                <option key={callCenter.slug} value={callCenter.slug}>
                  {callCenter.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Status
          <select value={filters.status} onChange={(event) => changeFilter('status', event.target.value)}>
            <option value="">Todos</option>
            {options?.statuses.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button ghost"
          onClick={() => {
            setFilters(EMPTY_FILTERS);
            setPage(1);
          }}
        >
          Limpar
        </button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Produto</th>
              <th>Funil</th>
              <th>Origem</th>
              <th>Call center</th>
              <th>Status</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="clickable" onClick={() => setSelectedId(lead.id)}>
                <td className="strong">{lead.name}</td>
                <td>{lead.product.name}</td>
                <td>{lead.funnel.name}</td>
                <td>{lead.source ?? '—'}</td>
                <td>{lead.call_center?.name ?? '—'}</td>
                <td>
                  <StatusBadge status={lead.status} />
                </td>
                <td className="nowrap muted">{formatDateTime(lead.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pagination && leads.length === 0 && <p className="empty">Nenhum lead com esses filtros.</p>}
      </div>

      {pagination && pagination.total > 0 && (
        <div className="pager">
          <span className="muted">
            {formatNumber(pagination.total)} leads · página {pagination.page} de {pagination.total_pages}
          </span>
          <div className="pager-buttons">
            <button className="button ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <button className="button ghost" disabled={page >= pagination.total_pages} onClick={() => setPage(page + 1)}>
              Próxima
            </button>
          </div>
        </div>
      )}

      {selectedId && (
        <LeadDetailPanel
          leadId={selectedId}
          onClose={() => setSelectedId(null)}
          onStatusChanged={() => setVersion((current) => current + 1)}
        />
      )}
    </section>
  );
}
