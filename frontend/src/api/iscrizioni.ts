/**
 * api/iscrizioni.ts — gestione iscrizioni pubbliche (admin).
 * Routes admin: GET /api/iscrizioni, GET /api/iscrizioni/:id,
 *               POST /api/iscrizioni/:id/approve, POST /api/iscrizioni/:id/reject,
 *               GET /api/iscrizioni/:id/allegati, GET /api/iscrizioni/allegati/:id/download
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/api';

// ── Tipi locali ──────────────────────────────────────────────────────────────

/** Stati reali del DB (CHECK constraint). */
export type IscrizioneStatoDb =
  | 'BOZZA'
  | 'INVIATA'
  | 'EMAIL_VERIFICATA'
  | 'APPROVATA'
  | 'RIFIUTATA';

export interface IscrizioneFull {
  id: string;
  concorsoId: string;
  stato: IscrizioneStatoDb;
  nome: string;
  cognome: string | null;
  email: string;
  telefono: string | null;
  dataNascita: string | null;
  nazionalita: string | null;
  luogoNascita: string | null;
  sesso: string | null;
  codiceFiscale: string | null;
  indirizzo: string | null;
  citta: string | null;
  cap: string | null;
  provincia: string | null;
  paese: string | null;
  strumento: string | null;
  anniStudio: number | null;
  scuolaProvenienza: string | null;
  programma: unknown;
  docentiPreparatori: unknown;
  sezioneId: string | null;
  categoriaId: string | null;
  isGruppo: boolean;
  gruppoNome: string | null;
  tipoGruppo: string | null;
  membri: unknown;
  tutore: unknown;
  consensiGdpr: Record<string, boolean> | null;
  noteLibere: string | null;
  emailVerifiedAt: string | null;
  approvataAt: string | null;
  candidatoId: string | null;
  note: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IscrizioneAllegato {
  id: string;
  tipo: 'foto' | 'documento' | 'ricevuta' | 'altro';
  nomeFile: string;
  sizeBytes: number | null;
  mimeType: string | null;
  createdAt: string;
}

export interface ApproveResult {
  ok: boolean;
  alreadyApproved?: boolean;
  candidatoId?: string;
  iscrizione?: IscrizioneFull;
  candidato?: unknown;
}

export interface RejectResult {
  ok: boolean;
  iscrizione?: IscrizioneFull;
}

// ── API functions ─────────────────────────────────────────────────────────────

export const iscrizioniApi = {
  list: (concorsoId: string, stato?: IscrizioneStatoDb, opts?: { limit?: number; offset?: number }) =>
    http.get<IscrizioneFull[]>('iscrizioni', {
      concorsoId,
      stato,
      limit: opts?.limit ?? 500,
      offset: opts?.offset,
    }),

  get: (id: string) => http.get<IscrizioneFull>(`iscrizioni/${id}`),

  approve: (id: string, note?: string) =>
    http.post<ApproveResult>(`iscrizioni/${id}/approve`, { note }),

  reject: (id: string, reason?: string) =>
    http.post<RejectResult>(`iscrizioni/${id}/reject`, { reason }),

  allegati: (id: string) => http.get<IscrizioneAllegato[]>(`iscrizioni/${id}/allegati`),

  /** URL diretto per il download (aperto in nuova scheda). */
  downloadAllegatoUrl: (allegatoId: string) => `/api/iscrizioni/allegati/${allegatoId}/download`,

  /**
   * Scarica il CSV delle iscrizioni del concorso (generato lato server, admin-only,
   * tracciato in audit per PII). Usa fetch+blob (non un semplice <a href>) perché
   * il cookie di sessione viaggia con credentials:'include' e così possiamo
   * intercettare gli errori (401/403/404) invece di scaricare una pagina di errore.
   */
  exportCsv: async (concorsoId: string): Promise<Blob> => {
    const res = await fetch(`/api/iscrizioni/export?concorsoId=${encodeURIComponent(concorsoId)}`, {
      credentials: 'include',
      headers: { Accept: 'text/csv' },
    });
    if (!res.ok) {
      let msg = `Errore HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string; message?: string };
        msg = j.error ?? j.message ?? msg;
      } catch { /* risposta non-JSON: tieni il messaggio di default */ }
      throw new Error(msg);
    }
    return res.blob();
  },
};

// ── React Query hook ──────────────────────────────────────────────────────────

export const ISCRIZIONI_KEY = (concorsoId: string) => ['iscrizioni', concorsoId] as const;

export function useIscrizioni(concorsoId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ISCRIZIONI_KEY(concorsoId),
    queryFn: () => iscrizioniApi.list(concorsoId),
    enabled: !!concorsoId,
    staleTime: 20_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ISCRIZIONI_KEY(concorsoId) });
    // Approvare crea un candidato → aggiorna anche quella lista
    void qc.invalidateQueries({ queryKey: ['candidati', concorsoId] });
  };

  const approveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      iscrizioniApi.approve(id, note),
    onSuccess: invalidate,
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      iscrizioniApi.reject(id, reason),
    onSuccess: invalidate,
  });

  return {
    iscrizioni: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    approveMutation,
    rejectMutation,
    refetch: query.refetch,
  };
}
