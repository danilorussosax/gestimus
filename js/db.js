// Data layer del frontend: parla al nuovo backend REST (Postgres+Fastify).
// Mantiene la stessa SHAPE pubblica del vecchio db.js (PB-backed) per non
// toccare le view esistenti:
//   - oggetto `db` con i metodi createX/updateX/deleteX/...
//   - `state` cache in memoria sincronizzata via init() + write-through
//   - `subscribe(fn)` per notify ai consumer (router/views)
//
// Differenze rispetto al legacy:
//   - Auth via cookie HttpOnly (gestita server-side); niente pb.authStore.
//   - File upload via POST /api/upload/:resource/:id (campo `file`).
//   - I campi tornano in camelCase dal backend; il mapper li traduce in
//     snake_case dove le view legacy li leggono ancora così (concorso_id, ecc.).

import { api, ApiError } from './api.js';
import { pb, refreshAuth } from './pb.js';
import { slugifyKey } from './scoring.js';

// N1: i criteri vivono in tabella `criteri` (nome, peso 0-100, ordine) ma le
// view + scoring usano la forma {key,label,peso(0-1)} su `fase.criteri`.
// Questi helper convertono tra le due rappresentazioni e popolano fase.criteri.
function critRowToKLP(r) {
  const label = r.nome || '';
  return { key: slugifyKey(label) || 'crit', label, peso: (Number(r.peso) || 0) / 100 };
}
function criteriForFase(faseId) {
  return (state._criteri || [])
    .filter((c) => c.faseId === faseId)
    .sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0))
    .map(critRowToKLP);
}

const META_KEY = 'gestionale_meta_v3'; // bump key per evitare collisioni col v2 PB

const empty = () => ({
  concorsi: [],
  fasi: [],
  candidati: [],
  candidati_fase: [],
  valutazioni: [],
  commissari: [],
  sezioni: [],
  categorie: [],
  commissioni: [],
  accounts: [],
  ente: null,
  ente_public: null,
  candidati_gruppo: [], // membri di gruppo (alias storico)
  sale: [],
  eventi: [], // eventi_calendario (blocchi)
  meta: { activeConcorsoId: null, role: null, currentCommissarioId: null },
});

let state = empty();
let initialized = false;

const subscribers = new Set();
export function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
// N71: guard anti-recursione. Se un subscriber muta lo stato e ri-chiama
// notify(), evitiamo la ricorsione infinita: marchiamo "notifying" e, se una
// notifica arriva durante un'altra, la rimandiamo a fine ciclo.
let notifying = false;
let notifyPending = false;
function notify() {
  if (notifying) { notifyPending = true; return; }
  notifying = true;
  try {
    do {
      notifyPending = false;
      // copia per tollerare unsubscribe durante l'iterazione
      for (const fn of [...subscribers]) fn(state);
    } while (notifyPending);
  } finally {
    notifying = false;
  }
}

function loadMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}
function saveMeta() {
  localStorage.setItem(META_KEY, JSON.stringify(state.meta));
}

// ====================================================================
// Mappers: backend camelCase → forma interna snake_case usata dalle view legacy.
// ====================================================================

const dateStr = (s) => (s ? String(s).slice(0, 10) : null);

function mapConcorso(r) {
  return {
    id: r.id,
    nome: r.nome || '',
    anno: r.anno,
    presidente_id: null,
    data_inizio: dateStr(r.dataInizio),
    stato: r.stato || 'ATTIVO',
    anonimo: !!r.anonimo,
    logo_filename: r.logo || '',
    logo_url: r.logo || null,
    iscrizioni_aperte: !!r.iscrizioniAperte,
    iscrizioni_chiusura: r.iscrizioniScadenza || null,
    default_tiebreak_strategy: null,
  };
}

function mapCommissario(r) {
  // Nel nuovo backend ogni commissario è associato a UN concorso (concorsoId).
  // Il legacy modellava multi-concorso via array `concorsi[]`. Per compat
  // esponiamo entrambi: concorsi_ids = [concorsoId], concorso_id = concorsoId.
  const cid = r.concorsoId || null;
  return {
    id: r.id,
    concorsi_ids: cid ? [cid] : [],
    concorso_id: cid,
    nome: r.nome || '',
    cognome: r.cognome || '',
    specialita: r.specialita || '',
    email: r.email || '',
    telefono: r.telefono || '',
    data_nascita: dateStr(r.dataNascita),
    nazionalita: r.nazionalita || '',
    foto_filename: r.foto || '',
    foto_url: r.foto || null,
    bio: r.bio || '',
    stato: r.stato || 'ATTIVO',
    is_presidente: false, // non più colonna del commissario; deriva da commissioni.presidenteCommissarioId
  };
}

function mapCandidato(r) {
  return {
    id: r.id,
    concorso_id: r.concorsoId,
    numero_candidato: r.numeroCandidato,
    nome: r.nome || '',
    cognome: r.cognome || '',
    strumento: r.strumento || '',
    data_nascita: dateStr(r.dataNascita),
    nazionalita: r.nazionalita || '',
    // Anagrafica/residenza/artistici estesi (allineamento candidati↔iscrizioni)
    email: r.email || '',
    telefono: r.telefono || '',
    sesso: r.sesso || '',
    luogo_nascita: r.luogoNascita || '',
    codice_fiscale: r.codiceFiscale || '',
    indirizzo: r.indirizzo || '',
    citta: r.citta || '',
    cap: r.cap || '',
    provincia: r.provincia || '',
    paese: r.paese || '',
    anni_studio: r.anniStudio ?? null,
    scuola_provenienza: r.scuolaProvenienza || '',
    foto_filename: r.foto || '',
    foto_url: r.foto || null,
    docenti_preparatori: Array.isArray(r.docentiPreparatori) ? r.docentiPreparatori : [],
    programma: Array.isArray(r.programma) ? r.programma : (r.programma || null),
    tutore: r.tutore || null,
    note_libere: r.noteLibere || '',
    data_iscrizione: dateStr(r.dataIscrizione),
    sezione_id: r.sezioneId || null,
    categoria_id: r.categoriaId || null,
    is_gruppo: !!r.isGruppo,
    gruppo_nome: r.gruppoNome || '',
    tipo_gruppo: r.tipoGruppo || (r.isGruppo ? 'ensemble' : ''),
    tipo: r.isGruppo
      ? (r.tipoGruppo === 'orchestra' ? 'orchestra' : 'gruppo')
      : 'individuale',
  };
}

function mapFase(r) {
  return {
    id: r.id,
    concorso_id: r.concorsoId,
    commissione_id: r.commissioneId || null,
    ordine: r.ordine,
    nome: r.nome || '',
    ammessi: r.ammessi || null,
    data_prevista: dateStr(r.dataPrevista),
    scala: r.scala || 100,
    modo_valutazione: r.modoValutazione || 'autonoma',
    pesi: r.pesi || null,
    metodo_media: r.metodoMedia || 'aritmetica',
    tempo_minuti: r.tempoMinuti || 0,
    stato: r.stato || 'PIANIFICATA',
    tiebreak_strategy: r.tiebreakStrategy || null,
    // Label custom per gli esiti mostrati nel PDF/UI risultati. Se null,
    // fallback ai default "PROMOSSO"/"ELIMINATO".
    testo_esito_promosso: r.testoEsitoPromosso || '',
    testo_esito_eliminato: r.testoEsitoEliminato || '',
    // sezioni_ids: array di id sezioni a cui la fase è ristretta. Vuoto = fase
    // globale sul concorso. Popolato dal backend via join table fasi_sezioni.
    sezioni_ids: Array.isArray(r.sezioniIds) ? r.sezioniIds : [],
    timer_started_at: r.timerStartedAt || null,
    timer_paused_at: r.timerPausedAt || null,
    timer_bonus_seconds: r.timerBonusSeconds || 0,
    timer_started_for_cf_id: r.timerStartedForCfId || null,
  };
}

function mapSezione(r) {
  return { id: r.id, concorso_id: r.concorsoId, nome: r.nome || '', descrizione: r.descrizione || '', ordine: r.ordine };
}
function mapCategoria(r) {
  return {
    id: r.id,
    sezione_id: r.sezioneId,
    concorso_id: null, // si recupera via sezione
    nome: r.nome || '',
    descrizione: r.descrizione || '',
    eta_min: r.etaMin || null,
    eta_max: r.etaMax || null,
    ordine: r.ordine,
  };
}
function mapCommissione(r) {
  return {
    id: r.id,
    concorso_id: r.concorsoId,
    nome: r.nome || '',
    descrizione: '',
    commissari_ids: Array.isArray(r.commissari) ? r.commissari : [],
    sezioni_ids: Array.isArray(r.sezioni) ? r.sezioni : [],
    categorie_ids: Array.isArray(r.categorie) ? r.categorie : [],
    include_tutte_categorie: false,
    presidente_id: r.presidenteCommissarioId || null,
  };
}
function mapCandidatoFase(r) {
  return {
    id: r.id,
    fase_id: r.faseId,
    candidato_id: r.candidatoId,
    posizione: r.posizione || null,
    stato: r.stato || 'IN_ATTESA',
    ammesso_prossima_fase: r.ammessoProssimaFase ?? null,
    evento_id: r.eventoId || null,
    ora_prevista: r.oraPrevista || null,
  };
}
function mapValutazione(r) {
  return {
    id: r.id,
    candidato_fase_id: r.candidatoFaseId,
    commissario_id: r.commissarioId,
    criterio: r.criterio,
    voto: r.voto,
    note: r.note || '',
    timestamp: r.timestamp || r.createdAt || null,
  };
}

