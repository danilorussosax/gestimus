// Service Worker — strategia ibrida.
// - Asset statici (HTML/CSS/JS/immagini): cache-first con revalidate (stale-while-revalidate).
// - API (qualunque cosa sotto /api/): network-only (mai cache — i dati sono live).
// - Navigation fallback: serve index.html dalla cache se offline.

const VERSION = 'gc-v14';
const STATIC_CACHE = `static-${VERSION}`;
// L235: precache completa dei moduli caricati eagerly da app.js + core, così la
// prima visita OFFLINE non rompe le viste admin/superadmin (prima ne mancavano
// metà). cache.addAll è tollerante (.catch) → un file mancante non blocca l'install.
const PRECACHE = [
  './',
  './index.html',
  './css/styles.css',
  // core
  './js/app.js', './js/db.js', './js/api.js', './js/utils.js', './js/pb.js',
  './js/scoring.js', './js/rng.js', './js/tiebreak.js', './js/i18n.js',
  './js/i18n/it.js', './js/i18n/en.js', './js/i18n/fr.js', './js/i18n/es.js',
  './js/icons.js', './js/palette.js', './js/piani.js', './js/calendario-pdf.js',
  // viste top-level
  './js/views/home.js', './js/views/login.js', './js/views/iscrizione.js',
  './js/views/privacy.js', './js/views/admin.js', './js/views/commissario.js',
  './js/views/calendario-pubblico.js', './js/views/account-security.js',
  './js/views/admin-dashboard.js', './js/views/admin-impostazioni.js',
  './js/views/admin-users.js', './js/views/admin-stats.js',
  './js/views/admin-manuale.js', './js/views/superadmin.js',
  // sotto-viste admin
  './js/views/admin/candidati.js', './js/views/admin/commissari.js',
  './js/views/admin/commissioni.js', './js/views/admin/risultati.js',
  './js/views/admin/verbale.js', './js/views/admin/import.js',
  './js/views/admin/iscrizioni.js', './js/views/admin/sezioni.js',
  './js/views/admin/fasi.js', './js/views/admin/calendario.js',
  './js/views/admin/audit.js', './js/views/admin/impostazioni-concorso.js',
  './js/views/admin/common.js', './js/views/admin/concorso-selector.js',
  './js/views/admin/dashboard.js',
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

  // CDN cross-origin (Tailwind/jspdf): stale-while-revalidate.
  // M216: prima era cache-first puro → un asset CDN senza versione nell'URL
  // (es. cdn.tailwindcss.com) restava stale per sempre. Ora serviamo subito la
  // cache ma rivalidiamo in background, così l'aggiornamento entra al refresh.
  if (url.origin !== self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => null);
      if (hit) { event.waitUntil(network); return hit; }
      return (await network) || Response.error();
    })());
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
