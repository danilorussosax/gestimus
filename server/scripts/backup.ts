import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Backup logico del database (rete di sicurezza DR + pre-migrazione).
 *
 * Usa `pg_dump` in formato custom (-Fc) → ripristinabile selettivamente con
 * `pg_restore`. Va eseguito PRIMA di una migration rischiosa o di un deploy:
 * se `db:sql:down` non basta (migration irreversibile), si ripristina da qui.
 *
 * Output: <ARCHIVE_DIR>/db-backups/gestimus_<ISO>.dump
 * Retention: tiene gli ultimi BACKUP_RETENTION_DAYS giorni (default 90).
 *
 * Connessione: DATABASE_URL_DIRECT (bypassa PgBouncer) → fallback SUPER.
 *
 * Restore (manuale, distruttivo — conferma prima):
 *   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL_DIRECT" <file>.dump
 */

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL_SUPER;
if (!url) {
  console.error('✗ DATABASE_URL_DIRECT o DATABASE_URL_SUPER richiesto');
  process.exit(1);
}

const archiveDir = process.env.ARCHIVE_DIR ?? './archive';
const backupDir = resolve(archiveDir, 'db-backups');
mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = resolve(backupDir, `gestimus_${stamp}.dump`);

console.log(`→ pg_dump → ${outFile}`);
const r = spawnSync('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-f', outFile, url], {
  stdio: ['ignore', 'inherit', 'inherit'],
});
if (r.error) {
  console.error('✗ pg_dump non disponibile nel PATH?', r.error.message);
  process.exit(1);
}
if (r.status !== 0) {
  console.error(`✗ pg_dump uscito con codice ${r.status}`);
  process.exit(r.status ?? 1);
}
const size = (statSync(outFile).size / 1024 / 1024).toFixed(2);
console.log(`✓ Backup completato (${size} MB)`);

// Retention: elimina i .dump più vecchi di BACKUP_RETENTION_DAYS.
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 90);
if (retentionDays > 0) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let purged = 0;
  for (const f of readdirSync(backupDir)) {
    if (!f.endsWith('.dump')) continue;
    const p = resolve(backupDir, f);
    if (statSync(p).mtimeMs < cutoff) { unlinkSync(p); purged++; }
  }
  if (purged > 0) console.log(`· retention: ${purged} backup oltre ${retentionDays}g rimossi`);
}

console.log(`\nRestore: pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL_DIRECT" "${outFile}"`);
