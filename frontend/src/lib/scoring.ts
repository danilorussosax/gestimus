// Phase-specific evaluation logic. Port of js/scoring.js — identical math.
// Pure functions, no DOM/IO.

// Default weights per fase ordine (legacy spec).
export const PESI: Record<number, Record<string, number>> = {
  1: { tecnica: 0.40, interpretazione: 0.30, intonazione: 0.20, musicalita: 0.10 },
  2: { tecnica: 0.35, interpretazione: 0.35, intonazione: 0.15, musicalita: 0.15 },
  3: { tecnica: 0.30, interpretazione: 0.40, intonazione: 0.10, musicalita: 0.20 },
};

// Default criteri keys & labels.
export const DEFAULT_CRITERI_KEYS = ['tecnica', 'interpretazione', 'intonazione', 'musicalita'] as const;
export const DEFAULT_CRITERI_LABEL: Record<string, string> = {
  tecnica: 'Tecnica',
  interpretazione: 'Interpretazione',
  intonazione: 'Intonazione',
  musicalita: 'Musicalità',
};
// Legacy aliases.
export const CRITERI = DEFAULT_CRITERI_KEYS;
export const CRITERI_LABEL = DEFAULT_CRITERI_LABEL;

export interface CriterioRuntime {
  key: string;
  label: string;
  peso: number;
}

// Build the default criteri array for a given fase ordine.
export function defaultCriteri(ordine = 1): CriterioRuntime[] {
  const w = PESI[ordine] ?? PESI[1];
  return DEFAULT_CRITERI_KEYS.map((k) => ({
    key: k,
    label: DEFAULT_CRITERI_LABEL[k] ?? k,
    peso: w[k] ?? 0,
  }));
}

// Slugify a label into a safe key.
export function slugifyKey(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30) || 'crit';
}

// Resolve the criteri list of a fase. Supports:
//   • fase.criteri = [{key,label,peso}, …]  (preferred, dynamic)
//   • fase.pesi    = {tecnica:..., …}        (legacy mapping, builds default 4-criteri)
//   • else: defaults from PESI[ordine].
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCriteri(faseOrOrdine: any): CriterioRuntime[] {
  if (faseOrOrdine != null && typeof faseOrOrdine === 'object') {
    if (Array.isArray(faseOrOrdine.criteri) && faseOrOrdine.criteri.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return faseOrOrdine.criteri.map((c: any, i: number) => ({
        key: c.key || slugifyKey(c.label) || `crit_${i + 1}`,
        label: c.label || c.key || `Criterio ${i + 1}`,
        peso: Number(c.peso) || 0,
      }));
    }
    if (faseOrOrdine.pesi && typeof faseOrOrdine.pesi === 'object') {
      return DEFAULT_CRITERI_KEYS.map((k) => ({
        key: k,
        label: DEFAULT_CRITERI_LABEL[k] ?? k,
        peso: Number(faseOrOrdine.pesi[k]) || 0,
      }));
    }
    if (faseOrOrdine.ordine != null) return defaultCriteri(faseOrOrdine.ordine);
    return defaultCriteri(1);
  }
  return defaultCriteri(faseOrOrdine as number | undefined);
}

// Backward-compat: returns a {key: peso} map. Built from getCriteri.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPesiFor(faseOrOrdine: any): Record<string, number> {
  const out: Record<string, number> = {};
  getCriteri(faseOrOrdine).forEach((c) => { out[c.key] = c.peso ?? 0; });
  return out;
}

