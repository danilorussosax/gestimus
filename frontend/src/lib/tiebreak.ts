// Tiebreak cascade for fase ranking. Port of js/tiebreak.js — identical algorithm.
// Depends on scoring.ts (no DOM/IO).

import {
  getCriteri,
  getMetodoMedia,
  computeAggregate,
  type FaseInput,
  type ValutazioneRaw,
  type CriterioRuntime,
} from './scoring';

const STEPS = ['scomposizione', 'presidente', 'eta', 'ex_aequo'] as const;
type StepKey = typeof STEPS[number];

export interface TiebreakStep {
  key: StepKey;
  enabled: boolean;
}

export interface TiebreakLogEntry {
  step: string;
  valore?: unknown;
  vinto?: boolean;
  motivazione?: string;
}

export interface RankedRow {
  cf: unknown;
  cand: unknown;
  media: number;
  valutazioni: ValutazioneRaw[];
  posizione_finale: number;
  tiebreak_log: TiebreakLogEntry[];
  ex_aequo_group: string | null;
}

type InputRow = Omit<RankedRow, 'posizione_finale' | 'tiebreak_log' | 'ex_aequo_group'> &
  Record<string, unknown>;

// Loose shapes for accessing external candidato/fase fields (validati a runtime).
interface CandShape {
  id?: unknown;
  tipo?: unknown;
  data_nascita?: unknown;
  dataNascita?: unknown;
  numero_candidato?: unknown;
  numeroCandidato?: unknown;
}
interface MembroShape {
  data_nascita?: unknown;
  dataNascita?: unknown;
}
interface FaseDate {
  data_prevista?: unknown;
  dataPrevista?: unknown;
}

// Riga di lavoro nella cascata: i campi finali sono assegnati man mano.
interface WorkRow {
  cf: unknown;
  cand: unknown;
  media: number;
  valutazioni?: ValutazioneRaw[];
  tiebreak_log?: TiebreakLogEntry[];
  ex_aequo_group?: string | null;
  posizione_finale?: number;
}

interface CascadeCtx {
  presidenteId: string | null;
  refDate: unknown;
  allCandidati: unknown[];
  getMembri: ((id: string) => unknown) | null;
}

export function defaultTiebreakStrategy(): TiebreakStep[] {
  return STEPS.map((key) => ({ key, enabled: true }));
}

export function effectiveStrategy(fase: unknown, concorso: unknown): TiebreakStep[] {
  const f = fase as { tiebreak_strategy?: unknown; tiebreakStrategy?: unknown } | null | undefined;
  const fromFase = sanitize(f?.tiebreak_strategy ?? f?.tiebreakStrategy);
  if (fromFase) return fromFase;
  const c = concorso as
    | { default_tiebreak_strategy?: unknown; defaultTiebreakStrategy?: unknown }
    | null
    | undefined;
  const fromConcorso = sanitize(c?.default_tiebreak_strategy ?? c?.defaultTiebreakStrategy);
  if (fromConcorso) return fromConcorso;
  return defaultTiebreakStrategy();
}

