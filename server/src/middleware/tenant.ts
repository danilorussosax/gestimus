import { eq, sql } from 'drizzle-orm';
import { domainToASCII } from 'node:url';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { dbApp, dbSuper } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { subscribe } from '../realtime/hub.js';

export type TenantContext = {
  id: string;
  slug: string;
  nome: string;
  stato: string;
  pianoScadenza: string | null;
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
  const label = parts[0];
  if (!label) return null;
  // M199: normalizzazione IDN/Punycode. Senza, `café` e `xn--caf-dma`
  // resolverebbero a slug diversi (uno non troverebbe il tenant). domainToASCII
  // converte gli IDN Unicode nella forma ASCII canonica (idempotente sugli ASCII).
  return domainToASCII(label) || label;
}

// H7: cache LRU per la risoluzione subdomain → tenant. Ogni richiesta HTTP
// (anche asset statici) altrimenti eseguirebbe un SELECT su dbSuper. Cache
// in-memory, TTL 60s, invalidata esplicitamente da invalidateTenantCache()
// quando il super-admin modifica/sospende un tenant.
const TENANT_CACHE_TTL_MS = 60_000;
const TENANT_CACHE_MAX = 256;
const tenantCache = new Map<string, { row: TenantContext | null; expiresAt: number }>();
// M200: single-flight. Alla scadenza del TTL, N richieste concorrenti per lo
// stesso subdomain farebbero N query identiche su dbSuper (thundering herd).
// Condividiamo una sola promise in volo per subdomain.
const tenantInFlight = new Map<string, Promise<TenantContext | null>>();

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

// #1: invalidazione cross-istanza. invalidateTenantCache() agisce solo sul Map
// in-process dell'ISTANZA che esegue la modifica. Dietro un load balancer con
// 2+ istanze, le altre continuerebbero a servire il tenant stale (es. sospeso
// per mancato pagamento / ordine legale, oppure uno slug riassegnato a un altro
// cliente) fino alla scadenza del TTL di 60s. broadcastTenantInvalidation()
// invalida la copia locale E notifica via Postgres LISTEN/NOTIFY tutte le
// istanze, che invalidano la propria. Riusa il client LISTEN dell'hub realtime.
const TENANT_CACHE_INVALIDATION_CHANNEL = 'tenant_cache_invalidation';

export async function broadcastTenantInvalidation(slug?: string): Promise<void> {
  // Invalidazione locale immediata (sincrona, non può fallire).
  invalidateTenantCache(slug);
  // Broadcast alle altre istanze. Best-effort: un errore sul NOTIFY non deve far
  // fallire la mutazione tenant chiamante — l'invalidazione locale è già fatta e
  // sulle altre istanze resta al più la finestra di 60s del TTL (= comportamento
  // pre-fix). Payload: lo slug, o '' per un clear totale (slug assente).
  try {
    await dbSuper.execute(
      sql`SELECT pg_notify(${TENANT_CACHE_INVALIDATION_CHANNEL}, ${slug ?? ''})`,
    );
  } catch (err) {
    logger.warn(
      { module: 'tenant', slug, err: (err as Error).message },
      'broadcast invalidazione cache tenant fallito (invalidazione locale comunque applicata)',
    );
  }
}

// Avvia il listener che invalida la cache locale quando un'ALTRA istanza (o
// questa stessa) emette una NOTIFY su TENANT_CACHE_INVALIDATION_CHANNEL.
// DEVE essere chiamato dopo startRealtimeHub() (usa il client LISTEN dell'hub).
export async function startTenantCacheInvalidationListener(): Promise<void> {
  await subscribe(TENANT_CACHE_INVALIDATION_CHANNEL, (payload) => {
    // payload arriva come stringa raw (slug) o null/'' → clear totale. L'hub
    // tenta JSON.parse: uno slug numerico ("123") diventa number → ricoerciamo.
    if (payload === null || payload === undefined || payload === '') {
      invalidateTenantCache();
      return;
    }
    invalidateTenantCache(String(payload));
  });
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
  // M200: se un lookup per questo subdomain è già in volo, riusalo.
  const pending = tenantInFlight.get(subdomain);
  if (pending) return pending;
  const promise = (async (): Promise<TenantContext | null> => {
    try {
      const found = await dbSuper.query.tenants.findFirst({
        where: eq(tenants.slug, subdomain),
        columns: { id: true, slug: true, nome: true, stato: true, pianoScadenza: true },
      });
      const row = found ?? null;
      if (tenantCache.size >= TENANT_CACHE_MAX) {
        // Eviction LRU: la prima chiave nell'ordine di iterazione è la meno
        // recentemente usata (le hit spostano in coda, vedi sopra).
        const firstKey = tenantCache.keys().next().value;
        if (firstKey !== undefined) tenantCache.delete(firstKey);
      }
      tenantCache.set(subdomain, { row, expiresAt: Date.now() + TENANT_CACHE_TTL_MS });
      return row;
    } finally {
      tenantInFlight.delete(subdomain);
    }
  })();
  tenantInFlight.set(subdomain, promise);
  return promise;
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
        if (found && found.stato === 'attivo') {
          req.tenant = found;
          // #9: arricchisci il logger così ogni log successivo porta il tenantId.
          req.log = req.log.child({ tenantId: found.id });
        }
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
      // #7: NON esporre lo stato esatto (sospeso/archiviato) a un chiamante non
      // autenticato — era un leak che permetteva di profilare i tenant per stato.
      // Restiamo su 403 (un tenant legittimo sospeso vede "non disponibile",
      // distinto dal 404 di slug inesistente) ma senza rivelare il perché.
      reply.code(403).send({ error: 'tenant non disponibile' });
      return reply;
    }

    req.tenant = found;
    // #9: arricchisci il logger così ogni log successivo porta il tenantId.
    req.log = req.log.child({ tenantId: found.id });
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