// Voto di un criterio dato l'oggetto voti di un commissario.
// DESIGN CHOICE: un criterio non ancora votato (chiave assente) contribuisce 0
// al totale pesato. Questo è VOLUTO — un voto legittimo di 0 e una chiave
// assente coincidono intenzionalmente (entrambi → 0).
function votoCriterio(voti: Record<string, unknown> | null | undefined, key: string): number {
  const raw = voti?.[key];
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// Total weighted score for a single commissario across the fase's criteri.
function pesatoVoti(criteri: CriterioRuntime[], voti: Record<string, unknown> | null | undefined): number {
  return criteri.reduce((s, c) => s + votoCriterio(voti, c.key) * (c.peso || 0), 0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pesato(voti: Record<string, unknown> | null | undefined, faseOrOrdine: any): number {
  return pesatoVoti(getCriteri(faseOrOrdine), voti);
}

export interface ValutazioneRaw {
  commissario_id: string;
  criterio: string;
  voto: number;
  [k: string]: unknown;
}

// Aggregate per-candidato media across all commissioners' weighted totals.
// Uses the fase-configured criteri and metodo_media.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mediaCandidato(valutazioni: ValutazioneRaw[], faseOrOrdine: any): number {
  const criteri = getCriteri(faseOrOrdine);
  const metodo = getMetodoMedia(faseOrOrdine);
  const byCom: Record<string, Record<string, unknown>> = {};
  valutazioni.forEach((v) => {
    (byCom[v.commissario_id] ??= {})[v.criterio] = v.voto;
  });
  const totals = Object.values(byCom).map((voti) => pesatoVoti(criteri, voti));
  if (!totals.length) return 0;
  return computeAggregate(totals, metodo);
}

// ─── Aggregation methods ─────────────────────────────────────────────────────

export const METODI_MEDIA: Record<string, {
  nome: string;
  icon: string;
  breve: string;
  formula: string;
  pro: string;
  contro: string;
  consigliata: string;
}> = {
  aritmetica: {
    nome: 'Media aritmetica',
    icon: '∑',
    breve: 'Somma di tutti i voti diviso il numero di commissari.',
    formula: 'media = (v₁ + v₂ + … + vₙ) / n',
    pro: 'Usa tutti i dati, semplice e trasparente.',
    contro: 'Vulnerabile a un singolo outlier.',
    consigliata: 'Sempre, se non vuoi correggere statisticamente gli estremi.',
  },
  olimpica: {
    nome: 'Media olimpica',
    icon: '🥇',
    breve: 'Scarta il voto più alto e il più basso, media aritmetica dei restanti.',
    formula: 'media = Σ(voti escluso max e min) / (n − 2)',
    pro: 'Annulla un singolo outlier per estremo.',
    contro: 'Con 3 commissari resta un solo voto utile.',
    consigliata: 'Da 4 commissari in su.',
  },
  winsorizzata: {
    nome: 'Media winsorizzata',
    icon: '✂️',
    breve: 'Limita gli estremi al secondo valore più alto/basso, poi fa la media aritmetica.',
    formula: 'voti[max] := voti[2°max], voti[min] := voti[2°min] → media',
    pro: 'Attenua gli outlier senza scartarli del tutto.',
    contro: 'Servono almeno 4-5 voti.',
    consigliata: 'Da 5 commissari in su.',
  },
  mediana: {
    nome: 'Voto mediano',
    icon: '⊥',
    breve: 'Valore centrale dei voti ordinati.',
    formula: 'mediana = voto in posizione (n+1)/2 dopo l\'ordinamento',
    pro: 'Massimamente robusta agli outlier.',
    contro: 'Ignora le distanze fra i voti.',
    consigliata: 'Robusta per qualsiasi N≥3.',
  },
  deviazione_std: {
    nome: 'Filtro deviazione standard',
    icon: 'σ',
    breve: 'Esclude i voti oltre ±2σ dalla media, poi ricalcola la media.',
    formula: 'escludi vᵢ con |vᵢ − μ| > 2·σ, quindi media dei rimanenti',
    pro: 'Robusta anche con outlier multipli.',
    contro: 'σ stimata su pochi voti è instabile.',
    consigliata: 'Solo con almeno 7 commissari.',
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMetodoMedia(fase: any): string {
  if (!fase) return 'aritmetica';
  const m = fase.metodoMedia ?? fase.metodo_media;
  return Object.prototype.hasOwnProperty.call(METODI_MEDIA, m) ? (m as string) : 'aritmetica';
}

export function suggerisciMetodo(nCommissari: unknown): { metodo: string; motivo: string } {
  const n = Number(nCommissari) || 0;
  if (n <= 2) return { metodo: 'aritmetica', motivo: `Con ${n} commissari un filtro statistico non ha abbastanza dati.` };
  if (n === 3) return { metodo: 'mediana', motivo: 'Con 3 commissari la mediana è la scelta più robusta.' };
  if (n <= 5) return { metodo: 'olimpica', motivo: `Con ${n} commissari la media olimpica scarta i due estremi.` };
  if (n <= 7) return { metodo: 'mediana', motivo: `Con ${n} commissari la mediana resta la più semplice e robusta.` };
  if (n <= 12) return { metodo: 'winsorizzata', motivo: `Con ${n} commissari la winsorizzazione attenua gli outlier.` };
  return { metodo: 'deviazione_std', motivo: `Con ${n} commissari la deviazione standard è statisticamente affidabile.` };
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
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function deviazioneStdArr(arr: number[], k = 2): number {
  if (arr.length < 3) return aritmeticaArr(arr);
  const mean = aritmeticaArr(arr);
  // Campionaria (Bessel): divisione per n-1.
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (arr.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return mean;
  const filtered = arr.filter((v) => Math.abs(v - mean) <= k * std);
  return aritmeticaArr(filtered.length ? filtered : arr);
}

export function computeAggregate(values: unknown, metodo = 'aritmetica'): number {
  const vals = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v)) as number[];
  switch (metodo) {
    case 'olimpica':       return olimpicaArr(vals);
    case 'winsorizzata':   return winsorizzataArr(vals);
    case 'mediana':        return medianaArr(vals);
    case 'deviazione_std': return deviazioneStdArr(vals);
    case 'aritmetica':
    default:               return aritmeticaArr(vals);
  }
}

// Resolve the score scale (max value of an individual vote) of a fase.
// Default 10.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getScala(faseOrScala: any): number {
  if (faseOrScala == null) return 10;
  const raw = typeof faseOrScala === 'number' ? faseOrScala : Number(faseOrScala.scala);
  const n = Number(raw) || 10;
  return Math.max(2, n);
}

export function voteStep(scala: unknown): number {
  return (Number(scala) || 10) <= 10 ? 0.5 : 1;
}

// Modalità di valutazione: 'autonoma' (default) o 'sincrona'.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getModoValutazione(fase: any): 'autonoma' | 'sincrona' {
  if (!fase) return 'autonoma';
  return fase.modoValutazione === 'sincrona' || fase.modo_valutazione === 'sincrona'
    ? 'sincrona'
    : 'autonoma';
}

export function fmtVoto(v: unknown, scala: unknown): string {
  const n = Number(v);
  const x = Number.isFinite(n) ? n : 0;
  const decimals = (Number(scala) || 10) <= 10 ? 1 : (Number.isInteger(x) ? 0 : 1);
  return x.toFixed(decimals);
}

// Eliminatoria admission suggestion. Thresholds relative to scala.
export function suggestEliminatoria({ media, voti, scala = 10 }: { media: number; voti?: number[]; scala?: number }): { ammesso: boolean; fascia: 'MERITO' | 'STANDARD' | 'ELIMINATO' } {
  const s = Number(scala) || 10;
  const norm = s ? media / s : 0;
  if (norm >= 0.65) return { ammesso: true, fascia: norm >= 0.80 ? 'MERITO' : 'STANDARD' };
  if (norm >= 0.60) {
    const sotto = (voti ?? []).filter((v) => (v / s) < 0.60).length;
    if (sotto <= 2) return { ammesso: true, fascia: 'STANDARD' };
  }
  return { ammesso: false, fascia: 'ELIMINATO' };
}
