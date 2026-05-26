/**
 * Concorsi API — typed wrappers + react-query hooks.
 *
 * Endpoints (server/src/routes/concorsi.ts):
 *   GET    /api/concorsi           → Concorso[]
 *   GET    /api/concorsi/:id       → Concorso
 *   POST   /api/concorsi           → Concorso (admin)
 *   PATCH  /api/concorsi/:id       → Concorso (admin)
 *   DELETE /api/concorsi/:id       → 204 (admin, ?force=true)
 *
 * Field note: the DB schema exposes camelCase from Drizzle:
 *   nome, anno, dataInizio, stato (ATTIVO|CONCLUSO|null), logo (path string),
 *   anonimo, iscrizioniAperte, iscrizioniScadenza (date string|null)
 * The shared Concorso type in types/index.ts maps these (logoUrl vs logo handled
 * here with a local alias — see ConcorsoRaw below).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback, useEffect } from 'react';
import { http } from '@/lib/api';
import type { Concorso } from '@/types';

// ---------------------------------------------------------------------------
// Local type: raw shape returned by the server (logo is a path, not logoUrl)
// The shared Concorso type uses logoUrl; we normalise here.
// ---------------------------------------------------------------------------
interface ConcorsoRaw {
  id: string;
  nome: string;
  anno: number;
  dataInizio: string | null;
  stato: string | null;
  logo: string | null;
  anonimo: boolean;
  iscrizioniAperte: boolean;
  iscrizioniScadenza: string | null;
  defaultTiebreakStrategy?: { key: string; enabled: boolean }[] | null;
  createdAt?: string;
  updatedAt?: string;
}

function normalize(raw: ConcorsoRaw): Concorso {
  return {
    id: raw.id,
    nome: raw.nome,
    anno: raw.anno,
    dataInizio: raw.dataInizio,
    stato: (raw.stato ?? 'ATTIVO') as Concorso['stato'],
    anonimo: raw.anonimo,
    iscrizioniAperte: raw.iscrizioniAperte,
    iscrizioniChiusura: raw.iscrizioniScadenza,
    logoUrl: raw.logo ?? null,
    defaultTiebreakStrategy: raw.defaultTiebreakStrategy ?? null,
  };
}

// ---------------------------------------------------------------------------
// CreateConcorsoBody — mirrors the Zod schema in server/src/routes/concorsi.ts
// ---------------------------------------------------------------------------
export interface CreateConcorsoBody {
  nome: string;
  anno: number;
  dataInizio?: string;
  stato?: 'ATTIVO' | 'CONCLUSO' | 'ARCHIVIATO';
  logo?: string;
  anonimo?: boolean;
  iscrizioniAperte?: boolean;
  iscrizioniScadenza?: string;
  defaultTiebreakStrategy?: { key: string; enabled: boolean }[];
}

export type UpdateConcorsoBody = Partial<CreateConcorsoBody>;

// ---------------------------------------------------------------------------
// Plain async API functions — importable by non-hook code
// ---------------------------------------------------------------------------

export async function listConcorsi(): Promise<Concorso[]> {
  const rows = await http.get<ConcorsoRaw[]>('concorsi');
  return rows.map(normalize);
}

export async function getConcorso(id: string): Promise<Concorso> {
  const raw = await http.get<ConcorsoRaw>(`concorsi/${id}`);
  return normalize(raw);
}

export async function createConcorso(body: CreateConcorsoBody): Promise<Concorso> {
  const raw = await http.post<ConcorsoRaw>('concorsi', body);
  return normalize(raw);
}

export async function updateConcorso(id: string, body: UpdateConcorsoBody): Promise<Concorso> {
  const raw = await http.patch<ConcorsoRaw>(`concorsi/${id}`, body);
  return normalize(raw);
}

/**
 * Delete a concorso.
 * Pass force=true to bypass the guard that prevents deleting a concorso with
 * linked candidati/iscrizioni (server returns 409 without it).
 */
export async function deleteConcorso(id: string, force = false): Promise<void> {
  await http.del(`concorsi/${id}${force ? '?force=true' : ''}`);
}

// ---------------------------------------------------------------------------
// Summary — conteggi sintetici del concorso (badge/header workspace admin).
// Una sola GET aggregata invece di scaricare candidati/commissari/commissioni/
// fasi/sezioni per intero solo per contarli. Endpoint: GET concorsi/:id/summary.
// ---------------------------------------------------------------------------
export interface ConcorsoSummary {
  concorsoId: string;
  candidati: number;
  commissari: number;
  commissioni: number;
  fasi: number;
  sezioni: number;
}

export async function getConcorsoSummary(id: string): Promise<ConcorsoSummary> {
  return http.get<ConcorsoSummary>(`concorsi/${id}/summary`);
}

// ---------------------------------------------------------------------------
// React-Query hooks
// ---------------------------------------------------------------------------

export const CONCORSI_QUERY_KEY = ['concorsi'] as const;
export const concorsoQueryKey = (id: string) => ['concorsi', id] as const;
export const concorsoSummaryQueryKey = (id: string) => ['concorsi', id, 'summary'] as const;

/** Returns the list of all concorsi for the current tenant. */
export function useConcorsi() {
  return useQuery({
    queryKey: CONCORSI_QUERY_KEY,
    queryFn: listConcorsi,
    staleTime: 30_000,
  });
}

/** Returns a single concorso by id. */
export function useConcorso(id: string | null | undefined) {
  return useQuery({
    queryKey: concorsoQueryKey(id ?? ''),
    queryFn: () => getConcorso(id ?? ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/** Conteggi sintetici del concorso (candidati/commissari/commissioni/fasi/sezioni). */
export function useConcorsoSummary(id: string | null | undefined) {
  return useQuery({
    queryKey: concorsoSummaryQueryKey(id ?? ''),
    queryFn: () => getConcorsoSummary(id ?? ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateConcorso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createConcorso,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CONCORSI_QUERY_KEY });
    },
  });
}

export function useUpdateConcorso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateConcorsoBody }) =>
      updateConcorso(id, body),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: CONCORSI_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: concorsoQueryKey(vars.id) });
    },
  });
}

export function useDeleteConcorso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      deleteConcorso(id, force),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CONCORSI_QUERY_KEY });
    },
  });
}

// ---------------------------------------------------------------------------
// Active-concorso — client-side, persisted in localStorage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'gestimus_active_concorso';

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null): void {
  try {
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    /* storage not available */
  }
}

export interface UseActiveConcorsoResult {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  activeConcorso: Concorso | null;
}

/**
 * Hook that surfaces the currently-selected concorso id (from localStorage)
 * together with the full Concorso object (resolved from the react-query cache
 * or live list).
 */
export function useActiveConcorso(): UseActiveConcorsoResult {
  const [activeId, setActiveIdState] = useState<string | null>(readStoredId);
  const { data: concorsi = [] } = useConcorsi();

  // Sync from localStorage changes in other tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setActiveIdState(e.newValue ?? null);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const setActiveId = useCallback((id: string | null) => {
    writeStoredId(id);
    setActiveIdState(id);
  }, []);

  // Auto-select the first concorso if nothing is stored and list is loaded
  useEffect(() => {
    if (activeId === null && concorsi.length > 0) {
      const first = concorsi[0];
      if (first) setActiveId(first.id);
    }
  }, [activeId, concorsi, setActiveId]);

  const activeConcorso = concorsi.find((c) => c.id === activeId) ?? null;

  return { activeId, setActiveId, activeConcorso };
}
