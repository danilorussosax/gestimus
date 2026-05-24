/**
 * api/public.ts — Endpoint pubblici (no auth).
 *
 * Copertura:
 *   - GET  /api/public/concorsi           → concorsi con iscrizioni aperte
 *   - GET  /api/public/concorsi/:id       → dettaglio + sezioni + categorie
 *   - POST /api/public/iscrizioni         → submit iscrizione
 *   - POST /api/public/iscrizioni/:uploadToken/allegati → upload allegato
 *   - POST /api/public/iscrizioni/:token/verify → verifica email
 *   - GET  /api/public/calendario/:token  → calendario pubblico
 *   - GET  /api/ente/public               → branding pubblico
 *
 * Tutti gli endpoint leggono il tenant dal subdomain (middleware globale).
 * Nessuna autenticazione richiesta.
 */

import { api } from '@/lib/api';

// ─── Tipi: concorsi pubblici ─────────────────────────────────────────────────

/** Concorso nella lista pubblica (iscrizioni aperte). */
export interface ConcorsoPublic {
  id: string;
  nome: string;
  anno: number | null;
  dataInizio: string | null;
  logo: string | null;
  iscrizioniScadenza: string | null;
  stato: string;
}

/** Sezione esposta nel dettaglio concorso pubblico. */
export interface SezionePublic {
  id: string;
  nome: string;
  descrizione: string | null;
}

/** Categoria esposta nel dettaglio concorso pubblico. */
export interface CategoriaPublic {
  id: string;
  sezioneId: string;
  nome: string;
  etaMin: number | null;
  etaMax: number | null;
}

/** Dettaglio concorso pubblico (include sezioni + categorie). */
export interface ConcorsoDetailPublic extends ConcorsoPublic {
  sezioni: SezionePublic[];
  categorie: CategoriaPublic[];
}

// ─── Tipi: submit iscrizione ─────────────────────────────────────────────────

export interface TutoreInput {
  nome?: string;
  cognome?: string;
  email?: string;
  telefono?: string;
}

export interface ProgrammaBrano {
  titolo: string;
  autore?: string;
  durata_min?: number;
}

export interface MembroGruppo {
  nome: string;
  cognome?: string;
  strumento?: string;
  data_nascita?: string;
}

/** Payload per POST /api/public/iscrizioni. */
export interface IscrizioneCreateInput {
  concorsoId: string;
  // Anti-spam
  website?: string;       // honeypot — DEVE essere inviato vuoto da utenti legittimi
  startedAt?: number;     // timestamp apertura form (ms)
  // Anagrafica
  nome: string;
  cognome?: string;
  email: string;
  telefono?: string;
  dataNascita?: string;
  nazionalita?: string;
  luogoNascita?: string;
  sesso?: string;
  codiceFiscale?: string;
  // Residenza
  indirizzo?: string;
  citta?: string;
  cap?: string;
  provincia?: string;
  paese?: string;
  // Artistici
  strumento?: string;
  anniStudio?: number;
  scuolaProvenienza?: string;
  programma?: ProgrammaBrano[];
  docentiPreparatori?: string[];
  sezioneId?: string;
  categoriaId?: string;
  isGruppo?: boolean;
  gruppoNome?: string;
  tipoGruppo?: 'ensemble' | 'orchestra';
  membri?: MembroGruppo[];
  tutore?: TutoreInput;
  // Consensi GDPR — obbligatori (schema server: literal(true))
  consensiGdpr: {
    privacy: true;
    regolamento: true;
    immagini?: boolean;
  };
  noteLibere?: string;
}

/** Risposta a POST /api/public/iscrizioni (201). */
export interface IscrizioneCreateResult {
  ok: boolean;
  iscrizioneId: string;
  /** Token capability per upload allegati. Solo nel 201, non nei logging. */
  uploadToken: string;
}

/** Risposta a POST /api/public/iscrizioni/:token/verify. */
export interface VerifyEmailResult {
  ok: boolean;
  alreadyVerified?: boolean;
  iscrizioneId?: string;
}

