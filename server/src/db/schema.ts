import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ============================================================================
// CORE: tenants, accounts, sessions, platform config, audit logs
// ============================================================================

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    slug: text('slug').notNull().unique(),
    nome: text('nome').notNull(),
    dominio: text('dominio'),
    stato: text('stato').notNull(),
    piano: text('piano').notNull(),
    pianoScadenza: date('piano_scadenza'),
    smtpConfig: jsonb('smtp_config'),
    note: text('note'),
    enteSettings: jsonb('ente_settings'),       // settings ente (denominazione, sede, P.IVA, ...)
    brandingPublic: jsonb('branding_public'),   // logo, colori, nome pubblico (visibile pre-login)
    archiviatoAt: timestamp('archiviato_at', { withTimezone: true }),
    cleanupAfterDays: integer('cleanup_after_days').notNull().default(30),
    cleanupScheduledAt: timestamp('cleanup_scheduled_at', { withTimezone: true }),
    require2faAdmin: boolean('require_2fa_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenants_stato_check', sql`${t.stato} IN ('attivo','sospeso','archiviato')`),
    check('tenants_piano_check', sql`${t.piano} IN ('trial','starter','pro','ultra','ppe')`),
    check(
      'tenants_cleanup_days_check',
      sql`${t.cleanupAfterDays} >= 0 AND ${t.cleanupAfterDays} <= 3650`,
    ),
    index('idx_tenants_slug').on(t.slug),
    index('idx_tenants_stato').on(t.stato),
  ],
);

