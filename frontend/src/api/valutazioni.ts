/**
 * api/valutazioni.ts
 *
 * Server contract (server/src/routes/valutazioni.ts):
 *   GET  /api/valutazioni?candidatoFaseId=&commissarioId= → Valutazione[]
 *   POST /api/valutazioni  { candidatoFaseId, commissarioId, criterio, voto, note? } → Valutazione (201)
 *   PATCH /api/valutazioni/:id { voto?, note? } → Valutazione
 *
 * The server has ONE row per (candidatoFaseId, commissarioId, criterio) — i.e.
 * one POST per criterio, NOT a batch. saveValutazione() fans out one POST per
 * criterio key in the `voti` map.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/api';
import type { Valutazione } from '@/types';

// ─── Raw fetch helpers ────────────────────────────────────────────────────────

export async function fetchValutazioniByCandidatoFase(
  candidatoFaseId: string,
): Promise<Valutazione[]> {
  return http.get<Valutazione[]>('valutazioni', { candidatoFaseId, limit: 1000 });
}

export async function fetchValutazioniByCommissario(
  commissarioId: string,
): Promise<Valutazione[]> {
  return http.get<Valutazione[]>('valutazioni', { commissarioId, limit: 1000 });
}

/**
 * Fetch all valutazioni for every candidatoFase in a fase.
 * There is no per-fase endpoint, so we accept a list of candidatoFaseIds and
 * fan out in parallel (batched Promise.all).
 */
export async function fetchValutazioniByFase(
  candidatoFaseIds: string[],
): Promise<Valutazione[]> {
  if (candidatoFaseIds.length === 0) return [];
  const chunks = await Promise.all(
    candidatoFaseIds.map((id) => fetchValutazioniByCandidatoFase(id)),
  );
  return chunks.flat();
}

// ─── Write ────────────────────────────────────────────────────────────────────

export interface SaveValutazioneParams {
  candidatoFaseId: string;
  commissarioId: string;
  /** One entry per criterio key: { tecnica: 8, interpretazione: 7, … } */
  voti: Record<string, number>;
  note?: string;
}

/**
 * Upsert all criteri voti for one (candidatoFase, commissario) pair.
 * The server expects ONE POST per criterio (upsert via ON CONFLICT DO UPDATE).
 * We fan out all requests in parallel and return all resulting rows.
 */
export async function saveValutazione(params: SaveValutazioneParams): Promise<Valutazione[]> {
  const { candidatoFaseId, commissarioId, voti, note } = params;
  const entries = Object.entries(voti);
  if (entries.length === 0) return [];
  return Promise.all(
    entries.map(([criterio, voto]) =>
      http.post<Valutazione>('valutazioni', {
        candidatoFaseId,
        commissarioId,
        criterio,
        voto,
        note,
      }),
    ),
  );
}

// ─── React Query hooks ────────────────────────────────────────────────────────

export function useValutazioniByCandidatoFase(candidatoFaseId: string | undefined) {
  return useQuery({
    queryKey: ['valutazioni', 'by-cf', candidatoFaseId],
    queryFn: () => fetchValutazioniByCandidatoFase(candidatoFaseId!),
    enabled: Boolean(candidatoFaseId),
    staleTime: 30_000,
  });
}

export function useValutazioniByCommissario(commissarioId: string | undefined) {
  return useQuery({
    queryKey: ['valutazioni', 'by-commissario', commissarioId],
    queryFn: () => fetchValutazioniByCommissario(commissarioId!),
    enabled: Boolean(commissarioId),
    staleTime: 30_000,
  });
}

/**
 * Hook that loads all valutazioni for a fase given its candidatoFaseIds.
 * Pass an empty/undefined array to keep the query disabled.
 */
export function useValutazioniByFase(candidatoFaseIds: string[] | undefined) {
  return useQuery({
    queryKey: ['valutazioni', 'by-fase', ...(candidatoFaseIds ?? [])],
    queryFn: () => fetchValutazioniByFase(candidatoFaseIds!),
    enabled: Array.isArray(candidatoFaseIds) && candidatoFaseIds.length > 0,
    staleTime: 30_000,
  });
}

export function useSaveValutazione() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveValutazione,
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({
        queryKey: ['valutazioni', 'by-cf', variables.candidatoFaseId],
      });
    },
  });
}
