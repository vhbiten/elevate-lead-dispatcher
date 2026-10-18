// Formatos das respostas da API (docs/spec.md, seção 12).

export type LeadStatus = 'new' | 'contacted' | 'no_answer' | 'callback' | 'qualified' | 'sale' | 'refund' | 'invalid';

type Named = { slug: string; name: string };

export type User = {
  id: number;
  email: string;
  role: 'ADMIN' | 'OPERATOR';
  call_center: Named | null;
};

export type LeadRow = {
  id: string;
  name: string;
  source: string | null;
  status: LeadStatus;
  created_at: string;
  product: Named;
  funnel: Named;
  call_center: Named | null;
};

export type Pagination = { page: number; page_size: number; total: number; total_pages: number };

export type StatusEvent = {
  status: LeadStatus;
  occurred_at: string;
  received_at: string;
  source: 'system' | 'webhook' | 'panel';
  applied: boolean;
  reason: 'stale' | 'invalid_transition' | null;
  external_id: string | null;
  call_center: { slug: string } | null;
  user: { email: string } | null;
};

export type LeadDetail = {
  id: string;
  name: string;
  email: string;
  phone: string;
  source: string | null;
  campaign: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  status: LeadStatus;
  status_updated_at: string;
  created_at: string;
  product: Named;
  funnel: Named;
  affiliate: { code: string } | null;
  call_center: Named | null;
  distributions: { distributed_at: string; external_id: string | null; call_center: Named }[];
  status_events: StatusEvent[];
};

export type Options = {
  products: (Named & { funnels: Named[] })[];
  call_centers: Named[];
  statuses: LeadStatus[];
};

export type Metrics = {
  total: number;
  today: number;
  distributed: number;
  pending: number;
  sales: number;
  conversion_rate: number;
};

export type CallCenterOverview = Named & {
  weight: number;
  active: boolean;
  assigned_count: number;
  total_leads: number;
  target_share: number;
  actual_share: number;
};
