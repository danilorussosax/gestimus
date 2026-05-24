// Tiebreak cascade for fase ranking. Port of js/tiebreak.js — identical algorithm.
// Depends on scoring.ts (no DOM/IO).

import {
  getCriteri,
  getMetodoMedia,
  computeAggregate,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cf: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cand: any;
  media: number;
  valutazioni: ValutazioneRaw[];
  posizione_finale: number;
  tiebreak_log: TiebreakLogEntry[];
  ex_aequo_group: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InputRow = Omit<RankedRow, 'posizione_finale' | 'tiebreak_log' | 'ex_aequo_group'> & Record<string, any>;

export function defaultTiebreakStrategy(): TiebreakStep[] {
  return STEPS.map((key) => ({ key, enabled: true }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function effectiveStrategy(fase: any, concorso: any): TiebreakStep[] {
  const fromFase = sanitize(fase?.tiebreak_strategy ?? fase?.tiebreakStrategy);
  if (fromFase) return fromFase;
  const fromConcorso = sanitize(
    concorso?.default_tiebreak_strategy ?? concorso?.defaultTiebreakStrategy,
  );
  if (fromConcorso) return fromConcorso;
  return defaultTiebreakStrategy();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitize(raw: any): TiebreakStep[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byKey = new Map(raw.map((s: any) => [s?.key, !!s?.enabled]));
  return STEPS.map((key) => ({
    key,
    enabled: byKey.has(key) ? (byKey.get(key)!) : true,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Mean across all commissari on a single criterio key.
export function mediaCandidatoSuCriterio(
  valutazioni: ValutazioneRaw[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fase: any,
  criterioKey: string,
): number {
  const metodo = getMetodoMedia(fase);
  const byCom = new Map<string, number>();
  for (const v of valutazioni) {
    if (!byCom.has(v.commissario_id)) byCom.set(v.commissario_id, 0);
    if (v.criterio === criterioKey) byCom.set(v.commissario_id, Number(v.voto) || 0);
  }
  const totals = [...byCom.values()];
  if (totals.length === 0) return 0;
  return computeAggregate(totals, metodo);
}

// Weighted score from a single commissario (the presidente).
export function votoPresidente(
  valutazioni: ValutazioneRaw[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fase: any,
  presidenteId: string | null,
): number | null {
  if (!presidenteId) return null;
  const criteri: CriterioRuntime[] = getCriteri(fase);
  const miei: Record<string, number> = {};
  for (const v of valutazioni) {
    if (v.commissario_id !== presidenteId) continue;
    miei[v.criterio] = Number(v.voto) || 0;
  }
  if (Object.keys(miei).length === 0) return null;
  return criteri.reduce((s, c) => s + (miei[c.key] ?? 0) * (c.peso || 0), 0);
}

// Age in decimal years. null if data_nascita is missing or in the future.
export function etaCandidato(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cand: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refDate: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _allCandidati: any[] = [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMembri: ((id: any) => any) | null = null,
): number | null {
  const ref = refDate ? new Date(refDate) : new Date();
  if (!cand) return null;
  if (cand.tipo === 'gruppo' || cand.tipo === 'orchestra') {
    if (typeof getMembri !== 'function') return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let membri: any[];
    try { membri = getMembri(cand.id) ?? []; } catch { membri = []; }
    if (!Array.isArray(membri) || membri.length === 0) return null;
    const eta = membri
      .filter((m) => m?.data_nascita ?? m?.dataNascita)
      .map((m) => yearsBetween(m.data_nascita ?? m.dataNascita, ref))
      .filter((n): n is number => n != null);
    if (eta.length === 0) return null;
    return eta.reduce((s, x) => s + x, 0) / eta.length;
  }
  const nascita = cand.data_nascita ?? cand.dataNascita;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allCandidati?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMembri?: ((id: any) => any) | null;
  strategy?: TiebreakStep[];
}

export function rankWithTieBreak(
  rows: InputRow[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fase: any,
  ctx: RankCtx = {},
): RankedRow[] {
  const strategy = (ctx.strategy?.length ? ctx.strategy : defaultTiebreakStrategy()).filter(
    (s) => s.enabled,
  );
  const presidenteId = ctx.presidenteId ?? null;
  const refDate = ctx.refDate ?? fase?.data_prevista ?? fase?.dataPrevista ?? new Date().toISOString();
  const allCandidati = ctx.allCandidati ?? [];
  const getMembri = typeof ctx.getMembri === 'function' ? ctx.getMembri : null;

  // Stable initial sort: media desc, then numero_candidato asc as tiebreaker.
  const sorted = rows.slice().sort((a, b) => {
    if (!eq(a.media, b.media)) return b.media - a.media;
    const na = (a.cand?.numero_candidato ?? a.cand?.numeroCandidato ?? 0) as number;
    const nb = (b.cand?.numero_candidato ?? b.cand?.numeroCandidato ?? 0) as number;
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
    const enriched = g.map((r) => ({
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

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCascade(group: any[], strategy: TiebreakStep[], fase: any, ctx: { presidenteId: string | null; refDate: unknown; allCandidati: any[]; getMembri: ((id: any) => any) | null }): any[] {
  let buckets: typeof group[] = [group];

  for (const step of strategy) {
    if (step.key === 'ex_aequo') break;
    const newBuckets: typeof group[] = [];
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memberIds = bucket.map((r: any) => r.cf?.id || r.cand?.id).filter(Boolean);
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
        r.tiebreak_log = [
          ...(r.tiebreak_log ?? []),
          {
            step: 'parita_residua',
            valore: bucket.length,
            motivazione: `Parità non risolta e regola ex aequo disattivata: ordine ${r.cand?.numero_candidato ?? r.cand?.numeroCandidato ?? '?'} usato come tiebreak finale.`,
          },
        ];
      }
    }
  }

  const out: typeof group = [];
  for (const bucket of buckets) for (const r of bucket) out.push(r);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function splitByStep(bucket: any[], stepKey: string, fase: any, ctx: any): any[][] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scored = bucket.map((r: any) => ({ r, score: stepScore(r, stepKey, fase, ctx) }));
  if (scored.every((s) => s.score == null)) return [bucket];

  const cmp = (a: unknown, b: unknown): number => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === 'string' || typeof b === 'string') {
      const sa = String(a), sb = String(b);
      if (sa === sb) return 0;
      return sa < sb ? 1 : -1; // desc
    }
    return (b as number) - (a as number);
  };
  const same = (a: unknown, b: unknown): boolean => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    if (typeof a === 'string' || typeof b === 'string') return String(a) === String(b);
    return eq(a as number, b as number);
  };

  scored.sort((a, b) => cmp(a.score, b.score));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subs: any[][] = [];
  let curSub: typeof scored = [];
  for (const s of scored) {
    if (curSub.length === 0 || same(curSub[0].score, s.score)) curSub.push(s);
    else { subs.push(curSub.map((x) => x.r)); curSub = [s]; }
  }
  if (curSub.length) subs.push(curSub.map((x) => x.r));
  return subs;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stepScore(row: any, stepKey: string, fase: any, ctx: any): number | string | null {
  if (stepKey === 'scomposizione') {
    return scomposizioneCompositeScore(row, fase);
  }
  if (stepKey === 'presidente') {
    const v = votoPresidente(row.valutazioni ?? [], fase, ctx.presidenteId);
    return v == null ? null : v;
  }
  if (stepKey === 'eta') {
    const e = etaCandidato(row.cand, ctx.refDate, ctx.allCandidati, ctx.getMembri);
    if (e == null) return null;
    return -e; // younger wins → min age → max (-age)
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scomposizioneCompositeScore(row: any, fase: any): string | null {
  const criteri = (getCriteri(fase) ?? [])
    .slice()
    .sort((a: CriterioRuntime, b: CriterioRuntime) => (b.peso || 0) - (a.peso || 0));
  if (criteri.length === 0) return null;
  const parts = criteri.map((c: CriterioRuntime) => {
    const v = Math.max(0, mediaCandidatoSuCriterio(row.valutazioni ?? [], fase, c.key));
    return v.toFixed(6).padStart(20, '0');
  });
  return parts.join('|');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function annotateStep(subs: any[][], stepKey: string): void {
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
