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
  meta: { activeConcorsoId: null, role: null, currentCommissarioId: null },
});

let state = empty();
let initialized = false;

const subscribers = new Set();
export function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
function notify() { subscribers.forEach((fn) => fn(state)); }

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
    foto_filename: r.foto || '',
    foto_url: r.foto || null,
    docenti_preparatori: Array.isArray(r.docentiPreparatori) ? r.docentiPreparatori : [],
    data_iscrizione: dateStr(r.dataIscrizione),
    sezione_id: r.sezioneId || null,
    categoria_id: r.categoriaId || null,
    is_gruppo: !!r.isGruppo,
    tipo: r.isGruppo ? 'gruppo' : 'individuale',
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
  return {
    id: r.id,
    concorso_id: r.concorsoId,
    stato: r.stato || 'BOZZA',
    nome: r.nome || '',
    cognome: r.cognome || '',
    email: r.email || '',
    telefono: r.telefono || '',
    data_nascita: dateStr(r.dataNascita),
    nazionalita: r.nazionalita || '',
    strumento: r.strumento || '',
    programma: r.programma || null,
    docenti_preparatori: Array.isArray(r.docentiPreparatori) ? r.docentiPreparatori : [],
    sezione_id: r.sezioneId || null,
    categoria_id: r.categoriaId || null,
    is_gruppo: !!r.isGruppo,
    membri: Array.isArray(r.membri) ? r.membri : null,
    tutore: r.tutore || null,
    consensi_gdpr: r.consensiGdpr || null,
    email_verified_at: r.emailVerifiedAt || null,
    approvata_at: r.approvataAt || null,
    candidato_id: r.candidatoId || null,
    note: r.note || '',
    created_at: r.createdAt || null,
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

async function loadEntePublic() {
  try {
    state.ente_public = await api.get('/api/ente/public');
  } catch {
    state.ente_public = null;
  }
}

async function loadAll() {
  const [concorsi, sezioni, categorie, commissioni, commissari, candidati, fasi, criteri, ente] = await Promise.all([
    api.get('/api/concorsi'),
    api.get('/api/sezioni'),
    api.get('/api/categorie'),
    api.get('/api/commissioni'),
    api.get('/api/commissari'),
    api.get('/api/candidati'),
    api.get('/api/fasi'),
    api.get('/api/criteri'),
    api.get('/api/ente').catch(() => null),
  ]);

  state.concorsi = (concorsi || []).map(mapConcorso);
  state.sezioni = (sezioni || []).map(mapSezione);
  state.categorie = (categorie || []).map(mapCategoria);
  state.commissioni = (commissioni || []).map(mapCommissione);
  state.commissari = (commissari || []).map(mapCommissario);
  state.candidati = (candidati || []).map(mapCandidato);
  state.fasi = (fasi || []).map(mapFase);
  state._criteri = criteri || []; // tenuti raw, non usati direttamente dalle view core
  state.ente = ente;

  // Carica candidati_fase per ogni fase (no endpoint cumulativo)
  state.candidati_fase = [];
  for (const f of state.fasi) {
    try {
      const list = await api.get('/api/candidati-fase', { faseId: f.id });
      state.candidati_fase.push(...(list || []).map(mapCandidatoFase));
    } catch (e) {
      console.warn('candidati-fase load failed for fase', f.id, e?.message);
    }
  }

  // Carica valutazioni per ogni candidato_fase
  state.valutazioni = [];
  for (const cf of state.candidati_fase) {
    try {
      const list = await api.get('/api/valutazioni', { candidatoFaseId: cf.id });
      state.valutazioni.push(...(list || []).map(mapValutazione));
    } catch (e) {
      console.warn('valutazioni load failed for cf', cf.id, e?.message);
    }
  }

  // Membri gruppo (candidati_gruppo) — alias storico
  state.candidati_gruppo = [];
  for (const c of state.candidati.filter((x) => x.is_gruppo)) {
    try {
      const list = await api.get('/api/membri-gruppo', { candidatoId: c.id });
      state.candidati_gruppo.push(...(list || []).map(mapMembroGruppo));
    } catch (e) {
      console.warn('membri-gruppo load failed for candidato', c.id, e?.message);
    }
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

  reload: async () => { await loadAll(); },
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
      attivo: me.attivo !== false,
      commissario: me.commissarioId || null,
      tenantId: me.tenantId,
    };
  },

  // Sincrono per compat con il legacy app.js che chiama `db.logout()` senza await,
  // poi fa subito `render()`. Lo state va svuotato PRIMA del return, l'HTTP è
  // fire-and-forget (la sessione cookie verrà invalidata server-side).
  logout() {
    pb.authStore.clear();
    state = empty();
    saveMeta();
    notify();
    api.post('/auth/logout', {}).catch(() => { /* best-effort */ });
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
    await api.delete(`/api/concorsi/${id}`);
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
    state.categorie = state.categorie.filter((c) => c.sezione_id !== id);
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
    // Aggiunte separate per le relazioni N-N
    for (const cid of commissari_ids) {
      try { await api.post(`/api/commissioni/${c.id}/commissari/${cid}`, {}); c.commissari_ids.push(cid); } catch {}
    }
    for (const sid of sezioni_ids) {
      try { await api.post(`/api/commissioni/${c.id}/sezioni/${sid}`, {}); c.sezioni_ids.push(sid); } catch {}
    }
    for (const cat of categorie_ids) {
      try { await api.post(`/api/commissioni/${c.id}/categorie/${cat}`, {}); c.categorie_ids.push(cat); } catch {}
    }
    notify();
    return c;
  },
  async updateCommissione(id, patch) {
    const body = {};
    if (patch.nome != null) body.nome = patch.nome;
    if (patch.presidente_id !== undefined) body.presidenteCommissarioId = patch.presidente_id || null;
    if (Object.keys(body).length > 0) await api.patch(`/api/commissioni/${id}`, body);

    // Riconcilia le 3 join tables in modo idempotente
    const current = state.commissioni.find((c) => c.id === id);
    if (!current) return null;
    const sync = async (relName, currentIds, newIds) => {
      if (!Array.isArray(newIds)) return currentIds;
      const cur = new Set(currentIds);
      const next = new Set(newIds);
      for (const a of cur) if (!next.has(a)) await api.delete(`/api/commissioni/${id}/${relName}/${a}`);
      for (const b of next) if (!cur.has(b)) await api.post(`/api/commissioni/${id}/${relName}/${b}`, {});
      return newIds.slice();
    };
    current.commissari_ids = await sync('commissari', current.commissari_ids, patch.commissari_ids);
    current.sezioni_ids = await sync('sezioni', current.sezioni_ids, patch.sezioni_ids);
    current.categorie_ids = await sync('categorie', current.categorie_ids, patch.categorie_ids);

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
  commissariByConcorso(concorso_id) {
    return state.commissari.filter((c) => c.concorso_id === concorso_id);
  },
  archivioCommissari() {
    // Senza colonna "archiviato": consideriamo "archivio" i commissari con stato INATTIVO
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

  // Multi-concorso (assegna/disassegna): nel nuovo modello il commissario è
  // single-concorso. Manteniamo le firme ma sono stub no-op fino a una
  // potenziale Fase 6 con re-design dello schema commissari.
  async assegnaCommissarioAConcorso(commissario_id, concorso_id) {
    return this.updateCommissario(commissario_id, {}); // no-op finché single-concorso
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
  getPresidenteFor(concorso_id) {
    const com = state.commissioni.find((c) => c.concorso_id === concorso_id && c.presidente_id);
    return com ? state.commissari.find((x) => x.id === com.presidente_id) || null : null;
  },

  // ---------- Candidati ----------
  candidatiByConcorso(concorso_id) {
    return state.candidati.filter((c) => c.concorso_id === concorso_id);
  },
  async createCandidato({ concorso_id, nome, cognome = '', strumento, data_nascita = null, nazionalita = '', foto = null, docenti_preparatori = [], sezione_id = null, categoria_id = null, tipo = 'individuale' }) {
    const numero = Math.max(0, ...state.candidati.filter((c) => c.concorso_id === concorso_id).map((c) => c.numero_candidato)) + 1;
    const r = await api.post('/api/candidati', {
      concorsoId: concorso_id,
      numeroCandidato: numero,
      nome, cognome, strumento,
      dataNascita: data_nascita || undefined,
      nazionalita,
      docentiPreparatori: docenti_preparatori,
      sezioneId: sezione_id || undefined,
      categoriaId: categoria_id || undefined,
      isGruppo: tipo === 'gruppo',
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
      docenti_preparatori: 'docentiPreparatori',
      sezione_id: 'sezioneId', categoria_id: 'categoriaId',
      numero_candidato: 'numeroCandidato',
    };
    for (const [k, v] of Object.entries(keymap)) {
      if (patch[k] !== undefined) body[v] = patch[k];
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
    notify();
  },

  // ---------- Fasi ----------
  fasiByConcorso(concorso_id) {
    return state.fasi.filter((f) => f.concorso_id === concorso_id).sort((a, b) => a.ordine - b.ordine);
  },
  async createFase({ concorso_id, nome, ammessi = null, data_prevista = null, scala = 100, modo_valutazione = 'autonoma', metodo_media = 'aritmetica', tempo_minuti = 0, pesi = null, commissione_id = null, tiebreak_strategy = null }) {
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
    });
    const f = mapFase(r);
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
    };
    for (const [k, v] of Object.entries(keymap)) {
      if (patch[k] !== undefined) body[v] = patch[k];
    }
    const r = await api.patch(`/api/fasi/${id}`, body);
    const f = mapFase(r);
    const i = state.fasi.findIndex((x) => x.id === id);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
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
    return com ? (com.commissari_ids || []) : [];
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
  async saveEnte(patch) {
    await api.patch('/api/ente', patch);
    state.ente = await api.get('/api/ente');
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
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
  },

  async concludiFase(faseId) {
    const r = await api.post(`/api/fasi/${faseId}/conclude`, {});
    const f = mapFase(r);
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
  },

  async sorteggiaFase(faseId, seed) {
    const s = Number(seed);
    if (!Number.isFinite(s)) throw new Error('sorteggiaFase: seed numerico richiesto');
    await api.post(`/api/fasi/${faseId}/sorteggio`, { seed: Math.trunc(s) });
    // Ricarica candidati_fase di questa fase per riflettere le nuove posizioni
    const list = await api.get('/api/candidati-fase', { faseId });
    state.candidati_fase = state.candidati_fase.filter((cf) => cf.fase_id !== faseId);
    state.candidati_fase.push(...(list || []).map(mapCandidatoFase));
    notify();
  },

  /**
   * Salva la valutazione di un commissario per un candidato in una fase.
   * Il legacy passa { voti: { criterio: voto } }; il backend nuovo accetta
   * una upsert per (cf, commissario, criterio): iteriamo i criteri.
   */
  async saveValutazione({ candidato_fase_id, commissario_id, voti, note = '', ammesso }) {
    if (!voti || typeof voti !== 'object') throw new Error('saveValutazione: voti richiesti');
    const saved = [];
    for (const [criterio, voto] of Object.entries(voti)) {
      if (voto == null || voto === '') continue;
      const r = await api.post('/api/valutazioni', {
        candidatoFaseId: candidato_fase_id,
        commissarioId: commissario_id,
        criterio,
        voto: Number(voto),
        note: note || undefined,
      });
      saved.push(mapValutazione(r));
    }
    // Aggiorna lo state delle valutazioni
    state.valutazioni = state.valutazioni.filter(
      (v) => !(v.candidato_fase_id === candidato_fase_id && v.commissario_id === commissario_id && voti[v.criterio] !== undefined),
    );
    state.valutazioni.push(...saved);

    // Flag ammesso opzionale (settato sul candidato_fase)
    if (typeof ammesso === 'boolean') {
      const r = await api.patch(`/api/candidati-fase/${candidato_fase_id}`, { ammessoProssimaFase: ammesso });
      const cf = mapCandidatoFase(r);
      const i = state.candidati_fase.findIndex((x) => x.id === candidato_fase_id);
      if (i >= 0) state.candidati_fase[i] = cf;
    }
    notify();
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
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
  },
  async pauseFaseTimer(faseId) {
    const r = await api.post(`/api/fasi/${faseId}/timer/pause`, {});
    const f = mapFase(r);
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
  },
  async resumeFaseTimer(faseId) {
    const r = await api.post(`/api/fasi/${faseId}/timer/resume`, {});
    const f = mapFase(r);
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
  },
  async addFaseTimerBonus(faseId, seconds = 60) {
    const r = await api.post(`/api/fasi/${faseId}/timer/bonus`, { seconds: Math.trunc(Number(seconds)) });
    const f = mapFase(r);
    const i = state.fasi.findIndex((x) => x.id === faseId);
    if (i >= 0) state.fasi[i] = f;
    notify();
    return f;
  },
  async resetFaseTimer(faseId) {
    const r = await api.post(`/api/fasi/${faseId}/timer/reset`, {});
    const f = mapFase(r);
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
          state.fasi[i] = { ...state.fasi[i], ...mapFase({ ...state.fasi[i], ...rt, id: faseId, concorsoId: state.fasi[i].concorso_id }) };
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
    const body = {
      concorsoId: payload.concorso_id,
      honeypot: payload.honeypot || undefined,
      startedAt: payload.started_at || undefined,
      nome: payload.nome,
      cognome: payload.cognome,
      email: payload.email,
      telefono: payload.telefono,
      dataNascita: payload.data_nascita || undefined,
      nazionalita: payload.nazionalita,
      strumento: payload.strumento,
      programma: payload.programma,
      docentiPreparatori: payload.docenti_preparatori,
      sezioneId: payload.sezione_id || undefined,
      categoriaId: payload.categoria_id || undefined,
      isGruppo: !!payload.is_gruppo,
      membri: payload.membri,
      tutore: payload.tutore,
      consensiGdpr: payload.consensi_gdpr,
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
