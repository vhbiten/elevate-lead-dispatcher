// Cliente da API. O front e a API ficam na mesma origem (nginx no Docker, proxy do Vite em
// desenvolvimento), então o cookie da sessão vai sozinho e o JavaScript nunca vê o token.

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; details?: { field: string; message: string }[] };

// Avisado quando a sessão expira no meio do uso: o App volta para o login.
export const SESSION_EXPIRED_EVENT = 'session-expired';

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    return { ok: false, status: 0, error: 'network_error' };
  }

  const body = await response.json().catch(() => ({}));
  if (response.ok) return { ok: true, data: body as T };

  if (response.status === 401 && path !== '/api/auth/login') {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  return { ok: false, status: response.status, error: body.error ?? 'request_failed', details: body.details };
}

// Monta a query string só com os filtros preenchidos.
export function toQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}
