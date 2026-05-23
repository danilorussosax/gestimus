import { eq } from 'drizzle-orm';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createCipheriv, randomBytes } from 'node:crypto';
import { keyBuffer } from './crypto-smtp.js';
import { dbSuper } from '../db/client.js';
import {
  accounts,
  auditLog,
  candidati,
  candidatiFase,
  candidatiMembri,
  categorie,
  commissari,
  commissariArchivio,
  commissioni,
  commissioniCategorie,
  commissioniCommissari,
  commissioniSezioni,
  concorsi,
  criteri,
  fasi,
  fasiSezioni,
  iscrizioni,
  iscrizioniAllegati,
  sezioni,
  sessions,
  tenantConfig,
  tenants,
  valutazioni,
} from '../db/schema.js';
import { env } from '../env.js';

const gzipP = promisify(gzip);

/**
 * Versione del formato di backup. Bump quando lo schema cambia in modo non
 * retro-compatibile (serve per il restore futuro).
 *
 * v2 (2026-05-23): backup cifrati AES-256-GCM at-rest.
 *   Layout file: `[1 byte version=2][12-byte IV][16-byte tag][ciphertext]`.
 *   Il ciphertext è il vecchio payload gzip (`gzip(JSON.stringify(manifest))`).
 *   Decrypt = chiunque abbia `GESTIMUS_SECRET_KEY`. v1 (gzip plain) resta
 *   leggibile dal restore per compatibilità, ma non viene più scritto.
 */
const BACKUP_FORMAT_VERSION = 2;
const ENC_VERSION_BYTE = 0x02;
const AES_ALGO = 'aes-256-gcm';

/**
 * Tabelle che vivono dentro un tenant (tutte cascade-deleted con il tenant).
 * L'ordine non conta per il backup; conta per un eventuale restore (segue le FK).
 */
const TENANT_TABLES = {
  tenant_config: tenantConfig,
  accounts: accounts,
  sessions: sessions,
  audit_log: auditLog,
  concorsi: concorsi,
  commissari: commissari,
  commissari_archivio: commissariArchivio,
  candidati: candidati,
  candidati_membri: candidatiMembri,
  sezioni: sezioni,
  categorie: categorie,
  commissioni: commissioni,
  commissioni_commissari: commissioniCommissari,
  commissioni_sezioni: commissioniSezioni,
  commissioni_categorie: commissioniCategorie,
  fasi: fasi,
  fasi_sezioni: fasiSezioni,
  criteri: criteri,
  candidati_fase: candidatiFase,
  valutazioni: valutazioni,
  iscrizioni: iscrizioni,
  iscrizioni_allegati: iscrizioniAllegati,
} as const;

type TenantTableName = keyof typeof TENANT_TABLES;

export type BackupResult = {
  path: string;
  filename: string;
  sizeBytes: number;
  tableCounts: Record<string, number>;
  exportedAt: string;
};

export type BackupManifest = {
  format: number;
  tenantId: string;
  tenantSlug: string;
  exportedAt: string;
  /** Riga della tabella tenants */
  tenant: unknown;
  /** Dati delle tabelle di dominio (chiave = nome tabella SQL) */
  tables: Record<TenantTableName, unknown[]>;
  tableCounts: Record<TenantTableName, number>;
};

function archiveDir(): string {
  return resolve(env.ARCHIVE_DIR);
}

async function ensureArchiveDir(): Promise<void> {
  await mkdir(archiveDir(), { recursive: true });
}

