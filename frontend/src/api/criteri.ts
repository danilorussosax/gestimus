/**
 * API wrappers per i criteri di valutazione.
 * Rotta server: /api/criteri (routes/criteri.ts)
 *
 * I criteri lato DB hanno: id, faseId, nome, descrizione, peso (int 0-100), ordine.
 * Il replace atomico PUT /api/criteri/fase/:faseId è la via principale: cancella e
 * reinserisce tutti i criteri della fase in una singola transazione, normalizzando
 * i pesi a somma 100 (metodo largest-remainder).
 */

import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/api';

// ─── Tipi locali ────────────────────────────────────────────────────────────

export interface CriterioRecord {
  id: string;
  faseId: string;
  nome: string;
  descrizione?: string | null;
  peso: number;        // int 0-100
  ordine: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Payload per un singolo criterio nel replace atomico. */
export interface CriterioInput {
  nome: string;
  descrizione?: string;
  /** Peso relativo 0-100. Il server normalizza la somma a 100. */
  peso: number;
  ordine?: number;
}

// ─── HTTP primitives ─────────────────────────────────────────────────────────

/** GET /api/criteri?faseId=… */
export function listCriteri(faseId: string): Promise<CriterioRecord[]> {
  return http.get<CriterioRecord[]>('criteri', { faseId });
}

/**
 * PUT /api/criteri/fase/:faseId — replace atomico (delete + insert in una tx).
 * I pesi vengono normalizzati dal server (largest-remainder → somma 100).
 * Richiede almeno 1 criterio.
 */
export function replaceCriteri(
  faseId: string,
  criteri: CriterioInput[],
): Promise<CriterioRecord[]> {
  return http.put<CriterioRecord[]>(`criteri/fase/${faseId}`, { criteri });
}

/** PATCH /api/criteri/:id */
export function updateCriterio(
  id: string,
  body: Partial<Omit<CriterioInput, 'faseId'>>,
): Promise<CriterioRecord> {
  return http.patch<CriterioRecord>(`criteri/${id}`, body);
}

/** DELETE /api/criteri/:id */
export function deleteCriterio(id: string): Promise<void> {
  return http.del<undefined>(`criteri/${id}`);
}

// ─── React Query hook ────────────────────────────────────────────────────────

export function useCriteri(faseId: string | undefined) {
  return useQuery({
    queryKey: ['criteri', faseId],
    queryFn: () => listCriteri(faseId!),
    enabled: !!faseId,
  });
}