function sanitize(raw: unknown): TiebreakStep[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const byKey = new Map(
    (raw as unknown[]).map((s) => {
      const o = s as { key?: unknown; enabled?: unknown } | null | undefined;
      return [o?.key, !!o?.enabled] as const;
    }),
  );
  return STEPS.map((key) => ({
    key,
    enabled: byKey.get(key) ?? true,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Mean across all commissari on a single criterio key.
export function mediaCandidatoSuCriterio(
  valutazioni: ValutazioneRaw[],
  fase: FaseInput,
  criterioKey: string,
): number {
  const metodo = getMetodoMedia(fase);
  const byCom = new Map<string, number>();
  for (const v of valutazioni) {
    if (!byCom.has(v.commissario_id)) byCom.set(v.commissario_id, 0);
    if (v.criterio === criterioKey) byCom.set(v.commissario_id, v.voto || 0);
  }
  const totals = [...byCom.values()];
  if (totals.length === 0) return 0;
  return computeAggregate(totals, metodo);
}

// Weighted score from a single commissario (the presidente).
export function votoPresidente(
  valutazioni: ValutazioneRaw[],
  fase: FaseInput,
  presidenteId: string | null,
): number | null {
  if (!presidenteId) return null;
  const criteri: CriterioRuntime[] = getCriteri(fase);
  const miei: Record<string, number> = {};
  for (const v of valutazioni) {
    if (v.commissario_id !== presidenteId) continue;
    miei[v.criterio] = v.voto || 0;
  }
  if (Object.keys(miei).length === 0) return null;
  return criteri.reduce((s, c) => s + (miei[c.key] ?? 0) * (c.peso || 0), 0);
}

// Age in decimal years. null if data_nascita is missing or in the future.
export function etaCandidato(
  cand: unknown,
  refDate: unknown,
  _allCandidati: unknown[] = [],
  getMembri: ((id: string) => unknown) | null = null,
): number | null {
  const ref = refDate ? new Date(refDate as string | number | Date) : new Date();
  if (!cand) return null;
  const c = cand as CandShape;
  if (c.tipo === 'gruppo' || c.tipo === 'orchestra') {
    if (typeof getMembri !== 'function') return null;
    let membri: unknown[];
    try {
      const m = getMembri(c.id as string);
      membri = Array.isArray(m) ? m : [];
    } catch {
      membri = [];
    }
    if (membri.length === 0) return null;
    const eta = (membri as (MembroShape | null | undefined)[])
      .filter((m) => m?.data_nascita ?? m?.dataNascita)
      .map((m) => yearsBetween(m?.data_nascita ?? m?.dataNascita, ref))
      .filter((n): n is number => n != null);
    if (eta.length === 0) return null;
    return eta.reduce((s, x) => s + x, 0) / eta.length;
  }
  const nascita = c.data_nascita ?? c.dataNascita;
  if (!nascita) return null;
  return yearsBetween(nascita, ref);
}

function yearsBetween(birth: unknown, ref: Date): number | null {
  const d = new Date(birth as string);
  if (isNaN(d.getTime())) return null;
  const days = Math.floor((ref.getTime() - d.getTime()) / 86_400_000);
  if (days < 0) return null;
  return days / 365.2425;
}

function exAequoGroupId(memberIds: unknown[] | null = null): string {
  if (Array.isArray(memberIds) && memberIds.length) {
    const sorted = [...memberIds].sort().join('|');
    let h = 5381;
    for (let i = 0; i < sorted.length; i++)
      h = ((h << 5) + h + sorted.charCodeAt(i)) >>> 0;
    return 'ea_' + h.toString(36);
  }
  return 'ea_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

const EPS = 1e-9;
function eq(a: number, b: number): boolean { return Math.abs(a - b) <= EPS; }

// ─── Main ranking algorithm ───────────────────────────────────────────────────

export interface RankCtx {
  presidenteId?: string | null;
  refDate?: string | null;
  allCandidati?: unknown[];
  getMembri?: ((id: string) => unknown) | null;
  strategy?: TiebreakStep[];
}

export function rankWithTieBreak(
  rows: InputRow[],
  fase: FaseInput,
  ctx: RankCtx = {},
): RankedRow[] {
  const strategy = (ctx.strategy?.length ? ctx.strategy : defaultTiebreakStrategy()).filter(
    (s) => s.enabled,
  );
  const presidenteId = ctx.presidenteId ?? null;
  const fd = fase as FaseDate | null | undefined;
  const refDate = ctx.refDate ?? fd?.data_prevista ?? fd?.dataPrevista ?? new Date().toISOString();
  const allCandidati = ctx.allCandidati ?? [];
  const getMembri = typeof ctx.getMembri === 'function' ? ctx.getMembri : null;

  // Stable initial sort: media desc, then numero_candidato asc as tiebreaker.
  const sorted = rows.slice().sort((a, b) => {
    if (!eq(a.media, b.media)) return b.media - a.media;
    const ca = a.cand as CandShape | undefined;
    const cb = b.cand as CandShape | undefined;
    const na = (ca?.numero_candidato ?? ca?.numeroCandidato ?? 0) as number;
    const nb = (cb?.numero_candidato ?? cb?.numeroCandidato ?? 0) as number;
    return na - nb;
  });

  // Group by identical media (within EPS).
  const groups: InputRow[][] = [];
  let cur: InputRow[] = [];
  for (const r of sorted) {
    if (cur.length === 0 || eq(cur[0].media, r.media)) cur.push(r);
    else { groups.push(cur); cur = [r]; }
  }
  if (cur.length) groups.push(cur);

  // Resolve tiebreak cascade on each group with ≥2 candidates.
  const resolved: RankedRow[] = [];
  for (const g of groups) {
    if (g.length === 1) {
      resolved.push({ ...g[0], tiebreak_log: [], ex_aequo_group: null, posizione_finale: 0 });
      continue;
    }
    const enriched: WorkRow[] = g.map((r) => ({
      ...r,
      tiebreak_log: [{ step: 'pari_su_media', valore: round2(r.media), motivazione: `Stessa media aggregata ${round2(r.media)}` }],
    }));
    const ordered = applyCascade(enriched, strategy, fase, { presidenteId, refDate, allCandidati, getMembri });
    for (const r of ordered) resolved.push(r as RankedRow);
  }

  // Assign posizione_finale with competition ranking (1224 system).
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    if (r.ex_aequo_group && i > 0 && resolved[i - 1].ex_aequo_group === r.ex_aequo_group) {
      r.posizione_finale = resolved[i - 1].posizione_finale;
    } else {
      r.posizione_finale = i + 1;
    }
  }

  return resolved;
}

/**
 * N144: i candidatiFase ammessi alla fase successiva = i top `ammessi` della
 * classifica con risoluzione pareggi. Gli ex aequo al taglio sono INCLUSI
 * (posizione_finale <= ammessi). Ritorna `null` se non c'è una soglia top-N
 * valida (`ammessi` mancante/≤0) → il server mantiene l'ammissione esistente.
 * Porting fedele di js/views/admin/common.js:computeAdmittedIds.
 */
export function computeAdmittedIds(
  ranked: RankedRow[],
  ammessi: number | null | undefined,
): string[] | null {
  const n = Number(ammessi);
  if (!Number.isFinite(n) || n <= 0) return null;
  return ranked
    .filter((r) => r.posizione_finale <= n)
    .map((r) => (r.cf as { id: string }).id);
}

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

function applyCascade(
  group: WorkRow[],
  strategy: TiebreakStep[],
  fase: FaseInput,
  ctx: CascadeCtx,
): WorkRow[] {
  let buckets: WorkRow[][] = [group];

  for (const step of strategy) {
    if (step.key === 'ex_aequo') break;
    const newBuckets: WorkRow[][] = [];
    for (const bucket of buckets) {
      if (bucket.length === 1) { newBuckets.push(bucket); continue; }
      const sub = splitByStep(bucket, step.key, fase, ctx);
      annotateStep(sub, step.key);
      for (const sb of sub) newBuckets.push(sb);
    }
    buckets = newBuckets;
    if (buckets.every((b) => b.length === 1)) break;
  }

  const hasExAequo = strategy.some((s) => s.key === 'ex_aequo');
  for (const bucket of buckets) {
    if (bucket.length <= 1) continue;
    if (hasExAequo) {
      const memberIds = bucket
        // id può essere stringa vuota → fallback su valore falsy voluto (porting vanilla)
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        .map((r) => (r.cf as CandShape | undefined)?.id || (r.cand as CandShape | undefined)?.id)
        .filter(Boolean);
      const gid = exAequoGroupId(memberIds);
      for (const r of bucket) {
        r.ex_aequo_group = gid;
        r.tiebreak_log = [
          ...(r.tiebreak_log ?? []),
          {
            step: 'ex_aequo',
            valore: bucket.length,
            motivazione: `Parità non risolta dalle regole precedenti: ex aequo dichiarato (${bucket.length} candidati). La posizione successiva non viene assegnata; i premi previsti si dividono in parti uguali.`,
          },
        ];
      }
    } else {
      for (const r of bucket) {
        const cand = r.cand as CandShape | undefined;
        r.tiebreak_log = [
          ...(r.tiebreak_log ?? []),
          {
            step: 'parita_residua',
            valore: bucket.length,
            motivazione: `Parità non risolta e regola ex aequo disattivata: ordine ${(cand?.numero_candidato ?? cand?.numeroCandidato ?? '?') as string} usato come tiebreak finale.`,
          },
        ];
      }
    }
  }

  const out: WorkRow[] = [];
  for (const bucket of buckets) for (const r of bucket) out.push(r);
  return out;
}

function splitByStep(
  bucket: WorkRow[],
  stepKey: StepKey,
  fase: FaseInput,
  ctx: CascadeCtx,
): WorkRow[][] {
  const scored = bucket.map((r) => ({ r, score: stepScore(r, stepKey, fase, ctx) }));
  if (scored.every((s) => s.score == null)) return [bucket];

  const cmp = (a: number | string | null, b: number | string | null): number => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === 'string' || typeof b === 'string') {
      const sa = String(a), sb = String(b);
      if (sa === sb) return 0;
      return sa < sb ? 1 : -1; // desc
    }
    return b - a;
  };
  const same = (a: number | string | null, b: number | string | null): boolean => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    if (typeof a === 'string' || typeof b === 'string') return String(a) === String(b);
    return eq(a, b);
  };

  scored.sort((a, b) => cmp(a.score, b.score));
  const subs: WorkRow[][] = [];
  let curSub: typeof scored = [];
  for (const s of scored) {
    if (curSub.length === 0 || same(curSub[0].score, s.score)) curSub.push(s);
    else { subs.push(curSub.map((x) => x.r)); curSub = [s]; }
  }
  if (curSub.length) subs.push(curSub.map((x) => x.r));
  return subs;
}

function stepScore(
  row: WorkRow,
  stepKey: StepKey,
  fase: FaseInput,
  ctx: CascadeCtx,
): number | string | null {
  if (stepKey === 'scomposizione') {
    return scomposizioneCompositeScore(row, fase);
  }
  if (stepKey === 'presidente') {
    return votoPresidente(row.valutazioni ?? [], fase, ctx.presidenteId);
  }
  if (stepKey === 'eta') {
    const e = etaCandidato(row.cand, ctx.refDate, ctx.allCandidati, ctx.getMembri);
    if (e == null) return null;
    return -e; // younger wins → min age → max (-age)
  }
  return null;
}

function scomposizioneCompositeScore(row: WorkRow, fase: FaseInput): string | null {
  const criteri = getCriteri(fase)
    .slice()
    .sort((a, b) => (b.peso || 0) - (a.peso || 0));
  if (criteri.length === 0) return null;
  const parts = criteri.map((c) => {
    const v = Math.max(0, mediaCandidatoSuCriterio(row.valutazioni ?? [], fase, c.key));
    return v.toFixed(6).padStart(20, '0');
  });
  return parts.join('|');
}

function annotateStep(subs: WorkRow[][], stepKey: StepKey): void {
  const label = stepLabel(stepKey);
  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i];
    const isFirst = i === 0;
    if (sub.length === 1 && subs.length > 1) {
      sub[0].tiebreak_log = [
        ...(sub[0].tiebreak_log ?? []),
        {
          step: stepKey,
          vinto: isFirst,
          motivazione: isFirst
            ? `Vince su ${label}.`
            : `Risolto da ${label} (posizione ${i + 1} nel sottogruppo).`,
        },
      ];
    } else if (sub.length > 1) {
      for (const r of sub) {
        r.tiebreak_log = [
          ...(r.tiebreak_log ?? []),
          { step: stepKey, vinto: false, motivazione: `Pari anche su ${label}: passo alla regola successiva.` },
        ];
      }
    }
  }
}

