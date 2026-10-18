import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatNumber, formatPercent } from '../format';
import type { Metrics } from '../types';

// Números do ADMIN (docs/spec.md, seção 11).
export function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<Metrics>('/api/metrics').then((result) => (result.ok ? setMetrics(result.data) : setFailed(true)));
  }, []);

  if (failed) return <p className="empty">Não foi possível carregar os números.</p>;
  if (!metrics) return <p className="empty">Carregando…</p>;

  const cards = [
    { label: 'Total de leads', value: formatNumber(metrics.total) },
    { label: 'Leads hoje', value: formatNumber(metrics.today), hint: 'desde 00h00, horário de Brasília' },
    { label: 'Distribuídos', value: formatNumber(metrics.distributed), hint: 'com call center atribuído' },
    { label: 'Pendentes', value: formatNumber(metrics.pending), hint: 'status novo: ninguém trabalhou ainda' },
    { label: 'Vendas', value: formatNumber(metrics.sales), hint: 'status atual venda' },
    { label: 'Taxa de conversão', value: formatPercent(metrics.conversion_rate), hint: 'vendas ÷ total de leads' },
  ];

  return (
    <section>
      <h1 className="page-title">Painel</h1>
      <div className="metrics">
        {cards.map((card) => (
          <div key={card.label} className="metric">
            <span className="metric-label">{card.label}</span>
            <span className="metric-value">{card.value}</span>
            {card.hint && <span className="metric-hint">{card.hint}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
