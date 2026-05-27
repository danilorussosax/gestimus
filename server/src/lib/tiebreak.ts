// #1 — Port server-side del tiebreak (algoritmo identico a
// frontend/src/lib/tiebreak.ts). Pure functions. Usato per ricalcolare la
// classifica della fase dal DB e derivare gli ammessi top-N con risoluzione
// pareggi (scomposizione → presidente → età → ex aequo).

import {
  getCriteri, getMetodoMedia, computeAggregate,
  type FaseInput, type ValutazioneRaw, type CriterioRuntime,
} from './scoring.js';

const STEPS = ['scomposizione', 'presidente', 'eta', 'ex_aequo'] as const;
type StepKey = typeof STEPS[number];

export interface TiebreakStep { key: StepKey; enabled: boolean; }

export interface RankedRow {
  cf: unknown; cand: unknown; media: number; valutazioni: ValutazioneRaw[];
  posizione_finale: number; ex_aequo_group: string | null;
}
type InputRow = { cf: unknown; cand: unknown; media: number; valutazioni: ValutazioneRaw[] } & Record<string, unknown>;

interface CandShape { id?: unknown; tipo?: unknown; isGruppo?: unknown; data_nascita?: unknown; dataNascita?: unknown; numero_candidato?: unknown; numeroCandidato?: unknown; }
interface MembroShape { data_nascita?: unknown; dataNascita?: unknown; }
interface FaseDate { data_prevista?: unknown; dataPrevista?: unknown; }

interface WorkRow {
  cf: unknown; cand: unknown; media: number; valutazioni?: ValutazioneRaw[];
  ex_aequo_group?: string | null; posizione_finale?: number;
}
interface CascadeCtx { presidenteId: string | null; refDate: unknown; allCandidati: unknown[]; getMembri: ((id: string) => unknown) | null; }

export function defaultTiebreakStrategy(): TiebreakStep[] { return STEPS.map((key) => ({ key, enabled: true })); }

export function effectiveStrategy(fase: unknown, concorso: unknown): TiebreakStep[] {
  const f = fase as { tiebreak_strategy?: unknown; tiebreakStrategy?: unknown } | null | undefined;
  const fromFase = sanitize(f?.tiebreak_strategy ?? f?.tiebreakStrategy);
  if (fromFase) return fromFase;
  const c = concorso as { default_tiebreak_strategy?: unknown; defaultTiebreakStrategy?: unknown } | null | undefined;
  const fromConcorso = sanitize(c?.default_tiebreak_strategy ?? c?.defaultTiebreakStrategy);
  if (fromConcorso) return fromConcorso;
  return defaultTiebreakStrategy();
}

function sanitize(raw: unknown): TiebreakStep[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const byKey = new Map((raw as unknown[]).map((s) => {
    const o = s as { key?: unknown; enabled?: unknown } | null | undefined;
    return [o?.key, !!o?.enabled] as const;
  }));
  return STEPS.map((key) => ({ key, enabled: byKey.get(key) ?? true }));
}