function stepLabel(key: string): string {
  switch (key) {
    case 'scomposizione': return 'scomposizione del voto (criterio con peso maggiore)';
    case 'presidente': return 'voto del Presidente di giuria';
    case 'eta': return 'criterio anagrafico (più giovane vince)';
    case 'ex_aequo': return 'ex aequo';
    default: return key;
  }
}

export const TIEBREAK_STEPS = STEPS.slice() as string[];

export function stepInfo(key: string): { titolo: string; breve: string; esempio: string } | null {
  const info: Record<string, { titolo: string; breve: string; esempio: string }> = {
    scomposizione: {
      titolo: 'Scomposizione del voto',
      breve: 'Confronta i criteri uno per uno, in ordine di peso decrescente.',
      esempio: 'Pari su media 8.50? Vince chi ha la media più alta su "Tecnica" (peso 35%). Se ancora pari, su "Interpretazione" e così via.',
    },
    presidente: {
      titolo: 'Voto del Presidente di giuria',
      breve: 'Il voto del Presidente diventa decisivo.',
      esempio: 'Pari? Vince il candidato con la media più alta calcolata sui soli voti del Presidente.',
    },
    eta: {
      titolo: 'Criterio anagrafico',
      breve: 'Vince il candidato anagraficamente più giovane.',
      esempio: "Pari? Vince il più giovane al momento dell'esibizione. Per i gruppi si usa la media delle date di nascita dei membri.",
    },
    ex_aequo: {
      titolo: 'Ex aequo (extrema ratio)',
      breve: 'Se la parità non è risolta, dichiarata pari merito.',
      esempio: 'Stessa posizione ai candidati. La posizione immediatamente successiva non viene assegnata; il premio della posizione e di quella successiva si sommano e dividono in parti uguali.',
    },
  };
  return info[key] ?? null;
}
