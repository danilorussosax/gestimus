// REST client per il backend Gestimus (Postgres+Fastify).
// Sostituisce il vecchio client PocketBase (js/pb.js).
//
// Convenzione:
// - Tutti i path sono relativi al dominio corrente (subdomain risolve il tenant lato server).
// - I cookie di sessione sono inviati automaticamente con `credentials: 'include'`.
// - Le date arrivano come stringhe ISO; chi le mostra può fare new Date(...).
// - I campi sono in camelCase (così come ritornati dal backend Drizzle).

const API_BASE = '/api';

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {any} body
   * @param {string} url
   */
  constructor(status, body, url) {
    const msg = typeof body === 'string' ? body : (body?.error || body?.message || `HTTP ${status}`);
    super(`${status} ${msg} (${url})`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

// M9: timeout per richiesta + retry con backoff su errori transitori.
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2; // 1 tentativo + 2 retry
const RETRY_BASE_MS = 400;
// Solo i metodi idempotenti vengono ritentati: ripetere una POST non-idempotente
// rischia doppie scritture.
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE']);

/**
 * @param {string} method
 * @param {string} path
 * @param {{ body?: any, query?: Record<string, any>, multipart?: FormData }} [opts]
 */
async function request(method, path, { body, query, multipart } = {}) {
  let url = path.startsWith('/') ? path : `${API_BASE}/${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v == null || v === '') continue;
      qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }

  /** @type {RequestInit} */
  const init = { method, credentials: 'include' };
  if (multipart) {
    init.body = multipart;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  const canRetry = IDEMPOTENT.has(method) && !multipart;
  let lastErr;
  for (let attempt = 0; attempt <= (canRetry ? MAX_RETRIES : 0); attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 204) return null;
      const ct = res.headers.get('content-type') || '';
      const payload = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
      if (!res.ok) {
        // Retry solo su 502/503/504 (transitori), non su 4xx (errori client).
        if (canRetry && [502, 503, 504].includes(res.status) && attempt < MAX_RETRIES) {
          lastErr = new ApiError(res.status, payload, url);
          await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
          continue;
        }
        throw new ApiError(res.status, payload, url);
      }
      return payload;
    } catch (err) {
      clearTimeout(timer);
      // Errori di rete / abort (timeout) sono ritentabili sui metodi idempotenti.
      const isNetwork = (/** @type {any} */ (err))?.name === 'AbortError' || err instanceof TypeError;
      if (canRetry && isNetwork && attempt < MAX_RETRIES) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export const api = {
  /** @param {string} path @param {Record<string, any>} [query] */
  get: (path, query) => request('GET', path, { query }),
  /** @param {string} path @param {any} [body] */
  post: (path, body) => request('POST', path, { body }),
  /** @param {string} path @param {any} [body] */
  patch: (path, body) => request('PATCH', path, { body }),
  /** @param {string} path @param {any} [body] */
  put: (path, body) => request('PUT', path, { body }),
  /** @param {string} path */
  delete: (path) => request('DELETE', path),

  /**
   * Upload multipart per file. `resource` ∈ 'concorso' | 'commissario' | 'candidato'.
   * Ritorna { url, filename, sizeBytes, mimeType }.
   * @param {string} resource @param {string} id @param {Blob} file
   */
  upload: (resource, id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', `/api/upload/${resource}/${id}`, { multipart: fd });
  },

  /**
   * SSE subscription. Ritorna una funzione di unsubscribe.
   * onMessage riceve l'oggetto JSON pubblicato dal backend via NOTIFY.
   * @param {string} path
   * @param {(data: any) => void} onMessage
   * @param {((this: EventSource, ev: Event) => any) | null} [onError]
   */
  subscribe(path, onMessage, onError) {
    const url = path.startsWith('/') ? path : `${API_BASE}/${path}`;
    const es = new EventSource(url, { withCredentials: true });
    es.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { data = ev.data; }
      onMessage(data);
    };
    if (onError) es.onerror = onError;
    return () => es.close();
  },

  /**
   * Helper: ritorna l'URL pubblico di un file caricato (servito da nginx/Caddy).
   * @param {string} path
   */
  fileUrl(path) {
    if (!path) return null;
    return path.startsWith('http') || path.startsWith('/') ? path : `/${path}`;
  },
};

export { API_BASE };
