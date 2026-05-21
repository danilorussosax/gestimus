// PocketBase client wrapper, used for migration from localStorage and (later) runtime sync.
import PocketBase from 'https://cdn.jsdelivr.net/npm/pocketbase@0.21.5/+esm';

export const PB_URL = (() => {
  // Allow override via ?pb=URL query param or window.PB_URL
  const u = new URL(window.location.href);
  const q = u.searchParams.get('pb');
  if (q) return q.replace(/\/$/, '');
  if (typeof window.PB_URL === 'string') return window.PB_URL.replace(/\/$/, '');
  // Use same origin: in production Caddy proxies /api/* to PB,
  // in development with Caddy multitenant the same applies.
  // Fallback per sviluppo diretto (npm start senza Caddy): ?pb=...
  return `${location.protocol}//${location.host}`;
})();

export const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

export async function pbHealthy() {
  try {
    const res = await fetch(`${PB_URL}/api/health`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pbCounts() {
  const counts = {};
  for (const name of ['concorsi','commissari','candidati','fasi','candidati_fase','valutazioni']) {
    try {
      const list = await pb.collection(name).getList(1, 1);
      counts[name] = list.totalItems;
    } catch (e) {
      counts[name] = -1; // collection missing or unreachable
    }
  }
  return counts;
}

export function dataURLToBlob(dataURL) {
  if (!dataURL || typeof dataURL !== 'string' || !dataURL.startsWith('data:')) return null;
  const [meta, b64] = dataURL.split(',');
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function fileURL(record, fileName) {
  if (!record || !fileName) return null;
  // Prefer SDK helper if available (varies across versions: getURL vs getUrl).
  if (pb.files?.getURL) return pb.files.getURL(record, fileName);
  if (pb.files?.getUrl) return pb.files.getUrl(record, fileName);
  if (pb.getFileUrl)    return pb.getFileUrl(record, fileName);
  // Fallback: construct manually using PB's stable URL pattern.
  return `${PB_URL}/api/files/${record.collectionId}/${record.id}/${encodeURIComponent(fileName)}`;
}
