import type { FastifyPluginAsync, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import os from 'node:os';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
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
import { invalidateTenantCache } from '../middleware/tenant.js';
import { hashPassword } from '../services/password.js';
import { writePlatformAudit } from '../services/audit.js';
import { listBackups } from '../services/backup.js';
import { runTenantCleanup } from '../services/cleanup.js';
import { encryptSmtp, isEncryptedSmtp } from '../services/crypto-smtp.js';
import { invalidateTransporter } from '../services/email.js';
import { readdir, stat as fsStat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { env } from '../env.js';

const TENANT_STATES = ['attivo', 'sospeso', 'archiviato'] as const;
const TENANT_PLANS = ['trial', 'starter', 'pro', 'ultra', 'ppe'] as const;
const PLATFORM_SLUG = 'platform';

// M4: cache breve dello snapshot /system (il campionamento CPU costa 200ms).
let systemSnapshotCache: { data: unknown; expiresAt: number } | null = null;
// N50: single-flight. Quando la cache scade, solo la prima richiesta calcola lo
// snapshot (sleep 200ms per CPU sampling); le concorrenti attendono la stessa
// promise invece di samplare anche loro → niente stampede.
let systemSnapshotInflight: Promise<unknown> | null = null;

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
 * M13: I/O già non bloccante (fs/promises); processiamo le entry in parallelo
 * con Promise.all così la latenza è O(profondità) anziché O(numero file).
 */
async function dirSizeBytes(path: string): Promise<number> {
  // N38: difesa-in-profondità contro path traversal. Lo slug è validato a
  // creazione tenant, ma se quella validazione venisse indebolita un path tipo
  // `../../etc` sfuggirebbe da UPLOADS_DIR. Rifiutiamo qualsiasi path che, una
  // volta risolto, non resti sotto UPLOADS_DIR.
  const root = resolve(env.UPLOADS_DIR);
  const resolved = resolve(path);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    return 0;
  }
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await Promise.all(
    entries.map(async (e) => {
      const full = join(path, e.name);
      if (e.isDirectory()) return dirSizeBytes(full);
      if (e.isFile()) {
        try {
          return (await fsStat(full)).size;
        } catch {
          return 0;
        }
      }
      return 0;
    }),
  );
  return sizes.reduce((a, b) => a + b, 0);
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
  // H7: ogni mutation su un tenant invalida la cache di risoluzione subdomain,
  // così sospensioni/archiviazioni/rinomine prendono effetto immediato senza
  // attendere il TTL di 60s.
  invalidateTenantCache(tenant.slug);
  await writePlatformAudit(req, action, {
    targetTenantId: tenant.id,
    targetTenantSlug: tenant.slug,
    payload,
  });
}

export const platformRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /tenants?stato=attivo|sospeso|archiviato|all&includePlatform=true (default: all)
   *
   * Il tenant tecnico 'platform' (contenitore dell'account super-admin) viene
   * escluso di default — non è un cliente. Per includerlo (debug/diagnostica)
   * passare ?includePlatform=true.
   */
  app.get('/tenants', { preHandler: platformGuards }, async (req) => {
    const query = z
      .object({
        stato: z.enum([...TENANT_STATES, 'all']).default('all'),
        includePlatform: z
          .union([z.boolean(), z.literal('true'), z.literal('false')])
          .default(false)
          .transform((v) => v === true || v === 'true'),
      })
      .parse(req.query);

    const conditions: ReturnType<typeof eq>[] = [];
    if (query.stato !== 'all') conditions.push(eq(tenants.stato, query.stato));
    if (!query.includePlatform) {
      conditions.push(sql`${tenants.slug} <> ${PLATFORM_SLUG}` as unknown as ReturnType<typeof eq>);
    }

    const rows = conditions.length
      ? await dbSuper.select().from(tenants).where(and(...conditions)).orderBy(asc(tenants.slug))
      : await dbSuper.select().from(tenants).orderBy(asc(tenants.slug));
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

    let created;
    try {
      created = await dbSuper.transaction(async (tx) => {
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
    } catch (err) {
      // N48: la SELECT-then-INSERT non è atomica. Due create concorrenti con lo
      // stesso slug passano entrambe la SELECT sopra, poi l'INSERT fallisce con
      // 23505 sul vincolo unique slug. Mappiamo a 409 invece di 500.
      const e = err as { code?: string; cause?: { code?: string } };
      if ((e.code ?? e.cause?.code) === '23505') {
        return reply.code(409).send({ error: `slug "${body.slug}" già in uso` });
      }
      throw err;
    }

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
    // N55: condizione stato nella WHERE → se un'altra richiesta cambia lo stato
    // tra il SELECT e l'UPDATE, l'update non matcha (0 righe) e ritorniamo 409
    // invece di crashare con `updated!` su undefined.
    const [updated] = await dbSuper
      .update(tenants)
      .set({ stato: 'sospeso', updatedAt: new Date() })
      .where(and(eq(tenants.id, id), eq(tenants.stato, 'attivo')))
      .returning();
    if (!updated) return reply.code(409).send({ error: 'stato cambiato concorrentemente' });
    await auditChange(req, 'platform.tenant.suspend', updated, { from: current.stato });
    return publicTenant(updated);
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
      .where(and(eq(tenants.id, id), eq(tenants.stato, 'sospeso')))
      .returning();
    if (!updated) return reply.code(409).send({ error: 'stato cambiato concorrentemente' });
    await auditChange(req, 'platform.tenant.reactivate', updated, { from: current.stato });
    return publicTenant(updated);
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
      // N55: non archiviare se nel frattempo è già stato archiviato.
      .where(and(eq(tenants.id, id), ne(tenants.stato, 'archiviato')))
      .returning();
    if (!updated) return reply.code(409).send({ error: 'stato cambiato concorrentemente' });

    await auditChange(req, 'platform.tenant.archive', updated, {
      from: current.stato,
      cleanupAfterDays: cleanupDays,
      cleanupScheduledAt,
    });
    return publicTenant(updated);
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
    if (!updated) return reply.code(409).send({ error: 'stato cambiato concorrentemente' });
    await auditChange(req, 'platform.tenant.restore', updated, { from: current.stato });
    return publicTenant(updated);
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
   * GET /runtime → aggregato runtime per-tenant sulla sliding window di 60s.
   * Restituisce un oggetto { [tenantId]: { reqCountMin, reqPerSec,
   * latencyP50Ms, latencyP95Ms, errorRate, lastSeenSec } } per i soli tenant
   * con traffico recente. Tenant assenti sottintendono "idle".
   */
  app.get('/runtime', { preHandler: platformGuards }, async () => {
    const { getRuntimeMetrics } = await import('../middleware/runtime-metrics.js');
    return { tenants: getRuntimeMetrics(), generatedAt: new Date().toISOString() };
  });

  /**
   * GET /system → snapshot risorse del processo Node + host (memoria, CPU
   * istantanea del processo, load medio di sistema, uptime).
   *
   * La CPU istantanea viene calcolata via `process.cpuUsage()` campionato due
   * volte a distanza di SAMPLE_WINDOW_MS. Riporta il consumo del solo processo
   * Node (non l'intero host) normalizzato a 1 core: 100% = un core saturo.
   * Su processi multi-thread può superare 100% se più worker lavorano in
   * parallelo (cappiamo a cores*100 per evitare numeri assurdi).
   *
   * `loadAvg1/5/15` resta esposto come metrica complementare di sistema
   * (include I/O wait): la card client lo mostra come "load di sistema".
   */
  app.get('/system', { preHandler: platformGuards }, async () => {
    // M4: il campionamento CPU blocca la richiesta per 200ms. Cachiamo il
    // risultato per 5s così richieste ravvicinate (polling dashboard ogni 5s,
    // più tab aperti) non scommano blocchi né aprono la porta a un DoS leggero.
    const now = Date.now();
    if (systemSnapshotCache && systemSnapshotCache.expiresAt > now) {
      return systemSnapshotCache.data;
    }
    // N50: single-flight. Se un calcolo è già in corso, attendi quello.
    if (systemSnapshotInflight) {
      return systemSnapshotInflight;
    }
    const compute = async (): Promise<unknown> => {
      const SAMPLE_WINDOW_MS = 200;
      const startCpu = process.cpuUsage();
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_WINDOW_MS));
      const elapsedCpu = process.cpuUsage(startCpu); // diff in µs (user+system)
      const cores = os.cpus().length;
      const windowMicros = SAMPLE_WINDOW_MS * 1000;
      const processPctRaw = ((elapsedCpu.user + elapsedCpu.system) / windowMicros) * 100;
      const processPct = Math.min(processPctRaw, cores * 100);

      const mem = process.memoryUsage();
      const [load1, load5, load15] = os.loadavg();
      const data = {
        memory: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
        },
        cpu: {
          cores,
          // % CPU istantanea del processo Node (campionata su 200ms).
          // 100% = un core saturo. Su multi-thread può salire fino a cores*100.
          processPct: Number(processPct.toFixed(1)),
          // Media di sistema (include altri processi e I/O wait): retro-
          // compatibile + utile come trend.
          loadAvg1: load1 ?? 0,
          loadAvg5: load5 ?? 0,
          loadAvg15: load15 ?? 0,
        },
        uptimeSec: Math.floor(process.uptime()),
      };
      systemSnapshotCache = { data, expiresAt: Date.now() + 5000 };
      return data;
    };
    systemSnapshotInflight = compute().finally(() => { systemSnapshotInflight = null; });
    return systemSnapshotInflight;
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
