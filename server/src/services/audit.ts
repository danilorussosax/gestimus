import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { auditLog, platformAuditLog } from '../db/schema.js';
import type { TxClient } from '../middleware/tenant.js';
import { dbSuper } from '../db/client.js';
import { env } from '../env.js';

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

// HMAC-SHA256 con GESTIMUS_SECRET_KEY (NON nel DB): un insider con accesso al
// solo database non può ricalcolare la firma di una riga manomessa. Firma il
// CONTENUTO (non createdAt, che è DB-side).
function hmac(values: unknown[]): string {
  return createHmac('sha256', env.GESTIMUS_SECRET_KEY).update(canonical(values)).digest('hex');
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

export function computeAuditLogSig(r: AuditLogRow): string {
  return hmac([
    r.tenantId ?? null, r.actorAccountId ?? null, r.action, r.targetType ?? null,
    r.targetId ?? null, r.payload ?? null, r.ip ?? null, r.userAgent ?? null,
  ]);
}
export function computePlatformAuditSig(r: PlatformAuditRow): string {
  return hmac([
    r.actorAccountId ?? null, r.action, r.targetTenantSlug ?? null,
    r.targetTenantId ?? null, r.payload ?? null, r.ip ?? null, r.userAgent ?? null,
  ]);
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
  await tx.insert(auditLog).values({ ...values, sig: computeAuditLogSig(values) });
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
  await dbSuper.insert(platformAuditLog).values({ ...values, sig: computePlatformAuditSig(values) });
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
  const rows = tenantId
    ? await dbSuper.select().from(auditLog).where(eq(auditLog.tenantId, tenantId))
    : await dbSuper.select().from(auditLog);
  const report: AuditIntegrityReport = { checked: 0, unsigned: 0, tampered: [] };
  for (const r of rows) {
    if (!r.sig) {
      report.unsigned += 1;
      continue;
    }
    report.checked += 1;
    const expected = computeAuditLogSig(r as AuditLogRow);
    if (expected !== r.sig) report.tampered.push({ id: r.id, action: r.action });
  }
  return report;
}