function mediaCandidatoSuCriterio(valutazioni: ValutazioneRaw[], fase: FaseInput, criterioKey: string): number {
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

function votoPresidente(valutazioni: ValutazioneRaw[], fase: FaseInput, presidenteId: string | null): number | null {
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

function etaCandidato(cand: unknown, refDate: unknown, _all: unknown[] = [], getMembri: ((id: string) => unknown) | null = null): number | null {
  const ref = refDate ? new Date(refDate as string | number | Date) : new Date();
  if (!cand) return null;
  const c = cand as CandShape;
  if (c.tipo === 'gruppo' || c.tipo === 'orchestra' || c.isGruppo === true) {
    if (typeof getMembri !== 'function') return null;
    let membri: unknown[];
    try { const m = getMembri(c.id as string); membri = Array.isArray(m) ? m : []; } catch { membri = []; }
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
    for (let i = 0; i < sorted.length; i++) h = ((h << 5) + h + sorted.charCodeAt(i)) >>> 0;
    return 'ea_' + h.toString(36);
  }
  return 'ea_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

const EPS = 1e-9;
function eq(a: number, b: number): boolean { return Math.abs(a - b) <= EPS; }

export interface RankCtx {
  presidenteId?: string | null; refDate?: string | null;
  allCandidati?: unknown[]; getMembri?: ((id: string) => unknown) | null; strategy?: TiebreakStep[];
}

export function rankWithTieBreak(rows: InputRow[], fase: FaseInput, ctx: RankCtx = {}): RankedRow[] {
  const strategy = (ctx.strategy?.length ? ctx.strategy : defaultTiebreakStrategy()).filter((s) => s.enabled);
  const presidenteId = ctx.presidenteId ?? null;
  const fd = fase as FaseDate | null | undefined;
  const refDate = ctx.refDate ?? fd?.data_prevista ?? fd?.dataPrevista ?? new Date().toISOString();
  const allCandidati = ctx.allCandidati ?? [];
  const getMembri = typeof ctx.getMembri === 'function' ? ctx.getMembri : null;

  const sorted = rows.slice().sort((a, b) => {
    if (!eq(a.media, b.media)) return b.media - a.media;
    const ca = a.cand as CandShape | undefined;
    const cb = b.cand as CandShape | undefined;
    const na = (ca?.numero_candidato ?? ca?.numeroCandidato ?? 0) as number;
    const nb = (cb?.numero_candidato ?? cb?.numeroCandidato ?? 0) as number;
    return na - nb;
  });

  const groups: InputRow[][] = [];
  let cur: InputRow[] = [];
  for (const r of sorted) {
    if (cur.length === 0 || eq(cur[0]!.media, r.media)) cur.push(r);
    else { groups.push(cur); cur = [r]; }
  }
  if (cur.length) groups.push(cur);

  const resolved: RankedRow[] = [];
  for (const g of groups) {
    if (g.length === 1) { resolved.push({ ...g[0]!, ex_aequo_group: null, posizione_finale: 0 }); continue; }
    const enriched: WorkRow[] = g.map((r) => ({ ...r }));
    const ordered = applyCascade(enriched, strategy, fase, { presidenteId, refDate, allCandidati, getMembri });
    for (const r of ordered) resolved.push(r as RankedRow);
  }

  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i]!;
    if (r.ex_aequo_group && i > 0 && resolved[i - 1]!.ex_aequo_group === r.ex_aequo_group) {
      r.posizione_finale = resolved[i - 1]!.posizione_finale;
    } else {
      r.posizione_finale = i + 1;
    }
  }
  return resolved;
}

export function computeAdmittedIds(ranked: RankedRow[], ammessi: number | null | undefined): string[] | null {
  const n = Number(ammessi);
  if (!Number.isFinite(n) || n <= 0) return null;
  return ranked.filter((r) => r.posizione_finale <= n).map((r) => (r.cf as { id: string }).id);
}

function applyCascade(group: WorkRow[], strategy: TiebreakStep[], fase: FaseInput, ctx: CascadeCtx): WorkRow[] {
  let buckets: WorkRow[][] = [group];
  for (const step of strategy) {
    if (step.key === 'ex_aequo') break;
    const newBuckets: WorkRow[][] = [];
    for (const bucket of buckets) {
      if (bucket.length === 1) { newBuckets.push(bucket); continue; }
      const sub = splitByStep(bucket, step.key, fase, ctx);
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
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        .map((r) => (r.cf as CandShape | undefined)?.id || (r.cand as CandShape | undefined)?.id)
        .filter(Boolean);
      const gid = exAequoGroupId(memberIds);
      for (const r of bucket) r.ex_aequo_group = gid;
    }
  }
  const out: WorkRow[] = [];
  for (const bucket of buckets) for (const r of bucket) out.push(r);
  return out;
}

function splitByStep(bucket: WorkRow[], stepKey: StepKey, fase: FaseInput, ctx: CascadeCtx): WorkRow[][] {
  const scored = bucket.map((r) => ({ r, score: stepScore(r, stepKey, fase, ctx) }));
  if (scored.every((s) => s.score == null)) return [bucket];
  const cmp = (a: number | string | null, b: number | string | null): number => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === 'string' || typeof b === 'string') {
      const sa = String(a), sb = String(b);
      if (sa === sb) return 0;
      return sa < sb ? 1 : -1;
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
    if (curSub.length === 0 || same(curSub[0]!.score, s.score)) curSub.push(s);
    else { subs.push(curSub.map((x) => x.r)); curSub = [s]; }
  }
  if (curSub.length) subs.push(curSub.map((x) => x.r));
  return subs;
}

function stepScore(row: WorkRow, stepKey: StepKey, fase: FaseInput, ctx: CascadeCtx): number | string | null {
  if (stepKey === 'scomposizione') return scomposizioneCompositeScore(row, fase);
  if (stepKey === 'presidente') return votoPresidente(row.valutazioni ?? [], fase, ctx.presidenteId);
  if (stepKey === 'eta') {
    const e = etaCandidato(row.cand, ctx.refDate, ctx.allCandidati, ctx.getMembri);
    if (e == null) return null;
    return -e;
  }
  return null;
}

function scomposizioneCompositeScore(row: WorkRow, fase: FaseInput): string | null {
  const criteri = getCriteri(fase).slice().sort((a, b) => (b.peso || 0) - (a.peso || 0));
  if (criteri.length === 0) return null;
  const parts = criteri.map((c) => {
    const v = Math.max(0, mediaCandidatoSuCriterio(row.valutazioni ?? [], fase, c.key));
    return v.toFixed(6).padStart(20, '0');
  });
  return parts.join('|');
}