function mapIscrizione(r) {
  // Traduzione stato backend (IT uppercase) → token legacy lowercase usati
  // dalla view admin iscrizioni (filter pills, colors, label). Manteniamo
  // entrambi (`stato` legacy, `stato_raw` originale) per compat.
  const STATO_MAP = {
    INVIATA: 'pending',
    EMAIL_VERIFICATA: 'email_verified',
    APPROVATA: 'approved',
    RIFIUTATA: 'rejected',
  };
  const statoRaw = r.stato || 'INVIATA';
  const stato = STATO_MAP[statoRaw] || statoRaw.toLowerCase();
  // Il tutore è JSONB lato backend; per la view lo "spalmiamo" in campi
  // top-level (tutore_nome, tutore_email, …) così non deve navigare l'oggetto.
  const tut = (r.tutore && typeof r.tutore === 'object') ? r.tutore : {};
  return {
    id: r.id,
    concorso_id: r.concorsoId,
    stato,
    stato_raw: statoRaw,
    nome: r.nome || '',
    cognome: r.cognome || '',
    email: r.email || '',
    telefono: r.telefono || '',
    data_nascita: dateStr(r.dataNascita),
    nazionalita: r.nazionalita || '',
    // Anagrafica estesa
    luogo_nascita: r.luogoNascita || '',
    sesso: r.sesso || '',
    codice_fiscale: r.codiceFiscale || '',
    // Residenza
    indirizzo: r.indirizzo || '',
    citta: r.citta || '',
    cap: r.cap || '',
    provincia: r.provincia || '',
    paese: r.paese || '',
    // Dati artistici extra
    strumento: r.strumento || '',
    anni_studio: r.anniStudio ?? null,
    scuola_provenienza: r.scuolaProvenienza || '',
    programma: r.programma || null,
    docenti_preparatori: Array.isArray(r.docentiPreparatori) ? r.docentiPreparatori : [],
    sezione_id: r.sezioneId || null,
    categoria_id: r.categoriaId || null,
    is_gruppo: !!r.isGruppo,
    // Alias per la view admin che usa nomi legacy
    tipo: r.isGruppo
      ? (r.tipoGruppo === 'orchestra' ? 'orchestra' : 'gruppo')
      : 'individuale',
    tipo_gruppo: r.tipoGruppo || (r.isGruppo ? 'ensemble' : ''),
    membri: Array.isArray(r.membri) ? r.membri : null,
    gruppo_membri: Array.isArray(r.membri) ? r.membri : [],
    gruppo_nome: r.gruppoNome || '',
    tutore: r.tutore || null,
    tutore_nome: tut.nome || '',
    tutore_cognome: tut.cognome || '',
    tutore_email: tut.email || '',
    tutore_telefono: tut.telefono || '',
    consensi_gdpr: r.consensiGdpr || null,
    consenso_privacy: !!(r.consensiGdpr && r.consensiGdpr.privacy),
    consenso_immagini: !!(r.consensiGdpr && r.consensiGdpr.immagini),
    consenso_regolamento: !!(r.consensiGdpr && r.consensiGdpr.regolamento),
    note_libere: r.noteLibere || '',
    email_verified_at: r.emailVerifiedAt || null,
    approvata_at: r.approvataAt || null,
    candidato_id: r.candidatoId || null,
    note: r.note || '',
    note_admin: r.note || '',
    rejected_reason: statoRaw === 'RIFIUTATA' ? (r.note || '') : '',
    created_at: r.createdAt || null,
    // La view legge `i.created` (alias storico) — manteniamo entrambi.
    created: r.createdAt || null,
    updated_at: r.updatedAt || null,
  };
}

function mapMembroGruppo(r) {
  return {
    id: r.id,
    candidato_id: r.candidatoId,
    nome: r.nome || '',
    cognome: r.cognome || '',
    strumento: r.strumento || '',
    data_nascita: dateStr(r.dataNascita),
    nazionalita: r.nazionalita || '',
  };
}

// ====================================================================
// Loader iniziale
// ====================================================================

// Appiattisce il record tenant: oltre alle colonne top-level (id/nome/slug/...),
// espone i campi nested di enteSettings/brandingPublic come proprietà piatte
// (logo_url, email_contatto, ecc.) per non costringere ogni view a navigare
// il JSONB.
function mapEnte(r) {
  if (!r) return null;
  const bp = r.brandingPublic || {};
  const es = r.enteSettings || {};
  return {
    ...r,
    // Preferiamo il nome pubblico custom (modificabile dall'admin) e cadiamo
    // sul nome top-level del tenant (immutabile lato frontend).
    nome: bp.nomePubblico || r.nome || null,
    logo_url: bp.logoUrl || null,
    colore_primario: bp.coloreAccent || null,
    colore_secondario: bp.coloreSfondo || null,
    sottotitolo: bp.sottotitolo || null,
    descrizione: es.note || null,
    email_contatto: es.email || null,
    telefono: es.telefono || null,
    sito_web: es.sitoWeb || null,
    indirizzo: es.sede || null,
    codice_fiscale: es.codiceFiscale || null,
    partita_iva: es.partitaIva || null,
    pec: es.pec || null,
    enteSettings: es,
    brandingPublic: bp,
  };
}

async function loadEntePublic() {
  try {
    state.ente_public = mapEnte(await api.get('/api/ente/public'));
  } catch {
    state.ente_public = null;
  }
}

// ---- Calendario / scheduling mappers ----
function mapSala(r) {
  return { id: r.id, concorso_id: r.concorsoId, nome: r.nome || '', indirizzo: r.indirizzo || '', ordine: r.ordine ?? null };
}
function mapEvento(r) {
  return {
    id: r.id,
    concorso_id: r.concorsoId,
    fase_id: r.faseId || null,
    sezione_id: r.sezioneId || null,
    categoria_id: r.categoriaId || null,
    sala_id: r.salaId || null,
    tipo: r.tipo || 'ESIBIZIONE',
    titolo: r.titolo || '',
    data: dateStr(r.data),
    ora_inizio: r.oraInizio || null,
    ora_fine: r.oraFine || null,
    durata_candidato_minuti: r.durataCandidatoMinuti ?? null,
    note: r.note || '',
    ordine: r.ordine ?? null,
  };
}
function mapCalendarioPub(r) {
  return {
    id: r.id,
    concorso_id: r.concorsoId,
    token: r.token,
    scopo: r.scopo,
    sezione_id: r.sezioneId || null,
    giorno: dateStr(r.giorno),
    etichetta: r.etichetta || '',
    attivo: !!r.attivo,
    mostra_nomi: !!r.mostraNomi,
    mostra_commissione: !!r.mostraCommissione,
  };
}

/**
 * Fetch standalone della pagina pubblica del calendario (no auth, no state).
 * Usato dalla rotta #/calendario?token=… renderizzata anche pre-login.
 */
export async function fetchCalendarioPubblico(token) {
  return api.get(`/api/public/calendario/${encodeURIComponent(token)}`);
}

async function loadAll() {
  // N90: allSettled invece di Promise.all → un singolo endpoint che fallisce
  // (es. /api/criteri 500) non abbatte l'intero caricamento iniziale. Le
  // risorse mancanti vengono segnalate via state.meta._loadErrors (toast in
  // app.js) lasciando l'app utilizzabile con stato parziale.
  const coreSpecs = [
    ['concorsi', '/api/concorsi'],
    ['sezioni', '/api/sezioni'],
    ['categorie', '/api/categorie'],
    ['commissioni', '/api/commissioni'],
    ['commissari', '/api/commissari'],
    ['candidati', '/api/candidati'],
    ['fasi', '/api/fasi'],
    ['criteri', '/api/criteri'],
    ['ente', '/api/ente'],
    ['sale', '/api/calendario/sale'],
    ['eventi', '/api/calendario/eventi'],
  ];
  const coreResults = await Promise.allSettled(coreSpecs.map(([, url]) => api.get(url)));
  const coreFailures = [];
  // `ente` è opzionale: il suo fallimento è tollerato in silenzio (come prima
  // con .catch(() => null)); le altre risorse vengono segnalate.
  const pick = (i, optional = false) => {
    const r = coreResults[i];
    if (r.status === 'fulfilled') return r.value;
    if (!optional) coreFailures.push(coreSpecs[i][0]);
    console.warn('load failed for', coreSpecs[i][1], r.reason?.message);
    return null;
  };
  const concorsi = pick(0), sezioni = pick(1), categorie = pick(2), commissioni = pick(3),
    commissari = pick(4), candidati = pick(5), fasi = pick(6), criteri = pick(7), ente = pick(8, true),
    saleRows = pick(9, true), eventiRows = pick(10, true);
  if (coreFailures.length > 0) {
    state.meta._loadErrors = state.meta._loadErrors || [];
    state.meta._loadErrors.push(`risorse non caricate: ${coreFailures.join(', ')}`);
  }

  state.concorsi = (concorsi || []).map(mapConcorso);
  state.sezioni = (sezioni || []).map(mapSezione);
  state.categorie = (categorie || []).map(mapCategoria);
  state.commissioni = (commissioni || []).map(mapCommissione);
  state.commissari = (commissari || []).map(mapCommissario);
  state.candidati = (candidati || []).map(mapCandidato);
  state._criteri = criteri || [];
  // N1: arricchisce ogni fase con .criteri ({key,label,peso}) derivati da
  // state._criteri, così form fasi, scoring e tiebreak vedono i criteri salvati
  // (mapFase da solo non li espone).
  state.fasi = (fasi || []).map((r) => {
    const f = mapFase(r);
    f.criteri = criteriForFase(f.id);
    return f;
  });
  state.ente = mapEnte(ente);
  state.sale = (saleRows || []).map(mapSala);
  state.eventi = (eventiRows || []).map(mapEvento);

  // H6: carica candidati_fase + valutazioni + membri-gruppo IN PARALLELO
  // invece che N+M+K richieste sequenziali. Per 5 fasi × 50 candidati la
  // differenza è ~50x sul tempo totale (gli HTTP RTT non si sommano più).
  state.candidati_fase = [];
  const cfFailures = [];
  const cfResults = await Promise.allSettled(
    state.fasi.map((f) => api.get('/api/candidati-fase', { faseId: f.id })),
  );
  cfResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      state.candidati_fase.push(...(r.value || []).map(mapCandidatoFase));
    } else {
      cfFailures.push(state.fasi[i].id);
      console.warn('candidati-fase load failed for fase', state.fasi[i].id, r.reason?.message);
    }
  });
  if (cfFailures.length > 0) {
    state.meta._loadErrors = state.meta._loadErrors || [];
    state.meta._loadErrors.push(`candidati_fase non caricati per ${cfFailures.length} fasi`);
  }

  state.valutazioni = [];
  const valFailures = [];
  const valResults = await Promise.allSettled(
    state.candidati_fase.map((cf) => api.get('/api/valutazioni', { candidatoFaseId: cf.id })),
  );
  valResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      state.valutazioni.push(...(r.value || []).map(mapValutazione));
    } else {
      valFailures.push(state.candidati_fase[i].id);
      console.warn('valutazioni load failed for cf', state.candidati_fase[i].id, r.reason?.message);
    }
  });
  if (valFailures.length > 0) {
    state.meta._loadErrors = state.meta._loadErrors || [];
    state.meta._loadErrors.push(`valutazioni non caricate per ${valFailures.length} candidati`);
  }

  state.candidati_gruppo = [];
  const mgFailures = [];
  const gruppi = state.candidati.filter((x) => x.is_gruppo);
  const mgResults = await Promise.allSettled(
    gruppi.map((c) => api.get('/api/membri-gruppo', { candidatoId: c.id })),
  );
  mgResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      state.candidati_gruppo.push(...(r.value || []).map(mapMembroGruppo));
    } else {
      mgFailures.push(gruppi[i].id);
      console.warn('membri-gruppo load failed for candidato', gruppi[i].id, r.reason?.message);
    }
  });
  if (mgFailures.length > 0) {
    state.meta._loadErrors = state.meta._loadErrors || [];
    state.meta._loadErrors.push(`membri-gruppo non caricati per ${mgFailures.length} gruppi`);
  }

  // Accounts (solo admin può listarli; per commissario fallisce 403 → array vuoto)
  try {
    const list = await api.get('/api/accounts');
    state.accounts = (list || []).map((a) => ({
      id: a.id,
      email: a.email,
      role: a.role,
      attivo: a.attivo,
      emailVerified: a.emailVerified,
      commissarioId: a.commissarioId,
      commissario: a.commissarioId,
      lastLoginAt: a.lastLoginAt,
      createdAt: a.createdAt,
    }));
  } catch {
    state.accounts = []; // ruolo commissario non ha permesso
  }

  // Meta da localStorage (activeConcorsoId, ruolo operativo)
  Object.assign(state.meta, loadMeta());

  notify();
}