export const platformConfig = pgTable('platform_config', {
  id: integer('id').primaryKey().default(1),
  require2faSuperadmin: boolean('require_2fa_superadmin').notNull().default(false),
  defaultCleanupDays: integer('default_cleanup_days').notNull().default(30),
  smtpPlatformConfig: jsonb('smtp_platform_config'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(),
    attivo: boolean('attivo').notNull().default(true),
    emailVerified: boolean('email_verified').notNull().default(false),
    commissarioId: uuid('commissario_id'), // FK aggiunta lato SQL post-creazione di commissari
    totpSecret: text('totp_secret'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    totpRecoveryCodes: text('totp_recovery_codes').array(),
    totpLastUsedAt: timestamp('totp_last_used_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('accounts_role_check', sql`${t.role} IN ('admin','commissario','superadmin')`),
    uniqueIndex('uniq_accounts_tenant_email').on(t.tenantId, t.email),
    index('idx_accounts_tenant').on(t.tenantId),
  ],
);

/**
 * Sessions: l'id memorizzato è SHA-256 hex del token spedito nel cookie.
 * Il token in chiaro non è mai persistito → se il DB viene esfiltrato,
 * le sessioni non sono utilizzabili.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_sessions_account').on(t.accountId),
    index('idx_sessions_expires').on(t.expiresAt),
    // M19: l'auth middleware filtra le sessioni per tenant ad ogni richiesta.
    index('idx_sessions_tenant').on(t.tenantId),
  ],
);

/**
 * Audit log per tenant (append-only via revoke UPDATE/DELETE al ruolo applicativo).
 * Quando il tenant viene cancellato, queste righe spariscono con lui (cascade).
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorAccountId: uuid('actor_account_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    payload: jsonb('payload'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_tenant_time').on(t.tenantId, t.createdAt),
    index('idx_audit_action').on(t.action),
    // M20: query per attore (chi ha fatto cosa).
    index('idx_audit_actor').on(t.actorAccountId),
  ],
);

/**
 * Platform audit log: separato dall'audit per-tenant.
 * Sopravvive al hard-delete dei tenant (no FK cascade su tenants).
 * Usato per tracciare azioni del super-admin (archive/restore/cleanup tenant, etc.).
 */
export const platformAuditLog = pgTable(
  'platform_audit_log',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    actorAccountId: uuid('actor_account_id'),
    action: text('action').notNull(),
    targetTenantSlug: text('target_tenant_slug'),
    targetTenantId: uuid('target_tenant_id'),
    payload: jsonb('payload'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_platform_audit_time').on(t.createdAt)],
);

/**
 * Tenant config: feature flags e limiti applicativi per tenant.
 */
export const tenantConfig = pgTable('tenant_config', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  maxConcorsi: integer('max_concorsi'),
  maxCommissari: integer('max_commissari'),
  maxCandidatiPerConcorso: integer('max_candidati_per_concorso'),
  features: jsonb('features'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================================
// CONCORSI
// ============================================================================

export const concorsi = pgTable(
  'concorsi',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    anno: integer('anno').notNull(),
    dataInizio: date('data_inizio'),
    stato: text('stato'),
    logo: text('logo'),
    anonimo: boolean('anonimo').notNull().default(false),
    iscrizioniAperte: boolean('iscrizioni_aperte').notNull().default(false),
    iscrizioniScadenza: date('iscrizioni_scadenza'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('concorsi_anno_check', sql`${t.anno} BETWEEN 1900 AND 2200`),
    check('concorsi_stato_check', sql`${t.stato} IS NULL OR ${t.stato} IN ('ATTIVO','CONCLUSO')`),
    index('idx_concorsi_tenant').on(t.tenantId),
  ],
);

// ============================================================================
// ANAGRAFICA: commissari, candidati, gruppi
// ============================================================================

export const commissari = pgTable(
  'commissari',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    concorsoId: uuid('concorso_id')
      .notNull()
      .references(() => concorsi.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    cognome: text('cognome'),
    specialita: text('specialita'),
    email: text('email'),
    telefono: text('telefono'),
    dataNascita: date('data_nascita'),
    nazionalita: text('nazionalita'),
    foto: text('foto'),
    bio: text('bio'),
    stato: text('stato').notNull().default('ATTIVO'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('commissari_stato_check', sql`${t.stato} IN ('ATTIVO','INATTIVO')`),
    index('idx_commissari_tenant').on(t.tenantId),
    index('idx_commissari_concorso').on(t.concorsoId),
    // N33: niente due commissari con la stessa email nello stesso concorso.
    // Indice unique parziale (email NULL ammesse, multiple).
    uniqueIndex('uniq_commissari_concorso_email')
      .on(t.concorsoId, t.email)
      .where(sql`${t.email} IS NOT NULL`),
  ],
);

export const commissariArchivio = pgTable(
  'commissari_archivio',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull(),
    motivo: text('motivo'),
    archiviatoDaAccountId: uuid('archiviato_da_account_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_commissari_archivio_tenant').on(t.tenantId)],
);

export const candidati = pgTable(
  'candidati',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    concorsoId: uuid('concorso_id')
      .notNull()
      .references(() => concorsi.id, { onDelete: 'cascade' }),
    numeroCandidato: integer('numero_candidato').notNull(),
    nome: text('nome').notNull(),
    cognome: text('cognome'),
    strumento: text('strumento').notNull(),
    dataNascita: date('data_nascita'),
    nazionalita: text('nazionalita'),
    // Anagrafica/residenza estese (allineamento candidati ↔ iscrizioni)
    email: text('email'),
    telefono: text('telefono'),
    sesso: text('sesso'),
    luogoNascita: text('luogo_nascita'),
    codiceFiscale: text('codice_fiscale'),
    indirizzo: text('indirizzo'),
    citta: text('citta'),
    cap: text('cap'),
    provincia: text('provincia'),
    paese: text('paese'),
    anniStudio: integer('anni_studio'),
    scuolaProvenienza: text('scuola_provenienza'),
    foto: text('foto'),
    docentiPreparatori: jsonb('docenti_preparatori'),
    programma: jsonb('programma'),
    tutore: jsonb('tutore'),
    noteLibere: text('note_libere'),
    dataIscrizione: date('data_iscrizione'),
    sezioneId: uuid('sezione_id'),
    categoriaId: uuid('categoria_id'),
    isGruppo: boolean('is_gruppo').notNull().default(false),
    gruppoNome: text('gruppo_nome'),
    tipoGruppo: text('tipo_gruppo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uniq_candidati_concorso_numero').on(t.concorsoId, t.numeroCandidato),
    index('idx_candidati_tenant').on(t.tenantId),
    index('idx_candidati_concorso').on(t.concorsoId),
  ],
);

export const candidatiMembri = pgTable(
  'candidati_membri',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    candidatoId: uuid('candidato_id')
      .notNull()
      .references(() => candidati.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    cognome: text('cognome'),
    strumento: text('strumento'),
    dataNascita: date('data_nascita'),
    nazionalita: text('nazionalita'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_candidati_membri_tenant').on(t.tenantId),
    index('idx_candidati_membri_candidato').on(t.candidatoId),
  ],
);

// ============================================================================
// STRUTTURA CONCORSO: sezioni, categorie, commissioni, fasi, criteri
// ============================================================================

export const sezioni = pgTable(
  'sezioni',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    concorsoId: uuid('concorso_id')
      .notNull()
      .references(() => concorsi.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    descrizione: text('descrizione'),
    ordine: integer('ordine'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_sezioni_tenant').on(t.tenantId), index('idx_sezioni_concorso').on(t.concorsoId)],
);

export const categorie = pgTable(
  'categorie',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sezioneId: uuid('sezione_id')
      .notNull()
      .references(() => sezioni.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    descrizione: text('descrizione'),
    etaMin: integer('eta_min'),
    etaMax: integer('eta_max'),
    ordine: integer('ordine'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_categorie_tenant').on(t.tenantId),
    index('idx_categorie_sezione').on(t.sezioneId),
  ],
);

export const commissioni = pgTable(
  'commissioni',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    concorsoId: uuid('concorso_id')
      .notNull()
      .references(() => concorsi.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    presidenteCommissarioId: uuid('presidente_commissario_id').references(() => commissari.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_commissioni_tenant').on(t.tenantId),
    index('idx_commissioni_concorso').on(t.concorsoId),
  ],
);

export const commissioniCommissari = pgTable(
  'commissioni_commissari',
  {
    commissioneId: uuid('commissione_id')
      .notNull()
      .references(() => commissioni.id, { onDelete: 'cascade' }),
    commissarioId: uuid('commissario_id')
      .notNull()
      .references(() => commissari.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.commissioneId, t.commissarioId] })],
);

export const commissioniSezioni = pgTable(
  'commissioni_sezioni',
  {
    commissioneId: uuid('commissione_id')
      .notNull()
      .references(() => commissioni.id, { onDelete: 'cascade' }),
    sezioneId: uuid('sezione_id')
      .notNull()
      .references(() => sezioni.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.commissioneId, t.sezioneId] })],
);

export const commissioniCategorie = pgTable(
  'commissioni_categorie',
  {
    commissioneId: uuid('commissione_id')
      .notNull()
      .references(() => commissioni.id, { onDelete: 'cascade' }),
    categoriaId: uuid('categoria_id')
      .notNull()
      .references(() => categorie.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.commissioneId, t.categoriaId] })],
);

export const fasi = pgTable(
  'fasi',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    concorsoId: uuid('concorso_id')
      .notNull()
      .references(() => concorsi.id, { onDelete: 'cascade' }),
    commissioneId: uuid('commissione_id').references(() => commissioni.id, {
      onDelete: 'set null',
    }),
    ordine: integer('ordine').notNull(),
    nome: text('nome').notNull(),
    ammessi: integer('ammessi'),
    dataPrevista: date('data_prevista'),
    scala: integer('scala').notNull().default(100),
    modoValutazione: text('modo_valutazione'),
    pesi: jsonb('pesi'),
    metodoMedia: text('metodo_media'),
    tempoMinuti: integer('tempo_minuti'),
    timerStartedAt: timestamp('timer_started_at', { withTimezone: true }),
    timerPausedAt: timestamp('timer_paused_at', { withTimezone: true }),
    timerBonusSeconds: integer('timer_bonus_seconds').notNull().default(0),
    timerStartedForCfId: uuid('timer_started_for_cf_id'),
    stato: text('stato').notNull().default('PIANIFICATA'),
    tiebreakStrategy: jsonb('tiebreak_strategy'),
    // Label custom per le colonne "esito" mostrate nel PDF e nella tab Risultati
    // — fallback ai default "PROMOSSO"/"ELIMINATO" se NULL.
    testoEsitoPromosso: text('testo_esito_promosso'),
    testoEsitoEliminato: text('testo_esito_eliminato'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'fasi_modo_valutazione_check',
      sql`${t.modoValutazione} IS NULL OR ${t.modoValutazione} IN ('autonoma','sincrona')`,
    ),
    check('fasi_stato_check', sql`${t.stato} IN ('PIANIFICATA','IN_CORSO','CONCLUSA')`),
    check('fasi_scala_check', sql`${t.scala} BETWEEN 2 AND 1000`),
    uniqueIndex('uniq_fasi_concorso_ordine').on(t.concorsoId, t.ordine),
    index('idx_fasi_tenant').on(t.tenantId),
  ],
);

export const fasiSezioni = pgTable(
  'fasi_sezioni',
  {
    faseId: uuid('fase_id')
      .notNull()
      .references(() => fasi.id, { onDelete: 'cascade' }),
    sezioneId: uuid('sezione_id')
      .notNull()
      .references(() => sezioni.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.faseId, t.sezioneId] })],
);

export const criteri = pgTable(
  'criteri',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    faseId: uuid('fase_id')
      .notNull()
      .references(() => fasi.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    descrizione: text('descrizione'),
    peso: integer('peso').notNull().default(100),
    ordine: integer('ordine'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('criteri_peso_check', sql`${t.peso} BETWEEN 0 AND 100`),
    index('idx_criteri_tenant').on(t.tenantId),
    index('idx_criteri_fase').on(t.faseId),
  ],
);

// ============================================================================
// WORKFLOW: candidati_fase, valutazioni
// ============================================================================

export const candidatiFase = pgTable(
  'candidati_fase',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    faseId: uuid('fase_id')
      .notNull()
      .references(() => fasi.id, { onDelete: 'cascade' }),
    candidatoId: uuid('candidato_id')
      .notNull()
      .references(() => candidati.id, { onDelete: 'cascade' }),
    posizione: integer('posizione'),
    stato: text('stato').notNull().default('IN_ATTESA'),
    ammessoProssimaFase: boolean('ammesso_prossima_fase'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'candidati_fase_stato_check',
      sql`${t.stato} IN ('IN_ATTESA','IN_ESECUZIONE','COMPLETATO','ELIMINATO')`,
    ),
    uniqueIndex('uniq_candidati_fase').on(t.faseId, t.candidatoId),
    index('idx_candidati_fase_tenant').on(t.tenantId),
    index('idx_candidati_fase_fase').on(t.faseId),
    // N18: l'UPDATE del conclude filtra (fase_id, stato).
    index('idx_candidati_fase_fase_stato').on(t.faseId, t.stato),
    // N42: query "tutte le fasi di un candidato" (scoring/risultati) molto comuni.
    index('idx_candidati_fase_candidato').on(t.candidatoId),
    // N43: un candidato COMPLETATO deve avere un esito esplicito (promosso/
    // eliminato), mai NULL → niente display ambiguo "—".
    check(
      'candidati_fase_completato_ammesso_check',
      sql`${t.stato} <> 'COMPLETATO' OR ${t.ammessoProssimaFase} IS NOT NULL`,
    ),
  ],
);

export const valutazioni = pgTable(
  'valutazioni',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    candidatoFaseId: uuid('candidato_fase_id')
      .notNull()
      .references(() => candidatiFase.id, { onDelete: 'cascade' }),
    commissarioId: uuid('commissario_id')
      .notNull()
      .references(() => commissari.id, { onDelete: 'cascade' }),
    criterio: text('criterio').notNull(),
    // numeric(5,2) per supportare voti decimali (es. mezzi punti su scala ≤10
    // dove voteStep=0.5). mode:'number' fa sì che node-postgres deserializzi
    // come number JS invece di string (default per numeric in pg).
    voto: numeric('voto', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    note: text('note'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uniq_valutazioni').on(t.candidatoFaseId, t.commissarioId, t.criterio),
    index('idx_valutazioni_tenant').on(t.tenantId),
    index('idx_valutazioni_cf').on(t.candidatoFaseId),
    index('idx_valutazioni_commissario').on(t.commissarioId),
    // N41: voto non negativo a livello DB (oltre al clamp trigger + zod min(0)).
    check('valutazioni_voto_check', sql`${t.voto} >= 0`),
  ],
);

// ============================================================================
// ISCRIZIONI PUBBLICHE
// ============================================================================

export const iscrizioni = pgTable(
  'iscrizioni',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    concorsoId: uuid('concorso_id')
      .notNull()
      .references(() => concorsi.id, { onDelete: 'cascade' }),
    stato: text('stato').notNull().default('BOZZA'),
    nome: text('nome').notNull(),
    cognome: text('cognome'),
    email: text('email').notNull(),
    telefono: text('telefono'),
    dataNascita: date('data_nascita'),
    nazionalita: text('nazionalita'),
    // Anagrafica estesa (richiesta dalla modale dettaglio admin)
    luogoNascita: text('luogo_nascita'),
    sesso: text('sesso'),
    codiceFiscale: text('codice_fiscale'),
    // Residenza
    indirizzo: text('indirizzo'),
    citta: text('citta'),
    cap: text('cap'),
    provincia: text('provincia'),
    paese: text('paese'),
    // Dati artistici extra
    strumento: text('strumento'),
    anniStudio: integer('anni_studio'),
    scuolaProvenienza: text('scuola_provenienza'),
    programma: jsonb('programma'),
    docentiPreparatori: jsonb('docenti_preparatori'),
    sezioneId: uuid('sezione_id').references(() => sezioni.id, { onDelete: 'set null' }),
    categoriaId: uuid('categoria_id').references(() => categorie.id, { onDelete: 'set null' }),
    isGruppo: boolean('is_gruppo').notNull().default(false),
    gruppoNome: text('gruppo_nome'),
    tipoGruppo: text('tipo_gruppo'),
    membri: jsonb('membri'),
    tutore: jsonb('tutore'),
    consensiGdpr: jsonb('consensi_gdpr'),
    noteLibere: text('note_libere'),
    emailVerificationToken: text('email_verification_token'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    approvataAt: timestamp('approvata_at', { withTimezone: true }),
    candidatoId: uuid('candidato_id').references(() => candidati.id, { onDelete: 'set null' }),
    note: text('note'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'iscrizioni_stato_check',
      sql`${t.stato} IN ('BOZZA','INVIATA','EMAIL_VERIFICATA','APPROVATA','RIFIUTATA')`,
    ),
    index('idx_iscrizioni_tenant').on(t.tenantId),
    index('idx_iscrizioni_concorso_stato').on(t.concorsoId, t.stato),
    index('idx_iscrizioni_email').on(t.email),
  ],
);

export const iscrizioniAllegati = pgTable(
  'iscrizioni_allegati',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    iscrizioneId: uuid('iscrizione_id')
      .notNull()
      .references(() => iscrizioni.id, { onDelete: 'cascade' }),
    tipo: text('tipo').notNull(),
    nomeFile: text('nome_file').notNull(),
    path: text('path').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    mimeType: text('mime_type'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('iscrizioni_allegati_tipo_check', sql`${t.tipo} IN ('foto','documento','ricevuta','altro')`),
    index('idx_iscrizioni_allegati_iscrizione').on(t.iscrizioneId),
  ],
);
