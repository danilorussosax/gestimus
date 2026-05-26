/**
 * api/candidati.ts — CRUD candidati + photo upload.
 * Routes: GET/POST /api/candidati, PATCH/DELETE /api/candidati/:id
 * Campo foto: il backend accetta un campo `foto` nella PATCH body (dataURL) ma
 * la route /api/upload/candidati/:id è supportata tramite http.upload.
 *
 * SHAPE BRIDGE — il backend NON ha i campi `tipo` né `fotoUrl`: la tabella
 * candidati usa `isGruppo` + `tipoGruppo` (e `foto`). Il frontend (form,
 * scoring, tiebreak, calendario) ragiona su un campo derivato `tipo`
 * ('individuale' | 'gruppo' | 'orchestra') e su `fotoUrl`. Questi due campi
 * vengono derivati in lettura (normalizeCandidato) e ri-tradotti in scrittura
 * (denormalizeBody → isGruppo/tipoGruppo). Senza questo ponte un "gruppo"
 * veniva salvato con isGruppo=false (zod scartava `tipo`) e letto come
 * individuale, e le foto non comparivano mai (c.fotoUrl === undefined).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/api';
import type { Candidato, CandidatoTipo, Sezione, Categoria } from '@/types';

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

// ── Shape bridge tra backend (isGruppo/tipoGruppo/foto) e frontend
//    (tipo/fotoUrl) ─────────────────────────────────────────────────────────

/** Riga grezza così come torna dal backend (no `tipo`, no `fotoUrl`). */
type CandidatoRaw = Omit<CandidatoFull, 'tipo' | 'fotoUrl'> & {
  isGruppo: boolean;
  tipoGruppo: 'ensemble' | 'orchestra' | null;
  foto: string | null;
};

/** Deriva il `tipo` del frontend dai campi reali del backend. */
function deriveTipo(isGruppo: boolean, tipoGruppo: string | null): CandidatoTipo {
  if (!isGruppo) return 'individuale';
  return tipoGruppo === 'orchestra' ? 'orchestra' : 'gruppo';
}

/**
 * Aggiunge i campi derivati `tipo` e `fotoUrl` alla riga del backend.
 * Esportata: i componenti che fanno `http.get<Candidato[]>('candidati')` grezzo
 * devono passarci ogni riga, altrimenti `c.tipo`/`c.fotoUrl` restano undefined.
 * Accetta una shape larga (Candidato | CandidatoRaw) e restituisce sempre la
 * forma completa CandidatoFull (con `tipo` e `fotoUrl` valorizzati).
 */
export function normalizeCandidato(
  raw: { isGruppo: boolean; tipoGruppo?: 'ensemble' | 'orchestra' | null; foto?: string | null },
): CandidatoFull {
  return {
    ...(raw as unknown as CandidatoFull),
    tipo: deriveTipo(raw.isGruppo, raw.tipoGruppo ?? null),
    fotoUrl: raw.foto ?? null,
  };
}

/**
 * Traduce il body del form (che porta `tipo`) nei campi reali del backend
 * (`isGruppo` + `tipoGruppo`). Rimuove i campi derivati `tipo`/`fotoUrl` che il
 * backend non conosce. Lascia invariati gli altri campi.
 * Esportata per i test del contratto write-path (ui → payload).
 */
export function denormalizeBody<T extends { tipo?: CandidatoTipo | null }>(
  body: T,
): Omit<T, 'tipo' | 'fotoUrl'> & { isGruppo?: boolean; tipoGruppo?: 'ensemble' | 'orchestra' | null } {
  const { tipo, ...rest } = body as T & { fotoUrl?: unknown };
  delete (rest as { fotoUrl?: unknown }).fotoUrl;
  if (tipo === undefined) {
    // PATCH che non tocca il tipo: non inviare isGruppo/tipoGruppo.
    return rest as Omit<T, 'tipo' | 'fotoUrl'>;
  }
  if (tipo === 'individuale' || tipo == null) {
    return { ...(rest as object), isGruppo: false, tipoGruppo: null } as Omit<T, 'tipo' | 'fotoUrl'> & {
      isGruppo: boolean;
      tipoGruppo: 'ensemble' | 'orchestra' | null;
    };
  }
  return {
    ...(rest as object),
    isGruppo: true,
    tipoGruppo: tipo === 'orchestra' ? 'orchestra' : 'ensemble',
  } as Omit<T, 'tipo' | 'fotoUrl'> & { isGruppo: boolean; tipoGruppo: 'ensemble' | 'orchestra' | null };
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
  gruppoNome?: string | null;
  /**
   * Tipo del candidato dal form. Tradotto in `isGruppo`+`tipoGruppo` da
   * denormalizeBody prima dell'invio (il backend non conosce `tipo`).
   */
  tipo?: CandidatoTipo;
  isGruppo?: boolean;
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
    http
      .get<CandidatoRaw[]>('candidati', { concorsoId, limit: opts?.limit ?? 500, offset: opts?.offset })
      .then((rows) => rows.map(normalizeCandidato)),

  get: (id: string) => http.get<CandidatoRaw>(`candidati/${id}`).then(normalizeCandidato),

  create: (body: CreateCandidatoInput) =>
    http.post<CandidatoRaw>('candidati', denormalizeBody(body)).then(normalizeCandidato),

  update: (id: string, body: UpdateCandidatoInput) =>
    http.patch<CandidatoRaw>(`candidati/${id}`, denormalizeBody(body)).then(normalizeCandidato),

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
  listAll: () =>
    http.get<CandidatoRaw[]>('candidati', { limit: 2000 }).then((rows) => rows.map(normalizeCandidato)),

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
