import type { FastifyPluginAsync, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { dbSuper } from '../db/client.js';
import {
  accounts,
  candidati,
  commissari,
  concorsi,
  iscrizioni,
  platformAuditLog,
  platformConfig,
  tenantConfig,
  tenants,
} from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { hashPassword } from '../services/password.js';
import { writePlatformAudit } from '../services/audit.js';
import { listBackups } from '../services/backup.js';
import { runTenantCleanup } from '../services/cleanup.js';
import { encryptSmtp, isEncryptedSmtp } from '../services/crypto-smtp.js';
import { invalidateTransporter } from '../services/email.js';
import { readdir, stat as fsStat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '../env.js';

const TENANT_STATES = ['attivo', 'sospeso', 'archiviato'] as const;
const TENANT_PLANS = ['trial', 'starter', 'pro', 'ultra', 'ppe'] as const;
const PLATFORM_SLUG = 'platform';

/**
 * Guard: la route esiste solo se la richiesta arriva dal subdomain super-admin.
 * Restituisce 404 per non rivelare l'esistenza dell'endpoint da altri sottodomini.
 */
const requirePlatformContext: preHandlerAsyncHookHandler = async (req, reply) => {
  if (!req.isSuperadmin) {
    return reply.code(404).send({ error: 'not found' });
  }
};

const platformGuards = [requirePlatformContext, requireAuth, requireRole('superadmin')];

const createTenantBody = z.object({
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'slug deve essere kebab-case'),
  nome: z.string().min(1).max(255),
  piano: z.enum(TENANT_PLANS),
  pianoScadenza: z.string().date().nullable().optional(),
  dominio: z.string().max(255).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  cleanupAfterDays: z.number().int().min(0).max(3650).optional(),
  require2faAdmin: z.boolean().optional(),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8).max(200),
});

const updateTenantBody = z
  .object({
    nome: z.string().min(1).max(255),
    piano: z.enum(TENANT_PLANS),
    pianoScadenza: z.string().date().nullable(),
    dominio: z.string().max(255).nullable(),
    note: z.string().max(2000).nullable(),
    cleanupAfterDays: z.number().int().min(0).max(3650),
    require2faAdmin: z.boolean(),
  })
  .partial();

const archiveBody = z
  .object({
    cleanupAfterDays: z.number().int().min(0).max(3650).optional(),
  })
  .optional();

const updateConfigBody = z
  .object({
    require2faSuperadmin: z.boolean(),
    defaultCleanupDays: z.number().int().min(0).max(3650),
  })
  .partial();

const smtpBody = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().positive().max(65535),
  secure: z.boolean().optional(),
  user: z.string().min(1).max(255),
  password: z.string().min(1).max(500),
  from: z.string().min(1).max(255),
});

/**
 * Body per il cambio piano dedicato. Permette anche di settare la scadenza e
 * gli override per-tenant dei limiti applicativi (tenant_config). I limiti
 * `null` significano "usa quello di default del piano (vedi piani.js lato FE)".
 */
const changePlanBody = z.object({
  piano: z.enum(TENANT_PLANS),
  pianoScadenza: z.string().date().nullable().optional(),
  overrides: z
    .object({
      maxConcorsi: z.number().int().nonnegative().nullable().optional(),
      maxCommissari: z.number().int().nonnegative().nullable().optional(),
      maxCandidatiPerConcorso: z.number().int().nonnegative().nullable().optional(),
    })
    .optional(),
});

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.string().datetime().optional(),
  action: z.string().max(100).optional(),
  tenantId: z.string().uuid().optional(),
});

type TenantRow = typeof tenants.$inferSelect;

