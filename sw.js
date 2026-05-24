// Service Worker — strategia ibrida.
// - Asset statici (HTML/CSS/JS/immagini): cache-first con revalidate (stale-while-revalidate).
// - API (qualunque cosa sotto /api/): network-only (mai cache — i dati sono live).
// - Navigation fallback: serve index.html dalla cache se offline.

const VERSION = 'gc-v12';
const STATIC_CACHE = `static-${VERSION}`;
const PRECACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/api.js',
  './js/utils.js',
  './js/scoring.js',
  './js/palette.js',
  './js/views/home.js',
  './js/views/login.js',
  './js/views/iscrizione.js',
  './js/views/privacy.js',
  './js/views/admin.js',
  './js/views/commissario.js',
  './logo.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE).catch(() => {/* tolerant */}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Svuota TUTTE le cache di versioni precedenti.
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // N142: NON forzare il reload (c.navigate) — farebbe perdere form non
    // salvati (candidato, import CSV, verbale, voti). Notifichiamo le tab; il
    // client mostra un avviso non bloccante e l'utente ricarica quando ha
    // salvato. Il nuovo JS è comunque servito network-first al prossimo refresh.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      try { c.postMessage({ type: 'SW_UPDATED', version: VERSION }); } catch { /* noop */ }
    }
  })());
});

function isApi(url) {
  // Backend Fastify same-origin sotto /api/. /_/ tollerato per asset privati.
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/_/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // mutazioni: lasciamo fare alla rete
  const url = new URL(req.url);

  // API: mai dalla cache. La auth filtra server-side, quindi servire risposte
  // cached produrrebbe stato stale per ruolo.
  if (isApi(url)) return;

  // Solo same-origin per assets; CDN cross-origin (Tailwind/jspdf) cache-first
  if (url.origin !== self.location.origin) {
    // Tailwind/jspdf/etc da CDN: cache-first con fallback rete
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch { return hit || Response.error(); }
      })
    );
    return;
  }

  // Navigation: HTML → network-first per cogliere i deploy, fallback offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        // R15: coerente con la strategia JS (M215) — una risposta non-ok
        // (500/502 dal server, non un errore di rete) NON va servita come
        // pagina: preferisci la shell in cache.
        if (res.ok) return res;
        return (await caches.match('./index.html')) || res;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Moduli JavaScript: network-first per evitare di servire vecchi bundle dopo deploy.
  // Se offline, fallback alla cache.
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            cache.put(req, res.clone());
            return res;
          }
          // M215: risposta non-ok (es. 500/404 HTML) → preferisci la versione in
          // cache invece di servire un bundle JS rotto; se non c'è, ritorna res.
          return (await cache.match(req)) || res;
        } catch {
          return (await cache.match(req)) || Response.error();
        }
      })
    );
    return;
  }

  // Altri asset statici (CSS, immagini, font, manifest): stale-while-revalidate
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const fetchPromise = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fetchPromise;
    })
  );
});