// ─── Tipi: calendario pubblico ────────────────────────────────────────────────

export interface CalSlot {
  oraPrevista: string | null;
  numero: number;
  etichetta: string;
  /** Marcatura live (aggiunta client-side): 'now' | 'next' | null */
  _live?: 'now' | 'next' | null;
}

export interface CalBlocco {
  id: string;
  tipo: string;
  titolo: string | null;
  oraInizio: string | null;
  oraFine: string | null;
  sala: { id: string; nome: string; indirizzo: string | null } | null;
  sezione: { id: string; nome: string } | null;
  categoria: { id: string; nome: string } | null;
  fase: { nome: string } | null;
  commissione: { nome: string; cognome: string | null; specialita: string | null }[] | null;
  slot: CalSlot[];
}

export interface CalGiorno {
  data: string;
  blocchi: CalBlocco[];
}

export interface CalendarioPubblicResponse {
  concorso: {
    id: string;
    nome: string;
    anno: number | null;
    logo: string | null;
  };
  pubblicazione: {
    scopo: string;
    etichetta: string | null;
    mostraNomi: boolean;
    mostraCommissione: boolean;
    sezioneId: string | null;
    giorno: string | null;
  };
  giorni: CalGiorno[];
}

// ─── Tipi: branding pubblico ─────────────────────────────────────────────────

export interface EnteBrandingPublic {
  slug?: string;
  nome?: string;
  brandingPublic?: {
    nomePubblico?: string;
    sottotitolo?: string;
    logoUrl?: string;
    coloreAccent?: string;
    coloreSfondo?: string;
  } | null;
  configured?: boolean;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const publicApi = {
  // ── Concorsi pubblici ──────────────────────────────────────────────────────

  /** GET /api/public/concorsi — concorsi aperti alle iscrizioni. */
  listConcorsiAperti: () =>
    api<ConcorsoPublic[]>('/api/public/concorsi', { method: 'GET' }),

  /** GET /api/public/concorsi/:id — dettaglio + sezioni + categorie. */
  getConcorso: (id: string) =>
    api<ConcorsoDetailPublic>(`/api/public/concorsi/${id}`, { method: 'GET' }),

  // ── Iscrizioni pubbliche ───────────────────────────────────────────────────

  /**
   * POST /api/public/iscrizioni — submit iscrizione.
   * Rate-limit: 3/ora per IP. Honeypot + min-time-on-page gestiti server-side.
   */
  createIscrizione: (body: IscrizioneCreateInput) =>
    api<IscrizioneCreateResult>('/api/public/iscrizioni', { method: 'POST', body }),

  /**
   * POST /api/public/iscrizioni/:uploadToken/allegati — upload allegato.
   * Il body è FormData con field "file".
   */
  uploadAllegato: (uploadToken: string, tipo: 'foto' | 'documento' | 'ricevuta' | 'altro', file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api<{ ok: boolean }>(
      `/api/public/iscrizioni/${encodeURIComponent(uploadToken)}/allegati?tipo=${tipo}`,
      { method: 'POST', body: fd },
    );
  },

  /**
   * POST /api/public/iscrizioni/:token/verify — verifica email.
   * Il backend usa POST (non GET) per evitare activation via prefetch/scanner.
   */
  verifyEmail: (token: string) =>
    api<VerifyEmailResult>(`/api/public/iscrizioni/${encodeURIComponent(token)}/verify`, { method: 'POST' }),

  // ── Calendario pubblico ────────────────────────────────────────────────────

  /** GET /api/public/calendario/:token — calendario del concorso. */
  getCalendario: (token: string) =>
    api<CalendarioPubblicResponse>(`/api/public/calendario/${encodeURIComponent(token)}`, { method: 'GET' }),

  // ── Branding pubblico ──────────────────────────────────────────────────────

  /** GET /api/ente/public — branding pubblico (no auth, usato per login + pubbliche). */
  getEnteBranding: () =>
    api<EnteBrandingPublic>('/api/ente/public', { method: 'GET' }),
};
