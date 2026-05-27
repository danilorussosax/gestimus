import type { FastifyRequest } from 'fastify';
import { and, asc, eq, gt, type SQL } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { auditLog, platformAuditLog } from '../db/schema.js';
import type { TxClient } from '../middleware/tenant.js';
import { dbSuper } from '../db/client.js';
import { deriveKey, deriveKeysWithFallback } from './keys.js';

// L232: ip/userAgent arrivano da header arbitrari del client. Vengono salvati
// in audit_log e poi resi nel viewer/log → newline o caratteri di controllo
// potrebbero falsificare righe di log o spezzare il rendering. Normalizziamo:
// niente CR/LF/controlli, lunghezza limitata. Difesa in profondità (il viewer
// fa comunque escape), e la firma HMAC copre il valore già sanificato.
function sanitizeHeader(v: string | undefined, max = 512): string | undefined {
  if (v == null) return undefined;
  const s = v.replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, max).trim();
  return s.length ? s : undefined;
}

function clientIp(req: FastifyRequest): string | undefined {
  const xff = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return sanitizeHeader(xff ?? req.ip);
}

// M196 — tamper-evidence. Canonical JSON deterministico (chiavi ordinate
// ricorsivamente): la firma resta stabile anche se jsonb riordina le chiavi del
// payload tra scrittura e rilettura.
function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

// HMAC-SHA256 con sottochiave dedicata derivata da GESTIMUS_SECRET_KEY (NON nel
// DB): un insider con accesso al solo database non può ricalcolare la firma di
// una riga manomessa. Firma il CONTENUTO (non createdAt, che è DB-side).
// N: chiave domain-separated 'gestimus:audit' — un leak della chiave AES
// SMTP/backup non permette di forgiare firme audit (e viceversa).
const AUDIT_HMAC_KEY = deriveKey('gestimus:audit');
// #2: chiavi per la VERIFICA (corrente + precedente in rotazione). Per FIRMARE le
// righe nuove si usa sempre la corrente (AUDIT_HMAC_KEY).
const AUDIT_HMAC_KEYS = deriveKeysWithFallback('gestimus:audit');
function hmacWith(key: Buffer, values: unknown[]): string {
  return createHmac('sha256', key).update(canonical(values)).digest('hex');
}
function hmac(values: unknown[]): string {
  return hmacWith(AUDIT_HMAC_KEY, values);
}

type AuditLogRow = {
  tenantId: string | null;
  actorAccountId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  ip: string | null;
  userAgent: string | null;
};
type PlatformAuditRow = {
  actorAccountId: string | null;
  action: string;
  targetTenantSlug: string | null;
  targetTenantId: string | null;
  payload: unknown;
  ip: string | null;
  userAgent: string | null;
};

