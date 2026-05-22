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
  constructor(status, body, url) {
    const msg = typeof body === 'string' ? body : (body?.error || body?.message || `HTTP ${status}`);
    super(`${status} ${msg} (${url})`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

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

  const init = { method, credentials: 'include' };
  if (multipart) {
    init.body = multipart;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) throw new ApiError(res.status, payload, url);
  return payload;
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  delete: (path) => request('DELETE', path),

  /**
   * Upload multipart per file. `resource` ∈ 'concorso' | 'commissario' | 'candidato'.
   * Ritorna { url, filename, sizeBytes, mimeType }.
   */
  upload: (resource, id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', `/api/upload/${resource}/${id}`, { multipart: fd });
  },

  /**
   * SSE subscription. Ritorna una funzione di unsubscribe.
   * onMessage riceve l'oggetto JSON pubblicato dal backend via NOTIFY.
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
   */
  fileUrl(path) {
    if (!path) return null;
    return path.startsWith('http') || path.startsWith('/') ? path : `/${path}`;
  },
};

export { API_BASE };
