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

export type ConcorsoStato = 'ATTIVO' | 'ARCHIVIATO' | 'SOSPESO' | 'CHIUSO';
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
  defaultTiebreakStrategy?: { key: string; enabled: boolean }[] | null;
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
  // Backend enum: 'autonoma' | 'sincrona' (nullable). NON esiste 'vincolata'.
  modoValutazione: 'autonoma' | 'sincrona' | null;
  metodoMedia: string | null;
  tempoMinuti: number | null;
  // Il backend restituisce un array di step ({key,enabled}) o null, non una stringa.
  tiebreakStrategy: { key: string; enabled: boolean }[] | null;
  sezioniIds: string[];
  /**
   * NON restituito dalla GET /fasi: i criteri arrivano da GET /criteri e
   * vengono attaccati lato client (vedi lib/scoring criteriFromRecords) prima
   * dello scoring. Opzionale per riflettere la realtà del payload.
   */
  criteri?: Criterio[];
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
  /**
   * Campo DERIVATO lato client (vedi api/candidati.ts normalizeCandidato).
   * Il backend NON lo restituisce: ha `isGruppo` + `tipoGruppo`. Derivato da
   * normalizeCandidato in ogni read.
   */
  tipo: CandidatoTipo;
  nome: string;
  cognome: string | null;
  strumento: string | null;
  dataNascita: string | null;
  nazionalita: string | null;
  email: string | null;
  sezioneId: string | null;
  categoriaId: string | null;
  // Campi reali del backend per i gruppi.
  isGruppo: boolean;
  gruppoNome: string | null;
  tipoGruppo: 'ensemble' | 'orchestra' | null;
  /** Path foto reale del backend (colonna `foto`). */
  foto: string | null;
  /** Alias di `foto` derivato in lettura (normalizeCandidato). */
  fotoUrl: string | null;
  [k: string]: unknown;
}

export interface Commissario {
  id: string;
  concorsoId: string;
  nome: string;
  cognome: string | null;
  specialita: string | null;
  email: string | null;
  stato: 'ATTIVO' | 'INATTIVO';
  bio: string | null;
  /** Colonna reale del backend: `foto` (path). Non esiste `fotoUrl`. */
  foto: string | null;
}

export interface Commissione {
  id: string;
  concorsoId: string;
  nome: string;
  // Field reali della GET /commissioni (vedi api/commissioni.ts CommissioneRecord):
  // presidenteCommissarioId + array `commissari`/`sezioni`/`categorie` (di ID).
  presidenteCommissarioId: string | null;
  commissari: string[];
  sezioni: string[];
  categorie: string[];
}

export interface CandidatoFase {
  id: string;
  faseId: string;
  candidatoId: string;
  // Enum completo del CHECK DB (mancavano IN_ESECUZIONE / ELIMINATO).
  stato: 'IN_ATTESA' | 'IN_ESECUZIONE' | 'COMPLETATO' | 'ELIMINATO';
  posizione: number | null;
  // Nullable lato DB: NULL finché l'esito non è deciso (fase non conclusa).
  ammessoProssimaFase: boolean | null;
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
  descrizione: string | null;
  // Il backend lascia `ordine` nullable.
  ordine: number | null;
}
export interface Categoria {
  id: string;
  // Il backend NON restituisce `concorsoId` per le categorie: appartengono a
  // una sezione (sezioneId, NOT NULL). La sezione porta il concorso.
  sezioneId: string;
  nome: string;
  descrizione: string | null;
  etaMin: number | null;
  etaMax: number | null;
  ordine: number | null;
}

// Stati REALI del CHECK constraint DB (vedi api/iscrizioni.ts IscrizioneStatoDb).
export type IscrizioneStato =
  | 'BOZZA'
  | 'INVIATA'
  | 'EMAIL_VERIFICATA'
  | 'APPROVATA'
  | 'RIFIUTATA';
export interface Iscrizione {
  id: string;
  concorsoId: string;
  stato: IscrizioneStato;
  nome: string;
  cognome: string | null;
  email: string;
  consensiGdpr: Record<string, boolean> | null;
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
  ordine: number | null;
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
  // `data` è NOT NULL lato DB → sempre valorizzato.
  data: string;
  oraInizio: string | null;
  oraFine: string | null;
  durataCandidatoMinuti: number | null;
  ordine: number | null;
}

export interface Account {
  id: string;
  email: string;
  role: Role;
  attivo: boolean;
  commissarioId: string | null;
  lastLoginAt: string | null;
}

// Forma REALE restituita da GET /api/audit-log (riga grezza di audit_log).
// Il backend NON arricchisce con email/ruolo attore né con un'etichetta target:
// restituisce gli ID. Campi precedenti (timestamp/targetLabel/actorEmail/
// actorRole) erano fantasma → in UI davano "Invalid Date" e attore "sistema".
export interface AuditEntry {
  id: string;
  tenantId: string;
  action: string;
  /** UUID dell'account che ha compiuto l'azione (null = azione di sistema). */
  actorAccountId: string | null;
  /** Tipo del target (es. 'concorso', 'fase'). */
  targetType: string | null;
  /** UUID del target (es. concorsoId, faseId…). */
  targetId: string | null;
  payload: unknown;
  ip: string | null;
  userAgent: string | null;
  /** HMAC tamper-evidence (può essere null sulle righe legacy). */
  sig: string | null;
  /** ISO datetime. */
  createdAt: string;
}
