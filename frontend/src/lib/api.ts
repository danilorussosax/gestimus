import i18n from 'i18next';
import type { ApiError } from '@/types';

// =============================================================================
// Client HTTP — backend Fastify Gestimus.
//
// Divergenza chiave rispetto allo stack Cadenza (JWT Bearer): Gestimus usa
// SESSIONI CON COOKIE HttpOnly (@fastify/cookie). Quindi:
//   - niente token in localStorage, niente header Authorization;
//   - `credentials: 'include'` su ogni fetch così il cookie di sessione viaggia;
//   - il bootstrap dell'utente avviene via GET /auth/me (vedi AuthContext).
//
// Routing path:
//   - i path che iniziano con '/' sono usati verbatim (es. '/auth/login',
//     '/api/valutazioni'): il backend monta l'auth su /auth e i dati su /api;
//   - i path senza '/' iniziale vengono prefissati con API_BASE ('/api').
// =============================================================================

const API_BASE = '/api';

export class HttpError extends Error {
  status: number;
  payload: ApiError;

  constructor(status: number, payload: ApiError) {
    super(payload.error ?? payload.message ?? `Errore HTTP ${status}`);
    this.status = status;
    this.payload = payload;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, unknown>;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const base = path.startsWith('/') ? path : `${API_BASE}/${path}`;
  const url = new URL(base, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        url.searchParams.set(k, String(v));
      }
    }
  }
  // strip origin così il dev proxy di Vite continua a funzionare
  return url.pathname + url.search;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = opts;
  const finalHeaders = new Headers(headers);

  if (body !== undefined && !(body instanceof FormData)) {
    finalHeaders.set('Content-Type', 'application/json');
  }

  const res = await fetch(buildUrl(path, query), {
    ...rest,
    credentials: 'include', // cookie di sessione
    headers: finalHeaders,
    body:
      body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const payload: ApiError = (data as ApiError | null) ?? { error: `Errore HTTP ${res.status}` };
    if (res.status === 401) {
      // Sessione assente/scaduta/revocata: segnala via evento custom.
      // AuthProvider ascolta 'auth:expired' e forza unmount + redirect /login.
      window.dispatchEvent(new CustomEvent('auth:expired', { detail: { code: payload.code } }));
    }
    throw new HttpError(res.status, payload);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Helper REST tipizzati sopra `api()`. Comodo per i moduli src/api/*. */
export const http = {
  get: <T = unknown>(path: string, query?: RequestOptions['query']) =>
    api<T>(path, { method: 'GET', query }),
  post: <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body }),
  patch: <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body }),
  put: <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body }),
  del: <T = unknown>(path: string) => api<T>(path, { method: 'DELETE' }),
  /** Upload multipart su /api/upload/{resource}/{id}. */
  upload: <T = unknown>(resource: string, id: string, file: Blob, field = 'file') => {
    const fd = new FormData();
    fd.append(field, file);
    return api<T>(`/api/upload/${resource}/${id}`, { method: 'POST', body: fd });
  },
};

/** URL assoluto per un asset servito dal backend (foto/loghi/allegati). */
export function fileUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return path.startsWith('/') ? path : `/${path}`;
}

const GENERIC_CODES_WITH_DETAILS = new Set(['VALIDATION_FAILED', 'BAD_REQUEST']);

/** Risolve un errore HTTP in una stringa localizzata (code → i18n, con fallback). */
export const httpErrorMessage = (err: unknown): string => {
  if (err instanceof HttpError) {
    const code = err.payload.code;
    if (code && GENERIC_CODES_WITH_DETAILS.has(code)) {
      if (err.payload.issues?.length) return err.payload.issues.join(' · ');
      if (err.payload.error) return err.payload.error;
    }
    if (code) {
      const key = `errors.code.${code}`;
      const translated = i18n.t(key);
      if (translated && translated !== key) return translated;
    }
    if (err.payload.details?.length) {
      return err.payload.details.map((d) => d.message).join(' · ');
    }
    return err.payload.error ?? err.payload.message ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return i18n.t('errors.generic');
};
