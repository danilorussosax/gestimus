// Service Worker — strategia ibrida.
// - Asset statici (HTML/CSS/JS/immagini): cache-first con revalidate (stale-while-revalidate).
// - API PocketBase (qualunque cosa con :8090 o /api/): network-only (mai cache — i dati sono live).
// - Navigation fallback: serve index.html dalla cache se offline.

const VERSION = 'gc-v11';
const STATIC_CACHE = `static-${VERSION}`;
const PRECACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/pb.js',
  './js/utils.js',
  './js/scoring.js',
  './js/migrate.js',
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
    // Forza il reload delle tab attive così l'utente vede subito la nuova versione
    // del JS senza dover fare hard-refresh manuale.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      try { c.navigate(c.url); } catch { /* alcune origin non lo permettono */ }
    }
  })());
});

function isApi(url) {
  // PocketBase è su :8090 di default; tolleriamo anche /api/ per reverse proxy futuri.
  return url.port === '8090' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/_/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // mutazioni: lasciamo fare alla rete
  const url = new URL(req.url);

  // PocketBase API (anche cross-origin): mai dalla cache. La auth filtra le rule
  // server-side, quindi servire risposte cached produrrebbe stato stale per ruolo.
  if (isApi(url)) return;

  // Solo same-origin per assets, escludi PocketBase e CDN che vogliamo sempre freschi
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
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Moduli JavaScript: network-first per evitare di servire vecchi bundle dopo deploy.
  // Se offline, fallback alla cache.
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
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
