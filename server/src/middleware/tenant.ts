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
  // L2: IPv4 letterale corretto (octet 0–255) → no tenant.
  if (/^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(host)) return null;
  // IPv6 letterale (es. ::1, [::1])
  if (host.includes(':') || host === '::1') return null;
  const parts = host.split('.');
  if (parts.length < 2) return null;
  return parts[0] ?? null;
}

// H7: cache LRU per la risoluzione subdomain → tenant. Ogni richiesta HTTP
// (anche asset statici) altrimenti eseguirebbe un SELECT su dbSuper. Cache
// in-memory, TTL 60s, invalidata esplicitamente da invalidateTenantCache()
// quando il super-admin modifica/sospende un tenant.
const TENANT_CACHE_TTL_MS = 60_000;
const TENANT_CACHE_MAX = 256;
const tenantCache = new Map<string, { row: TenantContext | null; expiresAt: number }>();

// N125 (falso positivo): NON è codice morto. È invocata centralmente da
// `auditChange()` in routes/platform.ts, che gira a OGNI mutazione del tenant
// (create, patch, suspend, reactivate, archive, restore, hard_delete,
// change_plan, smtp update/delete). Quindi sospensioni/archiviazioni/rename/
// delete invalidano sempre la cache (no finestra di 60s). Coperto anche il caso
// N128 (ri-creazione slug): create e delete invalidano entrambi lo slug.
export function invalidateTenantCache(slug?: string): void {
  if (slug) tenantCache.delete(slug);
  else tenantCache.clear();
}

async function resolveTenantBySubdomain(subdomain: string): Promise<TenantContext | null> {
  const now = Date.now();
  const cached = tenantCache.get(subdomain);
  if (cached && cached.expiresAt > now) {
    // N94: LRU reale. Map.set su una chiave esistente NON aggiorna l'ordine di
    // inserzione (spec ES6); senza questo re-insert l'eviction sarebbe FIFO e un
    // tenant molto acceduto ma inserito per primo verrebbe sfrattato prima di
    // uno inserito dopo e mai più usato. Re-inserire sposta la entry in coda.
    // (TTL invariato: la freshness non si rinnova sull'hit, solo la recency.)
    tenantCache.delete(subdomain);
    tenantCache.set(subdomain, cached);
    return cached.row;
  }
  const found = await dbSuper.query.tenants.findFirst({
    where: eq(tenants.slug, subdomain),
    columns: { id: true, slug: true, nome: true, stato: true },
  });
  const row = found ?? null;
  if (tenantCache.size >= TENANT_CACHE_MAX) {
    // Eviction LRU: la prima chiave nell'ordine di iterazione è la meno
    // recentemente usata (le hit spostano in coda, vedi sopra).
    const firstKey = tenantCache.keys().next().value;
    if (firstKey !== undefined) tenantCache.delete(firstKey);
  }
  tenantCache.set(subdomain, { row, expiresAt: now + TENANT_CACHE_TTL_MS });
  return row;
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
        const found = await resolveTenantBySubdomain(subdomain);
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

    // Risoluzione tenant via cache + dbSuper (bypass RLS sulla tabella tenants)
    const found = await resolveTenantBySubdomain(subdomain);

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
