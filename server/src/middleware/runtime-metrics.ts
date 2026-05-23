import type { FastifyInstance } from 'fastify';

// Sliding window di 60 secondi con tutte le richieste recenti per-tenant.
// Tenuto in memoria: il restart del processo azzera (è una metrica "real-time
// instant", non una serie storica). Per persistenza vera serve una tabella
// time-series (Fase 3, non in scope).
type ReqSample = {
  tenantId: string;
  ts: number; // ms epoch
  latencyMs: number;
  statusCode: number;
};

const WINDOW_MS = 60_000;
// N6: cap duro sul numero di campioni vivi. Sotto carico estremo (migliaia
// req/s) la finestra 60s potrebbe contenere centinaia di migliaia di sample
// prima del prune; il cap limita la memoria a O(MAX_SAMPLES) scartando i più
// vecchi (le metriche restano statisticamente valide su un campione ampio).
const MAX_SAMPLES = 50_000;
// M18: deque con head-pointer invece di Array.shift() (O(n)). pruneOld avanza
// `head`; quando l'area morta in testa supera metà array, compattiamo una sola
// volta. Ammortizzato O(1) per richiesta anche sotto carico.
const recentRequests: ReqSample[] = [];
let head = 0;

function liveSamples(): ReqSample[] {
  return recentRequests.slice(head);
}

// hrTime/Date.now sentinel posto sulla request dal hook onRequest, letto
// dall'onResponse per calcolare la latenza con precisione monotonic-clock.
declare module 'fastify' {
  interface FastifyRequest {
    _runtimeStart?: bigint;
  }
}

function pruneOld(now: number): void {
  while (head < recentRequests.length && now - recentRequests[head]!.ts > WINDOW_MS) {
    head++;
  }
  // Compatta quando l'area morta in testa è grande: evita crescita illimitata
  // dell'array sottostante mantenendo lo shift ammortizzato O(1).
  if (head > 1024 && head * 2 > recentRequests.length) {
    recentRequests.splice(0, head);
    head = 0;
  }
}

/**
 * Registra hook globali per misurare latenza per-request e mantenere una
 * sliding window di 60s. Da chiamare DOPO registerTenantMiddleware così
 * `req.tenant` è già risolto al momento dell'onResponse.
 */
export function registerRuntimeMetrics(app: FastifyInstance): void {
  app.addHook('onRequest', async (req) => {
    req._runtimeStart = process.hrtime.bigint();
  });
  app.addHook('onResponse', async (req, reply) => {
    const tenantId = req.tenant?.id;
    if (!tenantId) return; // public/healthz/superadmin: non aggregabile per-tenant
    const start = req._runtimeStart;
    if (start === undefined) return;
    const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const now = Date.now();
    pruneOld(now);
    recentRequests.push({
      tenantId,
      ts: now,
      latencyMs,
      statusCode: reply.statusCode,
    });
    // N6: cap duro. Se i sample vivi superano MAX_SAMPLES, scarta i più vecchi
    // avanzando head (e compatta subito per non far crescere l'array).
    if (recentRequests.length - head > MAX_SAMPLES) {
      head = recentRequests.length - MAX_SAMPLES;
      recentRequests.splice(0, head);
      head = 0;
    }
  });
}

export type TenantRuntimeStats = {
  reqCountMin: number; // richieste nell'ultimo minuto
  reqPerSec: number;   // media req/s
  latencyP50Ms: number;
  latencyP95Ms: number;
  errorRate: number;   // 0..1 — quota di status >= 500 sul totale
  lastSeenSec: number; // secondi dall'ultima richiesta (-1 se mai vista)
};

/**
 * Aggregato per-tenant sulla sliding window corrente. Tenant senza traffico
 * recente NON sono inclusi: il caller (route) decide se mostrare 0 o nulla.
 */
export function getRuntimeMetrics(): Record<string, TenantRuntimeStats> {
  const now = Date.now();
  pruneOld(now);
  const byTenant = new Map<string, ReqSample[]>();
  for (const r of liveSamples()) {
    const arr = byTenant.get(r.tenantId) ?? [];
    arr.push(r);
    byTenant.set(r.tenantId, arr);
  }
  const out: Record<string, TenantRuntimeStats> = {};
  for (const [tid, samples] of byTenant) {
    const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
    // L3: nearest-rank con indice interpolato basso. Per len=4, p50 → idx 1.
    const pIdx = (p: number) => Math.max(0, Math.floor((latencies.length - 1) * p));
    const idx50 = pIdx(0.5);
    const idx95 = pIdx(0.95);
    const errors = samples.filter((s) => s.statusCode >= 500).length;
    const lastTs = samples[samples.length - 1]!.ts;
    out[tid] = {
      reqCountMin: samples.length,
      reqPerSec: Number((samples.length / 60).toFixed(2)),
      latencyP50Ms: Math.round(latencies[idx50] ?? 0),
      latencyP95Ms: Math.round(latencies[idx95] ?? 0),
      errorRate: samples.length > 0 ? Number((errors / samples.length).toFixed(3)) : 0,
      lastSeenSec: Math.round((now - lastTs) / 1000),
    };
  }
  return out;
}
