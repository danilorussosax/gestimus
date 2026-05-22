import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { dbApp, dbSuper } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { env } from '../env.js';

export type TenantContext = {
  id: string;
  slug: string;
  nome: string;
  stato: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    tenant: TenantContext | null;
    isSuperadmin: boolean;
    /**
     * Run callback inside a DB transaction where app.current_tenant is set,
     * so RLS policies filter automatically. Uses the gestimus_app pool.
     */
    dbTx: <T>(cb: (tx: TxClient) => Promise<T>) => Promise<T>;
  }
}

export type TxClient = Parameters<Parameters<typeof dbApp.transaction>[0]>[0];

function extractSubdomain(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.split(':')[0]!.toLowerCase();
  if (host === 'localhost') return null;
  // IPv4 letterale (es. 127.0.0.1) → no tenant
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  // IPv6 letterale (es. ::1, [::1])
  if (host.includes(':') || host === '::1') return null;
  const parts = host.split('.');
  if (parts.length < 2) return null;
  return parts[0] ?? null;
}

export async function registerTenantMiddleware(app: FastifyInstance): Promise<void> {
  app.decorateRequest('tenant', null);
  app.decorateRequest('isSuperadmin', false);
  app.decorateRequest('dbTx', null as any);

  app.addHook('onRequest', async (req, reply) => {
    const subdomain = extractSubdomain(req.headers.host);

    // Health/metrics e asset statici bypassano la risoluzione tenant.
    // (Gli endpoint /api/* e /auth/* hanno comunque bisogno del subdomain.)
    if (
      req.url === '/healthz' ||
      req.url === '/readyz' ||
      req.url === '/' ||
      req.url === '/favicon.ico' ||
      req.url === '/manifest.webmanifest' ||
      req.url === '/sw.js' ||
      req.url.startsWith('/js/') ||
      req.url.startsWith('/css/') ||
      req.url.startsWith('/uploads/') ||
      req.url.startsWith('/index.html')
    ) {
      // Anche se il subdomain non c'è (es. accesso via 127.0.0.1), lasciamo passare
      // per servire i file statici. Le route /api/* continueranno a richiedere tenant.
      if (subdomain === env.SUPERADMIN_SUBDOMAIN) {
        req.isSuperadmin = true;
      } else if (subdomain) {
        const found = await dbSuper.query.tenants.findFirst({
          where: eq(tenants.slug, subdomain),
          columns: { id: true, slug: true, nome: true, stato: true },
        });
        if (found && found.stato === 'attivo') req.tenant = found;
      }
      return;
    }

    if (subdomain === env.SUPERADMIN_SUBDOMAIN) {
      req.isSuperadmin = true;
      req.tenant = null;
      return;
    }

    if (!subdomain) {
      reply.code(400).send({ error: 'host header missing or invalid' });
      return reply;
    }

    // Risoluzione tenant via dbSuper (bypass RLS sulla tabella tenants)
    const found = await dbSuper.query.tenants.findFirst({
      where: eq(tenants.slug, subdomain),
      columns: { id: true, slug: true, nome: true, stato: true },
    });

    if (!found) {
      reply.code(404).send({ error: `tenant '${subdomain}' non trovato` });
      return reply;
    }

    if (found.stato !== 'attivo') {
      reply.code(403).send({ error: `tenant '${subdomain}' non attivo (${found.stato})` });
      return reply;
    }

    req.tenant = found;
  });

  // dbTx helper: apre transaction con SET LOCAL app.current_tenant
  app.addHook('preHandler', async (req: FastifyRequest) => {
    req.dbTx = async <T>(cb: (tx: TxClient) => Promise<T>) => {
      if (!req.tenant) {
        throw new Error('dbTx called without tenant context (use dbSuper for superadmin routes)');
      }
      return dbApp.transaction(async (tx) => {
        await tx.execute(sql`SELECT app_set_tenant(${req.tenant!.id}::uuid)`);
        return cb(tx);
      });
    };
  });
}
