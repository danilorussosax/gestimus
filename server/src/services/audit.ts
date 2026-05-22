import type { FastifyRequest } from 'fastify';
import { auditLog, platformAuditLog } from '../db/schema.js';
import type { TxClient } from '../middleware/tenant.js';
import { dbSuper } from '../db/client.js';

function clientIp(req: FastifyRequest): string | undefined {
  return (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip;
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
  },
): Promise<void> {
  if (!req.tenant) return; // niente audit per richieste senza contesto tenant
  await tx.insert(auditLog).values({
    tenantId: req.tenant.id,
    actorAccountId: req.account?.id ?? null,
    action,
    targetType: data?.targetType ?? null,
    targetId: data?.targetId ?? null,
    payload: (data?.payload as object) ?? null,
    ip: clientIp(req),
    userAgent: req.headers['user-agent'] ?? null,
  });
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
  },
): Promise<void> {
  await dbSuper.insert(platformAuditLog).values({
    actorAccountId: req.account?.id ?? null,
    action,
    targetTenantSlug: data?.targetTenantSlug ?? null,
    targetTenantId: data?.targetTenantId ?? null,
    payload: (data?.payload as object) ?? null,
    ip: clientIp(req),
    userAgent: req.headers['user-agent'] ?? null,
  });
}
