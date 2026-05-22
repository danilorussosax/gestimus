// pb.js — stub di compatibilità.
// Il backend non è più PocketBase ma Postgres+Fastify. Il client PB è stato
// rimosso e sostituito da js/api.js. Tutti gli usi diretti di `pb.*` nelle view
// vanno migrati a `api` da './api.js' o ai metodi di `db` esposti da './db.js'.
//
// Questi export mantengono solo i nomi più usati come stub no-op per non
// rompere import residuali durante la migrazione. Saranno rimossi alla fine
// della Fase 5.

import { api } from './api.js';

export const PB_URL = '/api';

export async function pbHealthy() {
  try {
    const res = await fetch('/healthz', { credentials: 'include' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Nel nuovo backend i campi file (logo/foto) sono già URL relativi tipo
 * `/uploads/<tenant>/<resource>/<id>/<filename>`. Ritorniamo direttamente quello.
 */
export function fileURL(_record, filenameOrUrl) {
  if (!filenameOrUrl || typeof filenameOrUrl !== 'string') return null;
  if (filenameOrUrl.startsWith('/') || filenameOrUrl.startsWith('http')) return filenameOrUrl;
  return null;
}

export function dataURLToBlob(dataURL) {
  if (!dataURL || typeof dataURL !== 'string' || !dataURL.startsWith('data:')) return null;
  const [meta, b64] = dataURL.split(',');
  if (!b64) return null;
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * Stub `pb.authStore`. Le view che leggono `pb.authStore.model.role` o
 * `pb.authStore.isValid` continuano a funzionare; per popolarlo si chiama
 * `refreshAuth()` (lo fa `db.init()` automaticamente).
 */
let cachedMe = null;
export const pb = {
  authStore: {
    get isValid() {
      return !!cachedMe;
    },
    get model() {
      return cachedMe;
    },
    clear() {
      cachedMe = null;
    },
  },
};

export async function refreshAuth() {
  try {
    cachedMe = await api.get('/auth/me');
  } catch {
    cachedMe = null;
  }
  return cachedMe;
}
