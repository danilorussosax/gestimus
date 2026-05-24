/**
 * api/candidati.ts — CRUD candidati + photo upload.
 * Routes: GET/POST /api/candidati, PATCH/DELETE /api/candidati/:id
 * Campo foto: il backend accetta un campo `foto` nella PATCH body (dataURL) ma
 * la route /api/upload/candidati/:id è supportata tramite http.upload.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/api';
import type { Candidato, Sezione, Categoria } from '@/types';

// ── Tipi locali ──────────────────────────────────────────────────────────────

export interface CandidatoFull extends Candidato {
  telefono: string | null;
  sesso: string | null;
  luogoNascita: string | null;
  codiceFiscale: string | null;
  indirizzo: string | null;
  citta: string | null;
  cap: string | null;
  provincia: string | null;
  paese: string | null;
  anniStudio: number | null;
  scuolaProvenienza: string | null;
  docentiPreparatori: string[] | null;
  programma: unknown;
  tutore: unknown;
  noteLibere: string | null;
  dataIscrizione: string | null;
  tipoGruppo: 'ensemble' | 'orchestra' | null;
  foto: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCandidatoInput {
  concorsoId: string;
  nome: string;
  cognome?: string | null;
  strumento: string;
  dataNascita?: string | null;
  nazionalita?: string | null;
  email?: string | null;
  telefono?: string | null;
  sesso?: string | null;
  luogoNascita?: string | null;
  codiceFiscale?: string | null;
  indirizzo?: string | null;
  citta?: string | null;
  cap?: string | null;
  provincia?: string | null;
  paese?: string | null;
  anniStudio?: number | null;
  scuolaProvenienza?: string | null;
  docentiPreparatori?: string[];
  noteLibere?: string | null;
  sezioneId?: string | null;
  categoriaId?: string | null;
  isGruppo?: boolean;
  gruppoNome?: string | null;
  tipoGruppo?: 'ensemble' | 'orchestra' | null;
}

export type UpdateCandidatoInput = Partial<Omit<CreateCandidatoInput, 'concorsoId'>>;

/**
 * Membro di un candidato-gruppo (riga della tabella candidati_membri,
 * dati piatti: nome/cognome/strumento/data_nascita — non riferimenti ad
 * altri candidati). Allinea il modello del backend route /membri-gruppo.
 */
export interface MembroGruppo {
  id: string;
  candidatoId: string;
  nome: string;
  cognome: string | null;
  strumento: string | null;
  dataNascita: string | null;
  nazionalita?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MembroGruppoInput {
  candidatoId: string;
  nome: string;
  cognome?: string;
  strumento?: string;
  dataNascita?: string;
  nazionalita?: string;
}

export type MembroGruppoUpdate = Partial<Omit<MembroGruppoInput, 'candidatoId'>>;

// ── API functions ─────────────────────────────────────────────────────────────

export const candidatiApi = {
  list: (concorsoId: string, opts?: { limit?: number; offset?: number }) =>
    http.get<CandidatoFull[]>('candidati', { concorsoId, limit: opts?.limit ?? 500, offset: opts?.offset }),

  get: (id: string) => http.get<CandidatoFull>(`candidati/${id}`),

  create: (body: CreateCandidatoInput) => http.post<CandidatoFull>('candidati', body),

  update: (id: string, body: UpdateCandidatoInput) =>
    http.patch<CandidatoFull>(`candidati/${id}`, body),

  delete: (id: string) => http.del<void>(`candidati/${id}`),

  /** Carica la foto del candidato via /api/upload/candidati/:id (multipart). */
  uploadFoto: (id: string, file: Blob) => http.upload('candidati', id, file),

  /** Rimuove la foto del candidato (DELETE /api/upload/candidati/:id). */
  deleteFoto: (id: string) => http.del<void>(`/api/upload/candidati/${id}`),

  /** Sezioni e categorie del concorso — necessarie per il form candidato. */
  sezioni: (concorsoId: string) =>
    http.get<Sezione[]>('sezioni', { concorsoId, limit: 200 }),

  categorie: (concorsoId: string) =>
    http.get<Categoria[]>('categorie', { concorsoId, limit: 500 }),

  // ── Membri gruppo (candidati_membri, dati piatti) ─────────────────────────
  /** Elenco membri di un candidato-gruppo. */
  membri: (candidatoId: string) =>
    http.get<MembroGruppo[]>('membri-gruppo', { candidatoId, limit: 200 }),

  addMembro: (body: MembroGruppoInput) =>
    http.post<MembroGruppo>('membri-gruppo', body),

  updateMembro: (id: string, body: MembroGruppoUpdate) =>
    http.patch<MembroGruppo>(`membri-gruppo/${id}`, body),

  removeMembro: (id: string) => http.del<void>(`membri-gruppo/${id}`),

  // ── Storico cross-concorso ────────────────────────────────────────────────
  /** Tutti i candidati del tenant (nessun filtro concorso) per lo storico. */
  listAll: () => http.get<CandidatoFull[]>('candidati', { limit: 2000 }),

  /** Fasi di un concorso (per i conteggi dello storico). */
  fasi: (concorsoId: string) =>
    http.get<{ id: string }[]>('fasi', { concorsoId, limit: 200 }),

  /** Candidati-fase di una fase (per i conteggi dello storico). */
  candidatiFase: (faseId: string) =>
    http.get<{ id: string; candidatoId: string }[]>('candidati-fase', { faseId, limit: 1000 }),

  /** Valutazioni di un candidato-fase (per i conteggi dello storico). */
  valutazioni: (candidatoFaseId: string) =>
    http.get<{ id: string }[]>('valutazioni', { candidatoFaseId, limit: 500 }),
};

// ── React Query hook ──────────────────────────────────────────────────────────

export const CANDIDATI_KEY = (concorsoId: string) => ['candidati', concorsoId] as const;

export function useCandidati(concorsoId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: CANDIDATI_KEY(concorsoId),
    queryFn: () => candidatiApi.list(concorsoId),
    enabled: !!concorsoId,
    staleTime: 30_000,
  });

  const sezioniQuery = useQuery({
    queryKey: ['sezioni', concorsoId],
    queryFn: () => candidatiApi.sezioni(concorsoId),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });

  const categorieQuery = useQuery({
    queryKey: ['categorie', concorsoId],
    queryFn: () => candidatiApi.categorie(concorsoId),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: CANDIDATI_KEY(concorsoId) });

  const createMutation = useMutation({
    mutationFn: candidatiApi.create,
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCandidatoInput }) =>
      candidatiApi.update(id, data),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: candidatiApi.delete,
    onSuccess: invalidate,
  });

  return {
    candidati: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    sezioni: sezioniQuery.data ?? [],
    categorie: categorieQuery.data ?? [],
    createMutation,
    updateMutation,
    deleteMutation,
    refetch: query.refetch,
  };
}
