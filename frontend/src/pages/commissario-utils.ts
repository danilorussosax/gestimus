// =============================================================================
// commissario-utils — helper PURI della schermata Commissario
//
// Persistenza draft (sessionStorage), risoluzione membri commissione, nome
// visualizzato, età da data ISO, formato timer MM:SS. Estratti da Commissario.tsx
// per isolare la logica testabile dal componente. Nessuno stato React / SSE.
// =============================================================================

import type { Commissione } from '@/types';

// ── sessionStorage draft persistence ─────────────────────────────────────────

const DRAFT_KEY = 'gc_commissario_draft';

export interface DraftState {
  voti: Record<string, number>;
  note: string;
  faseId: string | null;
  candidatoFaseId: string | null;
}

export function persistDraft(d: DraftState) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* quota/private */ }
}

export function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

export function loadDraft(faseId: string | null, candidatoFaseId: string): DraftState | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as DraftState;
    if (d?.faseId === faseId && d.candidatoFaseId === candidatoFaseId) return d;
  } catch { /* corrupted */ }
  return null;
}

// ── Helper: resolve commissariIds from Commissione ────────────────────────────
// La GET /commissioni espone gli id dei membri nell'array `commissari`.

export function getCommissariIds(com: Commissione | undefined | null): string[] {
  if (!com) return [];
  return Array.isArray(com.commissari) ? com.commissari : [];
}

// ── Helper: display name ──────────────────────────────────────────────────────

export function displayName(p: { nome?: string | null; cognome?: string | null } | null | undefined): string {
  if (!p) return '';
  const parts = [p.cognome, p.nome].filter(Boolean);
  return parts.length ? parts.join(' ') : '';
}

// ── Helper: age from ISO date string ─────────────────────────────────────────

export function ageFromDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const birth = new Date(iso);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// ── Helper: format time ms → MM:SS ───────────────────────────────────────────

export function formatTime(ms: number): string {
  const tot = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(tot / 60);
  const s = tot % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── cfHasAllVotes — pure check: have all active commissari voted for a cf? ────
//
// Returns true if every activeCommId has submitted a vote for every criterio
// in faseCriteriKeys for the given candidatoFaseId (cfId).

export function cfHasAllVotes(
  cfId: string,
  activeCommIds: string[],
  faseCriteriKeys: string[],
  valsAll: { candidatoFaseId: string; commissarioId: string; criterio: string }[],
): boolean {
  if (faseCriteriKeys.length === 0) return false;
  return activeCommIds.every((cid) =>
    faseCriteriKeys.every((ck) =>
      valsAll.some((v) => v.candidatoFaseId === cfId && v.commissarioId === cid && v.criterio === ck),
    ),
  );
}

// ── resolveSyncCurrentCf — sincrona mode: find current/waiting cf ─────────────
//
// Iterates ordered faseCfList; for the first non-fully-voted cf:
//   - if this commissario already voted → set as waitingFor (others pending)
//   - otherwise → set as currentCf
// Returns { currentCf, waitingFor }.

export interface SyncCfResolution<T extends { id: string; candidatoId: string }> {
  currentCf: T | null;
  waitingFor: T | null;
}

export function resolveSyncCurrentCf<T extends { id: string; candidatoId: string }>(
  faseCfList: T[],
  myVotedCfIds: Set<string>,
  activeCommIds: string[],
  faseCriteriKeys: string[],
  valsAll: { candidatoFaseId: string; commissarioId: string; criterio: string }[],
): SyncCfResolution<T> {
  let currentCf: T | null = null;
  let waitingFor: T | null = null;

  for (const cf of faseCfList) {
    if (cfHasAllVotes(cf.id, activeCommIds, faseCriteriKeys, valsAll)) continue;
    if (myVotedCfIds.has(cf.id)) {
      waitingFor = cf;
    } else {
      currentCf = cf;
    }
    break;
  }

  return { currentCf, waitingFor };
}

// ── isAmmesso — threshold logic (ordine 1 → 65%, others → 70%) ───────────────
//
// norm: normalised score (0-1), ordine: fase ordine (1-based integer).

export function isAmmesso(norm: number, ordine: number): boolean {
  return ordine === 1 ? norm >= 0.65 : norm >= 0.70;
}
