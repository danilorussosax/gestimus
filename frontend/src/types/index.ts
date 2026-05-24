// =============================================================================
// Tipi condivisi — contratto API Gestimus (backend Fastify + Drizzle/Postgres).
//
// Le shape rispecchiano le risposte del backend (camelCase). I moduli in
// src/api/* e le pagine in src/pages/* importano da qui. Quando un campo è
// incerto, verificare la rotta corrispondente in server/src/routes/*.ts.
// =============================================================================

/** Forma standard di un errore restituito dal backend. */
export interface ApiError {
  error?: string;
  message?: string;
  code?: string;
  issues?: string[];
  details?: { message: string; path?: string }[];
  statusCode?: number;
}

export type Role = 'commissario' | 'admin' | 'superadmin';

/** Utente autenticato (GET /auth/me). */
export interface User {
  id: string;
  email: string;
  role: Role;
  attivo: boolean;
  tenantId: string;
  /** Presente solo per gli account di tipo commissario. */
  commissarioId: string | null;
  totpEnabled: boolean;
}

/** Risposta di POST /auth/login: o serve il 2FA, o la sessione è già emessa. */
export interface LoginNeedsMfa {
  mfaRequired: true;
  challenge: string;
}
export interface LoginSession {
  account: { id: string; email: string; role: Role; tenantId: string };
  expiresAt: string;
}
export type LoginResponse = LoginNeedsMfa | LoginSession;

// ───────────────────────── Entità di dominio ──────────────────────────────
// (interfacce best-effort dall'inventory della vecchia app; i singoli moduli
//  api le rifiniscono contro le rotte server reali.)

export type ConcorsoStato = 'ATTIVO' | 'SOSPESO' | 'CHIUSO';
export interface Concorso {
  id: string;
  nome: string;
  anno: number | null;
  dataInizio: string | null;
  stato: ConcorsoStato;
  anonimo: boolean;
  iscrizioniAperte: boolean;
  iscrizioniChiusura: string | null;
  logoUrl: string | null;
}

export type FaseStato = 'PIANIFICATA' | 'IN_CORSO' | 'CONCLUSA';
export interface Criterio {
  key: string;
  label: string;
  peso: number;
}
export interface Fase {
  id: string;
  concorsoId: string;
  commissioneId: string | null;
  ordine: number;
  nome: string;
  stato: FaseStato;
  ammessi: number | null;
  dataPrevista: string | null;
  scala: number;
  modoValutazione: 'autonoma' | 'vincolata';
  metodoMedia: string;
  tempoMinuti: number | null;
  tiebreakStrategy: string | null;
  sezioniIds: string[];
  criteri: Criterio[];
}

export interface FaseRuntime {
  stato: FaseStato;
  timerStartedAt: string | null;
  timerPausedAt: string | null;
  timerBonusSeconds: number;
  timerStartedForCfId: string | null;
}

export type CandidatoTipo = 'individuale' | 'gruppo' | 'orchestra';
export interface Candidato {
  id: string;
  concorsoId: string;
  numeroCandidato: number | null;
  tipo: CandidatoTipo;
  nome: string;
  cognome: string;
  strumento: string | null;
  dataNascita: string | null;
  nazionalita: string | null;
  email: string | null;
  sezioneId: string | null;
  categoriaId: string | null;
  isGruppo: boolean;
  gruppoNome: string | null;
  fotoUrl: string | null;
  [k: string]: unknown;
}

export interface Commissario {
  id: string;
  concorsoId: string;
  nome: string;
  cognome: string;
  specialita: string | null;
  email: string | null;
  stato: 'ATTIVO' | 'INATTIVO';
  bio: string | null;
  fotoUrl: string | null;
  concorsiIds: string[];
}

export interface Commissione {
  id: string;
  concorsoId: string;
  nome: string;
  descrizione: string | null;
  commissariIds: string[];
  sezioniIds: string[];
  categorieIds: string[];
  presidenteId: string | null;
}

export interface CandidatoFase {
  id: string;
  faseId: string;
  candidatoId: string;
  stato: 'IN_ATTESA' | 'COMPLETATO';
  posizione: number | null;
  ammessoProssimaFase: boolean;
  eventoId: string | null;
  oraPrevista: string | null;
}

export interface Valutazione {
  id: string;
  candidatoFaseId: string;
  commissarioId: string;
  criterio: string;
  voto: number;
  note: string | null;
  timestamp: string;
}

export interface Sezione {
  id: string;
  concorsoId: string;
  nome: string;
  ordine: number;
}
export interface Categoria {
  id: string;
  concorsoId: string;
  sezioneId: string | null;
  nome: string;
  ordine: number;
}

export type IscrizioneStato = 'pending' | 'email_verified' | 'approved' | 'rejected';
export interface Iscrizione {
  id: string;
  concorsoId: string;
  stato: IscrizioneStato;
  nome: string;
  cognome: string;
  email: string;
  consensiGdpr: Record<string, boolean>;
  candidatoId: string | null;
  createdAt: string;
  [k: string]: unknown;
}

export interface Ente {
  id: string;
  nome: string;
  slug: string;
  logoUrl: string | null;
  sottotitolo: string | null;
  emailContatto: string | null;
  telefono: string | null;
  sitoWeb: string | null;
  [k: string]: unknown;
}

export interface Sala {
  id: string;
  concorsoId: string;
  nome: string;
  indirizzo: string | null;
  ordine: number;
}
export interface Evento {
  id: string;
  concorsoId: string;
  faseId: string | null;
  sezioneId: string | null;
  categoriaId: string | null;
  salaId: string | null;
  tipo: string;
  titolo: string | null;
  data: string | null;
  oraInizio: string | null;
  oraFine: string | null;
  durataCandidatoMinuti: number | null;
  ordine: number;
}

export interface Account {
  id: string;
  email: string;
  role: Role;
  attivo: boolean;
  commissarioId: string | null;
  lastLoginAt: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  targetId: string | null;
  payload: unknown;
  timestamp: string;
  actorEmail: string | null;
}