// ====================================================================
// API pubblica `db`
// ====================================================================

export const db = {
  get state() { return state; },
  get initialized() { return initialized; },

  init: async () => {
    // Branding pubblico sempre, anche pre-login
    await loadEntePublic();

    // Verifica sessione corrente (cookie HttpOnly)
    const me = await refreshAuth();
    if (!me) {
      initialized = true;
      notify();
      return;
    }
    // Super-admin opera su /api/platform/* (subdomain platform, req.tenant=null).
    // Saltiamo loadAll() perché gli endpoint per-tenant non sono accessibili senza tenant.
    if (me.role !== 'superadmin') {
      await loadAll();
    }
    initialized = true;
    notify();
  },

  reload: async () => {
    // Super-admin opera su /api/platform/*; loadAll() per-tenant esplode in 500.
    if (pb.authStore.model?.role === 'superadmin') return;
    await loadAll();
  },
  reloadEntePublic: async () => { await loadEntePublic(); notify(); },

  // ---------- Meta locale ----------
  setRole(role, commissarioId = null) {
    const authRole = pb.authStore.isValid ? (pb.authStore.model?.role || null) : null;
    const rank = { commissario: 1, admin: 2, superadmin: 3 };
    const wantedRank = rank[role] || 0;
    const authRank = rank[authRole] || 0;
    if (wantedRank > authRank) {
      console.warn(`setRole: blocked upgrade from "${authRole}" to "${role}"`);
      return;
    }
    state.meta.role = role;
    state.meta.currentCommissarioId = commissarioId;
    saveMeta(); notify();
  },
  setActiveConcorso(id) {
    state.meta.activeConcorsoId = id;
    saveMeta(); notify();
  },

  // ---------- Auth ----------
  isAuthenticated() { return pb.authStore.isValid; },
  currentAccount() { return pb.authStore.model || null; },

  async login(email, password) {
    await api.post('/auth/login', { email, password });
    const me = await refreshAuth();
    // Super-admin non carica i dati per-tenant (endpoint richiedono tenant context).
    if (me && me.role !== 'superadmin') {
      await loadAll();
    }
    if (!me) return null;
    // Shape compat con la view legacy: campo `commissario` (id), `attivo` boolean.
    return {
      id: me.id,
      email: me.email,
      role: me.role,
      attivo: me.attivo === true,
      commissario: me.commissarioId || null,
      tenantId: me.tenantId,
    };
  },

  // M7: la logout ora è async e attende l'invalidazione server-side della
  // sessione PRIMA di pulire lo stato locale. Senza l'await, un re-login
  // immediato poteva avvenire mentre la vecchia sessione era ancora valida.
  // Se la POST fallisce (offline), procediamo comunque a pulire il client.
  async logout() {
    try {
      await api.post('/auth/logout', {});
    } catch { /* best-effort: offline o sessione già scaduta */ }
    pb.authStore.clear();
    state = empty();
    saveMeta();
    notify();
  },

  // ---------- Audit log ----------
  // Lato server l'audit è automatico su tutte le mutazioni. Queste API restano
  // per compat: `audit()` è no-op (l'azione è già loggata dal backend),
  // `fetchAuditLog()` legge da /api/audit-log.
  audit(_action, _meta) { /* automatica server-side, no-op */ },

  async fetchAuditLog({ concorsoId = null, limit = 200, action = null } = {}) {
    const rows = await api.get('/api/audit-log', { limit, action });
    // Filtro client-side per concorsoId se richiesto (il payload ha targetId)
    return concorsoId
      ? rows.filter((r) => r.targetId === concorsoId || r.payload?.concorsoId === concorsoId)
      : rows;
  },

  // ---------- Concorsi ----------
  concorsiList() { return state.concorsi.slice(); },

  async createConcorso({ nome, anno, data_inizio = null, logo = undefined }) {
    const created = await api.post('/api/concorsi', {
      nome,
      anno: Number(anno) || new Date().getFullYear(),
      dataInizio: data_inizio || undefined,
      stato: 'ATTIVO',
    });
    const c = mapConcorso(created);
    state.concorsi.push(c);

    // Upload logo se fornito (dataURL → Blob)
    if (logo && typeof logo === 'object' && logo.dataURL) {
      try {
        const blob = base64ToBlob(logo.dataURL);
        if (blob) {
          const up = await api.upload('concorso', c.id, new File([blob], logo.name || 'logo.png', { type: blob.type }));
          c.logo_url = up.url;
          c.logo_filename = up.filename;
        }
      } catch (e) {
        console.warn('logo upload failed:', e?.message);
      }
    }
    notify();
    return c;
  },

  async updateConcorso(id, patch) {
    const body = {};
    if (patch.nome != null) body.nome = patch.nome;
    if (patch.anno != null) body.anno = Number(patch.anno);
    if (patch.data_inizio !== undefined) body.dataInizio = patch.data_inizio || undefined;
    if (patch.stato != null) body.stato = patch.stato;
    if (patch.anonimo !== undefined) body.anonimo = !!patch.anonimo;
    if (patch.iscrizioni_aperte !== undefined) body.iscrizioniAperte = !!patch.iscrizioni_aperte;
    if (patch.iscrizioni_chiusura !== undefined) body.iscrizioniScadenza = patch.iscrizioni_chiusura || undefined;

    let updated = await api.patch(`/api/concorsi/${id}`, body);

    if (patch.logo && typeof patch.logo === 'object' && patch.logo.dataURL) {
      try {
        const blob = base64ToBlob(patch.logo.dataURL);
        if (blob) {
          await api.upload('concorso', id, new File([blob], patch.logo.name || 'logo.png', { type: blob.type }));
        }
      } catch (e) {
        console.warn('logo upload failed:', e?.message);
      }
      updated = await api.get(`/api/concorsi/${id}`);
    }

    const c = mapConcorso(updated);
    const idx = state.concorsi.findIndex((x) => x.id === id);
    if (idx >= 0) state.concorsi[idx] = c;
    notify();
    return c;
  },

  async deleteConcorso(id) {
    // M193: il server rifiuta il delete di un concorso con dati collegati senza
    // force; la UI conferma già esplicitamente, quindi passiamo force=true.
    await api.delete(`/api/concorsi/${id}?force=true`);
    state.concorsi = state.concorsi.filter((x) => x.id !== id);
    state.fasi = state.fasi.filter((f) => f.concorso_id !== id);
    state.candidati = state.candidati.filter((x) => x.concorso_id !== id);
    state.commissari = state.commissari.filter((c) => c.concorso_id !== id);
    state.sezioni = state.sezioni.filter((s) => s.concorso_id !== id);
    state.commissioni = state.commissioni.filter((c) => c.concorso_id !== id);
    const validFaseIds = new Set(state.fasi.map((f) => f.id));
    state.candidati_fase = state.candidati_fase.filter((cf) => validFaseIds.has(cf.fase_id));
    const validCfIds = new Set(state.candidati_fase.map((cf) => cf.id));
    state.valutazioni = state.valutazioni.filter((v) => validCfIds.has(v.candidato_fase_id));
    if (state.meta.activeConcorsoId === id) {
      state.meta.activeConcorsoId = null;
      saveMeta();
    }
    notify();
  },

  // ---------- Sezioni ----------
  sezioniByConcorso(concorso_id) {
    return state.sezioni.filter((s) => s.concorso_id === concorso_id);
  },
  async createSezione({ concorso_id, nome, descrizione = '' }) {
    const r = await api.post('/api/sezioni', { concorsoId: concorso_id, nome, descrizione });
    const s = mapSezione(r);
    state.sezioni.push(s); notify();
    return s;
  },
  async updateSezione(id, patch) {
    const body = {};
    if (patch.nome != null) body.nome = patch.nome;
    if (patch.descrizione != null) body.descrizione = patch.descrizione;
    if (patch.ordine != null) body.ordine = patch.ordine;
    const r = await api.patch(`/api/sezioni/${id}`, body);
    const s = mapSezione(r);
    const i = state.sezioni.findIndex((x) => x.id === id);
    if (i >= 0) state.sezioni[i] = s;
    notify();
    return s;
  },
  async deleteSezione(id) {
    await api.delete(`/api/sezioni/${id}`);
    state.sezioni = state.sezioni.filter((s) => s.id !== id);
    const removedCatIds = new Set(state.categorie.filter((c) => c.sezione_id === id).map((c) => c.id));
    state.categorie = state.categorie.filter((c) => c.sezione_id !== id);
    // N19: ripulisci anche lo stato derivato che referenzia la sezione/categorie
    // rimosse, altrimenti la cache frontend resta incoerente (il server blocca
    // la delete se fasi referenziano la sezione, ma candidati/fasi locali
    // potrebbero puntare a id ora inesistenti).
    state.fasi.forEach((f) => {
      if (Array.isArray(f.sezioni_ids)) f.sezioni_ids = f.sezioni_ids.filter((sid) => sid !== id);
    });
    state.candidati.forEach((c) => {
      if (c.sezione_id === id) c.sezione_id = null;
      if (removedCatIds.has(c.categoria_id)) c.categoria_id = null;
    });
    notify();
  },

  // ---------- Categorie ----------
  categorieBySezione(sezione_id) {
    return state.categorie.filter((c) => c.sezione_id === sezione_id);
  },
  categorieByConcorso(concorso_id) {
    const sezIds = new Set(state.sezioni.filter((s) => s.concorso_id === concorso_id).map((s) => s.id));
    return state.categorie.filter((c) => sezIds.has(c.sezione_id));
  },
  async createCategoria({ sezione_id, nome, descrizione = '' }) {
    const r = await api.post('/api/categorie', { sezioneId: sezione_id, nome, descrizione });
    const c = mapCategoria(r);
    state.categorie.push(c); notify();
    return c;
  },
  async updateCategoria(id, patch) {
    const body = {};
    if (patch.nome != null) body.nome = patch.nome;
    if (patch.descrizione != null) body.descrizione = patch.descrizione;
    if (patch.ordine != null) body.ordine = patch.ordine;
    if (patch.eta_min != null) body.etaMin = patch.eta_min;
    if (patch.eta_max != null) body.etaMax = patch.eta_max;
    const r = await api.patch(`/api/categorie/${id}`, body);
    const c = mapCategoria(r);
    const i = state.categorie.findIndex((x) => x.id === id);
    if (i >= 0) state.categorie[i] = c;
    notify();
    return c;
  },
  async deleteCategoria(id) {
    await api.delete(`/api/categorie/${id}`);
    state.categorie = state.categorie.filter((c) => c.id !== id);
    notify();
  },
  async copyCategorieToSezioni({ from_sezione_id, to_sezioni_ids = [], skipDuplicates = true }) {
    const source = state.categorie.filter((c) => c.sezione_id === from_sezione_id);
    const created = [];
    for (const sid of to_sezioni_ids) {
      const existing = new Set(state.categorie.filter((c) => c.sezione_id === sid).map((c) => c.nome.toLowerCase()));
      for (const cat of source) {
        if (skipDuplicates && existing.has(cat.nome.toLowerCase())) continue;
        const r = await api.post('/api/categorie', {
          sezioneId: sid,
          nome: cat.nome,
          descrizione: cat.descrizione,
        });
        const c = mapCategoria(r);
        state.categorie.push(c);
        created.push(c);
      }
    }
    notify();
    return created;
  },

  // ---------- Commissioni ----------
  commissioniByConcorso(concorso_id) {
    return state.commissioni.filter((c) => c.concorso_id === concorso_id);
  },
  effectiveCategorieForCommissione(commissione) {
    if (!commissione) return [];
    if (commissione.include_tutte_categorie && Array.isArray(commissione.sezioni_ids)) {
      const ids = new Set(commissione.sezioni_ids);
      return state.categorie.filter((c) => ids.has(c.sezione_id)).map((c) => c.id);
    }
    return commissione.categorie_ids || [];
  },
  async createCommissione({ concorso_id, nome, descrizione: _d = '', commissari_ids = [], sezioni_ids = [], categorie_ids = [], include_tutte_categorie: _i = false, presidente_id = null }) {
    const r = await api.post('/api/commissioni', {
      concorsoId: concorso_id,
      nome,
      presidenteCommissarioId: presidente_id || undefined,
    });
    const c = mapCommissione(r);
    state.commissioni.push(c);
    // Aggiunte separate per le relazioni N-N. Loggiamo eventuali fallimenti
    // (rete, RLS, FK mancante) invece di silenziarli: una commissione che
    // resta vuota perché gli attach sono falliti è una sorgente di confusione
    // ("ho assegnato la commissione alla fase ma non vedo i commissari").
    for (const cid of commissari_ids) {
      try { await api.post(`/api/commissioni/${c.id}/commissari/${cid}`, {}); c.commissari_ids.push(cid); }
      catch (e) { console.warn(`createCommissione: attach commissario ${cid} failed:`, e?.message || e); }
    }
    for (const sid of sezioni_ids) {
      try { await api.post(`/api/commissioni/${c.id}/sezioni/${sid}`, {}); c.sezioni_ids.push(sid); }
      catch (e) { console.warn(`createCommissione: attach sezione ${sid} failed:`, e?.message || e); }
    }
    for (const cat of categorie_ids) {
      try { await api.post(`/api/commissioni/${c.id}/categorie/${cat}`, {}); c.categorie_ids.push(cat); }
      catch (e) { console.warn(`createCommissione: attach categoria ${cat} failed:`, e?.message || e); }
    }
    notify();
    return c;
  },
  async updateCommissione(id, patch) {
    const body = {};
    if (patch.nome != null) body.nome = patch.nome;
    if (patch.presidente_id !== undefined) body.presidenteCommissarioId = patch.presidente_id || null;
    if (Object.keys(body).length > 0) await api.patch(`/api/commissioni/${id}`, body);

    // Riconcilia le 3 join tables in modo idempotente.
    // Non muto lo state ottimisticamente: solo dopo il GET finale del record
    // aggiornato dal server scriviamo nello state — così se uno qualunque
    // dei sync (delete/post) fallisce, lo state non resta in stato intermedio.
    const current = state.commissioni.find((c) => c.id === id);
    if (!current) return null;
    const sync = async (relName, currentIds, newIds) => {
      if (!Array.isArray(newIds)) return;
      const cur = new Set(currentIds);
      const next = new Set(newIds);
      for (const a of cur) if (!next.has(a)) await api.delete(`/api/commissioni/${id}/${relName}/${a}`);
      for (const b of next) if (!cur.has(b)) await api.post(`/api/commissioni/${id}/${relName}/${b}`, {});
    };
    try {
      await sync('commissari', current.commissari_ids, patch.commissari_ids);
      await sync('sezioni', current.sezioni_ids, patch.sezioni_ids);
      await sync('categorie', current.categorie_ids, patch.categorie_ids);
    } catch (err) {
      // M21: dopo una sync parziale, riallineamo lo state alla verità del
      // backend ricaricando l'INTERA collezione commissioni (non solo il
      // record toccato: le relazioni potrebbero essere cambiate altrove).
      // Se anche questo reload fallisce, segnaliamo lo stato potenzialmente
      // stantio così la UI può forzare un refresh completo.
      try {
        const list = await api.get('/api/commissioni');
        state.commissioni = (list || []).map(mapCommissione);
        notify();
      } catch {
        state.meta._loadErrors = state.meta._loadErrors || [];
        state.meta._loadErrors.push('commissioni potenzialmente non sincronizzate (reload fallito)');
        notify();
      }
      throw err;
    }

    const refreshed = await api.get(`/api/commissioni/${id}`);
    const c = mapCommissione(refreshed);
    const i = state.commissioni.findIndex((x) => x.id === id);
    if (i >= 0) state.commissioni[i] = c;
    notify();
    return c;
  },
  async deleteCommissione(id) {
    await api.delete(`/api/commissioni/${id}`);
    state.commissioni = state.commissioni.filter((c) => c.id !== id);
    notify();
  },

  // ---------- Commissari ----------
  // Lista dei commissari ATTIVI per un concorso. Gli INATTIVI sono nascosti
  // dalla vista "Commissari del concorso" — finiscono in archivio finché non
  // vengono ri-attivati.
  commissariByConcorso(concorso_id) {
    return state.commissari.filter(
      (c) => c.concorso_id === concorso_id && c.stato !== 'INATTIVO',
    );
  },
  // Archivio: commissari INATTIVI del tenant. Da qui possono essere riattivati
  // sul concorso a cui erano originariamente assegnati.
  archivioCommissari() {
    return state.commissari.filter((c) => c.stato === 'INATTIVO');
  },
  getAccountForCommissario(commissario_id) {
    return state.accounts.find((a) => a.commissarioId === commissario_id) || null;
  },
  async createCommissario({ concorso_id = null, nome, cognome = '', specialita = '', email = '', telefono = '', data_nascita = null, nazionalita = '', foto = null, bio = '' }) {
    if (!concorso_id) throw new Error('createCommissario: concorso_id richiesto');
    const r = await api.post('/api/commissari', {
      concorsoId: concorso_id,
      nome, cognome, specialita, email: email || undefined, telefono,
      dataNascita: data_nascita || undefined,
      nazionalita, bio,
    });
    const cm = mapCommissario(r);
    state.commissari.push(cm);
    if (foto && typeof foto === 'object' && foto.dataURL) {
      try {
        const blob = base64ToBlob(foto.dataURL);
        if (blob) {
          const up = await api.upload('commissario', cm.id, new File([blob], foto.name || 'foto.png', { type: blob.type }));
          cm.foto_url = up.url;
          cm.foto_filename = up.filename;
        }
      } catch (e) { console.warn('commissario foto upload failed:', e?.message); }
    }
    notify();
    return cm;
  },
  async updateCommissario(id, patch) {
    const body = {};
    const keymap = {
      nome: 'nome', cognome: 'cognome', specialita: 'specialita',
      email: 'email', telefono: 'telefono',
      data_nascita: 'dataNascita', nazionalita: 'nazionalita',
      bio: 'bio', stato: 'stato',
    };
    for (const [k, v] of Object.entries(keymap)) {
      if (patch[k] !== undefined) body[v] = patch[k];
    }
    let updated = body.nome !== undefined || Object.keys(body).length > 0
      ? await api.patch(`/api/commissari/${id}`, body)
      : await api.get(`/api/commissari/${id}`);

    if (patch.foto && typeof patch.foto === 'object' && patch.foto.dataURL) {
      try {
        const blob = base64ToBlob(patch.foto.dataURL);
        if (blob) {
          await api.upload('commissario', id, new File([blob], patch.foto.name || 'foto.png', { type: blob.type }));
        }
      } catch (e) { console.warn('commissario foto upload failed:', e?.message); }
      updated = await api.get(`/api/commissari/${id}`);
    }
    const cm = mapCommissario(updated);
    const i = state.commissari.findIndex((x) => x.id === id);
    if (i >= 0) state.commissari[i] = cm;
    notify();
    return cm;
  },
  async deleteCommissario(id) {
    await api.delete(`/api/commissari/${id}`);
    state.commissari = state.commissari.filter((c) => c.id !== id);
    notify();
  },

  // Nel modello attuale i commissari sono single-concorso: "rimuovi" non
  // cambia FK, ma sposta lo stato in INATTIVO (→ scompare dalla vista del
  // concorso, appare in archivio). "Riassegna" ripristina lo stato ATTIVO.
  async assegnaCommissarioAConcorso(commissario_id, _concorso_id) {
    return this.updateCommissario(commissario_id, { stato: 'ATTIVO' });
  },
  async disassegnaCommissarioDaConcorso(commissario_id, _concorso_id) {
    return this.updateCommissario(commissario_id, { stato: 'INATTIVO' });
  },

  getPresidenteForCommissione(commissione_or_id) {
    const c = typeof commissione_or_id === 'string'
      ? state.commissioni.find((x) => x.id === commissione_or_id)
      : commissione_or_id;
    if (!c || !c.presidente_id) return null;
    return state.commissari.find((x) => x.id === c.presidente_id) || null;
  },
  getPresidenteForFase(fase) {
    if (!fase || !fase.commissione_id) return null;
    return this.getPresidenteForCommissione(fase.commissione_id);
  },
  isPresidenteDiQualcheCommissione(commissario_id) {
    return state.commissioni.some((c) => c.presidente_id === commissario_id);
  },
  /**
   * @deprecated il modello attuale ha un presidente per-commissione (potenzialmente
   * diverso per ogni commissione del concorso). Usa `getPresidenteForCommissione`,
   * `getPresidenteForFase`, `presidentiFor`, o `getPresidenteForFinale` (firma PDF
   * protocollo). Mantenuto solo per backward-compat: ritorna il presidente SOLO
   * se tutte le commissioni del concorso convergono sullo stesso commissario
   * (cioè è davvero "il" presidente di quel concorso). Altrimenti `null`.
   */
  getPresidenteFor(concorso_id) {
    const ids = new Set(
      state.commissioni
        .filter((c) => c.concorso_id === concorso_id && c.presidente_id)
        .map((c) => c.presidente_id),
    );
    if (ids.size !== 1) return null;
    const [only] = ids;
    return state.commissari.find((x) => x.id === only) || null;
  },
  /**
   * Tutti i presidenti distinti del concorso, ognuno con la lista di commissioni
   * di cui è presidente. Utile per header/dashboard che vogliono mostrare
   * "N presidenti" o l'elenco completo.
   */
  presidentiFor(concorso_id) {
    const byPres = new Map();
    for (const c of state.commissioni) {
      if (c.concorso_id !== concorso_id || !c.presidente_id) continue;
      const arr = byPres.get(c.presidente_id) ?? [];
      arr.push(c);
      byPres.set(c.presidente_id, arr);
    }
    return Array.from(byPres.entries()).map(([pid, commissioni]) => ({
      presidente: state.commissari.find((x) => x.id === pid) || null,
      commissioni,
    })).filter((x) => x.presidente);
  },
  /**
   * Presidente della commissione che gestisce la fase finale del concorso.
   * Usato nel PDF protocollo per la firma in calce. null se la fase finale
   * non esiste, non è ancora CONCLUSA, o non ha commissione assegnata.
   */
  getPresidenteForFinale(concorso_id) {
    const fasi = state.fasi.filter((f) => f.concorso_id === concorso_id);
    if (fasi.length === 0) return null;
    // M211: la fase finale è quella con ordine MASSIMO, non `ordine === length`
    // (gli ordini possono avere buchi dopo cancellazioni di fasi).
    const finale = fasi.reduce((mx, f) => (f.ordine > mx.ordine ? f : mx), fasi[0]);
    return this.getPresidenteForFase(finale);
  },

  // ---------- Candidati ----------
  candidatiByConcorso(concorso_id) {
    return state.candidati.filter((c) => c.concorso_id === concorso_id);
  },
  // Membri di un candidato-gruppo (righe della tabella candidati_membri
  // collegate via candidato_id). I membri sono dati piatti (nome/cognome/
  // strumento), non riferimenti ad altri candidati.
  membriGruppo(gruppo_id) {
    return state.candidati_gruppo.filter((m) => m.candidato_id === gruppo_id);
  },
  async createCandidato(opts = {}) {
    const {
      concorso_id, nome, cognome = '', strumento, data_nascita = null, nazionalita = '',
      foto = null, docenti_preparatori = [], sezione_id = null, categoria_id = null,
      tipo = 'individuale',
      // Anagrafica/residenza/artistici estesi (allineamento con iscrizioni)
      email = '', telefono = '', sesso = '', luogo_nascita = '', codice_fiscale = '',
      indirizzo = '', citta = '', cap = '', provincia = '', paese = '',
      anni_studio = null, scuola_provenienza = '',
      programma = null, tutore = null, note_libere = '', gruppo_nome = '',
      tipo_gruppo = '',
    } = opts;
    const isGruppoFlag = tipo === 'gruppo' || tipo === 'orchestra';
    const tipoGruppoNorm = tipo === 'orchestra' ? 'orchestra' : (isGruppoFlag ? (tipo_gruppo || 'ensemble') : null);
    // M6: numeroCandidato è calcolato dal server (MAX+1 in transazione) per
    // evitare duplicati su creazioni rapide. Non lo inviamo più dal client.
    const r = await api.post('/api/candidati', {
      concorsoId: concorso_id,
      nome, cognome, strumento,
      dataNascita: data_nascita || undefined,
      nazionalita,
      email: email || undefined,
      telefono: telefono || undefined,
      sesso: sesso || undefined,
      luogoNascita: luogo_nascita || undefined,
      codiceFiscale: codice_fiscale || undefined,
      indirizzo: indirizzo || undefined,
      citta: citta || undefined,
      cap: cap || undefined,
      provincia: provincia || undefined,
      paese: paese || undefined,
      anniStudio: anni_studio ?? undefined,
      scuolaProvenienza: scuola_provenienza || undefined,
      docentiPreparatori: docenti_preparatori,
      programma: programma ?? undefined,
      tutore: tutore ?? undefined,
      noteLibere: note_libere || undefined,
      sezioneId: sezione_id || undefined,
      categoriaId: categoria_id || undefined,
      isGruppo: isGruppoFlag,
      gruppoNome: gruppo_nome || undefined,
      tipoGruppo: tipoGruppoNorm || undefined,
    });
    const cd = mapCandidato(r);
    state.candidati.push(cd);
    if (foto && typeof foto === 'object' && foto.dataURL) {
      try {
        const blob = base64ToBlob(foto.dataURL);
        if (blob) {
          const up = await api.upload('candidato', cd.id, new File([blob], foto.name || 'foto.png', { type: blob.type }));
          cd.foto_url = up.url;
          cd.foto_filename = up.filename;
        }
      } catch (e) { console.warn('candidato foto upload failed:', e?.message); }
    }
    notify();
    return cd;
  },
  async updateCandidato(id, patch) {
    const body = {};
    const keymap = {
      nome: 'nome', cognome: 'cognome', strumento: 'strumento',
      data_nascita: 'dataNascita', nazionalita: 'nazionalita',
      email: 'email', telefono: 'telefono', sesso: 'sesso',
      luogo_nascita: 'luogoNascita', codice_fiscale: 'codiceFiscale',
      indirizzo: 'indirizzo', citta: 'citta', cap: 'cap',
      provincia: 'provincia', paese: 'paese',
      anni_studio: 'anniStudio', scuola_provenienza: 'scuolaProvenienza',
      docenti_preparatori: 'docentiPreparatori',
      programma: 'programma', tutore: 'tutore', note_libere: 'noteLibere',
      sezione_id: 'sezioneId', categoria_id: 'categoriaId',
      gruppo_nome: 'gruppoNome',
      tipo_gruppo: 'tipoGruppo',
      numero_candidato: 'numeroCandidato',
    };
    for (const [k, v] of Object.entries(keymap)) {
      if (patch[k] !== undefined) body[v] = patch[k];
    }
    if (patch.tipo !== undefined) {
      const isGruppoFlag = patch.tipo === 'gruppo' || patch.tipo === 'orchestra';
      body.isGruppo = isGruppoFlag;
      if (isGruppoFlag && body.tipoGruppo === undefined) {
        body.tipoGruppo = patch.tipo === 'orchestra' ? 'orchestra' : 'ensemble';
      }
      if (!isGruppoFlag) body.tipoGruppo = null;
    }
    let updated = Object.keys(body).length > 0
      ? await api.patch(`/api/candidati/${id}`, body)
      : await api.get(`/api/candidati/${id}`);

    if (patch.foto && typeof patch.foto === 'object' && patch.foto.dataURL) {
      try {
        const blob = base64ToBlob(patch.foto.dataURL);
        if (blob) {
          await api.upload('candidato', id, new File([blob], patch.foto.name || 'foto.png', { type: blob.type }));
        }
      } catch (e) { console.warn('candidato foto upload failed:', e?.message); }
      updated = await api.get(`/api/candidati/${id}`);
    }
    const cd = mapCandidato(updated);
    const i = state.candidati.findIndex((x) => x.id === id);
    if (i >= 0) state.candidati[i] = cd;
    notify();
    return cd;
  },
  async deleteCandidato(id) {
    await api.delete(`/api/candidati/${id}`);
    state.candidati = state.candidati.filter((c) => c.id !== id);
    // N119: il server fa CASCADE; allineiamo lo stato in memoria per non lasciare
    // candidati_fase/valutazioni/membri orfani (che apparirebbero finché non si
    // ricarica).
    const cfIds = new Set(
      state.candidati_fase.filter((cf) => cf.candidato_id === id).map((cf) => cf.id),
    );
    state.candidati_fase = state.candidati_fase.filter((cf) => cf.candidato_id !== id);
    state.valutazioni = state.valutazioni.filter((v) => !cfIds.has(v.candidato_fase_id));
    if (Array.isArray(state.candidati_gruppo)) {
      state.candidati_gruppo = state.candidati_gruppo.filter((m) => m.candidato_id !== id);
    }
    notify();
  },

  // ---------- Fasi ----------
  fasiByConcorso(concorso_id) {
    return state.fasi.filter((f) => f.concorso_id === concorso_id).sort((a, b) => a.ordine - b.ordine);
  },
  async createFase({ concorso_id, nome, ammessi = null, data_prevista = null, scala = 100, modo_valutazione = 'autonoma', metodo_media = 'aritmetica', tempo_minuti = 0, pesi = null, commissione_id = null, tiebreak_strategy = null, sezioni_ids = [], testo_esito_promosso = '', testo_esito_eliminato = '', criteri = null }) {
    const ordine = state.fasi.filter((f) => f.concorso_id === concorso_id).length + 1;
    const r = await api.post('/api/fasi', {
      concorsoId: concorso_id,
      ordine, nome,
      ammessi: ammessi || undefined,
      dataPrevista: data_prevista || undefined,
      scala, modoValutazione: modo_valutazione,
      metodoMedia: metodo_media,
      tempoMinuti: tempo_minuti || undefined,
      pesi: pesi || undefined,
      commissioneId: commissione_id || undefined,
      tiebreakStrategy: tiebreak_strategy || undefined,
      sezioniIds: Array.isArray(sezioni_ids) && sezioni_ids.length > 0 ? sezioni_ids : undefined,
      testoEsitoPromosso: testo_esito_promosso || undefined,
      testoEsitoEliminato: testo_esito_eliminato || undefined,
    });
    const f = mapFase(r);
    // N1: persiste i criteri nella tabella `criteri` (prima venivano scartati).
    if (Array.isArray(criteri)) await this._syncCriteri(f.id, criteri);
    f.criteri = criteriForFase(f.id);
    state.fasi.push(f); notify();
    return f;
  },
  async updateFase(id, patch) {
    const body = {};
    const keymap = {
      nome: 'nome', ammessi: 'ammessi', data_prevista: 'dataPrevista',
      scala: 'scala', modo_valutazione: 'modoValutazione',
      metodo_media: 'metodoMedia', tempo_minuti: 'tempoMinuti',
      pesi: 'pesi', commissione_id: 'commissioneId',
      tiebreak_strategy: 'tiebreakStrategy', ordine: 'ordine',
      sezioni_ids: 'sezioniIds',
      testo_esito_promosso: 'testoEsitoPromosso',
      testo_esito_eliminato: 'testoEsitoEliminato',
    };
    for (const [k, v] of Object.entries(keymap)) {
      if (patch[k] !== undefined) body[v] = patch[k];
    }
    const r = await api.patch(`/api/fasi/${id}`, body);
    const f = mapFase(r);
    // N1: se la form ha passato i criteri, riconciliali nella tabella `criteri`.
    if (Array.isArray(patch.criteri)) await this._syncCriteri(id, patch.criteri);
    f.criteri = criteriForFase(id);
    const i = state.fasi.findIndex((x) => x.id === id);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
  },
  // N35: riconcilia i criteri di una fase con UNA sola chiamata atomica
  // (PUT /api/criteri/fase/:id fa delete+insert in transazione lato server).
  // Prima erano N delete + N post separati: un fallimento a metà lasciava i
  // criteri vecchi cancellati e i nuovi parziali. peso 0-1 → 0-100 per il DB
  // (il server poi normalizza la somma a 100, vedi N34).
  async _syncCriteri(faseId, criteri) {
    const payload = (criteri || [])
      .map((c, i) => ({
        nome: (c.label || c.key || '').trim(),
        peso: Math.max(0, Math.min(100, Math.round((Number(c.peso) || 0) * 100))),
        ordine: i,
      }))
      .filter((c) => c.nome);
    if (payload.length === 0) return;
    const rows = await api.put(`/api/criteri/fase/${faseId}`, { criteri: payload });
    state._criteri = (state._criteri || []).filter((c) => c.faseId !== faseId);
    (state._criteri = state._criteri || []).push(...(rows || []));
    notify(); // N74: notifica esplicita (non affidarsi solo al caller)
  },
  async deleteFase(id) {
    await api.delete(`/api/fasi/${id}`);
    state.fasi = state.fasi.filter((f) => f.id !== id);
    state.candidati_fase = state.candidati_fase.filter((cf) => cf.fase_id !== id);
    notify();
  },
  async reorderFasi(concorso_id, idsInOrder) {
    await api.patch('/api/fasi/reorder', { concorsoId: concorso_id, ids: idsInOrder });
    // Riallinea ordine in state
    idsInOrder.forEach((id, i) => {
      const f = state.fasi.find((x) => x.id === id);
      if (f) f.ordine = i + 1;
    });
    notify();
  },
  async setPesiFase(faseId, pesi) {
    return this.updateFase(faseId, { pesi });
  },
  getFaseCommissariIds(fase) {
    // Nel nuovo modello: i commissari di una fase sono quelli della commissione associata
    if (!fase || !fase.commissione_id) return [];
    const com = state.commissioni.find((c) => c.id === fase.commissione_id);
    if (!com) {
      // FK orfana: la fase punta a una commissione che non è in state.
      // Cause tipiche: la commissione è stata cancellata (set null sul DB ma
      // qui c'è cache stale), oppure GET /commissioni non l'ha restituita.
      console.warn(`getFaseCommissariIds: fase ${fase.id} referenzia commissione ${fase.commissione_id} non presente in state.commissioni`);
      return [];
    }
    return com.commissari_ids || [];
  },

  // ---------- Criteri (raw, esposti come metodo helper) ----------
  criteriByFase(fase_id) {
    return (state._criteri || []).filter((c) => c.faseId === fase_id);
  },
  async createCriterio({ fase_id, nome, peso = 100, descrizione = '', ordine = null }) {
    const r = await api.post('/api/criteri', {
      faseId: fase_id, nome, peso, descrizione, ordine: ordine ?? undefined,
    });
    (state._criteri = state._criteri || []).push(r);
    notify();
    return r;
  },
  async deleteCriterio(id) {
    await api.delete(`/api/criteri/${id}`);
    state._criteri = (state._criteri || []).filter((c) => c.id !== id);
    notify();
  },

  // ---------- Ente / branding ----------
  getEnte() { return state.ente; },
  getEntePublic() { return state.ente_public; },
  /**
   * Salva i campi piatti del form ente sui due endpoint corretti:
   *   - /api/ente         (PATCH MERGE su enteSettings: email, telefono, sede, ...)
   *   - /api/ente/branding (PATCH MERGE su brandingPublic: logoUrl, colori)
   *
   * Il `patch` arriva dal form admin-impostazioni.js con nomi piatti tipo
   * `email_contatto`, `colore_primario`, `logo` (File o dataURL).
   */
  async saveEnte(patch) {
    const enteFields = {};
    if (patch.email_contatto !== undefined) enteFields.email = patch.email_contatto;
    if (patch.telefono !== undefined) enteFields.telefono = patch.telefono;
    if (patch.sito_web !== undefined) enteFields.sitoWeb = patch.sito_web;
    if (patch.indirizzo !== undefined) enteFields.sede = patch.indirizzo;
    if (patch.descrizione !== undefined) enteFields.note = patch.descrizione;
    if (Object.keys(enteFields).length > 0) {
      await api.patch('/api/ente', enteFields);
    }

    const brandingFields = {};
    if (patch.nome !== undefined) brandingFields.nomePubblico = patch.nome;
    if (patch.sottotitolo !== undefined) brandingFields.sottotitolo = patch.sottotitolo;
    if (patch.colore_primario !== undefined) brandingFields.coloreAccent = patch.colore_primario;
    if (patch.colore_secondario !== undefined) brandingFields.coloreSfondo = patch.colore_secondario;
    if (patch.logo !== undefined) {
      // Il form può passare File, dataURL string o null (rimozione).
      if (patch.logo instanceof File || patch.logo instanceof Blob) {
        brandingFields.logoUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(patch.logo);
        });
      } else if (typeof patch.logo === 'string') {
        brandingFields.logoUrl = patch.logo;
      } else if (patch.logo === null) {
        brandingFields.logoUrl = '';
      }
    }
    if (Object.keys(brandingFields).length > 0) {
      await api.patch('/api/ente/branding', brandingFields);
    }

    state.ente = mapEnte(await api.get('/api/ente'));
    // L'endpoint pubblico (usato per branding pre-login) ha una copia separata;
    // ricarichiamo anche quello così l'header logo si aggiorna senza reload.
    await loadEntePublic();
    notify();
    return state.ente;
  },

  // ====================================================================
  // STUBS Fase 5b.2 — verranno implementati nel prossimo step.
  // Lasciati come reject esplicite per non passare in silenzio.
  // ====================================================================
  candidatiFaseList(_faseId) { return state.candidati_fase.filter((cf) => cf.fase_id === _faseId); },
  findPreviousFaseInChain(fase) {
    if (!fase) return null;
    const concorsoFasi = state.fasi.filter((f) => f.concorso_id === fase.concorso_id).sort((a, b) => a.ordine - b.ordine);
    const idx = concorsoFasi.findIndex((f) => f.id === fase.id);
    return idx > 0 ? concorsoFasi[idx - 1] : null;
  },
  valutazioniByCandidatoFase(cf_id) {
    return state.valutazioni.filter((v) => v.candidato_fase_id === cf_id);
  },
  // ---------- Workflow fase ----------

  async startFase(faseId) {
    const r = await api.post(`/api/fasi/${faseId}/start`, {});
    const f = mapFase(r);
    f.criteri = criteriForFase(f.id); // N10: mapFase non popola criteri
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    // Il backend auto-popola candidati_fase se vuota — ricarico localmente
    // così la UI mostra subito la lista candidati.
    try {
      const list = await api.get('/api/candidati-fase', { faseId });
      state.candidati_fase = state.candidati_fase.filter((cf) => cf.fase_id !== faseId);
      state.candidati_fase.push(...(list || []).map(mapCandidatoFase));
    } catch (e) {
      console.warn('reload candidati_fase after start failed:', e?.message);
    }
    notify();
    return f;
  },

  async concludiFase(faseId, admittedIds = null) {
    // N144: l'ammissione (top-N per classifica) è calcolata dal chiamante con lo
    // stesso motore della classifica mostrata e inviata atomicamente al server.
    const r = await api.post(`/api/fasi/${faseId}/conclude`, Array.isArray(admittedIds) ? { admitted: admittedIds } : {});
    const f = mapFase(r);
    f.criteri = criteriForFase(f.id); // N10: mapFase non popola criteri
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    // Il backend finalizza i candidati_fase (IN_ATTESA → COMPLETATO) al
    // conclude — ricarico in state così la view risultati mostra subito
    // "promosso/eliminato" invece di "in attesa".
    try {
      const list = await api.get('/api/candidati-fase', { faseId });
      state.candidati_fase = state.candidati_fase.filter((cf) => cf.fase_id !== faseId);
      state.candidati_fase.push(...(list || []).map(mapCandidatoFase));
    } catch (e) {
      console.warn('reload candidati_fase after conclude failed:', e?.message);
    }
    notify();
    return f;
  },

  async sorteggiaFase(faseId, seed) {
    // M8: se il chiamante non passa un seed (caso comune dal pannello fasi),
    // ne generiamo uno casuale qui. Restituiamo {seed, count} dalla risposta
    // server così il toast può mostrare il seed effettivo (prima era undefined).
    let s = Number(seed);
    if (!Number.isFinite(s)) s = Math.floor(Math.random() * 0xffffffff);
    const res = await api.post(`/api/fasi/${faseId}/sorteggio`, { seed: Math.trunc(s) });
    // N12: ricarica candidati_fase con la nuova lista PRIMA di toccare lo state.
    // Se il GET fallisce, lo state precedente resta intatto (prima il filter
    // rimuoveva i vecchi record anche quando il reload poi falliva → dati persi
    // lato client). Pattern allineato a startFase/concludiFase.
    try {
      const list = await api.get('/api/candidati-fase', { faseId });
      state.candidati_fase = state.candidati_fase.filter((cf) => cf.fase_id !== faseId);
      state.candidati_fase.push(...(list || []).map(mapCandidatoFase));
    } catch (e) {
      console.warn('reload candidati_fase after sorteggio failed:', e?.message);
    }
    notify();
    return res ?? { seed: Math.trunc(s) };
  },

  /**
   * Salva la valutazione di un commissario per un candidato in una fase.
   * Il legacy passa { voti: { criterio: voto } }; il backend nuovo accetta
   * una upsert per (cf, commissario, criterio): iteriamo i criteri.
   */
  async saveValutazione({ candidato_fase_id, commissario_id, voti, note = '' }) {
    if (!voti || typeof voti !== 'object') throw new Error('saveValutazione: voti richiesti');
    // H3: niente più "rimuovi prima/inserisci dopo in loop". Inviamo tutte le
    // POST in parallelo (allSettled) e committiamo SOLO i criteri salvati con
    // successo. I criteri falliti restano nello stato precedente: nessuna
    // perdita di voti già esistenti se un singolo POST fallisce a metà.
    const entries = Object.entries(voti).filter(([, v]) => v != null && v !== '');
    const results = await Promise.allSettled(entries.map(([criterio, voto]) =>
      api.post('/api/valutazioni', {
        candidatoFaseId: candidato_fase_id,
        commissarioId: commissario_id,
        criterio,
        voto: Number(voto),
        note: note || undefined,
      }),
    ));
    const saved = [];
    const savedCriteri = new Set();
    const errors = [];
    for (let i = 0; i < results.length; i++) {
      const [criterio] = entries[i];
      const r = results[i];
      if (r.status === 'fulfilled') {
        saved.push(mapValutazione(r.value));
        savedCriteri.add(criterio);
      } else {
        errors.push({ criterio, error: r.reason });
      }
    }
    // Sostituisce solo le valutazioni con criterio in savedCriteri.
    state.valutazioni = state.valutazioni.filter(
      (v) => !(v.candidato_fase_id === candidato_fase_id && v.commissario_id === commissario_id && savedCriteri.has(v.criterio)),
    );
    state.valutazioni.push(...saved);

    // N144: la valutazione NON decide più l'ammissione (era last-write-wins tra
    // commissari). L'ammissione è calcolata dall'aggregato e applicata al
    // conclude della fase (vedi concludiFase + /fasi/:id/conclude).
    notify();
    if (errors.length > 0) {
      const err = new Error(`saveValutazione: ${errors.length} salvataggi falliti`);
      err.partial = { saved, errors };
      throw err;
    }
    return saved;
  },

  // ---------- Timer fase ----------

  async getFaseRuntime(faseId) {
    return await api.get(`/api/fasi/${faseId}/runtime`);
  },

  async upsertFaseRuntime(faseId, fields = {}) {
    // Mappa i field legacy alle action specifiche del backend.
    // Pattern di chiamate possibili:
    //   { timer_started_at: <date>, timer_started_for_cf_id: id }   → start(cfId)
    //   { timer_paused_at: <date> }                                  → pause
    //   { timer_paused_at: null }                                    → resume
    //   { timer_bonus_seconds: <delta> }                             → bonus(delta)
    //   { timer_started_at: null }                                   → reset
    if (fields.timer_started_at && fields.timer_started_for_cf_id !== undefined) {
      return this.startFaseTimer(faseId, fields.timer_started_for_cf_id);
    }
    if (fields.timer_paused_at) return this.pauseFaseTimer(faseId);
    if (fields.timer_paused_at === null && fields.timer_started_at !== null) return this.resumeFaseTimer(faseId);
    if (typeof fields.timer_bonus_seconds === 'number') return this.addFaseTimerBonus(faseId, fields.timer_bonus_seconds);
    if (fields.timer_started_at === null) return this.resetFaseTimer(faseId);
    return this.getFaseRuntime(faseId);
  },

  async startFaseTimer(faseId, candidatoFaseId = null) {
    const r = await api.post(`/api/fasi/${faseId}/timer/start`, candidatoFaseId ? { candidatoFaseId } : {});
    const f = mapFase(r);
    f.criteri = criteriForFase(f.id); // N10: preserva criteri (mapFase non li popola)
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
  },
  async pauseFaseTimer(faseId) {
    const r = await api.post(`/api/fasi/${faseId}/timer/pause`, {});
    const f = mapFase(r);
    f.criteri = criteriForFase(f.id); // N10: preserva criteri (mapFase non li popola)
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
  },
  async resumeFaseTimer(faseId) {
    const r = await api.post(`/api/fasi/${faseId}/timer/resume`, {});
    const f = mapFase(r);
    f.criteri = criteriForFase(f.id); // N10: preserva criteri (mapFase non li popola)
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
  },
  async addFaseTimerBonus(faseId, seconds = 60) {
    const r = await api.post(`/api/fasi/${faseId}/timer/bonus`, { seconds: Math.trunc(Number(seconds)) });
    const f = mapFase(r);
    f.criteri = criteriForFase(f.id); // N10: preserva criteri (mapFase non li popola)
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
  },
  async resetFaseTimer(faseId) {
    const r = await api.post(`/api/fasi/${faseId}/timer/reset`, {});
    const f = mapFase(r);
    f.criteri = criteriForFase(f.id); // N10: preserva criteri (mapFase non li popola)
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
  },
  async clearFaseTimer(faseId) { return this.resetFaseTimer(faseId); },

  /**
   * Subscribe agli eventi realtime di una fase. onChange(payload) viene chiamato
   * a ogni NOTIFY (start/pause/resume/bonus/reset/conclude) ricevuto via SSE.
   * Ritorna una funzione di unsubscribe.
   */
  subscribeFaseRuntime(faseId, onChange) {
    return api.subscribe(`/api/realtime/fase/${faseId}`, async (payload) => {
      // Aggiorna lo state locale leggendo il runtime aggiornato (best-effort)
      try {
        const rt = await api.get(`/api/fasi/${faseId}/runtime`);
        const i = state.fasi.findIndex((x) => x.id === faseId);
        if (i >= 0) {
          // N36: il runtime endpoint ritorna solo i campi timer/stato in
          // camelCase. Mappiamo SOLO quelli sui campi snake_case esistenti,
          // senza passare per mapFase (che, ricevendo un mix snake/camel,
          // azzerava silenziosamente data_prevista/modo_valutazione/
          // metodo_media/tiebreak_strategy/sezioni_ids).
          const cur = state.fasi[i];
          state.fasi[i] = {
            ...cur,
            stato: rt.stato ?? cur.stato,
            tempo_minuti: rt.tempoMinuti ?? cur.tempo_minuti,
            timer_started_at: rt.timerStartedAt ?? null,
            timer_paused_at: rt.timerPausedAt ?? null,
            timer_bonus_seconds: rt.timerBonusSeconds ?? 0,
            timer_started_for_cf_id: rt.timerStartedForCfId ?? null,
          };
          notify();
        }
      } catch (e) {
        console.warn('subscribeFaseRuntime refresh failed:', e?.message);
      }
      onChange?.(payload);
    });
  },

  // ---------- Gruppi (candidati_membri) ----------

  async addMembroGruppo(gruppoId, candidatoId, strumentoGruppo = '') {
    // Nel nuovo modello, i membri sono record indipendenti dentro `candidati_membri`,
    // non link a candidati individuali. Estraggo i dati del candidato individuale
    // e li copio come nuovo membro del gruppo.
    const ind = state.candidati.find((c) => c.id === candidatoId);
    if (!ind) throw new Error('addMembroGruppo: candidato individuale non trovato');
    const r = await api.post('/api/membri-gruppo', {
      candidatoId: gruppoId,
      nome: ind.nome,
      cognome: ind.cognome || undefined,
      strumento: strumentoGruppo || ind.strumento || undefined,
      dataNascita: ind.data_nascita || undefined,
      nazionalita: ind.nazionalita || undefined,
    });
    const m = mapMembroGruppo(r);
    state.candidati_gruppo.push(m);
    notify();
    return m;
  },

  async removeMembroGruppo(_gruppoId, membroId) {
    await api.delete(`/api/membri-gruppo/${membroId}`);
    state.candidati_gruppo = state.candidati_gruppo.filter((m) => m.id !== membroId);
    notify();
  },

  // Aggiunge un membro a un gruppo passando i dati piatti (nome/cognome/
  // strumento/data_nascita/nazionalita), senza richiedere un candidato
  // individuale esistente. Usato dal form admin "Aggiungi candidato" quando
  // l'admin compila inline la lista membri (analogo del form iscrizione
  // pubblica).
  async addMembroGruppoData(gruppoId, data = {}) {
    const r = await api.post('/api/membri-gruppo', {
      candidatoId: gruppoId,
      nome: (data.nome || '').trim(),
      cognome: (data.cognome || '').trim() || undefined,
      strumento: (data.strumento || '').trim() || undefined,
      dataNascita: data.data_nascita || undefined,
      nazionalita: (data.nazionalita || '').trim() || undefined,
    });
    const m = mapMembroGruppo(r);
    state.candidati_gruppo.push(m);
    notify();
    return m;
  },

  async updateMembroGruppoData(membroId, data = {}) {
    const body = {};
    if (data.nome !== undefined) body.nome = (data.nome || '').trim();
    if (data.cognome !== undefined) body.cognome = (data.cognome || '').trim();
    if (data.strumento !== undefined) body.strumento = (data.strumento || '').trim();
    if (data.data_nascita !== undefined) body.dataNascita = data.data_nascita || undefined;
    if (data.nazionalita !== undefined) body.nazionalita = (data.nazionalita || '').trim();
    const r = await api.patch(`/api/membri-gruppo/${membroId}`, body);
    const m = mapMembroGruppo(r);
    const i = state.candidati_gruppo.findIndex((x) => x.id === membroId);
    if (i >= 0) state.candidati_gruppo[i] = m;
    notify();
    return m;
  },

  // ---------- Accounts (utenti del tenant) ----------

  async _loadAccounts() {
    try {
      const list = await api.get('/api/accounts');
      state.accounts = (list || []).map((a) => ({
        id: a.id,
        email: a.email,
        role: a.role,
        attivo: a.attivo,
        emailVerified: a.emailVerified,
        commissarioId: a.commissarioId,
        commissario: a.commissarioId, // alias legacy
        lastLoginAt: a.lastLoginAt,
        createdAt: a.createdAt,
      }));
    } catch (e) {
      console.warn('loadAccounts failed:', e?.message);
      state.accounts = [];
    }
  },

  async createAccount({ email, password, role, commissario_id = null, attivo = true }) {
    const r = await api.post('/api/accounts', {
      email, password, role,
      commissarioId: commissario_id || undefined,
      attivo,
    });
    await this._loadAccounts();
    notify();
    return r;
  },

  async updateAccount(id, patch) {
    const body = {};
    if (patch.email !== undefined) body.email = patch.email;
    if (patch.role !== undefined) body.role = patch.role;
    if (patch.attivo !== undefined) body.attivo = patch.attivo;
    if (patch.commissario_id !== undefined) body.commissarioId = patch.commissario_id || null;
    const r = await api.patch(`/api/accounts/${id}`, body);
    await this._loadAccounts();
    notify();
    return r;
  },

  async resetAccountPassword(id, newPassword) {
    await api.post(`/api/accounts/${id}/reset-password`, { password: newPassword });
    return { ok: true };
  },

  async deleteAccount(id) {
    await api.delete(`/api/accounts/${id}`);
    state.accounts = state.accounts.filter((a) => a.id !== id);
    notify();
  },

  // ---------- Iscrizioni pubbliche (pre-login) ----------

  /**
   * Ritorna il PRIMO concorso aperto del tenant (compat con la view legacy che
   * gestisce un concorso pubblico per volta). Include sezioni e categorie per
   * popolare i select del form senza ulteriori chiamate.
   */
  async fetchConcorsoIscrizioniAperto() {
    const list = await api.get('/api/public/concorsi');
    if (!Array.isArray(list) || list.length === 0) return null;
    const first = list[0];
    const details = await api.get(`/api/public/concorsi/${first.id}`);
    return {
      id: details.id,
      nome: details.nome || '',
      anno: details.anno,
      data_inizio: details.dataInizio ? String(details.dataInizio).slice(0, 10) : null,
      logo_url: details.logo || null,
      iscrizioni_chiusura: details.iscrizioniScadenza || null,
      sezioni: (details.sezioni || []).map((s) => ({
        id: s.id, nome: s.nome || '', descrizione: s.descrizione || '',
      })),
      categorie: (details.categorie || []).map((c) => ({
        id: c.id, sezione_id: c.sezioneId, nome: c.nome || '',
        eta_min: c.etaMin || null, eta_max: c.etaMax || null,
      })),
    };
  },

  /** Lista (plurale) dei concorsi aperti — utile se servisse più di uno. */
  async fetchConcorsiIscrizioniAperte() {
    const list = await api.get('/api/public/concorsi');
    return (list || []).map((c) => ({
      id: c.id,
      nome: c.nome || '',
      anno: c.anno,
      data_inizio: c.dataInizio ? String(c.dataInizio).slice(0, 10) : null,
      logo_url: c.logo || null,
      iscrizioni_chiusura: c.iscrizioniScadenza || null,
    }));
  },

  /** Dettagli concorso (sezioni+categorie) per chi conosce già l'id. */
  async fetchConcorsoIscrizioneDetails(concorsoId) {
    return api.get(`/api/public/concorsi/${concorsoId}`);
  },

  /**
   * Submit iscrizione pubblica. payload shape legacy:
   *   { concorso_id, nome, cognome, email, telefono, data_nascita, nazionalita,
   *     strumento, programma, docenti_preparatori, sezione_id, categoria_id,
   *     is_gruppo, membri, tutore, consensi_gdpr, started_at, honeypot }
   */
  async createIscrizione(payload) {
    // Tolleriamo sia gli alias snake_case dei mapper interni sia i name dei
    // <input>/<select> usati dal form pubblico (iscrizione.js draft → d.sezione,
    // d.categoria, d.concorso, ecc.). Il backend vuole camelCase puro.
    const num = (v) => {
      if (v === '' || v == null) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    // I consensi possono arrivare come booleani sparsi (consenso_privacy,
    // consenso_immagini, consenso_regolamento) o già aggregati (consensi_gdpr).
    const consensi = payload.consensi_gdpr || {
      privacy: !!payload.consenso_privacy,
      immagini: !!payload.consenso_immagini,
      regolamento: !!payload.consenso_regolamento,
    };
    // Tutore: aggregato in oggetto se i campi sono sparsi nel form.
    const tutore = payload.tutore || (
      payload.tutore_nome || payload.tutore_email
        ? {
            nome: payload.tutore_nome || '',
            cognome: payload.tutore_cognome || '',
            email: payload.tutore_email || '',
            telefono: payload.tutore_telefono || '',
          }
        : undefined
    );
    const body = {
      concorsoId: payload.concorso_id || payload.concorso || payload.concorsoId,
      // Anti-spam: stessi nomi del form e dello schema server (no rinomina).
      // `website` = honeypot, `startedAt` = timestamp apertura form.
      website: payload.website || undefined,
      startedAt: payload.startedAt || payload._form_started_at || undefined,
      nome: payload.nome,
      cognome: payload.cognome,
      email: payload.email,
      telefono: payload.telefono,
      dataNascita: payload.data_nascita || undefined,
      nazionalita: payload.nazionalita,
      luogoNascita: payload.luogo_nascita || undefined,
      sesso: payload.sesso || undefined,
      codiceFiscale: payload.codice_fiscale || undefined,
      indirizzo: payload.indirizzo || undefined,
      citta: payload.citta || undefined,
      cap: payload.cap || undefined,
      provincia: payload.provincia || undefined,
      paese: payload.paese || undefined,
      strumento: payload.strumento,
      anniStudio: num(payload.anni_studio),
      scuolaProvenienza: payload.scuola_provenienza || undefined,
      programma: payload.programma,
      docentiPreparatori: payload.docenti_preparatori,
      sezioneId: payload.sezione_id || payload.sezione || undefined,
      categoriaId: payload.categoria_id || payload.categoria || undefined,
      isGruppo: payload.is_gruppo != null
        ? !!payload.is_gruppo
        : (payload.tipo === 'gruppo' || payload.tipo === 'orchestra'),
      gruppoNome: payload.gruppo_nome || undefined,
      tipoGruppo: payload.tipo === 'orchestra'
        ? 'orchestra'
        : (payload.tipo === 'gruppo' ? 'ensemble' : (payload.tipo_gruppo || undefined)),
      membri: payload.membri || payload.gruppo_membri,
      tutore,
      consensiGdpr: consensi,
      noteLibere: payload.note_libere || undefined,
    };
    return api.post('/api/public/iscrizioni', body);
  },

  /**
   * Verifica email tramite token (link in email).
   */
  async verifyIscrizioneEmail(token) {
    return api.get(`/api/public/iscrizioni/${encodeURIComponent(token)}/verify`);
  },

  // ---------- Iscrizioni admin ----------

  async listIscrizioni({ concorsoId = null, stato = null } = {}) {
    const rows = await api.get('/api/iscrizioni', { concorsoId, stato });
    return (rows || []).map(mapIscrizione);
  },

  async approveIscrizione(iscrizioneId, { note = '' } = {}) {
    const res = await api.post(`/api/iscrizioni/${iscrizioneId}/approve`, { note });
    // Approve crea il candidato collegato lato server: refresh delle liste impattate
    if (res?.candidato) {
      state.candidati.push(mapCandidato(res.candidato));
    }
    notify();
    return res;
  },

  async rejectIscrizione(iscrizioneId, reason = '') {
    const res = await api.post(`/api/iscrizioni/${iscrizioneId}/reject`, { reason });
    notify();
    return res;
  },

  // ---------- Calendario / scheduling ----------
  saleByConcorso(concorso_id) {
    return state.sale.filter((s) => s.concorso_id === concorso_id)
      .sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0) || a.nome.localeCompare(b.nome));
  },
  async createSala({ concorso_id, nome, indirizzo = '', ordine = null }) {
    const r = await api.post('/api/calendario/sale', { concorsoId: concorso_id, nome, indirizzo, ordine });
    const s = mapSala(r); state.sale.push(s); notify();
    return s;
  },
  async updateSala(id, patch) {
    const body = {};
    if (patch.nome != null) body.nome = patch.nome;
    if (patch.indirizzo != null) body.indirizzo = patch.indirizzo;
    if (patch.ordine !== undefined) body.ordine = patch.ordine;
    const r = await api.patch(`/api/calendario/sale/${id}`, body);
    const s = mapSala(r);
    const i = state.sale.findIndex((x) => x.id === id);
    if (i >= 0) state.sale[i] = s;
    notify();
    return s;
  },
  async deleteSala(id) {
    await api.delete(`/api/calendario/sale/${id}`);
    state.sale = state.sale.filter((s) => s.id !== id);
    // I blocchi che usavano la sala restano (sala_id → null lato server).
    state.eventi = state.eventi.map((e) => (e.sala_id === id ? { ...e, sala_id: null } : e));
    notify();
  },

  eventiByConcorso(concorso_id) {
    return state.eventi.filter((e) => e.concorso_id === concorso_id)
      .sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.ora_inizio || '').localeCompare(b.ora_inizio || ''));
  },
  async createEvento(payload) {
    const body = {
      concorsoId: payload.concorso_id,
      faseId: payload.fase_id ?? null,
      sezioneId: payload.sezione_id ?? null,
      categoriaId: payload.categoria_id ?? null,
      salaId: payload.sala_id ?? null,
      tipo: payload.tipo || 'ESIBIZIONE',
      titolo: payload.titolo ?? null,
      data: payload.data,
      oraInizio: payload.ora_inizio ?? null,
      oraFine: payload.ora_fine ?? null,
      durataCandidatoMinuti: payload.durata_candidato_minuti ?? null,
      note: payload.note ?? null,
      ordine: payload.ordine ?? null,
    };
    const r = await api.post('/api/calendario/eventi', body);
    const e = mapEvento(r); state.eventi.push(e); notify();
    return e;
  },
  async updateEvento(id, patch) {
    const map = {
      fase_id: 'faseId', sezione_id: 'sezioneId', categoria_id: 'categoriaId', sala_id: 'salaId',
      tipo: 'tipo', titolo: 'titolo', data: 'data', ora_inizio: 'oraInizio', ora_fine: 'oraFine',
      durata_candidato_minuti: 'durataCandidatoMinuti', note: 'note', ordine: 'ordine',
    };
    const body = {};
    for (const [k, v] of Object.entries(map)) if (patch[k] !== undefined) body[v] = patch[k];
    const r = await api.patch(`/api/calendario/eventi/${id}`, body);
    const e = mapEvento(r);
    const i = state.eventi.findIndex((x) => x.id === id);
    if (i >= 0) state.eventi[i] = e;
    notify();
    return e;
  },
  async deleteEvento(id) {
    await api.delete(`/api/calendario/eventi/${id}`);
    state.eventi = state.eventi.filter((e) => e.id !== id);
    // Sgancia gli slot in cache.
    state.candidati_fase = state.candidati_fase.map((cf) =>
      cf.evento_id === id ? { ...cf, evento_id: null, ora_prevista: null } : cf);
    notify();
  },
  // Applica gli slot ritornati dal backend (genera/riordina) allo stato locale.
  _applySlots(eventoId, slots) {
    const byCf = new Map((slots || []).map((s) => [s.id, s]));
    state.candidati_fase = state.candidati_fase.map((cf) => {
      if (byCf.has(cf.id)) {
        const s = byCf.get(cf.id);
        return { ...cf, evento_id: eventoId, ora_prevista: s.oraPrevista || null, posizione: s.posizione ?? cf.posizione };
      }
      // Slot precedentemente legato a questo blocco ma non più presente → sganciato.
      if (cf.evento_id === eventoId) return { ...cf, evento_id: null, ora_prevista: null };
      return cf;
    });
    notify();
  },
  async generaSlotEvento(eventoId) {
    const slots = await api.post(`/api/calendario/eventi/${eventoId}/genera-slot`, {});
    this._applySlots(eventoId, slots);
    return slots;
  },
  async riordinaSlotEvento(eventoId, ordine) {
    const slots = await api.post(`/api/calendario/eventi/${eventoId}/riordina-slot`, { ordine });
    this._applySlots(eventoId, slots);
    return slots;
  },
  slotByEvento(eventoId) {
    return state.candidati_fase
      .filter((cf) => cf.evento_id === eventoId)
      .sort((a, b) => (a.ora_prevista || '').localeCompare(b.ora_prevista || '') || (a.posizione ?? 0) - (b.posizione ?? 0));
  },

  // Link pubblici del calendario.
  async calendarioLinks(concorso_id) {
    const rows = await api.get('/api/calendario/pubblicazioni', { concorsoId: concorso_id });
    return (rows || []).map(mapCalendarioPub);
  },
  async createCalendarioLink(payload) {
    const r = await api.post('/api/calendario/pubblicazioni', {
      concorsoId: payload.concorso_id,
      scopo: payload.scopo,
      sezioneId: payload.sezione_id ?? null,
      giorno: payload.giorno ?? null,
      etichetta: payload.etichetta ?? null,
      mostraNomi: payload.mostra_nomi ?? true,
      mostraCommissione: payload.mostra_commissione ?? false,
    });
    return mapCalendarioPub(r);
  },
  async updateCalendarioLink(id, patch) {
    const map = { sezione_id: 'sezioneId', giorno: 'giorno', etichetta: 'etichetta', attivo: 'attivo', mostra_nomi: 'mostraNomi', mostra_commissione: 'mostraCommissione' };
    const body = {};
    for (const [k, v] of Object.entries(map)) if (patch[k] !== undefined) body[v] = patch[k];
    const r = await api.patch(`/api/calendario/pubblicazioni/${id}`, body);
    return mapCalendarioPub(r);
  },
  async deleteCalendarioLink(id) {
    await api.delete(`/api/calendario/pubblicazioni/${id}`);
  },

  // ---------- Comandi disabilitati ----------
  async resetAll() {
    throw new Error('Operazione disabilitata. Chiedi al super-admin di archiviare il tenant.');
  },
  async seedDemo() {
    throw new Error('seedDemo non disponibile: usare scripts/seed-dev.ts lato server.');
  },
};

// ====================================================================
// Helpers
// ====================================================================

function base64ToBlob(dataURL) {
  if (!dataURL || typeof dataURL !== 'string' || !dataURL.startsWith('data:')) return null;
  const [meta, b64] = dataURL.split(',');
  if (!b64) return null;
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * Compat: il legacy esponeva `fingerprintCommissario` per equality check.
 * Riprodotta su campi mappati.
 */
export function fingerprintCommissario(c) {
  if (!c) return '';
  return [c.nome, c.cognome, c.email, c.telefono, c.data_nascita || ''].map((x) => (x || '').trim().toLowerCase()).join('|');
}