// #8: createdAt come ISO-8601 stabile per la firma. Una stringa già ISO viene
// normalizzata via Date per evitare divergenze tra scrittura e rilettura DB.
function toIsoOrNull(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

// #8: la firma include `createdAt` (v2) quando fornito. Senza createdAt la firma
// è "legacy v1" — un DBA poteva retrodatare/postdatare una riga senza invalidare
// l'HMAC, perché il timestamp non era coperto. Le righe nuove firmano sempre v2;
// verifyAuditIntegrity accetta v2 e, in fallback, v1 (righe pre-fix).
function auditLogFields(r: AuditLogRow, createdAt?: Date | string | null): unknown[] {
  const fields: unknown[] = [
    r.tenantId ?? null, r.actorAccountId ?? null, r.action, r.targetType ?? null,
    r.targetId ?? null, r.payload ?? null, r.ip ?? null, r.userAgent ?? null,
  ];
  if (createdAt != null) fields.push(toIsoOrNull(createdAt));
  return fields;
}
export function computeAuditLogSig(r: AuditLogRow, createdAt?: Date | string | null): string {
  return hmac(auditLogFields(r, createdAt));
}

// #2 + #8: una firma audit_log è valida se combacia con UNA combinazione di
// (chiave corrente / precedente in rotazione) × (v2 con createdAt / v1 legacy
// senza createdAt). Le righe nuove sono v2 firmate con la chiave corrente; le
// vecchie possono essere v1 e/o firmate con la chiave precedente.
function auditLogSigValid(r: AuditLogRow & { createdAt?: Date | string | null; sig: string | null }): boolean {
  if (!r.sig) return false;
  const f2 = auditLogFields(r, r.createdAt ?? null);
  const f1 = auditLogFields(r);
  for (const key of AUDIT_HMAC_KEYS) {
    if (r.sig === hmacWith(key, f2) || r.sig === hmacWith(key, f1)) return true;
  }
  return false;
}
export function computePlatformAuditSig(r: PlatformAuditRow, createdAt?: Date | string | null): string {
  const fields: unknown[] = [
    r.actorAccountId ?? null, r.action, r.targetTenantSlug ?? null,
    r.targetTenantId ?? null, r.payload ?? null, r.ip ?? null, r.userAgent ?? null,
  ];
  if (createdAt != null) fields.push(toIsoOrNull(createdAt));
  return hmac(fields);
}

/**
 * Scrive una riga in audit_log (RLS-protected, cascade su tenant delete).
 * Da usare DENTRO una transazione (tx) per consistenza con la modifica.
 */
export async function writeAudit(
  tx: TxClient,
  req: FastifyRequest,
  action: string,
  data?: {
    targetType?: string;
    targetId?: string;
    payload?: unknown;
    // M152: attore esplicito per i casi in cui req.account non è ancora
    // popolato (es. audit di login, scritto prima che la sessione sia attiva).
    actorAccountId?: string | null;
  },
): Promise<void> {
  if (!req.tenant) return; // niente audit per richieste senza contesto tenant
  const values = {
    tenantId: req.tenant.id,
    actorAccountId: data?.actorAccountId ?? req.account?.id ?? null,
    action,
    targetType: data?.targetType ?? null,
    targetId: data?.targetId ?? null,
    payload: (data?.payload as object) ?? null,
    ip: clientIp(req) ?? null,
    userAgent: sanitizeHeader(req.headers['user-agent'] as string | undefined) ?? null,
  };
  // #8: createdAt impostato esplicitamente (non default DB) così possiamo
  // firmarlo con lo STESSO valore che finisce nella riga.
  const createdAt = new Date();
  await tx.insert(auditLog).values({ ...values, createdAt, sig: computeAuditLogSig(values, createdAt) });
}

/**
 * Audit a livello piattaforma (super-admin). Non passa per RLS,
 * sopravvive al cascade delete del tenant.
 */
export async function writePlatformAudit(
  req: FastifyRequest,
  action: string,
  data?: {
    targetTenantSlug?: string;
    targetTenantId?: string;
    payload?: unknown;
    actorAccountId?: string | null;
  },
): Promise<void> {
  const values = {
    actorAccountId: data?.actorAccountId ?? req.account?.id ?? null,
    action,
    targetTenantSlug: data?.targetTenantSlug ?? null,
    targetTenantId: data?.targetTenantId ?? null,
    payload: (data?.payload as object) ?? null,
    ip: clientIp(req) ?? null,
    userAgent: sanitizeHeader(req.headers['user-agent'] as string | undefined) ?? null,
  };
  const createdAt = new Date(); // #8: firmato con la riga (vedi writeAudit)
  await dbSuper.insert(platformAuditLog).values({ ...values, createdAt, sig: computePlatformAuditSig(values, createdAt) });
}

export type AuditIntegrityReport = {
  checked: number;
  unsigned: number;
  tampered: Array<{ id: string; action: string }>;
};

/**
 * M196: verifica l'integrità delle firme dell'audit_log (uso ops/diagnostica).
 * Ricalcola l'HMAC di ogni riga e segnala i mismatch (manomissione) e le righe
 * senza firma (legacy, pre-feature). Se `tenantId` è omesso verifica tutto.
 */
export async function verifyAuditIntegrity(tenantId?: string): Promise<AuditIntegrityReport> {
  const report: AuditIntegrityReport = { checked: 0, unsigned: 0, tampered: [] };
  // Itera a chunk con keyset su `id` (uuidv7 monotonico): su tenant con audit_log
  // molto grande non carichiamo l'intera tabella in memoria.
  const CHUNK = 1000;
  let cursor: string | null = null;
  for (;;) {
    const tenantFilter: SQL | undefined = tenantId ? eq(auditLog.tenantId, tenantId) : undefined;
    const cursorFilter: SQL | undefined = cursor ? gt(auditLog.id, cursor) : undefined;
    const rows = await dbSuper
      .select()
      .from(auditLog)
      .where(and(tenantFilter, cursorFilter))
      .orderBy(asc(auditLog.id))
      .limit(CHUNK);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (!r.sig) {
        report.unsigned += 1;
        continue;
      }
      report.checked += 1;
      // #2 + #8: valida su (chiave corrente/precedente) × (v2 con createdAt / v1
      // legacy). Tampered solo se nessuna combinazione combacia.
      if (!auditLogSigValid(r as AuditLogRow & { createdAt: Date; sig: string | null }))
        report.tampered.push({ id: r.id, action: r.action });
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < CHUNK) break;
  }
  return report;
}