function publicTenant(t: TenantRow) {
  return {
    id: t.id,
    slug: t.slug,
    nome: t.nome,
    dominio: t.dominio,
    stato: t.stato,
    piano: t.piano,
    pianoScadenza: t.pianoScadenza,
    note: t.note,
    archiviatoAt: t.archiviatoAt,
    cleanupAfterDays: t.cleanupAfterDays,
    cleanupScheduledAt: t.cleanupScheduledAt,
    require2faAdmin: t.require2faAdmin,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

async function findTenant(id: string): Promise<TenantRow | undefined> {
  const rows = await dbSuper.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return rows[0];
}

/**
 * Calcolo ricorsivo della dimensione di una directory in bytes.
 * Best-effort: se la dir non esiste o non è leggibile, ritorna 0.
 */
async function dirSizeBytes(path: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = join(path, e.name);
    if (e.isDirectory()) {
      total += await dirSizeBytes(full);
    } else if (e.isFile()) {
      try {
        total += (await fsStat(full)).size;
      } catch {
        /* ignore */
      }
    }
  }
  return total;
}

function guardPlatformTenant(t: TenantRow, reply: FastifyReply): boolean {
  if (t.slug === PLATFORM_SLUG) {
    reply.code(409).send({ error: 'il tenant platform non può essere modificato in stato/lifecycle' });
    return false;
  }
  return true;
}

async function auditChange(
  req: FastifyRequest,
  action: string,
  tenant: TenantRow,
  payload?: Record<string, unknown>,
): Promise<void> {
  await writePlatformAudit(req, action, {
    targetTenantId: tenant.id,
    targetTenantSlug: tenant.slug,
    payload,
  });
}

export const platformRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /tenants?stato=attivo|sospeso|archiviato|all (default: all)
   */
  app.get('/tenants', { preHandler: platformGuards }, async (req) => {
    const query = z
      .object({
        stato: z.enum([...TENANT_STATES, 'all']).default('all'),
      })
      .parse(req.query);
    const rows =
      query.stato === 'all'
        ? await dbSuper.select().from(tenants).orderBy(asc(tenants.slug))
        : await dbSuper
            .select()
            .from(tenants)
            .where(eq(tenants.stato, query.stato))
            .orderBy(asc(tenants.slug));
    return rows.map(publicTenant);
  });

  /**
   * GET /tenants/:id → dettaglio singolo tenant
   */
  app.get('/tenants/:id', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const t = await findTenant(id);
    if (!t) return reply.notFound();
    return publicTenant(t);
  });

  /**
   * GET /tenants/:id/stats → conteggi entità per il tenant
   */
  app.get('/tenants/:id/stats', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const t = await findTenant(id);
    if (!t) return reply.notFound();

    const [concorsiCount, commissariCount, candidatiCount, iscrizioniCount, accountsCount] =
      await Promise.all([
        dbSuper
          .select({ n: sql<number>`count(*)::int` })
          .from(concorsi)
          .where(eq(concorsi.tenantId, id)),
        dbSuper
          .select({ n: sql<number>`count(*)::int` })
          .from(commissari)
          .where(eq(commissari.tenantId, id)),
        dbSuper
          .select({ n: sql<number>`count(*)::int` })
          .from(candidati)
          .where(eq(candidati.tenantId, id)),
        dbSuper
          .select({ n: sql<number>`count(*)::int` })
          .from(iscrizioni)
          .where(eq(iscrizioni.tenantId, id)),
        dbSuper
          .select({ n: sql<number>`count(*)::int` })
          .from(accounts)
          .where(eq(accounts.tenantId, id)),
      ]);

    const diskUsageBytes = await dirSizeBytes(resolve(env.UPLOADS_DIR, t.slug));

    return {
      tenantId: id,
      concorsi: concorsiCount[0]?.n ?? 0,
      commissari: commissariCount[0]?.n ?? 0,
      candidati: candidatiCount[0]?.n ?? 0,
      iscrizioni: iscrizioniCount[0]?.n ?? 0,
      accounts: accountsCount[0]?.n ?? 0,
      diskUsageBytes,
    };
  });

  /**
   * POST /tenants → crea ente + primo account admin (atomico)
   */
  app.post('/tenants', { preHandler: platformGuards }, async (req, reply) => {
    const parsed = createTenantBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    const body = parsed.data;

    if (body.slug === PLATFORM_SLUG) {
      return reply.code(409).send({ error: 'slug "platform" è riservato' });
    }
    const existing = await dbSuper
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, body.slug))
      .limit(1);
    if (existing[0]) {
      return reply.code(409).send({ error: `slug "${body.slug}" già in uso` });
    }

    const adminEmail = body.adminEmail.trim().toLowerCase();
    const passwordHash = await hashPassword(body.adminPassword);

    const created = await dbSuper.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(tenants)
        .values({
          slug: body.slug,
          nome: body.nome,
          dominio: body.dominio ?? null,
          stato: 'attivo',
          piano: body.piano,
          pianoScadenza: body.pianoScadenza ?? null,
          note: body.note ?? null,
          cleanupAfterDays: body.cleanupAfterDays ?? 30,
          require2faAdmin: body.require2faAdmin ?? false,
        })
        .returning();
      await tx.insert(accounts).values({
        tenantId: tenant!.id,
        email: adminEmail,
        passwordHash,
        role: 'admin',
        attivo: true,
        emailVerified: true,
      });
      return tenant!;
    });

    await auditChange(req, 'platform.tenant.create', created, {
      piano: body.piano,
      adminEmail,
    });

    return reply.code(201).send(publicTenant(created));
  });

  /**
   * PATCH /tenants/:id → aggiorna meta (nome, piano, dominio, note, cleanup, 2FA flag)
   */
  app.patch('/tenants/:id', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = updateTenantBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    const body = parsed.data;

    const current = await findTenant(id);
    if (!current) return reply.notFound();

    const update: Partial<TenantRow> = { updatedAt: new Date() };
    if (body.nome !== undefined) update.nome = body.nome;
    if (body.piano !== undefined) update.piano = body.piano;
    if (body.pianoScadenza !== undefined) update.pianoScadenza = body.pianoScadenza;
    if (body.dominio !== undefined) update.dominio = body.dominio;
    if (body.note !== undefined) update.note = body.note;
    if (body.require2faAdmin !== undefined) update.require2faAdmin = body.require2faAdmin;

    // Modifica cleanup_after_days: se il tenant è già archiviato, ricalcola cleanup_scheduled_at
    if (body.cleanupAfterDays !== undefined) {
      update.cleanupAfterDays = body.cleanupAfterDays;
      if (current.stato === 'archiviato' && current.archiviatoAt) {
        const scheduled = new Date(current.archiviatoAt);
        scheduled.setDate(scheduled.getDate() + body.cleanupAfterDays);
        update.cleanupScheduledAt = scheduled;
      }
    }

    const [updated] = await dbSuper.update(tenants).set(update).where(eq(tenants.id, id)).returning();
    await auditChange(req, 'platform.tenant.update', updated!, { changes: body });
    return publicTenant(updated!);
  });

  /**
   * POST /tenants/:id/suspend → stato attivo → sospeso
   */
  app.post('/tenants/:id/suspend', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const current = await findTenant(id);
    if (!current) return reply.notFound();
    if (!guardPlatformTenant(current, reply)) return reply;
    if (current.stato !== 'attivo') {
      return reply.code(409).send({ error: `tenant in stato ${current.stato}, non sospendibile` });
    }
    const [updated] = await dbSuper
      .update(tenants)
      .set({ stato: 'sospeso', updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning();
    await auditChange(req, 'platform.tenant.suspend', updated!, { from: current.stato });
    return publicTenant(updated!);
  });

  /**
   * POST /tenants/:id/reactivate → stato sospeso → attivo
   */
  app.post('/tenants/:id/reactivate', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const current = await findTenant(id);
    if (!current) return reply.notFound();
    if (!guardPlatformTenant(current, reply)) return reply;
    if (current.stato !== 'sospeso') {
      return reply.code(409).send({ error: `tenant in stato ${current.stato}, non riattivabile` });
    }
    const [updated] = await dbSuper
      .update(tenants)
      .set({ stato: 'attivo', updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning();
    await auditChange(req, 'platform.tenant.reactivate', updated!, { from: current.stato });
    return publicTenant(updated!);
  });

  /**
   * POST /tenants/:id/archive → stato attivo|sospeso → archiviato
   * Body opzionale: { cleanupAfterDays } per override puntuale.
   */
  app.post('/tenants/:id/archive', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = archiveBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    const current = await findTenant(id);
    if (!current) return reply.notFound();
    if (!guardPlatformTenant(current, reply)) return reply;
    if (current.stato === 'archiviato') {
      return reply.code(409).send({ error: 'tenant già archiviato' });
    }

    const cleanupDays = parsed.data?.cleanupAfterDays ?? current.cleanupAfterDays;
    const archiviatoAt = new Date();
    const cleanupScheduledAt = cleanupDays > 0
      ? new Date(archiviatoAt.getTime() + cleanupDays * 86400_000)
      : null;

    const [updated] = await dbSuper
      .update(tenants)
      .set({
        stato: 'archiviato',
        archiviatoAt,
        cleanupAfterDays: cleanupDays,
        cleanupScheduledAt,
        updatedAt: archiviatoAt,
      })
      .where(eq(tenants.id, id))
      .returning();

    await auditChange(req, 'platform.tenant.archive', updated!, {
      from: current.stato,
      cleanupAfterDays: cleanupDays,
      cleanupScheduledAt,
    });
    return publicTenant(updated!);
  });

  /**
   * POST /tenants/:id/restore → da archiviato torna ad attivo (finché il cleanup non è scattato)
   */
  app.post('/tenants/:id/restore', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const current = await findTenant(id);
    if (!current) return reply.notFound();
    if (current.stato !== 'archiviato') {
      return reply.code(409).send({ error: `tenant in stato ${current.stato}, non ripristinabile` });
    }
    const [updated] = await dbSuper
      .update(tenants)
      .set({
        stato: 'attivo',
        archiviatoAt: null,
        cleanupScheduledAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(tenants.id, id), eq(tenants.stato, 'archiviato')))
      .returning();
    await auditChange(req, 'platform.tenant.restore', updated!, { from: current.stato });
    return publicTenant(updated!);
  });

  /**
   * DELETE /tenants/:id → hard-delete immediato. Tutte le entità cascade-cancellano.
   * Il record platform_audit_log sopravvive (no FK cascade).
   */
  app.delete('/tenants/:id', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const current = await findTenant(id);
    if (!current) return reply.notFound();
    if (!guardPlatformTenant(current, reply)) return reply;

    await auditChange(req, 'platform.tenant.hard_delete', current, {
      stato_at_delete: current.stato,
      slug: current.slug,
      nome: current.nome,
    });
    await dbSuper.delete(tenants).where(eq(tenants.id, id));
    return reply.code(204).send();
  });

  /**
   * GET /audit → platform_audit_log con filtri base
   */
  app.get('/audit', { preHandler: platformGuards }, async (req, reply) => {
    const parsed = auditQuery.safeParse(req.query);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    const { limit, before, action, tenantId } = parsed.data;

    const conditions = [] as ReturnType<typeof eq>[];
    if (action) conditions.push(eq(platformAuditLog.action, action));
    if (tenantId) conditions.push(eq(platformAuditLog.targetTenantId, tenantId));
    if (before) conditions.push(sql`${platformAuditLog.createdAt} < ${new Date(before)}`);

    const rows = await dbSuper
      .select()
      .from(platformAuditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(platformAuditLog.createdAt))
      .limit(limit);
    return rows;
  });

  /**
   * GET /tenants/:id/config → override per-tenant in tenant_config
   */
  app.get('/tenants/:id/config', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const t = await findTenant(id);
    if (!t) return reply.notFound();
    const rows = await dbSuper
      .select()
      .from(tenantConfig)
      .where(eq(tenantConfig.tenantId, id))
      .limit(1);
    return rows[0] ?? null;
  });

  /**
   * POST /tenants/:id/change-plan → cambia piano + scadenza + override limiti
   * (combina UPDATE tenants + UPSERT tenant_config in una transazione + audit)
   */
  app.post('/tenants/:id/change-plan', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = changePlanBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    const body = parsed.data;

    const current = await findTenant(id);
    if (!current) return reply.notFound();

    const updated = await dbSuper.transaction(async (tx) => {
      const [t] = await tx
        .update(tenants)
        .set({
          piano: body.piano,
          pianoScadenza: body.pianoScadenza ?? null,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, id))
        .returning();

      if (body.overrides) {
        const o = body.overrides;
        const existing = await tx
          .select()
          .from(tenantConfig)
          .where(eq(tenantConfig.tenantId, id))
          .limit(1);
        if (existing[0]) {
          await tx
            .update(tenantConfig)
            .set({
              maxConcorsi: o.maxConcorsi ?? null,
              maxCommissari: o.maxCommissari ?? null,
              maxCandidatiPerConcorso: o.maxCandidatiPerConcorso ?? null,
              updatedAt: new Date(),
            })
            .where(eq(tenantConfig.tenantId, id));
        } else {
          await tx.insert(tenantConfig).values({
            tenantId: id,
            maxConcorsi: o.maxConcorsi ?? null,
            maxCommissari: o.maxCommissari ?? null,
            maxCandidatiPerConcorso: o.maxCandidatiPerConcorso ?? null,
          });
        }
      }
      return t!;
    });

    await auditChange(req, 'platform.tenant.change_plan', updated, {
      from: { piano: current.piano, pianoScadenza: current.pianoScadenza },
      to: { piano: body.piano, pianoScadenza: body.pianoScadenza ?? null },
      overrides: body.overrides ?? null,
    });

    return publicTenant(updated);
  });

  /**
   * GET /tenants/:id/smtp → stato della config SMTP del tenant (no password)
   */
  app.get('/tenants/:id/smtp', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const t = await findTenant(id);
    if (!t) return reply.notFound();
    const raw = t.smtpConfig;
    if (!raw) return { configured: false };
    return { configured: true, encrypted: isEncryptedSmtp(raw) };
  });

  /**
   * PUT /tenants/:id/smtp → salva config SMTP cifrata at-rest
   */
  app.put('/tenants/:id/smtp', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = smtpBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    const t = await findTenant(id);
    if (!t) return reply.notFound();

    const encrypted = encryptSmtp(parsed.data);
    await dbSuper
      .update(tenants)
      .set({ smtpConfig: encrypted, updatedAt: new Date() })
      .where(eq(tenants.id, id));
    invalidateTransporter(id);
    await auditChange(req, 'platform.tenant.smtp.update', t, {
      host: parsed.data.host,
      port: parsed.data.port,
      user: parsed.data.user,
    });
    return { ok: true };
  });

  /**
   * DELETE /tenants/:id/smtp → rimuove la config SMTP del tenant
   */
  app.delete('/tenants/:id/smtp', { preHandler: platformGuards }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const t = await findTenant(id);
    if (!t) return reply.notFound();
    await dbSuper
      .update(tenants)
      .set({ smtpConfig: null, updatedAt: new Date() })
      .where(eq(tenants.id, id));
    invalidateTransporter(id);
    await auditChange(req, 'platform.tenant.smtp.delete', t);
    return { ok: true };
  });

  /**
   * GET /backups → lista dei dump pre-hard-delete presenti in ARCHIVE_DIR.
   */
  app.get('/backups', { preHandler: platformGuards }, async () => {
    return await listBackups();
  });

  /**
   * POST /jobs/cleanup-tenants → trigger manuale del job di hard-delete
   * (utile per ops/test; il cron notturno fa la stessa cosa automaticamente).
   */
  app.post('/jobs/cleanup-tenants', { preHandler: platformGuards }, async (req) => {
    const result = await runTenantCleanup();
    await writePlatformAudit(req, 'platform.jobs.cleanup_manual', { payload: result });
    return result;
  });

  /**
   * GET /config → platform_config singleton (row id=1)
   */
  app.get('/config', { preHandler: platformGuards }, async () => {
    const rows = await dbSuper.select().from(platformConfig).where(eq(platformConfig.id, 1)).limit(1);
    return rows[0] ?? null;
  });

  /**
   * PATCH /config → aggiorna require2faSuperadmin / defaultCleanupDays
   */
  app.patch('/config', { preHandler: platformGuards }, async (req, reply) => {
    const parsed = updateConfigBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    const body = parsed.data;
    const update: Partial<typeof platformConfig.$inferSelect> = { updatedAt: new Date() };
    if (body.require2faSuperadmin !== undefined) update.require2faSuperadmin = body.require2faSuperadmin;
    if (body.defaultCleanupDays !== undefined) update.defaultCleanupDays = body.defaultCleanupDays;

    const [updated] = await dbSuper
      .update(platformConfig)
      .set(update)
      .where(eq(platformConfig.id, 1))
      .returning();
    await writePlatformAudit(req, 'platform.config.update', { payload: body });
    return updated ?? null;
  });
};
