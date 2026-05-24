// Load test locale — misura throughput/latenza dei percorsi caldi.
// Server compilato (node dist) su :4001, DB via PgBouncer :6433 (prod-like).
// Uso: node tests/load/load.mjs [connections] [durationSec]
//
// CAVEAT (onesti, vanno letti coi numeri):
//  - dataset di sviluppo PICCOLO → query veloci (ottimistico vs tenant grandi);
//  - load generator + server + Postgres + PgBouncer sullo STESSO host → contesa
//    CPU (il server ha meno core che in prod → pessimistico sul throughput);
//  - NODE_ENV=development (cookie http + login non rate-limited per il test).
import autocannon from 'autocannon';

// Usiamo l'hostname (risolto da /etc/hosts → 127.0.0.1): `fetch` ignora l'header
// `host` (forbidden header), quindi il tenant si risolve dall'URL reale.
const BASE = 'http://ente1.gestimus.local:4001';
const CONNECTIONS = Number(process.argv[2] || 50);
const DURATION = Number(process.argv[3] || 10);

function run(opts) {
  return new Promise((resolve, reject) => {
    autocannon({ duration: DURATION, connections: CONNECTIONS, ...opts }, (err, res) =>
      err ? reject(err) : resolve(res));
  });
}

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@ente1.test', password: 'Admin123!' }),
  });
  const sc = r.headers.get('set-cookie') || '';
  const m = sc.match(/gestimus_session=[^;]+/);
  if (!m) throw new Error(`login fallito (${r.status})`);
  return m[0];
}

const fmt = (r) => ({
  'req/s (avg)': Math.round(r.requests.average),
  'p50 ms': r.latency.p50,
  'p95 ms': r.latency.p97_5,
  'p99 ms': r.latency.p99,
  'max ms': r.latency.max,
  'non-2xx': r.non2xx,
  errors: r.errors,
  timeouts: r.timeouts,
});

const main = async () => {
  const cookie = await login();

  // 1) Baseline + sanity dei due percorsi a 50 conn.
  console.log(`\n== Scenari (${CONNECTIONS} conn × ${DURATION}s) ==`);
  const out = {};
  out['baseline /healthz (no DB)'] = fmt(await run({ url: `${BASE}/healthz`, connections: CONNECTIONS }));
  out['public /api/public/concorsi (rate-limit 60/min/IP → 429 by design)'] =
    fmt(await run({ url: `${BASE}/api/public/concorsi`, connections: CONNECTIONS }));
  out['auth /api/concorsi (RLS + sessione + PgBouncer)'] =
    fmt(await run({ url: `${BASE}/api/concorsi`, headers: { cookie }, connections: CONNECTIONS }));
  console.table(out);

  // 2) Sweep di concorrenza sull'hot path autenticato (no rate-limit) → curva
  //    throughput/latenza, per individuare la saturazione.
  console.log(`\n== Sweep concorrenza — auth /api/concorsi (×${DURATION}s) ==`);
  const sweep = {};
  for (const c of [25, 50, 100, 200, 400]) {
    process.stdout.write(`▶ ${c} conn …\n`);
    sweep[`${c} conn`] = fmt(await run({ url: `${BASE}/api/concorsi`, headers: { cookie }, connections: c }));
  }
  console.table(sweep);
};

main().catch((e) => { console.error(e); process.exit(1); });
