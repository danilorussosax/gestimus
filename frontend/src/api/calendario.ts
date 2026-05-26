/**
 * api/calendario.ts — Sale, eventi calendario, slot generation/reorder,
 * pubblicazioni (link pubblici).
 *
 * Routes backend: server/src/routes/calendario.ts
 * Base path: /api/calendario  (il server monta questo plugin su /api/calendario)
 *
 * NOTE: tutti i path vengono passati con prefisso 'calendario/' in modo che
 * buildUrl li risolva a /api/calendario/... (il lib/api aggiunge /api/).
 */

import { http } from '@/lib/api';
import type { Sala, Evento } from '@/types';

// ─── Tipo locale: pubblicazione (link pubblico) ───────────────────────────────

export type CalendarioScopo = 'CONCORSO' | 'SEZIONE' | 'GIORNO';

export interface CalendarioPubblicazione {
  id: string;
  concorsoId: string;
  token: string;
  scopo: CalendarioScopo;
  sezioneId: string | null;
  giorno: string | null;
  etichetta: string | null;
  attivo: boolean;
  mostraNomi: boolean;
  mostraCommissione: boolean;
  createdAt: string;
}

// ─── Payload types ────────────────────────────────────────────────────────────

export interface SalaCreate {
  concorsoId: string;
  nome: string;
  indirizzo?: string | null;
  ordine?: number | null;
}
export type SalaUpdate = Partial<Omit<SalaCreate, 'concorsoId'>>;

export interface EventoCreate {
  concorsoId: string;
  faseId?: string | null;
  sezioneId?: string | null;
  categoriaId?: string | null;
  salaId?: string | null;
  tipo?: 'ESIBIZIONE' | 'EVENTO';
  titolo?: string | null;
  data: string;
  oraInizio?: string | null;
  oraFine?: string | null;
  durataCandidatoMinuti?: number | null;
  note?: string | null;
  ordine?: number | null;
}
export type EventoUpdate = Partial<Omit<EventoCreate, 'concorsoId'>>;

export interface PubCreate {
  concorsoId: string;
  scopo: CalendarioScopo;
  sezioneId?: string | null;
  giorno?: string | null;
  etichetta?: string | null;
  attivo?: boolean;
  mostraNomi?: boolean;
  mostraCommissione?: boolean;
}
export type PubUpdate = Partial<Omit<PubCreate, 'concorsoId' | 'scopo'>>;

export interface SlotItem {
  id: string;
  candidatoId: string;
  posizione: number | null;
  oraPrevista: string | null;
  numeroCandidato: number | null;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const calendarioApi = {
  // ── Sale ──
  getSale: (concorsoId?: string) =>
    http.get<Sala[]>('calendario/sale', concorsoId ? { concorsoId } : undefined),

  createSala: (body: SalaCreate) =>
    http.post<Sala>('calendario/sale', body),

  updateSala: (id: string, body: SalaUpdate) =>
    http.patch<Sala>(`calendario/sale/${id}`, body),

  deleteSala: (id: string) =>
    http.del<undefined>(`calendario/sale/${id}`),

  // ── Eventi ──
  getEventi: (concorsoId?: string) =>
    http.get<Evento[]>('calendario/eventi', concorsoId ? { concorsoId } : undefined),

  createEvento: (body: EventoCreate) =>
    http.post<Evento>('calendario/eventi', body),

  updateEvento: (id: string, body: EventoUpdate) =>
    http.patch<Evento>(`calendario/eventi/${id}`, body),

  deleteEvento: (id: string) =>
    http.del<undefined>(`calendario/eventi/${id}`),

  /** POST /calendario/eventi/:id/genera-slot → ricalcola gli orari individuali */
  generaSlot: (eventoId: string) =>
    http.post<SlotItem[]>(`calendario/eventi/${eventoId}/genera-slot`),

  /** POST /calendario/eventi/:id/riordina-slot { ordine: string[] } */
  riordinaSlot: (eventoId: string, ordine: string[]) =>
    http.post<SlotItem[]>(`calendario/eventi/${eventoId}/riordina-slot`, { ordine }),

  // ── Pubblicazioni (link pubblici) ──
  getPubblicazioni: (concorsoId?: string) =>
    http.get<CalendarioPubblicazione[]>(
      'calendario/pubblicazioni',
      concorsoId ? { concorsoId } : undefined,
    ),

  createPubblicazione: (body: PubCreate) =>
    http.post<CalendarioPubblicazione>('calendario/pubblicazioni', body),

  updatePubblicazione: (id: string, body: PubUpdate) =>
    http.patch<CalendarioPubblicazione>(`calendario/pubblicazioni/${id}`, body),

  deletePubblicazione: (id: string) =>
    http.del<undefined>(`calendario/pubblicazioni/${id}`),
};
