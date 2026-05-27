/**
 * usePiani() — catalogo piani d'acquisto dal backend (GET /api/platform/piani).
 *
 * Restituisce sia l'array grezzo (Piano[], shape API camelCase) sia una mappa
 * key→PianoInfo (shape locale snake_case) pronta per badge/usage/KPI.
 *
 * Robustezza: finché la query carica o in caso di errore, la mappa ricade sul
 * catalogo statico PIANI di lib/piani.ts, così la UI non si rompe mai (i piani
 * "storici" trial/starter/pro/ultra/ppe restano sempre risolvibili).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { platformApi, type Piano } from '@/api/platform';
import { PIANI, pianoInfoFromApi, type PianiMap, type PianoInfo } from '@/lib/piani';

export const PIANI_QUERY_KEY = ['platform', 'piani'] as const;

export interface UsePianiResult {
  /** Lista grezza dei piani (camelCase) — vuota finché non carica. */
  piani: Piano[];
  /**
   * Mappa key→PianoInfo. È sempre popolata: parte dal catalogo statico PIANI e,
   * appena arrivano i dati dal backend, viene sovrascritta dai piani dinamici.
   */
  pianiMap: PianiMap;
  isLoading: boolean;
  isError: boolean;
}

export function usePiani(): UsePianiResult {
  const q = useQuery({
    queryKey: PIANI_QUERY_KEY,
    queryFn: () => platformApi.listPiani(),
    staleTime: 60_000,
  });

  const pianiMap = useMemo<PianiMap>(() => {
    const data = q.data;
    if (!data || data.length === 0) {
      // Fallback statico: nessun dato (loading/errore/lista vuota).
      return PIANI;
    }
    // Base statica + override dai piani dinamici (così le key storiche mancanti
    // dal backend restano comunque risolvibili).
    const map: Record<string, PianoInfo> = { ...PIANI };
    for (const p of data) {
      map[p.key] = pianoInfoFromApi(p);
    }
    return map;
  }, [q.data]);

  return {
    piani: q.data ?? [],
    pianiMap,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
