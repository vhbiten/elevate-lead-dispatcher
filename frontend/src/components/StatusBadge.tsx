import { STATUS_LABELS } from '../format';
import type { LeadStatus } from '../types';

// A cor diz em que fase o lead está: novo, em trabalho, venda ou encerrado.
export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>;
}
