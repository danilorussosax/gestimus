/**
 * system-metrics — campionamento periodico delle risorse del processo Node in
 * un ring buffer in-memory, per alimentare le card RAM/CPU del super-admin con
 * una finestra di 24h.
 *
 * Le metriche sono PER-PROCESSO (rss/heap/cpu del solo Node): hanno senso solo
 * per la vita del processo, quindi il buffer è in-memory e si resetta al
 * restart (nessuna persistenza DB necessaria). Default: 1 campione/60s × 1440
 * = 24h.
 */
import os from 'node:os';

export interface SystemSample {
  ts: number; // epoch ms
  rssMb: number;
  heapUsedMb: number;
  cpuPct: number; // % CPU del processo, 1 core = 100 (può superare su multi-core)
  loadAvg1: number; // load medio di sistema a 1 min
}

export const SAMPLE_INTERVAL_MS = 60_000;
const MAX_SAMPLES = 1440; // 24h a 60s

const ring: SystemSample[] = [];
let timer: NodeJS.Timeout | null = null;

async function takeSample(): Promise<SystemSample> {
  const SAMPLE_WINDOW_MS = 200;
  const startCpu = process.cpuUsage();
  await new Promise((r) => setTimeout(r, SAMPLE_WINDOW_MS));
  const el = process.cpuUsage(startCpu); // µs (user+system)
  const cores = os.cpus().length;
  const pctRaw = ((el.user + el.system) / (SAMPLE_WINDOW_MS * 1000)) * 100;
  const pct = Math.min(pctRaw, cores * 100);
  const mem = process.memoryUsage();
  const [l1] = os.loadavg();
  return {
    ts: Date.now(),
    rssMb: Math.round(mem.rss / (1024 * 1024)),
    heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    cpuPct: Number(pct.toFixed(1)),
    loadAvg1: Number((l1 ?? 0).toFixed(2)),
  };
}

function push(s: SystemSample): void {
  ring.push(s);
  if (ring.length > MAX_SAMPLES) ring.shift();
}

/** Avvia il sampler (idempotente). Il timer è unref'd: non tiene vivo il processo. */
export function startSystemMetricsSampler(): () => void {
  if (timer) return () => {};
  void takeSample().then(push).catch(() => {}); // primo campione immediato
  timer = setInterval(() => {
    void takeSample().then(push).catch(() => {});
  }, SAMPLE_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

/** Copia immutabile dei campioni accumulati (max 24h). */
export function getSystemHistory(): SystemSample[] {
  return ring.slice();
}
