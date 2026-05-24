// Load test SCRITTURE (voti) — POST /api/valutazioni (upsert con FOR UPDATE su
// candidato_fase+fase, via PgBouncer transaction mode). Misura due pattern:
//   - SPREAD: voti distribuiti su candidati/criteri diversi (realistico);
//   - CONTENTION: tutti sulla STESSA riga (cf+commissario+criterio) → worst-case
//     lock/serializzazione.
// Setup via API (admin): crea una fase dedicata IN_CORSO + candidati, poi vota.
// Server compilato :4001, DB via PgBouncer. Uso: node tests/load/load-write.mjs [conn] [sec]
//
// CAVEAT: scrive righe valutazioni reali su una fase di test (non concludere →
// niente freeze); host condiviso; dataset dev.
import autocannon from 'autocannon';

const BASE = 'http://ente1.gestimus.local:4001';
const CONN = Number(process.argv[2] || 50);
const DUR = Number(process.argv[3] || 8);

let COOKIE = '';
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(COOKIE ? { cookie: COOKIE } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = txt; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${txt.slice(0, 200)}`);
  return j;
}

function run(opts) {
  return new Promise((res, rej) => autocannon({ duration: DUR, connections: CONN, ...opts }, (e, r) => e ? rej(e) : res(r)));
}
const fmt = (r) => ({
  'req/s (avg)': Math.round(r.requests.average), 'p50 ms': r.latency.p50,
  'p95 ms': r.latency.p97_5, 'p99 ms': r.latency.p99, 'max ms': r.latency.max,
  'non-2xx': r.non2xx, errors: r.errors, timeouts: r.timeouts,
});

const main = async () => {
  // Login.
  const lr = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@ente1.test', password: 'Admin123!' }),
  });
  COOKIE = (lr.headers.get('set-cookie') || '').match(/gestimus_session=[^;]+/)?.[0] || '';
  if (!COOKIE) throw new Error('login fallito');

  const concorsi = await api('GET', '/api/concorsi');
  const concorso = concorsi.find((/** @type {any} */ c) => /Solisti/.test(c.nome)) || concorsi[0];
  const commissari = await api('GET', `/api/commissari?concorsoId=${concorso.id}`);
  const commissarioId = commissari[0]?.id;
  if (!commissarioId) throw new Error('nessun commissario seedato');

  // Candidati dedicati (8) + fase IN_CORSO.
  const tag = Date.now();
  for (let i = 0; i < 8; i++) {
    await api('POST', '/api/candidati', { concorsoId: concorso.id, nome: `LoadCand ${tag}-${i}`, strumento: 'Pianoforte' });
  }
  const fasi = await api('GET', `/api/fasi?concorsoId=${concorso.id}`);
  const ordine = Math.max(0, ...fasi.map((/** @type {any} */ f) => f.ordine || 0)) + 1;
  const fase = await api('POST', '/api/fasi', { concorsoId: concorso.id, ordine, nome: `LoadFase ${tag}`, scala: 10 });
  await api('POST', `/api/fasi/${fase.id}/start`, {});
  const cfs = await api('GET', `/api/candidati-fase?faseId=${fase.id}`);
  const cfIds = cfs.map((/** @type {any} */ c) => c.id);
  if (cfIds.length === 0) throw new Error('nessun candidato_fase dopo start');
  console.log(`setup: fase=${fase.id} · ${cfIds.length} candidati_fase · commissario=${commissarioId}\n`);

  const criteri = ['Tecnica', 'Interpretazione', 'Musicalita'];
  const hdr = { 'content-type': 'application/json', cookie: COOKIE };

  // SPREAD: una request per (cf × criterio) → upsert distribuiti.
  const spreadReqs = [];
  for (const cf of cfIds) for (const cr of criteri) {
    spreadReqs.push({ method: 'POST', path: '/api/valutazioni', headers: hdr,
      body: JSON.stringify({ candidatoFaseId: cf, commissarioId, criterio: cr, voto: 8 }) });
  }

  // CONTENTION: tutte le request sulla STESSA riga (cf[0], stesso criterio/commissario).
  const contendReq = [{ method: 'POST', path: '/api/valutazioni', headers: hdr,
    body: JSON.stringify({ candidatoFaseId: cfIds[0], commissarioId, criterio: 'Tecnica', voto: 7 }) }];

  console.log(`== Scritture voti (${CONN} conn × ${DUR}s) ==`);
  const out = {};
  console.log('▶ SPREAD (cf×criterio distribuiti) …');
  out['SPREAD (righe diverse)'] = fmt(await run({ url: BASE, requests: spreadReqs }));
  console.log('▶ CONTENTION (stessa riga, ON CONFLICT) …');
  out['CONTENTION (stessa riga)'] = fmt(await run({ url: BASE, requests: contendReq }));
  console.table(out);
};
main().catch((e) => { console.error(e); process.exit(1); });
