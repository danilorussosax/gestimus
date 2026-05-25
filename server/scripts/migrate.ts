import 'dotenv/config';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Migration runner tracciato con supporto ROLLBACK.
 *
 * Le migration sono file SQL in `scripts/migrations/` con nome
 * `YYYY_MM_DD_<descr>.sql` (ordine lessicografico = ordine di applicazione).
 * Una migration PUÒ avere un file di rollback affiancato `<base>.down.sql`:
 * se presente, `down` la sa annullare; se assente, la migration è
 * dichiarata IRREVERSIBILE e `down` si rifiuta con errore esplicito.
 *
 * Lo stato è in una tabella ledger `_schema_migrations` (name, checksum,
 * applied_at). `up` applica solo i file NON ancora registrati; ogni file gira
 * nella propria transazione (atomico: o tutto applicato+registrato, o niente).
 *
 * Connessione: DATABASE_URL_DIRECT (bypassa PgBouncer) → fallback
 * DATABASE_URL_SUPER. Serve un ruolo con privilegi DDL (gestimus_super).
 *
 * Comandi:
 *   status              elenca migration: applicate / pendenti / con-down
 *   up                  applica tutte le pendenti, in ordine
 *   down [n]            annulla le ultime n applicate (default 1), richiede .down.sql
 *   baseline            registra TUTTE le migration presenti come già applicate
 *                       SENZA eseguirle (per DB esistenti già allineati a mano)
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, 'migrations');

function dbUrl(): string {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL_SUPER;
  if (!url) {
    console.error('✗ DATABASE_URL_DIRECT o DATABASE_URL_SUPER richiesto');
    process.exit(1);
  }
  return url;
}

interface Mig {
  name: string; // base, es. 2026_05_24_foo.sql
  upPath: string;
  downPath: string | null;
  checksum: string;
}

function loadMigrations(): Mig[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const downs = new Set(files.filter((f) => f.endsWith('.down.sql')));
  const ups = files
    .filter((f) => !f.endsWith('.down.sql'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ups.map((name) => {
    const upPath = resolve(MIGRATIONS_DIR, name);
    const downName = name.replace(/\.sql$/, '.down.sql');
    const sql = readFileSync(upPath, 'utf8');
    return {
      name,
      upPath,
      downPath: downs.has(downName) ? resolve(MIGRATIONS_DIR, downName) : null,
      checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16),
    };
  });
}

async function ensureLedger(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function applied(client: Client): Promise<Map<string, string>> {
  const r = await client.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM _schema_migrations',
  );
  return new Map(r.rows.map((row) => [row.name, row.checksum]));
}

async function cmdStatus(client: Client): Promise<void> {
  const migs = loadMigrations();
  const done = await applied(client);
  console.log(`Migration in ${MIGRATIONS_DIR}:\n`);
  for (const m of migs) {
    const state = done.has(m.name) ? '✓ applicata' : '· pendente ';
    const drift = done.has(m.name) && done.get(m.name) !== m.checksum ? ' ⚠️ CHECKSUM DIVERSO' : '';
    const rev = m.downPath ? '[reversibile]' : '[irreversibile]';
    console.log(`  ${state} ${rev.padEnd(15)} ${m.name}${drift}`);
  }
  const pending = migs.filter((m) => !done.has(m.name)).length;
  console.log(`\n${migs.length} totali · ${migs.length - pending} applicate · ${pending} pendenti`);
}

async function cmdUp(client: Client): Promise<void> {
  const migs = loadMigrations();
  const done = await applied(client);
  const pending = migs.filter((m) => !done.has(m.name));
  if (pending.length === 0) {
    console.log('✓ Nessuna migration pendente.');
    return;
  }
  for (const m of pending) {
    const sql = readFileSync(m.upPath, 'utf8');
    console.log(`→ applico ${m.name}`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _schema_migrations (name, checksum) VALUES ($1, $2)', [m.name, m.checksum]);
      await client.query('COMMIT');
      console.log(`  ✓ ${m.name}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${m.name} fallita — rollback. Nessuna modifica applicata.`);
      throw err;
    }
  }
  console.log(`\n✓ ${pending.length} migration applicate.`);
}

async function cmdDown(client: Client, n: number): Promise<void> {
  const migs = loadMigrations();
  const byName = new Map(migs.map((m) => [m.name, m]));
  const r = await client.query<{ name: string }>(
    'SELECT name FROM _schema_migrations ORDER BY name DESC LIMIT $1',
    [n],
  );
  if (r.rows.length === 0) {
    console.log('· Nessuna migration da annullare.');
    return;
  }
  for (const { name } of r.rows) {
    const m = byName.get(name);
    if (!m || !m.downPath) {
      console.error(`✗ ${name} è IRREVERSIBILE (manca ${name.replace(/\.sql$/, '.down.sql')}). Rollback interrotto.`);
      console.error('  Ripristina da backup (npm run db:backup / pg_restore) se devi tornare indietro.');
      process.exit(1);
    }
    const sql = readFileSync(m.downPath, 'utf8');
    console.log(`← annullo ${name}`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('DELETE FROM _schema_migrations WHERE name = $1', [name]);
      await client.query('COMMIT');
      console.log(`  ✓ ${name} annullata`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ down di ${name} fallita — rollback.`);
      throw err;
    }
  }
  console.log(`\n✓ ${r.rows.length} migration annullate.`);
}

async function cmdBaseline(client: Client): Promise<void> {
  const migs = loadMigrations();
  const done = await applied(client);
  const toMark = migs.filter((m) => !done.has(m.name));
  if (toMark.length === 0) {
    console.log('✓ Ledger già allineato, niente da registrare.');
    return;
  }
  for (const m of toMark) {
    await client.query('INSERT INTO _schema_migrations (name, checksum) VALUES ($1, $2) ON CONFLICT DO NOTHING', [m.name, m.checksum]);
  }
  console.log(`✓ ${toMark.length} migration registrate come applicate (baseline, non eseguite).`);
}

async function main() {
  const [cmd = 'status', arg] = process.argv.slice(2);
  const client = new Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    await ensureLedger(client);
    switch (cmd) {
      case 'status': await cmdStatus(client); break;
      case 'up': await cmdUp(client); break;
      case 'down': await cmdDown(client, Math.max(1, Number(arg) || 1)); break;
      case 'baseline': await cmdBaseline(client); break;
      default:
        console.error(`Comando sconosciuto: ${cmd}. Usa: status | up | down [n] | baseline`);
        process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\n✗ migrate fallito:', err instanceof Error ? err.message : err);
  process.exit(1);
});
