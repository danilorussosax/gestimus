/**
 * API wrappers per le fasi del concorso.
 * Rotta server: /api/fasi (routes/fasi.ts)
 *
 * Transizioni stato: PIANIFICATA → IN_CORSO (start) → CONCLUSA (conclude)
 * Sorteggio: disponibile su PIANIFICATA e IN_CORSO.
 */

import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/api';
import type { FaseStato } from '@/types';
import type { CriterioInput, CriterioRecord } from './criteri';
import { replaceCriteri } from './criteri';

// ─── Tipi locali ────────────────────────────────────────────────────────────

export interface TiebreakStep {
  key: string;
  enabled: boolean;
}

export interface FaseRecord {
  id: string;
  concorsoId: string;
  commissioneId: string | null;
  ordine: number;
  nome: string;
  stato: FaseStato;
  ammessi: number | null;
  dataPrevista: string | null;
  scala: number;
  modoValutazione: 'autonoma' | 'sincrona' | null;
  pesi: unknown;
  metodoMedia: string | null;
  tempoMinuti: number | null;
  timerStartedAt: string | null;
  timerPausedAt: string | null;
  timerBonusSeconds: number;
  timerStartedForCfId: string | null;
  tiebreakStrategy: TiebreakStep[] | null;
  testoEsitoPromosso: string | null;
  testoEsitoEliminato: string | null;
  sezioniIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** Payload per createFase. */
export interface CreateFaseBody {
  concorsoId: string;
  ordine: number;
  nome: string;
  ammessi?: number | null;
  dataPrevista?: string | null;
  scala?: number;
  modoValutazione?: 'autonoma' | 'sincrona' | null;
  metodoMedia?: string | null;
  tempoMinuti?: number | null;
  commissioneId?: string | null;
  tiebreakStrategy?: TiebreakStep[] | null;
  testoEsitoPromosso?: string | null;
  testoEsitoEliminato?: string | null;
  sezioniIds?: string[];
}

export type UpdateFaseBody = Partial<Omit<CreateFaseBody, 'concorsoId'>>;

/** Risposta di sorteggio. */
export interface SorteggiResult {
  ok: boolean;
  count: number;
  seed: number;
}

// ─── HTTP primitives ─────────────────────────────────────────────────────────

/** GET /api/fasi?concorsoId=… */
export function listFasi(concorsoId: string): Promise<FaseRecord[]> {
  return http.get<FaseRecord[]>('fasi', { concorsoId });
}

/** GET /api/fasi/:id */
export function getFase(id: string): Promise<FaseRecord> {
  return http.get<FaseRecord>(`fasi/${id}`);
}

/** POST /api/fasi */
export function createFase(body: CreateFaseBody): Promise<FaseRecord> {
  return http.post<FaseRecord>('fasi', body);
}

/** PATCH /api/fasi/:id */
export function updateFase(id: string, body: UpdateFaseBody): Promise<FaseRecord> {
  return http.patch<FaseRecord>(`fasi/${id}`, body);
}

/** DELETE /api/fasi/:id → 204 */
export function deleteFase(id: string): Promise<void> {
  return http.del<undefined>(`fasi/${id}`);
}

/** POST /api/fasi/:id/start — PIANIFICATA → IN_CORSO */
export function startFase(id: string): Promise<FaseRecord> {
  return http.post<FaseRecord>(`fasi/${id}/start`);
}

/**
 * POST /api/fasi/:id/conclude — IN_CORSO → CONCLUSA
 * `admittedIds` = array di candidatiFase.id da ammettere alla fase successiva
 * (calcolo lato client dalla classifica). Se omesso il server mantiene
 * l'ammissione esistente (retrocompatibilità).
 */
export function concludiFase(
  id: string,
  admittedIds?: string[],
): Promise<FaseRecord> {
  return http.post<FaseRecord>(`fasi/${id}/conclude`, { admitted: admittedIds });
}

/**
 * POST /api/fasi/:id/sorteggio
 * `seed` int32 ≥ 0 e ≤ 2_147_483_647. Se omesso ne genera uno casuale.
 */
export function sorteggiaFase(
  id: string,
  seed?: number,
): Promise<SorteggiResult> {
  const s = seed ?? Math.floor(Math.random() * 2_147_483_647);
  return http.post<SorteggiResult>(`fasi/${id}/sorteggio`, { seed: s });
}

/**
 * PATCH /api/fasi/reorder — riordina tutte le fasi del concorso.
 * `ids` deve contenere TUTTI gli id delle fasi del concorso nell'ordine desiderato.
 */
export function reorderFasi(
  concorsoId: string,
  ids: string[],
): Promise<{ ok: boolean }> {
  return http.patch<{ ok: boolean }>('fasi/reorder', { concorsoId, ids });
}

// ─── Criteri sync ─────────────────────────────────────────────────────────────

/**
 * Sostituisce atomicamente i criteri di una fase.
 * Wrapper di replaceCriteri per importazione comoda da FasiTab.
 */
export function syncCriteri(
  faseId: string,
  criteri: CriterioInput[],
): Promise<CriterioRecord[]> {
  return replaceCriteri(faseId, criteri);
}

// ─── React Query hook ────────────────────────────────────────────────────────

export const FASI_QUERY_KEY = (concorsoId: string) => ['fasi', concorsoId] as const;

export function useFasi(concorsoId: string) {
  return useQuery({
    queryKey: FASI_QUERY_KEY(concorsoId),
    queryFn: () => listFasi(concorsoId),
    enabled: !!concorsoId,
  });
}
