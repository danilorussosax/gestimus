import type { FastifyPluginAsync } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { dbSuper } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

const enteBody = z.object({
  denominazione: z.string().max(255).optional(),
  sede: z.string().max(255).optional(),
  codiceFiscale: z.string().max(50).optional(),
  partitaIva: z.string().max(50).optional(),
  telefono: z.string().max(50).optional(),
  email: z.string().email().optional().or(z.literal('')),
  pec: z.string().email().optional().or(z.literal('')),
  sitoWeb: z.string().max(255).optional(),
  note: z.string().optional(),
});

// logoUrl può essere un dataURL base64 inline (PNG/WebP) oppure un path/URL.
// N46: branding_public è letto su OGNI richiesta non autenticata (GET
// /ente/public per la pagina di login). Un logo da 10MB rendeva ogni
// caricamento login una query da 10MB → DoS. Cap a ~1MB (≈750KB binari dopo
// base64). Per loghi più grandi va usato un URL esterno.
const MAX_LOGO_CHARS = 1_000_000;
const brandingBody = z.object({
  nomePubblico: z.string().max(255).optional(),
  sottotitolo: z.string().max(255).optional(),
  logoUrl: z.string().max(MAX_LOGO_CHARS).optional(),
  coloreAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  coloreSfondo: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const enteRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /ente → settings completi del tenant (richiede auth, admin/commissario)
   */
  app.get('/', { preHandler: [requireAuth] }, async (req) => {
    const rows = await dbSuper
      .select({
        id: tenants.id,
        slug: tenants.slug,
        nome: tenants.nome,
        dominio: tenants.dominio,
        piano: tenants.piano,
        enteSettings: tenants.enteSettings,
        brandingPublic: tenants.brandingPublic,
      })
      .from(tenants)
      .where(eq(tenants.id, req.tenant!.id))
      .limit(1);
    return rows[0];
  });

  /**
   * PATCH /ente (admin) → MERGE su ente_settings (no overwrite del JSONB).
   * Inviare solo i campi che cambiano; gli altri restano intatti.
   */
  app.patch('/', { preHandler: [requireAuth, requireRole('admin')] }, async (req, reply) => {
    const parsed = enteBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    // Merge JSONB lato server con `||`: atomico vs read-merge-write applicativo.
    // Due PATCH concorrenti producono il merge sequenziale corretto (last-write
    // wins per chiave, mai dropout cieco di campi).
    const patch = JSON.stringify(parsed.data);
    await dbSuper
      .update(tenants)
      .set({
        enteSettings: sql`COALESCE(${tenants.enteSettings}, '{}'::jsonb) || ${patch}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, req.tenant!.id));
    await req.dbTx(async (tx) => {
      await writeAudit(tx, req, 'ente.update', { targetType: 'tenant', targetId: req.tenant!.id });
    });
    return { ok: true };
  });

  /**
   * GET /ente/public → branding pubblico, accessibile SENZA auth (per la pagina di login)
   */
  app.get('/public', async (req) => {
    if (!req.tenant) return { configured: false };
    const rows = await dbSuper
      .select({
        slug: tenants.slug,
        nome: tenants.nome,
        brandingPublic: tenants.brandingPublic,
      })
      .from(tenants)
      .where(eq(tenants.id, req.tenant.id))
      .limit(1);
    return rows[0];
  });

  /**
   * PATCH /ente/branding (admin) → MERGE branding pubblico (no overwrite).
   */
  app.patch('/branding', { preHandler: [requireAuth, requireRole('admin')] }, async (req, reply) => {
    const parsed = brandingBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    const patch = JSON.stringify(parsed.data);
    await dbSuper
      .update(tenants)
      .set({
        brandingPublic: sql`COALESCE(${tenants.brandingPublic}, '{}'::jsonb) || ${patch}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, req.tenant!.id));
    await req.dbTx(async (tx) => {
      await writeAudit(tx, req, 'branding.update', {
        targetType: 'tenant',
        targetId: req.tenant!.id,
      });
    });
    return { ok: true };
  });
};
