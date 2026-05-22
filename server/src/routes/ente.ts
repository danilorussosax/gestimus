import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
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
  email: z.string().email().optional(),
  pec: z.string().email().optional(),
  sitoWeb: z.string().max(255).optional(),
  note: z.string().optional(),
});

const brandingBody = z.object({
  nomePubblico: z.string().max(255).optional(),
  sottotitolo: z.string().max(255).optional(),
  logoUrl: z.string().max(500).optional(),
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
   * PATCH /ente (admin) → aggiorna ente_settings
   */
  app.patch('/', { preHandler: [requireAuth, requireRole('admin')] }, async (req, reply) => {
    const parsed = enteBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    await dbSuper
      .update(tenants)
      .set({ enteSettings: parsed.data, updatedAt: new Date() })
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
   * PATCH /ente/branding (admin) → aggiorna branding pubblico
   */
  app.patch('/branding', { preHandler: [requireAuth, requireRole('admin')] }, async (req, reply) => {
    const parsed = brandingBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest(parsed.error.message);
    await dbSuper
      .update(tenants)
      .set({ brandingPublic: parsed.data, updatedAt: new Date() })
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
