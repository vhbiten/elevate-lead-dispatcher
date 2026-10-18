import { useEffect, useState } from 'react';
import { api } from '../api';
import { errorMessage, formatNumber, formatPercent } from '../format';
import type { CallCenterOverview } from '../types';

type Draft = { weight: string; active: boolean };

// Distribuição (docs/spec.md, seção 11): a parte configurada e a parte real de cada call center, e a edição.
export function DispatcherPage() {
  const [callCenters, setCallCenters] = useState<CallCenterOverview[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  function show(list: CallCenterOverview[]) {
    setCallCenters(list);
    setDrafts(Object.fromEntries(list.map((cc) => [cc.slug, { weight: String(cc.weight), active: cc.active }])));
  }

  useEffect(() => {
    api<{ call_centers: CallCenterOverview[] }>('/api/dispatcher').then((result) => result.ok && show(result.data.call_centers));
  }, []);

  function edit(slug: string, change: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [slug]: { ...current[slug], ...change } }));
    setMessage(null);
  }

  const changed = callCenters.some(
    (cc) => drafts[cc.slug] && (drafts[cc.slug].weight !== String(cc.weight) || drafts[cc.slug].active !== cc.active),
  );

  async function save() {
    setSaving(true);
    const body = {
      call_centers: callCenters.map((cc) => ({ slug: cc.slug, weight: Number(drafts[cc.slug].weight), active: drafts[cc.slug].active })),
    };
    const result = await api<{ call_centers: CallCenterOverview[] }>('/api/dispatcher', { method: 'PUT', body });
    setSaving(false);
    if (result.ok) {
      show(result.data.call_centers);
      setMessage({ kind: 'ok', text: 'Configuração salva. Os contadores recomeçaram do zero.' });
    } else {
      setMessage({ kind: 'error', text: result.status === 400 ? 'Use pesos inteiros entre 0 e 1000.' : errorMessage(result.error) });
    }
  }

  const assignedTotal = callCenters.reduce((sum, cc) => sum + cc.assigned_count, 0);

  return (
    <section>
      <h1 className="page-title">Distribuição</h1>
      <p className="page-intro">
        Cada lead novo vai para o call center mais atrasado em relação à sua parte. Salvar uma configuração zera os contadores, e a
        nova proporção vale dali em diante.
      </p>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Call center</th>
              <th>Ativo</th>
              <th>Peso</th>
              <th>Parte configurada × parte real</th>
              <th className="number">Recebidos desde a última mudança</th>
              <th className="number">Total de leads</th>
            </tr>
          </thead>
          <tbody>
            {callCenters.map((cc) => (
              <tr key={cc.slug} className={cc.active ? '' : 'inactive'}>
                <td className="strong">{cc.name}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={drafts[cc.slug]?.active ?? cc.active}
                    onChange={(event) => edit(cc.slug, { active: event.target.checked })}
                    aria-label={`${cc.name} ativo`}
                  />
                </td>
                <td>
                  <input
                    className="weight-input"
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    value={drafts[cc.slug]?.weight ?? cc.weight}
                    onChange={(event) => edit(cc.slug, { weight: event.target.value })}
                    aria-label={`Peso de ${cc.name}`}
                  />
                </td>
                <td>
                  <ShareBars target={cc.target_share} actual={cc.actual_share} hasData={assignedTotal > 0} />
                </td>
                <td className="number">{formatNumber(cc.assigned_count)}</td>
                <td className="number">{formatNumber(cc.total_leads)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="actions">
        {message && <p className={message.kind === 'ok' ? 'form-ok' : 'form-error'}>{message.text}</p>}
        <button className="button primary" onClick={save} disabled={!changed || saving}>
          {saving ? 'Salvando…' : 'Salvar configuração'}
        </button>
      </div>
    </section>
  );
}

// Duas barras, uma sobre a outra: o que foi configurado e o que de fato aconteceu.
function ShareBars({ target, actual, hasData }: { target: number; actual: number; hasData: boolean }) {
  return (
    <div className="shares">
      <div className="share-row">
        <span className="share-label">configurada</span>
        <span className="share-track">
          <span className="share-bar target" style={{ width: `${target * 100}%` }} />
        </span>
        <span className="share-value">{formatPercent(target)}</span>
      </div>
      <div className="share-row">
        <span className="share-label">real</span>
        <span className="share-track">
          <span className="share-bar actual" style={{ width: `${actual * 100}%` }} />
        </span>
        <span className="share-value">{hasData ? formatPercent(actual) : '—'}</span>
      </div>
    </div>
  );
}
