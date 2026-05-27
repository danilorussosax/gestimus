// #1 — Port server-side dello scoring (math identica a frontend/src/lib/scoring.ts).
// Pure functions, nessun I/O. Serve al server per RICALCOLARE la classifica di
// una fase dal DB e verificare la lista `admitted` inviata dal client in conclude
// (prima il server salvava la lista senza alcuna verifica → classifica non
// verificabile). DEVE restare allineata al port frontend: stessa formula, stessi
// metodi di aggregazione, stesso trattamento dei voti mancanti (= 0, voluto).

export const PESI: Record<number, Record<string, number>> = {
  1: { tecnica: 0.40, interpretazione: 0.30, intonazione: 0.20, musicalita: 0.10 },
  2: { tecnica: 0.35, interpretazione: 0.35, intonazione: 0.15, musicalita: 0.15 },
  3: { tecnica: 0.30, interpretazione: 0.40, intonazione: 0.10, musicalita: 0.20 },
};

export const DEFAULT_CRITERI_KEYS = ['tecnica', 'interpretazione', 'intonazione', 'musicalita'] as const;
const DEFAULT_CRITERI_LABEL: Record<string, string> = {
  tecnica: 'Tecnica', interpretazione: 'Interpretazione', intonazione: 'Intonazione', musicalita: 'Musicalità',
};

export interface CriterioRuntime { key: string; label: string; peso: number; }

interface FaseLike {
  criteri?: unknown; pesi?: unknown; ordine?: unknown;
  metodoMedia?: unknown; metodo_media?: unknown; scala?: unknown;
}
export type FaseInput = FaseLike | number | null | undefined;

export function defaultCriteri(ordine = 1): CriterioRuntime[] {
  const w = PESI[ordine] ?? PESI[1]!;
  return DEFAULT_CRITERI_KEYS.map((k) => ({ key: k, label: DEFAULT_CRITERI_LABEL[k] ?? k, peso: w[k] ?? 0 }));
}

export function slugifyKey(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30) || 'crit';
}

export function getCriteri(faseOrOrdine: FaseInput): CriterioRuntime[] {
  if (faseOrOrdine != null && typeof faseOrOrdine === 'object') {
    const criteriRaw = faseOrOrdine.criteri;
    if (Array.isArray(criteriRaw) && criteriRaw.length > 0) {
      return (criteriRaw as unknown[]).map((raw, i) => {
        const c = (raw ?? {}) as { key?: unknown; label?: unknown; peso?: unknown };
        return {
          key: (c.key || slugifyKey(c.label) || `crit_${i + 1}`) as string,
          label: (c.label || c.key || `Criterio ${i + 1}`) as string,
          peso: Number(c.peso) || 0,
        };
      });
    }
    const pesiRaw = faseOrOrdine.pesi;
    if (pesiRaw && typeof pesiRaw === 'object') {
      const pesi = pesiRaw as Record<string, unknown>;
      return DEFAULT_CRITERI_KEYS.map((k) => ({ key: k, label: DEFAULT_CRITERI_LABEL[k] ?? k, peso: Number(pesi[k]) || 0 }));
    }
    if (faseOrOrdine.ordine != null) return defaultCriteri(faseOrOrdine.ordine as number);
    return defaultCriteri(1);
  }
  return defaultCriteri(faseOrOrdine as number | undefined);
}

// DESIGN CHOICE (come frontend): un criterio non votato (chiave assente) → 0.
function votoCriterio(voti: Record<string, unknown> | null | undefined, key: string): number {
  const raw = voti?.[key];
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// Criteri runtime dai record DB (entità criteri; peso 0-100). La chiave deriva
// dal nome (slug) e coincide con la `criterio` salvata nelle valutazioni.
export function criteriFromRecords(records: readonly unknown[] | null | undefined): CriterioRuntime[] {
  if (!Array.isArray(records)) return [];
  return (records as readonly unknown[]).map((raw, i) => {
    const c = raw as { key?: unknown; nome?: unknown; label?: unknown; peso?: unknown } | null | undefined;
    return {
      key: (c?.key || slugifyKey(c?.nome ?? c?.label) || `crit_${i + 1}`) as string,
      label: (c?.nome ?? c?.label ?? `Criterio ${i + 1}`) as string,
      peso: Number(c?.peso) || 0,
    };
  });
}

function pesatoVoti(criteri: CriterioRuntime[], voti: Record<string, unknown> | null | undefined): number {
  let num = 0, den = 0;
  for (const c of criteri) {
    const w = c.peso || 0;
    num += votoCriterio(voti, c.key) * w;
    den += w;
  }
  if (den > 0) return num / den;
  if (criteri.length === 0) return 0;
  return criteri.reduce((s, c) => s + votoCriterio(voti, c.key), 0) / criteri.length;
}

export interface ValutazioneRaw { commissario_id: string; criterio: string; voto: number; [k: string]: unknown; }

export function mediaCandidato(valutazioni: ValutazioneRaw[], faseOrOrdine: FaseInput): number {
  const criteri = getCriteri(faseOrOrdine);
  const metodo = getMetodoMedia(faseOrOrdine);
  const byCom: Record<string, Record<string, unknown>> = {};
  valutazioni.forEach((v) => { (byCom[v.commissario_id] ??= {})[v.criterio] = v.voto; });
  const totals = Object.values(byCom).map((voti) => pesatoVoti(criteri, voti));
  if (!totals.length) return 0;
  return computeAggregate(totals, metodo);
}

const METODI = new Set(['aritmetica', 'olimpica', 'winsorizzata', 'mediana', 'deviazione_std']);
export function getMetodoMedia(fase: FaseInput): string {
  if (!fase || typeof fase !== 'object') return 'aritmetica';
  const m = (fase.metodoMedia ?? fase.metodo_media) as string;
  return METODI.has(m) ? m : 'aritmetica';
}

function aritmeticaArr(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}
function olimpicaArr(arr: number[]): number {
  if (arr.length <= 2) return aritmeticaArr(arr);
  const sorted = [...arr].sort((a, b) => a - b);
  return aritmeticaArr(sorted.slice(1, -1));
}
function winsorizzataArr(arr: number[]): number {
  if (arr.length <= 2) return aritmeticaArr(arr);
  const sorted = [...arr].sort((a, b) => a - b);
  const capped = [...sorted];
  capped[0] = sorted[1]!;
  capped[capped.length - 1] = sorted[sorted.length - 2]!;
  return aritmeticaArr(capped);
}
function medianaArr(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2 === 1) return sorted[(n - 1) / 2]!;
  return (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}
function deviazioneStdArr(arr: number[], k = 2): number {
  if (arr.length < 3) return aritmeticaArr(arr);
  const mean = aritmeticaArr(arr);
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (arr.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return mean;
  const filtered = arr.filter((v) => Math.abs(v - mean) <= k * std);
  return aritmeticaArr(filtered.length ? filtered : arr);
}

export function computeAggregate(values: unknown, metodo = 'aritmetica'): number {
  const vals = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v)) as number[];
  switch (metodo) {
    case 'olimpica': return olimpicaArr(vals);
    case 'winsorizzata': return winsorizzataArr(vals);
    case 'mediana': return medianaArr(vals);
    case 'deviazione_std': return deviazioneStdArr(vals);
    default: return aritmeticaArr(vals);
  }
}
