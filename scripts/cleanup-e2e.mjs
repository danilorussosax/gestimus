#!/usr/bin/env node
// Rimuove i residui delle suite Playwright dal DB PocketBase:
// - concorso "E2E test concorso" e tutti i record figli (cascade via relation)
// - commissari orfani con email *@test.local (e2e-existing/e2e-pwd/e2e-com)
// - account con email *@test.local
// Usage:
//   node scripts/cleanup-e2e.mjs            # esegue
//   node scripts/cleanup-e2e.mjs --dry-run  # mostra cosa eliminerebbe senza toccare nulla
//   node scripts/cleanup-e2e.mjs --purge-all # rimuove anche l'admin e2e-admin@test.local
// Override URL: PB_URL=http://host:port node scripts/cleanup-e2e.mjs

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const DRY = process.argv.includes('--dry-run');
const PURGE_ALL = process.argv.includes('--purge-all');

const TEST_CONCORSO_NAME = 'E2E test concorso';
const TEST_EMAIL_RE = /@test\.local$/i;
// Admin riutilizzato dalle suite Playwright: lo conserviamo di default per non
// rompere i test al prossimo `npm run test:e2e` (usa --purge-all per rimuoverlo).
const KEEP_EMAIL = 'e2e-admin@test.local';

async function api(method, path, body) {
  const res = await fetch(`${PB_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function listAll(collection, filter) {
  const q = new URLSearchParams({ perPage: '500' });
  if (filter) q.set('filter', filter);
  const data = await api('GET', `/api/collections/${collection}/records?${q}`);
  return data.items || [];
}

async function del(collection, id) {
  if (DRY) return;
  await api('DELETE', `/api/collections/${collection}/records/${id}`);
}

const tag = DRY ? '[DRY] ' : '';
let totalDeleted = 0;

async function main() {
  // 1) Concorso E2E + figli
  const concorsi = await listAll('concorsi', `nome="${TEST_CONCORSO_NAME}"`);
  for (const c of concorsi) {
    console.log(`→ Concorso "${c.nome}" (${c.id})`);
    // Pulizia espliciti: cascadeDelete dovrebbe occuparsene, ma alcune
    // collezioni (audit_log, fase_runtime) non sono in cascade.
    for (const coll of ['audit_log', 'fase_runtime']) {
      try {
        const rows = await listAll(coll, `concorso="${c.id}"`);
        for (const r of rows) { await del(coll, r.id); totalDeleted++; }
        if (rows.length) console.log(`  ${tag}- ${rows.length} record da ${coll}`);
      } catch { /* collezione opzionale */ }
    }
    await del('concorsi', c.id);
    totalDeleted++;
    console.log(`  ${tag}✓ concorso eliminato (commissari/candidati/fasi/… in cascade)`);
  }
  if (!concorsi.length) console.log('→ Nessun concorso "E2E test concorso" trovato.');

  // 2) Commissari orfani con email di test
  const allCom = await listAll('commissari');
  const orphanCom = allCom.filter(c => c.email && TEST_EMAIL_RE.test(c.email));
  for (const c of orphanCom) {
    console.log(`  ${tag}- commissario orfano: ${c.email} (${c.id})`);
    await del('commissari', c.id);
    totalDeleted++;
  }

  // 3) Account con email di test
  let accounts = [];
  try { accounts = await listAll('accounts'); } catch { /* collezione assente */ }
  const orphanAcc = accounts.filter(a =>
    a.email && TEST_EMAIL_RE.test(a.email)
    && (PURGE_ALL || a.email.toLowerCase() !== KEEP_EMAIL)
  );
  for (const a of orphanAcc) {
    console.log(`  ${tag}- account: ${a.email} (${a.id})`);
    await del('accounts', a.id);
    totalDeleted++;
  }

  console.log(`\n${tag}Totale record ${DRY ? 'da eliminare' : 'eliminati'}: ${totalDeleted}`);
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
