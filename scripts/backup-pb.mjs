#!/usr/bin/env node
// Backup di pb_data/ in backups/pb_<timestamp>.tar.gz
// Usage: node scripts/backup-pb.js [--keep N]
//   --keep N: mantieni solo gli ultimi N backup (default: tutti)

import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
// PocketBase crea pb_data accanto al binario quando lanciato con `npm run start:pb`.
const SRC  = resolve(ROOT, 'pocketbase', 'pb_data');
const DEST_DIR = resolve(ROOT, 'backups');

const args = process.argv.slice(2);
const keepIdx = args.indexOf('--keep');
const keep = keepIdx >= 0 ? Number(args[keepIdx + 1]) : null;

try {
  statSync(SRC);
} catch {
  console.error(`✗ pb_data non trovato in ${SRC}. Avvia PocketBase almeno una volta.`);
  process.exit(1);
}

mkdirSync(DEST_DIR, { recursive: true });

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = resolve(DEST_DIR, `pb_${ts}.tar.gz`);

console.log(`→ Creo ${out}…`);
execSync(`tar -czf "${out}" -C "${resolve(ROOT, 'pocketbase')}" pb_data`, { stdio: 'inherit' });

const size = (statSync(out).size / 1024 / 1024).toFixed(2);
console.log(`✓ Backup creato (${size} MB)`);

if (Number.isFinite(keep) && keep > 0) {
  const all = readdirSync(DEST_DIR)
    .filter(f => f.startsWith('pb_') && f.endsWith('.tar.gz'))
    .map(f => ({ f, t: statSync(resolve(DEST_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const toRemove = all.slice(keep);
  for (const { f } of toRemove) {
    unlinkSync(resolve(DEST_DIR, f));
    console.log(`  – rimosso vecchio backup: ${f}`);
  }
  console.log(`  → Conservati gli ultimi ${Math.min(keep, all.length)} backup`);
}