function safeIsoStamp(): string {
  // 2026-05-22T13-45-09-123Z (filesystem-safe, niente ':')
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Backup completo dei dati di un tenant in JSON gzipped.
 * Restituisce il path del file scritto e i conteggi per tabella.
 *
 * Nota: usiamo `dbSuper` (BYPASSRLS) perché il super-admin vede tutti i tenant.
 * Il filtro per tenant_id è esplicito nel WHERE.
 */
export async function backupTenant(tenantId: string): Promise<BackupResult> {
  await ensureArchiveDir();

  const tenantRow = (
    await dbSuper.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  )[0];
  if (!tenantRow) {
    throw new Error(`backup: tenant ${tenantId} non trovato`);
  }

  const tableCounts = {} as Record<TenantTableName, number>;
  const tables = {} as Record<TenantTableName, unknown[]>;

  for (const [name, table] of Object.entries(TENANT_TABLES) as [
    TenantTableName,
    (typeof TENANT_TABLES)[TenantTableName],
  ][]) {
    // Tutte le tabelle qui hanno una colonna tenantId (cascade-deleted con tenant)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenantIdCol = (table as any).tenantId;
    const rows = await dbSuper.select().from(table).where(eq(tenantIdCol, tenantId));
    tables[name] = rows;
    tableCounts[name] = rows.length;
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT_VERSION,
    tenantId,
    tenantSlug: tenantRow.slug,
    exportedAt: new Date().toISOString(),
    tenant: tenantRow,
    tables,
    tableCounts,
  };

  // L5: suffisso random per evitare collisioni se due backup partono nello
  // stesso millisecondo (es. cleanup + backup manuale concorrenti).
  const filename = `${tenantRow.slug}-${safeIsoStamp()}-${randomBytes(3).toString('hex')}.json.gz.enc`;
  const filepath = join(archiveDir(), filename);
  const compressed = await gzipP(Buffer.from(JSON.stringify(manifest)));
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGO, keyBuffer(), iv);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  const fileBuffer = Buffer.concat([Buffer.from([ENC_VERSION_BYTE]), iv, tag, ciphertext]);
  await writeFile(filepath, fileBuffer);
  const st = await stat(filepath);

  return {
    path: filepath,
    filename,
    sizeBytes: st.size,
    tableCounts,
    exportedAt: manifest.exportedAt,
  };
}

export type BackupListEntry = {
  filename: string;
  sizeBytes: number;
  modifiedAt: string;
  tenantSlug: string;
};

/**
 * Lista i file di backup presenti in ARCHIVE_DIR.
 * Filename convention: `<slug>-<iso>.json.gz` dove iso = 2026-05-22T13-45-09-123Z
 * (lo slug può contenere `-`, quindi estraggo via regex sull'isoStamp).
 */
// Match: <slug>-<iso>[-<hex>].json.gz[.enc]. Il suffisso hex (L5) è opzionale
// per restare compatibile con i backup pre-esistenti senza suffisso.
const BACKUP_FILENAME_RE = /^(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(?:-[0-9a-f]{6})?\.json\.gz(?:\.enc)?$/;
const BACKUP_EXTS = ['.json.gz', '.json.gz.enc'];

function isBackupFile(name: string): boolean {
  return BACKUP_EXTS.some((ext) => name.endsWith(ext));
}

export async function listBackups(): Promise<BackupListEntry[]> {
  try {
    await ensureArchiveDir();
    const files = await readdir(archiveDir());
    const entries: BackupListEntry[] = [];
    for (const f of files) {
      if (!isBackupFile(f)) continue;
      const st = await stat(join(archiveDir(), f));
      const m = BACKUP_FILENAME_RE.exec(f);
      const slug = m?.[1] ?? 'unknown';
      entries.push({
        filename: f,
        sizeBytes: st.size,
        modifiedAt: st.mtime.toISOString(),
        tenantSlug: slug,
      });
    }
    return entries.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
  } catch (err) {
    // M203: non mascherare del tutto — un errore di permessi/disco va segnalato
    // (altrimenti l'admin vede "nessun backup" invece dell'errore reale).
    console.error('[backup] listBackups failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Rimuove i backup più vecchi di `retentionDays`.
 * Restituisce { deleted } per audit/logging.
 */
export async function pruneOldBackups(retentionDays: number): Promise<{ deleted: number }> {
  if (retentionDays <= 0) return { deleted: 0 };
  await ensureArchiveDir();
  const cutoff = Date.now() - retentionDays * 86400_000;
  let deleted = 0;
  const files = await readdir(archiveDir());
  for (const f of files) {
    if (!isBackupFile(f)) continue;
    const full = join(archiveDir(), f);
    const st = await stat(full);
    if (st.mtimeMs < cutoff) {
      await unlink(full);
      deleted += 1;
    }
  }
  return { deleted };
}
