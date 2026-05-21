// PocketBase-backed runtime data layer.
// Maintains an in-memory cache (`state`) populated on init() from PB and kept
// in sync via write-through mutations (await PB → update local state → notify).
// External shape mirrors the legacy localStorage layer so views stay simple.

import { pb, pbHealthy, dataURLToBlob, fileURL, PB_URL } from './pb.js';
import { mulberry32 } from './rng.js';

const META_KEY = 'gestionale_meta_v2';

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
  candidati_gruppo: [],
  meta: { activeConcorsoId: null, role: null, currentCommissarioId: null },
});

let state = empty();
let initialized = false;

const subscribers = new Set();
export function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
function notify() { subscribers.forEach(fn => fn(state)); }

function loadMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}
function saveMeta() {
  localStorage.setItem(META_KEY, JSON.stringify(state.meta));
}

// ---------- mappers (PB record → internal shape) ----------
const safeDate = (s) => (s && typeof s === 'string') ? s.slice(0, 10) : null;
const safeISO  = (s) => s || null;
function asArr(j) {
  if (Array.isArray(j)) return j;
  if (typeof j === 'string') { try { return JSON.parse(j); } catch { return []; } }
  return [];
}

function mapConcorso(r) {
  return {
    id: r.id,
    nome: r.nome || '',
    anno: r.anno,
    presidente_id: null,
    data_inizio: safeDate(r.data_inizio),
    stato: r.stato || 'ATTIVO',
    anonimo: !!r.anonimo,
    logo_filename: r.logo || '',
    logo_url: r.logo ? fileURL(r, r.logo) : null,
    iscrizioni_aperte: !!r.iscrizioni_aperte,
    iscrizioni_chiusura: r.iscrizioni_chiusura || null,
  };
}
function mapCommissario(r) {
  return {
    id: r.id,
    concorso_id: r.concorso,
    nome: r.nome || '',
    cognome: r.cognome || '',
    specialita: r.specialita || '',
    email: r.email || '',
    telefono: r.telefono || '',
    data_nascita: safeDate(r.data_nascita),
    nazionalita: r.nazionalita || '',
    foto: r.foto ? fileURL(r, r.foto) : null,
    cv: r.cv
      ? { name: r.cv, type: r.cv.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream', dataURL: fileURL(r, r.cv) }
      : null,
    bio: r.bio || '',
    stato: r.stato || 'ATTIVO',
    is_presidente: !!r.is_presidente,
  };
}
function mapCandidato(r) {
  return {
    id: r.id,
    concorso_id: r.concorso,
    numero_candidato: r.numero_candidato,
    nome: r.nome || '',
    cognome: r.cognome || '',
    strumento: r.strumento || '',
    data_nascita: safeDate(r.data_nascita),
    nazionalita: r.nazionalita || '',
    foto: r.foto ? fileURL(r, r.foto) : null,
    docenti_preparatori: asArr(r.docenti_preparatori),
    sezioni_ids: Array.isArray(r.sezioni) ? r.sezioni : [],
    categorie_ids: Array.isArray(r.categorie) ? r.categorie : [],
    data_iscrizione: safeISO(r.data_iscrizione),
    tipo: r.tipo || 'individuale',
    eta: null,
  };
}

function mapSezione(r) {
  return {
    id: r.id,
    concorso_id: r.concorso,
    nome: r.nome || '',
    descrizione: r.descrizione || '',
    ordine: Number(r.ordine) || 0,
  };
}
function mapCategoria(r) {
  return {
    id: r.id,
    sezione_id: r.sezione,
    nome: r.nome || '',
    descrizione: r.descrizione || '',
    ordine: Number(r.ordine) || 0,
  };
}
function mapCommissione(r) {
  return {
    id: r.id,
    concorso_id: r.concorso,
    nome: r.nome || '',
    descrizione: r.descrizione || '',
    commissari_ids: Array.isArray(r.commissari) ? r.commissari : [],
    sezioni_ids: Array.isArray(r.sezioni) ? r.sezioni : [],
    categorie_ids: Array.isArray(r.categorie) ? r.categorie : [],
    include_tutte_categorie: !!r.include_tutte_categorie,
    presidente_id: r.presidente || null,
  };
}
function mapAccount(r) {
  return {
    id: r.id,
    email: r.email || '',
    nome: r.nome || '',
    cognome: r.cognome || '',
    role: r.role || 'commissario',
    commissario_id: r.commissario || null,
    attivo: r.attivo !== false,
    created: r.created || null,
  };
}
function mapFase(r) {
  return {
    id: r.id,
    concorso_id: r.concorso,
    ordine: r.ordine,
    nome: r.nome || '',
    ammessi: r.ammessi != null && r.ammessi !== 0 ? Number(r.ammessi) : null,
    data_prevista: safeDate(r.data_prevista),
    scala: Number(r.scala) || 10,
    modo_valutazione: r.modo_valutazione === 'sincrona' ? 'sincrona' : 'autonoma',
    metodo_media: r.metodo_media || 'aritmetica',
    tempo_minuti: r.tempo_minuti != null ? Number(r.tempo_minuti) : 0,
    pesi: r.pesi && typeof r.pesi === 'object' && !Array.isArray(r.pesi) ? r.pesi : null,
    criteri: Array.isArray(r.criteri) ? r.criteri : null,
    commissari_ids: Array.isArray(r.commissari_ids) ? r.commissari_ids : null,
    commissione_id: typeof r.commissione === 'string' && r.commissione ? r.commissione : null,
    sezioni_ids: Array.isArray(r.sezioni) ? r.sezioni : [],
    stato: r.stato || 'PIANIFICATA',
  };
}
function mapCandidatoFase(r) {
  return {
    id: r.id,
    fase_id: r.fase,
    candidato_id: r.candidato,
    posizione: r.posizione,
    stato: r.stato || 'IN_ATTESA',
    ammesso_prossima_fase: !!r.ammesso_prossima_fase,
  };
}
function mapValutazione(r) {
  return {
    id: r.id,
    candidato_fase_id: r.candidato_fase,
    commissario_id: r.commissario,
    criterio: r.criterio,
    voto: Number(r.voto),
    note: r.note || '',
    timestamp: safeISO(r.timestamp),
  };
}
function mapEnte(r) {
  return {
    id: r.id,
    nome: r.nome || '',
    descrizione: r.descrizione || '',
    logo_url: r.logo ? fileURL(r, r.logo) : null,
    sito_web: r.sito_web || '',
    email_contatto: r.email_contatto || '',
    telefono: r.telefono || '',
    indirizzo: r.indirizzo || '',
    colore_primario: r.colore_primario || '#4169E1',
    colore_secondario: r.colore_secondario || '#F5A623',
    impostazioni: r.impostazioni && typeof r.impostazioni === 'object' ? r.impostazioni : {},
  };
}
function mapEntePublic(r) {
  return {
    id: r.id,
    nome: r.nome || '',
    logo_url: r.logo ? fileURL(r, r.logo) : null,
    colore_primario: r.colore_primario || '#4169E1',
    colore_secondario: r.colore_secondario || '#F5A623',
  };
}
function mapCandidatoGruppo(r) {
  return {
    id: r.id,
    gruppo_id: r.gruppo,
    candidato_id: r.candidato,
    strumento_gruppo: r.strumento_gruppo || '',
  };
}
// Carica il branding pubblico (logo/nome/colori) — accessibile SENZA auth.
// Pensato per essere chiamato pre-login dalla view di login e dall'header.
async function loadEntePublic() {
  try {
    const r = await pb.collection('enti_public').getList(1, 1);
    state.ente_public = r.items.length > 0 ? mapEntePublic(r.items[0]) : null;
  } catch {
    state.ente_public = null;
  }
}

async function loadAll() {
  const [concorsi, commissari, candidati, fasi, cf, val, sez, cat, comm, acc, entiList, cg] = await Promise.all([
    pb.collection('concorsi').getFullList({ sort: 'created' }),
    pb.collection('commissari').getFullList({ sort: 'created' }),
    pb.collection('candidati').getFullList({ sort: 'numero_candidato' }),
    pb.collection('fasi').getFullList({ sort: 'ordine' }),
    pb.collection('candidati_fase').getFullList({ sort: 'posizione' }),
    pb.collection('valutazioni').getFullList(),
    pb.collection('sezioni').getFullList({ sort: 'ordine,created' }).catch(() => []),
    pb.collection('categorie').getFullList({ sort: 'ordine,created' }).catch(() => []),
    pb.collection('commissioni').getFullList({ sort: 'created' }).catch(() => []),
    // accounts: usiamo getList con perPage alto invece di getFullList per via di un
    // bug noto su SDK 0.21 + listRule misti che filtra le pagine successive.
    pb.collection('accounts').getList(1, 500, { sort: 'created' }).then(r => r.items).catch(() => []),
    pb.collection('enti').getFullList().catch(() => []),
    pb.collection('candidati_gruppo').getFullList().catch(() => []),
  ]);
  state.concorsi = concorsi.map(mapConcorso);
  state.commissari = commissari.map(mapCommissario);
  state.candidati = candidati.map(mapCandidato);
  state.fasi = fasi.map(mapFase);
  state.candidati_fase = cf.map(mapCandidatoFase);
  state.valutazioni = val.map(mapValutazione);
  state.sezioni = sez.map(mapSezione);
  state.categorie = cat.map(mapCategoria);
  state.commissioni = comm.map(mapCommissione);
  state.accounts = acc.map(mapAccount);
  state.ente = entiList.length > 0 ? mapEnte(entiList[0]) : null;
  state.candidati_gruppo = cg.map(mapCandidatoGruppo);

  state.meta = { ...empty().meta, ...loadMeta() };
  if (state.meta.activeConcorsoId && !state.concorsi.find(c => c.id === state.meta.activeConcorsoId)) {
    state.meta.activeConcorsoId = null;
  }
  if (state.meta.currentCommissarioId && !state.commissari.find(c => c.id === state.meta.currentCommissarioId)) {
    state.meta.currentCommissarioId = null;
    state.meta.role = null;
  }
  saveMeta();
  notify();
}

// Stable identity for a commissario across concorsi.
// Email match wins; fallback to normalized nome+cognome+specialita.
export function fingerprintCommissario(c) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (c?.email) return `e:${String(c.email).toLowerCase().trim()}`;
  return `n:${norm(c?.nome)}|${norm(c?.cognome)}|${norm(c?.specialita)}`;
}

function appendFileField(fd, fieldName, value, defaultName) {
  if (value === undefined) return;
  if (value === null) { fd.append(fieldName, ''); return; }
  if (typeof value === 'string' && value.startsWith('data:')) {
    const blob = dataURLToBlob(value);
    if (blob) fd.append(fieldName, blob, defaultName);
    return;
  }
  if (value && typeof value === 'object' && typeof value.dataURL === 'string' && value.dataURL.startsWith('data:')) {
    const blob = dataURLToBlob(value.dataURL);
    if (blob) fd.append(fieldName, blob, value.name || defaultName);
    return;
  }
  // existing URL (already in PB) → don't include = preserve
}

export const db = {
  get state() { return state; },
  get initialized() { return initialized; },

  init: async () => {
    if (!await pbHealthy()) {
      throw new Error('PocketBase non raggiungibile su ' + PB_URL);
    }
    // Branding pubblico: caricato SEMPRE, anche pre-login, per la pagina di login.
    await loadEntePublic();
    // Se l'utente non è autenticato, non possiamo leggere le collezioni
    // (regole di accesso richiedono auth). Mostriamo il login.
    if (!pb.authStore.isValid) {
      initialized = true;
      notify();
      return;
    }
    try {
      await pb.collection('concorsi').getList(1, 1);
    } catch (e) {
      throw new Error('Collezioni PocketBase mancanti. Esegui `./pocketbase serve --migrationsDir ./pb_migrations` o `node scripts/setup-pb.js admin password`.');
    }
    await loadAll();
    initialized = true;
  },

  reload: async () => { await loadAll(); },
  reloadEntePublic: async () => { await loadEntePublic(); notify(); },

  // ---------- Meta ----------
  setRole(role, commissarioId = null) {
    state.meta.role = role;
    state.meta.currentCommissarioId = commissarioId;
    saveMeta(); notify();
  },
  setActiveConcorso(id) {
    state.meta.activeConcorsoId = id;
    saveMeta(); notify();
  },

  // ---------- Audit log ----------
  // Best-effort: l'audit non deve MAI bloccare l'azione di business.
  // Doppio strato di sicurezza: try/catch interno + chiamanti che usano .catch().
  audit(action, { targetType = null, targetId = null, targetLabel = null, concorsoId = null, payload = null } = {}) {
    const m = pb.authStore.model || {};
    const data = {
      actor_email: m.email || '',
      actor_role:  m.role || '',
      action,
      target_type: targetType || '',
      target_id:   targetId || '',
      target_label: targetLabel || '',
      concorso_id: concorsoId || '',
      payload:     payload || null, // PB JSON field accetta oggetto; null se vuoto
    };
    // Chiamata totalmente fire-and-forget: nessuna eccezione propagata al chiamante.
    Promise.resolve().then(() => pb.collection('audit_log').create(data))
      .catch(e => console.warn('audit log failed:', e?.message || e));
  },
  async fetchAuditLog({ concorsoId = null, limit = 200 } = {}) {
    // pb.filter() applica l'escape dei valori; evita di costruire stringhe a mano.
    const filter = concorsoId ? pb.filter('concorso_id = {:cid}', { cid: concorsoId }) : '';
    const list = await pb.collection('audit_log').getList(1, limit, {
      sort: '-created',
      filter,
    });
    return list.items;
  },

  // ---------- Concorsi ----------
  async createConcorso({ nome, anno, data_inizio = null, logo = undefined }) {
    const fd = new FormData();
    fd.append('nome', nome);
    fd.append('anno', String(Number(anno) || new Date().getFullYear()));
    fd.append('data_inizio', data_inizio || '');
    fd.append('stato', 'ATTIVO');
    appendFileField(fd, 'logo', logo, 'logo.png');
    const rec = await pb.collection('concorsi').create(fd);
    const c = mapConcorso(rec);
    state.concorsi.push(c);
    notify();
    this.audit('concorso.create', { targetType: 'concorso', targetId: c.id, targetLabel: c.nome, concorsoId: c.id, payload: { anno: c.anno } });
    return c;
  },
  async updateConcorso(id, patch) {
    let rec;
    if ('logo' in patch) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'logo') continue;
        fd.append(k, v == null ? '' : (typeof v === 'boolean' ? String(v) : String(v)));
      }
      appendFileField(fd, 'logo', patch.logo, 'logo.png');
      rec = await pb.collection('concorsi').update(id, fd);
    } else {
      rec = await pb.collection('concorsi').update(id, patch);
    }
    const c = mapConcorso(rec);
    const idx = state.concorsi.findIndex(x => x.id === id);
    if (idx >= 0) state.concorsi[idx] = c;
    notify();
    return c;
  },
  async deleteConcorso(id) {
    const c = state.concorsi.find(x => x.id === id);
    await pb.collection('concorsi').delete(id);
    // Cleanup ottimistico locale: PB cascade-delete-a i figli lato server, qui
    // riallineiamo subito lo state per evitare schermate stale se loadAll fallisce.
    state.concorsi = state.concorsi.filter(x => x.id !== id);
    state.fasi = state.fasi.filter(f => f.concorso_id !== id);
    state.candidati = state.candidati.filter(x => x.concorso_id !== id);
    state.commissari = state.commissari.filter(x => x.concorso_id !== id);
    state.sezioni = state.sezioni.filter(x => x.concorso_id !== id);
    state.commissioni = state.commissioni.filter(x => x.concorso_id !== id);
    const validFaseIds = new Set(state.fasi.map(f => f.id));
    state.candidati_fase = state.candidati_fase.filter(cf => validFaseIds.has(cf.fase_id));
    const validCfIds = new Set(state.candidati_fase.map(cf => cf.id));
    state.valutazioni = state.valutazioni.filter(v => validCfIds.has(v.candidato_fase_id));
    if (state.meta.activeConcorsoId === id) {
      state.meta.activeConcorsoId = null;
      saveMeta();
    }
    // Se il commissario corrente apparteneva a questo concorso, esce dal ruolo.
    if (state.meta.role === 'commissario' && state.meta.currentCommissarioId
        && !state.commissari.find(cm => cm.id === state.meta.currentCommissarioId)) {
      state.meta.currentCommissarioId = null;
      state.meta.role = null;
      saveMeta();
    }
    notify();
    // Resync best-effort dal server (per coerenza con state aggregato lato PB).
    loadAll().catch(e => console.warn('reload after deleteConcorso failed:', e?.message));
    this.audit('concorso.delete', { targetType: 'concorso', targetId: id, targetLabel: c?.nome });
  },

  // ---------- Fasi ----------
  fasiByConcorso(concorso_id) {
    return state.fasi.filter(f => f.concorso_id === concorso_id).sort((a,b) => a.ordine - b.ordine);
  },
  async createFase({ concorso_id, nome, ammessi = null, data_prevista = null, scala = 10, modo_valutazione = 'autonoma', metodo_media = 'aritmetica', tempo_minuti = 0, pesi = null, criteri = null, commissari_ids = null, commissione_id = null, sezioni_ids = null }) {
    const ordine = state.fasi.filter(f => f.concorso_id === concorso_id).length + 1;
    const validMetodi = ['aritmetica','olimpica','winsorizzata','mediana','deviazione_std'];
    let cleanCriteri = null;
    if (Array.isArray(criteri) && criteri.length > 0) {
      cleanCriteri = criteri
        .map((c, i) => ({
          key: String(c.key || '').trim() || `crit_${i+1}`,
          label: String(c.label || '').trim() || `Criterio ${i+1}`,
          peso: Math.max(0, Number(c.peso) || 0),
        }))
        .filter(c => c.label);
    }
    const data = {
      concorso: concorso_id,
      ordine,
      nome,
      ammessi: ammessi == null || ammessi === '' ? null : Number(ammessi),
      data_prevista: data_prevista || '',
      scala: Number(scala) || 10,
      modo_valutazione: modo_valutazione === 'sincrona' ? 'sincrona' : 'autonoma',
      metodo_media: validMetodi.includes(metodo_media) ? metodo_media : 'aritmetica',
      tempo_minuti: Math.max(0, Math.min(600, Math.round(Number(tempo_minuti) || 0))),
      pesi: pesi || null,
      criteri: cleanCriteri,
      commissari_ids: Array.isArray(commissari_ids) ? commissari_ids : null,
      commissione: commissione_id || '',
      sezioni: Array.isArray(sezioni_ids) ? sezioni_ids : [],
      stato: 'PIANIFICATA',
    };
    const rec = await pb.collection('fasi').create(data);
    const f = mapFase(rec);
    state.fasi.push(f);
    notify();
    return f;
  },
  async updateFase(id, patch) {
    const data = { ...patch };
    if ('ammessi' in data && (data.ammessi === '' || data.ammessi == null)) data.ammessi = null;
    if ('sezioni_ids' in data) { data.sezioni = Array.isArray(data.sezioni_ids) ? data.sezioni_ids : []; delete data.sezioni_ids; }
    if ('commissione_id' in data) { data.commissione = data.commissione_id || ''; delete data.commissione_id; }
    const rec = await pb.collection('fasi').update(id, data);
    const f = mapFase(rec);
    const idx = state.fasi.findIndex(x => x.id === id);
    if (idx >= 0) state.fasi[idx] = f;
    notify();
    return f;
  },
  async deleteFase(id) {
    await pb.collection('fasi').delete(id);
    await loadAll();
  },
  async reorderFasi(concorso_id, idsInOrder) {
    for (let i = 0; i < idsInOrder.length; i++) {
      await pb.collection('fasi').update(idsInOrder[i], { ordine: i + 1 });
      const f = state.fasi.find(x => x.id === idsInOrder[i]);
      if (f) f.ordine = i + 1;
    }
    notify();
  },
  async setPesiFase(faseId, pesi) {
    const rec = await pb.collection('fasi').update(faseId, { pesi });
    const f = mapFase(rec);
    const idx = state.fasi.findIndex(x => x.id === faseId);
    if (idx >= 0) state.fasi[idx] = f;
    notify();
  },
  getFaseCommissariIds(fase) {
    if (!fase) return [];
    // Priority 1: commissione assigned to the fase → use its members
    if (fase.commissione_id) {
      const com = state.commissioni.find(c => c.id === fase.commissione_id);
      if (com && Array.isArray(com.commissari_ids) && com.commissari_ids.length > 0) {
        return com.commissari_ids.filter(id => state.commissari.some(c => c.id === id));
      }
    }
    // Priority 2: explicit commissari list
    if (Array.isArray(fase.commissari_ids) && fase.commissari_ids.length > 0) {
      return fase.commissari_ids.filter(id => state.commissari.some(c => c.id === id));
    }
    // Fallback: all commissari of the concorso
    return state.commissari.filter(c => c.concorso_id === fase.concorso_id).map(c => c.id);
  },

  // ---------- Candidati ----------
  candidatiByConcorso(concorso_id) {
    return state.candidati
      .filter(c => c.concorso_id === concorso_id)
      .sort((a,b) => a.numero_candidato - b.numero_candidato);
  },
  async createCandidato({ concorso_id, nome, cognome = '', strumento, data_nascita = null, nazionalita = '', foto = null, docenti_preparatori = [], sezioni_ids = [], categorie_ids = [], tipo = 'individuale' }) {
    const numero = state.candidati.filter(c => c.concorso_id === concorso_id).length + 1;
    const docenti = Array.isArray(docenti_preparatori)
      ? docenti_preparatori
      : String(docenti_preparatori || '').split('\n').map(s => s.trim()).filter(Boolean);
    const fd = new FormData();
    fd.append('concorso', concorso_id);
    fd.append('numero_candidato', String(numero));
    fd.append('nome', nome);
    fd.append('cognome', cognome || '');
    fd.append('strumento', strumento);
    if (data_nascita) fd.append('data_nascita', data_nascita);
    fd.append('nazionalita', nazionalita || '');
    fd.append('tipo', tipo || 'individuale');
    fd.append('docenti_preparatori', JSON.stringify(docenti));
    fd.append('data_iscrizione', new Date().toISOString());
    if (Array.isArray(sezioni_ids)) sezioni_ids.forEach(id => fd.append('sezioni', id));
    if (Array.isArray(categorie_ids)) categorie_ids.forEach(id => fd.append('categorie', id));
    appendFileField(fd, 'foto', foto, 'foto.jpg');
    const rec = await pb.collection('candidati').create(fd);
    const c = mapCandidato(rec);
    state.candidati.push(c);
    notify();
    return c;
  },
  async updateCandidato(id, patch) {
    const fd = new FormData();
    const fields = ['nome','cognome','strumento','data_nascita','nazionalita'];
    for (const f of fields) if (f in patch) fd.append(f, patch[f] == null ? '' : String(patch[f]));
    if ('docenti_preparatori' in patch) {
      const arr = Array.isArray(patch.docenti_preparatori)
        ? patch.docenti_preparatori
        : String(patch.docenti_preparatori || '').split('\n').map(s => s.trim()).filter(Boolean);
      fd.append('docenti_preparatori', JSON.stringify(arr));
    }
    if ('sezioni_ids' in patch) {
      // Empty array → set to empty (no append). Append empty value to clear field.
      if (Array.isArray(patch.sezioni_ids) && patch.sezioni_ids.length > 0) {
        patch.sezioni_ids.forEach(sid => fd.append('sezioni', sid));
      } else {
        fd.append('sezioni', '');
      }
    }
    if ('categorie_ids' in patch) {
      if (Array.isArray(patch.categorie_ids) && patch.categorie_ids.length > 0) {
        patch.categorie_ids.forEach(cid => fd.append('categorie', cid));
      } else {
        fd.append('categorie', '');
      }
    }
    if ('foto' in patch) appendFileField(fd, 'foto', patch.foto, 'foto.jpg');
    const rec = await pb.collection('candidati').update(id, fd);
    const c = mapCandidato(rec);
    const idx = state.candidati.findIndex(x => x.id === id);
    if (idx >= 0) state.candidati[idx] = c;
    notify();
    return c;
  },
  async deleteCandidato(id) {
    await pb.collection('candidati').delete(id);
    await loadAll();
  },

  // ---------- Commissari ----------
  commissariByConcorso(concorso_id) {
    return state.commissari.filter(c => c.concorso_id === concorso_id);
  },
  async createCommissario({ concorso_id, nome, cognome = '', specialita = '', email = '', telefono = '', data_nascita = null, nazionalita = '', foto = null, cv = null, bio = '', is_presidente = false }) {
    // If marking as presidente, demote any existing one in the same concorso first.
    // Best-effort: leggiamo lo stato FRESCO da PB (non cache) per ridurre la finestra di race
    // tra due admin che marcano presidenti diversi quasi simultaneamente. L'unicità non è
    // garantita dal DB; un constraint a livello PB-hook sarebbe la soluzione corretta.
    if (is_presidente) {
      const fresh = await pb.collection('commissari').getList(1, 50, {
        filter: pb.filter('concorso = {:c} && is_presidente = true', { c: concorso_id }),
      }).then(r => r.items).catch(() => []);
      for (const o of fresh) {
        await pb.collection('commissari').update(o.id, { is_presidente: false });
        const local = state.commissari.find(x => x.id === o.id);
        if (local) local.is_presidente = false;
      }
    }
    const fd = new FormData();
    fd.append('concorso', concorso_id);
    fd.append('nome', nome);
    fd.append('cognome', cognome || '');
    fd.append('specialita', specialita || '');
    fd.append('email', email || '');
    fd.append('telefono', telefono || '');
    if (data_nascita) fd.append('data_nascita', data_nascita);
    fd.append('nazionalita', nazionalita || '');
    fd.append('bio', bio || '');
    fd.append('stato', 'ATTIVO');
    fd.append('is_presidente', is_presidente ? 'true' : 'false');
    appendFileField(fd, 'foto', foto, 'foto.jpg');
    appendFileField(fd, 'cv', cv, cv?.name || 'cv');
    const rec = await pb.collection('commissari').create(fd);
    const c = mapCommissario(rec);
    state.commissari.push(c);
    notify();
    return c;
  },
  async updateCommissario(id, patch) {
    // Enforce single presidente per concorso. Vedi nota in createCommissario:
    // l'unicità non è garantita dal DB; usiamo il PB come fonte autoritativa.
    if (patch.is_presidente === true) {
      const com = state.commissari.find(c => c.id === id);
      if (com) {
        const fresh = await pb.collection('commissari').getList(1, 50, {
          filter: pb.filter('concorso = {:c} && is_presidente = true && id != {:id}', { c: com.concorso_id, id }),
        }).then(r => r.items).catch(() => []);
        for (const o of fresh) {
          await pb.collection('commissari').update(o.id, { is_presidente: false });
          const local = state.commissari.find(x => x.id === o.id);
          if (local) local.is_presidente = false;
        }
      }
    }
    const fd = new FormData();
    const fields = ['nome','cognome','specialita','email','telefono','data_nascita','nazionalita','bio'];
    for (const f of fields) if (f in patch) fd.append(f, patch[f] == null ? '' : String(patch[f]));
    if ('is_presidente' in patch) fd.append('is_presidente', patch.is_presidente ? 'true' : 'false');
    if ('foto' in patch) appendFileField(fd, 'foto', patch.foto, 'foto.jpg');
    if ('cv' in patch) appendFileField(fd, 'cv', patch.cv, patch.cv?.name || 'cv');
    const rec = await pb.collection('commissari').update(id, fd);
    const c = mapCommissario(rec);
    const idx = state.commissari.findIndex(x => x.id === id);
    if (idx >= 0) state.commissari[idx] = c;
    notify();
    return c;
  },
  // Presidente di una specifica commissione (relation in `commissioni.presidente`).
  // Ritorna il record commissario, oppure null se la commissione non ha presidente.
  getPresidenteForCommissione(commissione_or_id) {
    const com = typeof commissione_or_id === 'string'
      ? state.commissioni.find(c => c.id === commissione_or_id)
      : commissione_or_id;
    if (!com || !com.presidente_id) return null;
    return state.commissari.find(c => c.id === com.presidente_id) || null;
  },

  // Presidente che pilota una specifica fase: viene letto dalla commissione
  // assegnata alla fase. Se la fase non ha commissione assegnata o la commissione
  // non ha presidente, ritorna null (il pannello presidente non viene mostrato).
  getPresidenteForFase(fase) {
    if (!fase || !fase.commissione_id) return null;
    return this.getPresidenteForCommissione(fase.commissione_id);
  },

  // Controlla se un commissario è presidente di ALMENO una commissione
  // (di qualunque concorso). Usato dai badge UI (palette, home, card admin).
  isPresidenteDiQualcheCommissione(commissario_id) {
    if (!commissario_id) return false;
    return state.commissioni.some(c => c.presidente_id === commissario_id);
  },

  // Backward-compat: ritorna il PRIMO presidente di una qualsiasi commissione
  // del concorso (usato dall'header admin per mostrare "Presidente: X" quando
  // l'admin sta configurando il concorso senza ancora aver scelto una fase
  // specifica). Da deprecare in futuro.
  getPresidenteFor(concorso_id) {
    const presidentIds = new Set(
      state.commissioni
        .filter(c => c.concorso_id === concorso_id && c.presidente_id)
        .map(c => c.presidente_id)
    );
    for (const id of presidentIds) {
      const com = state.commissari.find(c => c.id === id);
      if (com) return com;
    }
    return null;
  },
  // Build a deduplicated archive view across all concorsi.
  // Two commissari with the same email (or same nome+cognome+specialita) are
  // collapsed into a single archive entry. The "best" record (with most fields
  // filled) becomes the canonical, while concorsi_ids lists every concorso it
  // appears in.
  getArchivioCommissari() {
    const groups = new Map();
    for (const c of state.commissari) {
      const key = fingerprintCommissario(c);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const score = (x) => (x.foto?1:0) + (x.cv?1:0) + (x.bio?1:0) + (x.email?1:0) + (x.telefono?1:0) + (x.data_nascita?1:0);
    const result = [];
    for (const [key, records] of groups) {
      const sorted = records.slice().sort((a,b) => score(b) - score(a));
      const canonical = sorted[0];
      result.push({
        ...canonical,
        fingerprint: key,
        concorsi_ids: records.map(r => r.concorso_id),
        record_ids: records.map(r => r.id),
      });
    }
    return result;
  },
  async deleteCommissario(id) {
    await pb.collection('commissari').delete(id);
    await loadAll();
  },

  // ---------- Candidati Fase ----------
  candidatiFaseList(faseId) {
    return state.candidati_fase.filter(cf => cf.fase_id === faseId).sort((a,b) => a.posizione - b.posizione);
  },
  // Find the previous fase in the same "scope chain":
  //   - If the current fase is shared (no sezioni_ids), any earlier fase is its predecessor.
  //   - If scoped to sezioni S, the previous fase must be either shared or share at least one sezione with S.
  // This way fasi specifiche per sezione possono procedere su tracce parallele.
  findPreviousFaseInChain(fase) {
    const fasiCorso = this.fasiByConcorso(fase.concorso_id);
    const myScope = Array.isArray(fase.sezioni_ids) ? fase.sezioni_ids : [];
    const isMyShared = myScope.length === 0;
    const earlier = fasiCorso.filter(f => f.ordine < fase.ordine).sort((a,b) => b.ordine - a.ordine);
    for (const prev of earlier) {
      const prevScope = Array.isArray(prev.sezioni_ids) ? prev.sezioni_ids : [];
      const isPrevShared = prevScope.length === 0;
      if (isMyShared || isPrevShared) return prev;
      if (prevScope.some(s => myScope.includes(s))) return prev;
    }
    return null;
  },
  async startFase(faseId) {
    const fase = state.fasi.find(f => f.id === faseId);
    if (!fase) return;
    if (fase.stato !== 'PIANIFICATA') return;

    const prev = this.findPreviousFaseInChain(fase);
    if (prev && prev.stato !== 'CONCLUSA') {
      throw new Error(`Devi prima concludere la fase precedente: ${prev.nome}`);
    }

    const myScope = Array.isArray(fase.sezioni_ids) ? fase.sezioni_ids : [];
    const filterByScope = (cands) => myScope.length === 0
      ? cands
      : cands.filter(c => Array.isArray(c.sezioni_ids) && c.sezioni_ids.some(s => myScope.includes(s)));

    let candidatiAmmessi = [];
    if (!prev) {
      // First fase in this scope chain → tutti i candidati del concorso, filtrati per scope
      candidatiAmmessi = filterByScope(this.candidatiByConcorso(fase.concorso_id));
    } else {
      const prevCfs = state.candidati_fase
        .filter(cf => cf.fase_id === prev.id && cf.ammesso_prossima_fase)
        .sort((a,b) => a.posizione - b.posizione);
      candidatiAmmessi = filterByScope(
        prevCfs.map(cf => state.candidati.find(c => c.id === cf.candidato_id)).filter(Boolean)
      );
    }
    const existing = state.candidati_fase.filter(cf => cf.fase_id === faseId);
    if (existing.length === 0) {
      for (let i = 0; i < candidatiAmmessi.length; i++) {
        const cand = candidatiAmmessi[i];
        const rec = await pb.collection('candidati_fase').create({
          fase: faseId,
          candidato: cand.id,
          posizione: i + 1,
          stato: 'IN_ATTESA',
          ammesso_prossima_fase: false,
        });
        state.candidati_fase.push(mapCandidatoFase(rec));
      }
    }
    const rec = await pb.collection('fasi').update(faseId, { stato: 'IN_CORSO' });
    const updated = mapFase(rec);
    const fIdx = state.fasi.findIndex(x => x.id === faseId);
    if (fIdx >= 0) state.fasi[fIdx] = updated;
    notify();
    this.audit('fase.start', { targetType: 'fase', targetId: faseId, targetLabel: updated.nome, concorsoId: updated.concorso_id });
  },
  // ---------- Fase runtime (timer sincronizzato) ----------
  async getFaseRuntime(faseId) {
    try {
      return await pb.collection('fase_runtime').getFirstListItem(pb.filter('fase = {:f}', { f: faseId }));
    } catch (e) {
      if (e?.status === 404) return null;
      throw e;
    }
  },
  async upsertFaseRuntime(faseId, fields) {
    const existing = await this.getFaseRuntime(faseId);
    if (existing) {
      return await pb.collection('fase_runtime').update(existing.id, fields);
    }
    return await pb.collection('fase_runtime').create({ fase: faseId, ...fields });
  },
  // Avvia (o re-avvia) il timer per il candidato corrente. Auto-chiamato dal
  // presidente quando cambia candidato. duration_seconds = fase.tempo_minuti*60.
  async startFaseTimer(faseId, candidatoFaseId) {
    const fase = state.fasi.find(f => f.id === faseId);
    if (!fase) throw new Error('Fase non trovata');
    const dur = (Number(fase.tempo_minuti) || 0) * 60;
    if (dur <= 0) return null; // timer disabilitato per questa fase
    const now = new Date().toISOString();
    return await this.upsertFaseRuntime(faseId, {
      candidato_fase: candidatoFaseId || '',
      started_at: now,
      paused_at: '',
      duration_seconds: dur,
    });
  },
  async pauseFaseTimer(faseId) {
    const r = await this.getFaseRuntime(faseId);
    if (!r || r.paused_at) return r;
    return await pb.collection('fase_runtime').update(r.id, {
      paused_at: new Date().toISOString(),
    });
  },
  async resumeFaseTimer(faseId) {
    const r = await this.getFaseRuntime(faseId);
    if (!r || !r.paused_at) return r;
    // Sposta started_at in avanti del tempo trascorso in pausa, poi azzera paused_at.
    const pauseDelta = Date.now() - new Date(r.paused_at).getTime();
    const newStart = new Date(new Date(r.started_at).getTime() + pauseDelta).toISOString();
    return await pb.collection('fase_runtime').update(r.id, {
      started_at: newStart,
      paused_at: '',
    });
  },
  async addFaseTimerBonus(faseId, seconds = 60) {
    const r = await this.getFaseRuntime(faseId);
    if (!r) return null;
    const updated = await pb.collection('fase_runtime').update(r.id, {
      duration_seconds: (Number(r.duration_seconds) || 0) + seconds,
    });
    this.audit('fase.timer_bonus', {
      targetType: 'fase', targetId: faseId,
      payload: { seconds },
    });
    return updated;
  },
  async resetFaseTimer(faseId) {
    const r = await this.getFaseRuntime(faseId);
    if (!r) return null;
    const fase = state.fasi.find(f => f.id === faseId);
    const dur = (Number(fase?.tempo_minuti) || 0) * 60;
    return await pb.collection('fase_runtime').update(r.id, {
      started_at: new Date().toISOString(),
      paused_at: '',
      duration_seconds: dur,
    });
  },
  async clearFaseTimer(faseId) {
    const r = await this.getFaseRuntime(faseId);
    if (r) await pb.collection('fase_runtime').delete(r.id);
  },
  // Sottoscrive le mutazioni del runtime per UNA fase. onChange riceve il record (o null se cancellato).
  // Restituisce una funzione di unsubscribe.
  async subscribeFaseRuntime(faseId, onChange) {
    // Manda subito lo stato corrente
    try { onChange(await this.getFaseRuntime(faseId)); }
    catch (e) { console.warn('runtime fetch:', e.message); }
    const handler = (e) => {
      if (e?.record?.fase === faseId) {
        onChange(e.action === 'delete' ? null : e.record);
      }
    };
    await pb.collection('fase_runtime').subscribe('*', handler);
    return async () => {
      try { await pb.collection('fase_runtime').unsubscribe('*'); } catch { /* ignore */ }
    };
  },

  async sorteggiaFase(faseId, seed) {
    // Riordina i candidati_fase di una fase con shuffle Fisher-Yates seedato (mulberry32).
    const fase = state.fasi.find(f => f.id === faseId);
    if (!fase) throw new Error('Fase non trovata');
    if (fase.stato === 'CONCLUSA') throw new Error('La fase è già conclusa: l\'ordine non si può più cambiare');
    const cfs = state.candidati_fase.filter(cf => cf.fase_id === faseId);
    if (cfs.length === 0) throw new Error('Nessun candidato in questa fase. Avvia la fase per popolare l\'elenco.');

    // Resolve seed → 32bit unsigned
    const usedSeed = (seed != null && seed !== '')
      ? (Number(seed) >>> 0)
      : (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0);
    const rand = mulberry32(usedSeed);

    // Fisher–Yates shuffle (immutable copy)
    const order = [...cfs];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    // Persist new positions
    for (let i = 0; i < order.length; i++) {
      const cf = order[i];
      const newPos = i + 1;
      if (cf.posizione === newPos) continue;
      const rec = await pb.collection('candidati_fase').update(cf.id, { posizione: newPos });
      const idx = state.candidati_fase.findIndex(x => x.id === cf.id);
      if (idx >= 0) state.candidati_fase[idx] = mapCandidatoFase(rec);
    }
    notify();
this.audit('fase.sorteggio', {
    targetType: 'fase', targetId: faseId, targetLabel: fase.nome,
    concorsoId: fase.concorso_id,
    payload: { seed: usedSeed, count: order.length },
  });
  return { seed: usedSeed, order: order.map((cf, i) => ({ candidato_fase_id: cf.id, candidato_id: cf.candidato_id, posizione: i + 1 })) };
},

async riordinaCandidatiFase(faseId, idsInOrder) {
    const results = await Promise.all(idsInOrder.map((id, i) =>
      pb.collection('candidati_fase').update(id, { posizione: i + 1 })
    ));
    for (const rec of results) {
      const idx = state.candidati_fase.findIndex(x => x.id === rec.id);
      if (idx >= 0) state.candidati_fase[idx] = mapCandidatoFase(rec);
    }
    notify();
  },

  async concludiFase(faseId) {
    const rec = await pb.collection('fasi').update(faseId, { stato: 'CONCLUSA' });
    const f = mapFase(rec);
    const idx = state.fasi.findIndex(x => x.id === faseId);
    if (idx >= 0) state.fasi[idx] = f;
    notify();
    // Pulisci runtime timer (se presente) — non blocca in caso di errore.
    this.clearFaseTimer(faseId).catch(() => {});
    this.audit('fase.complete', { targetType: 'fase', targetId: faseId, targetLabel: f.nome, concorsoId: f.concorso_id });
  },

  // ---------- Valutazioni ----------
  valutazioniByCandidatoFase(candidato_fase_id) {
    return state.valutazioni.filter(v => v.candidato_fase_id === candidato_fase_id);
  },
  async saveValutazione({ candidato_fase_id, commissario_id, voti, note = '', ammesso }) {
    for (const [criterio, voto] of Object.entries(voti)) {
      const existing = state.valutazioni.find(v =>
        v.candidato_fase_id === candidato_fase_id &&
        v.commissario_id === commissario_id &&
        v.criterio === criterio
      );
      const data = {
        candidato_fase: candidato_fase_id,
        commissario: commissario_id,
        criterio,
        voto: Number(voto),
        note,
        timestamp: new Date().toISOString(),
      };
      if (existing) {
        const rec = await pb.collection('valutazioni').update(existing.id, data);
        const i = state.valutazioni.findIndex(v => v.id === existing.id);
        state.valutazioni[i] = mapValutazione(rec);
      } else {
        const rec = await pb.collection('valutazioni').create(data);
        state.valutazioni.push(mapValutazione(rec));
      }
    }
    const rec = await pb.collection('candidati_fase').update(candidato_fase_id, {
      stato: 'COMPLETATO',
      ammesso_prossima_fase: !!ammesso,
    });
    const idx = state.candidati_fase.findIndex(x => x.id === candidato_fase_id);
    if (idx >= 0) state.candidati_fase[idx] = mapCandidatoFase(rec);
    notify();
  },

  // ---------- Sezioni ----------
  sezioniByConcorso(concorso_id) {
    return state.sezioni.filter(s => s.concorso_id === concorso_id).sort((a,b) => (a.ordine||0) - (b.ordine||0) || a.nome.localeCompare(b.nome));
  },
  async createSezione({ concorso_id, nome, descrizione = '' }) {
    const ordine = state.sezioni.filter(s => s.concorso_id === concorso_id).length + 1;
    const rec = await pb.collection('sezioni').create({ concorso: concorso_id, nome, descrizione, ordine });
    const s = mapSezione(rec);
    state.sezioni.push(s);
    notify();
    return s;
  },
  async updateSezione(id, patch) {
    const rec = await pb.collection('sezioni').update(id, patch);
    const s = mapSezione(rec);
    const idx = state.sezioni.findIndex(x => x.id === id);
    if (idx >= 0) state.sezioni[idx] = s;
    notify();
    return s;
  },
  async deleteSezione(id) {
    await pb.collection('sezioni').delete(id);
    await loadAll();
  },

  // ---------- Categorie ----------
  categorieBySezione(sezione_id) {
    return state.categorie.filter(c => c.sezione_id === sezione_id).sort((a,b) => (a.ordine||0) - (b.ordine||0) || a.nome.localeCompare(b.nome));
  },
  categorieByConcorso(concorso_id) {
    const sezIds = new Set(state.sezioni.filter(s => s.concorso_id === concorso_id).map(s => s.id));
    return state.categorie.filter(c => sezIds.has(c.sezione_id));
  },
  async createCategoria({ sezione_id, nome, descrizione = '' }) {
    const ordine = state.categorie.filter(c => c.sezione_id === sezione_id).length + 1;
    const rec = await pb.collection('categorie').create({ sezione: sezione_id, nome, descrizione, ordine });
    const c = mapCategoria(rec);
    state.categorie.push(c);
    notify();
    return c;
  },
  async updateCategoria(id, patch) {
    const rec = await pb.collection('categorie').update(id, patch);
    const c = mapCategoria(rec);
    const idx = state.categorie.findIndex(x => x.id === id);
    if (idx >= 0) state.categorie[idx] = c;
    notify();
    return c;
  },
  async deleteCategoria(id) {
    await pb.collection('categorie').delete(id);
    await loadAll();
  },
  // Copia le categorie di una sezione sorgente in una o più sezioni destinazione.
  //   - skipDuplicates: true (default) → non duplica categorie con nome già presente
  //     nella sezione destinazione (case-insensitive).
  //   - Le categorie vengono create con ordine incrementale dopo quelle esistenti.
  // Ritorna { created: N, skipped: N } aggregato su tutte le destinazioni.
  async copyCategorieToSezioni({ from_sezione_id, to_sezioni_ids = [], skipDuplicates = true }) {
    if (!from_sezione_id) throw new Error('Sezione sorgente mancante.');
    const srcCats = state.categorie.filter(c => c.sezione_id === from_sezione_id);
    if (srcCats.length === 0) throw new Error('La sezione sorgente non ha categorie.');
    let created = 0, skipped = 0;
    for (const destId of to_sezioni_ids) {
      if (!destId || destId === from_sezione_id) continue;
      const existingNames = new Set(
        state.categorie.filter(c => c.sezione_id === destId).map(c => (c.nome || '').toLowerCase().trim())
      );
      let nextOrdine = state.categorie.filter(c => c.sezione_id === destId).length + 1;
      for (const cat of srcCats) {
        const key = (cat.nome || '').toLowerCase().trim();
        if (skipDuplicates && existingNames.has(key)) { skipped++; continue; }
        const rec = await pb.collection('categorie').create({
          sezione: destId,
          nome: cat.nome,
          descrizione: cat.descrizione || '',
          ordine: nextOrdine++,
        });
        state.categorie.push(mapCategoria(rec));
        existingNames.add(key);
        created++;
      }
    }
    notify();
    this.audit('categorie.copy', {
      targetType: 'sezione', targetId: from_sezione_id, targetLabel: (state.sezioni.find(s => s.id === from_sezione_id)?.nome || ''),
      payload: { from: from_sezione_id, to: to_sezioni_ids, created, skipped },
    });
    return { created, skipped };
  },

  // ---------- Commissioni ----------
  commissioniByConcorso(concorso_id) {
    return state.commissioni.filter(c => c.concorso_id === concorso_id);
  },
  // Returns the list of all categorie effectively assigned to a commissione,
  // expanding the sezioni-with-include flag.
  effectiveCategorieForCommissione(commissione) {
    const direct = new Set(commissione.categorie_ids || []);
    if (commissione.include_tutte_categorie && Array.isArray(commissione.sezioni_ids)) {
      for (const sid of commissione.sezioni_ids) {
        for (const cat of state.categorie.filter(c => c.sezione_id === sid)) {
          direct.add(cat.id);
        }
      }
    }
    return Array.from(direct);
  },
  async createCommissione({ concorso_id, nome, descrizione = '', commissari_ids = [], sezioni_ids = [], categorie_ids = [], include_tutte_categorie = false, presidente_id = null }) {
    const data = {
      concorso: concorso_id,
      nome, descrizione,
      commissari: commissari_ids,
      sezioni: sezioni_ids,
      categorie: categorie_ids,
      include_tutte_categorie: !!include_tutte_categorie,
      presidente: presidente_id || '',
    };
    const rec = await pb.collection('commissioni').create(data);
    const c = mapCommissione(rec);
    state.commissioni.push(c);
    notify();
    return c;
  },
  async updateCommissione(id, patch) {
    const data = { ...patch };
    if ('commissari_ids' in data) { data.commissari = data.commissari_ids; delete data.commissari_ids; }
    if ('sezioni_ids' in data) { data.sezioni = data.sezioni_ids; delete data.sezioni_ids; }
    if ('categorie_ids' in data) { data.categorie = data.categorie_ids; delete data.categorie_ids; }
    if ('presidente_id' in data) { data.presidente = data.presidente_id || ''; delete data.presidente_id; }
    const rec = await pb.collection('commissioni').update(id, data);
    const c = mapCommissione(rec);
    const idx = state.commissioni.findIndex(x => x.id === id);
    if (idx >= 0) state.commissioni[idx] = c;
    notify();
    return c;
  },
  async deleteCommissione(id) {
    await pb.collection('commissioni').delete(id);
    state.commissioni = state.commissioni.filter(c => c.id !== id);
    notify();
  },

  // ---------- Accounts (auth) ----------
  getAccountForCommissario(commissario_id) {
    return state.accounts.find(a => a.commissario_id === commissario_id) || null;
  },
  async createAccount({ email, password, nome = '', cognome = '', role, commissario_id = null, attivo = true }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    // Pre-check: PB risponde con il generico "Failed to create record" su collisione email.
    // Interroghiamo prima la collezione per dare un errore comprensibile.
    try {
      const existing = await pb.collection('accounts').getFirstListItem(pb.filter('email = {:e}', { e: cleanEmail }));
      if (existing) {
        const err = new Error('email_taken');
        err.code = 'email_taken';
        err.existingId = existing.id;
        throw err;
      }
    } catch (e) {
      if (e?.code === 'email_taken') throw e;
      // 404 = nessuna collisione; altri errori (rete, auth) li lasciamo emergere
      if (e?.status && e.status !== 404) throw e;
    }
    const data = {
      email: cleanEmail, password, passwordConfirm: password,
      nome, cognome, role,
      attivo,
      emailVisibility: true,
    };
    if (commissario_id) data.commissario = commissario_id;
    const rec = await pb.collection('accounts').create(data);
    state.accounts.push(mapAccount(rec));
    notify();
    this.audit('account.create', { targetType: 'account', targetId: rec.id, targetLabel: cleanEmail, payload: { role } });
    return mapAccount(rec);
  },
  async updateAccount(id, patch) {
    const data = { ...patch };
    if ('commissario_id' in data) { data.commissario = data.commissario_id || null; delete data.commissario_id; }
    // Se il ruolo cambia da commissario a admin/superadmin, scollega il record commissario.
    if ('role' in data && data.role && data.role !== 'commissario' && !('commissario' in data)) {
      data.commissario = null;
    }
    const rec = await pb.collection('accounts').update(id, data);
    const idx = state.accounts.findIndex(a => a.id === id);
    if (idx >= 0) state.accounts[idx] = mapAccount(rec);
    notify();
    return mapAccount(rec);
  },
  async resetAccountPassword(id, newPassword) {
    // PocketBase 0.22 richiede oldPassword per modificare la password (eccezione
    // solo per i PB superuser). I nostri admin sono regular accounts, quindi
    // l'unico modo è cancellare + ricreare il record. Strategia anti-data-loss:
    //   1. Snapshot del record originale PRIMA della delete.
    //   2. Se la create fallisce dopo la delete, ricrea l'account vecchio dallo
    //      snapshot con una password placeholder (loggata, non visibile a noi:
    //      l'admin dovrà rifare il reset). Meglio che perdere l'account.
    const rec = await pb.collection('accounts').getOne(id);
    const snapshot = {
      email: rec.email,
      role: rec.role,
      nome: rec.nome || '',
      cognome: rec.cognome || '',
      commissario: rec.commissario || '',
      attivo: rec.attivo,
    };
    await pb.collection('accounts').delete(id);
    state.accounts = state.accounts.filter(a => a.id !== id);
    let newRec;
    try {
      newRec = await pb.collection('accounts').create({
        ...snapshot, password: newPassword, passwordConfirm: newPassword,
        emailVisibility: true,
      });
    } catch (createErr) {
      // Rollback best-effort: ricrea con password placeholder generata.
      const placeholder = 'tmp_' + crypto.getRandomValues(new Uint32Array(2)).join('') + '!Aa';
      try {
        const restored = await pb.collection('accounts').create({
          ...snapshot, password: placeholder, passwordConfirm: placeholder,
          emailVisibility: true,
        });
        state.accounts.push(mapAccount(restored));
        notify();
        this.audit('account.password_reset_failed', {
          targetType: 'account', targetId: restored.id, targetLabel: snapshot.email,
          payload: { error: String(createErr?.message || createErr), restored: true },
        });
      } catch (restoreErr) {
        this.audit('account.password_reset_failed', {
          targetType: 'account', targetId: id, targetLabel: snapshot.email,
          payload: { error: String(createErr?.message || createErr), restored: false, restoreError: String(restoreErr?.message || restoreErr) },
        });
      }
      throw createErr;
    }
    state.accounts.push(mapAccount(newRec));
    notify();
    this.audit('account.password_reset', {
      targetType: 'account', targetId: newRec.id, targetLabel: rec.email,
    });
    return mapAccount(newRec);
  },
  async deleteAccount(id) {
    const a = state.accounts.find(x => x.id === id);
    await pb.collection('accounts').delete(id);
    state.accounts = state.accounts.filter(a => a.id !== id);
    notify();
    this.audit('account.delete', { targetType: 'account', targetId: id, targetLabel: a?.email });
  },

  // ---------- Auth ----------
  isAuthenticated() {
    return pb.authStore.isValid;
  },
  currentAccount() {
    return pb.authStore.isValid ? pb.authStore.model : null;
  },
  async login(email, password) {
    const auth = await pb.collection('accounts').authWithPassword(email, password);
    this.audit('auth.login', { targetType: 'account', targetId: auth.record.id, targetLabel: email });
    return auth.record;
  },
  logout() {
    const m = pb.authStore.model;
    if (m) this.audit('auth.logout', { targetType: 'account', targetId: m.id, targetLabel: m.email });
    pb.authStore.clear();
    state.meta.role = null;
    state.meta.currentCommissarioId = null;
    saveMeta();
    notify();
  },

  // ---------- Demo / Reset ----------
  async resetAll() {
    const concorsi = await pb.collection('concorsi').getFullList({ fields: 'id' });
    for (const c of concorsi) await pb.collection('concorsi').delete(c.id);
    state.concorsi = [];
    state.commissari = [];
    state.candidati = [];
    state.fasi = [];
    state.candidati_fase = [];
    state.valutazioni = [];
    state.sezioni = [];
    state.categorie = [];
    state.commissioni = [];
    // Keep meta.role / currentCommissarioId — auth determines role, not data presence.
    state.meta.activeConcorsoId = null;
    saveMeta();
    notify();
  },
  async seedDemo() {
    await this.resetAll();
    const c = await this.createConcorso({ nome: 'Concorso Internazionale di Musica 2026', anno: 2026 });
    await this.createFase({ concorso_id: c.id, nome: 'Eliminatoria' });
    await this.createFase({ concorso_id: c.id, nome: 'Semifinale', ammessi: 20 });
    await this.createFase({ concorso_id: c.id, nome: 'Finale', ammessi: 6 });

    const seedCom = [
      { nome: 'Anna',  cognome: 'Rossi',    specialita: 'Pianoforte',   email: 'anna.rossi@esempio.it',    telefono: '+39 339 1234567', data_nascita: '1968-03-12', nazionalita: 'Italiana', bio: 'Presidente di concorso, concertista, docente al Conservatorio di Milano.', is_presidente: true },
      { nome: 'Marco', cognome: 'Bianchi',  specialita: 'Violino',      email: 'marco.bianchi@esempio.it', telefono: '+39 340 7654321', data_nascita: '1972-07-04', nazionalita: 'Italiana', bio: "Primo violino di un'orchestra sinfonica nazionale." },
      { nome: 'Giulia',cognome: 'Esposito', specialita: 'Composizione', email: 'giulia.esposito@esempio.it', telefono: '', data_nascita: '1979-11-21', nazionalita: 'Italiana', bio: "Compositrice e direttrice d'orchestra." },
    ];
    for (const d of seedCom) await this.createCommissario({ concorso_id: c.id, ...d });

    const strumenti = ['Pianoforte','Violino','Violoncello','Flauto','Clarinetto','Tromba','Chitarra','Arpa'];
    const nomi = ['Sofia','Lorenzo','Alessandro','Martina','Davide','Chiara','Federico','Elena','Tommaso','Alice','Andrea','Emma','Riccardo','Beatrice','Matteo','Giorgia','Luca','Aurora','Gabriele','Vittoria','Edoardo','Giulia','Francesco','Camilla','Diego','Greta'];
    const cognomi = ['Romano','Russo','Ferrari','Conti','Marino','Greco','Bruno','Galli','Lombardi','Moretti','De Luca','Costa','Ricci','Marchetti','Rinaldi','Caruso','Mancini','Fontana'];
    const naz = ['Italiana','Italiana','Italiana','Italiana','Francese','Tedesca','Spagnola','Cinese','Giapponese','Statunitense','Britannica','Polacca'];
    const docPool = [
      ['Mario Bianchi — Conservatorio di Milano','Anna Verdi — Accademia Santa Cecilia'],
      ['Luca Ferrari — Conservatorio di Roma'],
      ['Sara Greco — Hochschule Wien'],
      ['Elena Bruni — Royal Academy of Music'],
      [],
      ['Pietro Lombardi — Conservatorio di Bologna','Giulia Russo — Mozarteum Salzburg'],
    ];
    // Sezioni di esempio
    const sezioneArchi = await this.createSezione({ concorso_id: c.id, nome: 'Archi', descrizione: 'Strumenti ad arco' });
    const sezioneFiati = await this.createSezione({ concorso_id: c.id, nome: 'Fiati', descrizione: 'Strumenti a fiato' });
    const sezioneMdc = await this.createSezione({ concorso_id: c.id, nome: 'Musica da Camera', descrizione: 'Formazioni cameristiche' });
    // Categorie
    const catArchiSenior = await this.createCategoria({ sezione_id: sezioneArchi.id, nome: 'Senior (18-30)' });
    const catArchiJunior = await this.createCategoria({ sezione_id: sezioneArchi.id, nome: 'Junior (12-17)' });
    const catFiatiOttoni = await this.createCategoria({ sezione_id: sezioneFiati.id, nome: 'Ottoni' });
    const catFiatiLegni  = await this.createCategoria({ sezione_id: sezioneFiati.id, nome: 'Legni' });

    // Mappa strumento → sezione/categoria
    const mapStr = (s) => {
      if (['Violino','Violoncello'].includes(s)) return { sez: sezioneArchi.id, cat: null };
      if (['Flauto','Clarinetto'].includes(s))   return { sez: sezioneFiati.id, cat: catFiatiLegni.id };
      if (['Tromba'].includes(s))                return { sez: sezioneFiati.id, cat: catFiatiOttoni.id };
      return { sez: null, cat: null };
    };

    for (let i = 0; i < 24; i++) {
      const eta = 18 + (i % 14);
      const today = new Date();
      const birthYear = today.getFullYear() - eta;
      const birthMonth = ((i * 7) % 12) + 1;
      const birthDay = ((i * 11) % 27) + 1;
      const data_nascita = `${birthYear}-${String(birthMonth).padStart(2,'0')}-${String(birthDay).padStart(2,'0')}`;
      const strum = strumenti[i % strumenti.length];
      const m = mapStr(strum);
      const sezIds = m.sez ? [m.sez] : [];
      let catIds = m.cat ? [m.cat] : [];
      // Per archi: assegna senior/junior in base a età
      if (m.sez === sezioneArchi.id) {
        catIds = eta >= 18 ? [catArchiSenior.id] : [catArchiJunior.id];
      }
      await this.createCandidato({
        concorso_id: c.id,
        nome: nomi[i % nomi.length],
        cognome: cognomi[(i*3) % cognomi.length],
        strumento: strum,
        data_nascita,
        nazionalita: naz[i % naz.length],
        docenti_preparatori: docPool[i % docPool.length],
        sezioni_ids: sezIds,
        categorie_ids: catIds,
      });
    }

    // Commissione di esempio: "Giuria Archi" composta dai 3 commissari, assegnata a sezione Archi con auto-include categorie
    const commsCorso = state.commissari.filter(x => x.concorso_id === c.id);
    if (commsCorso.length > 0) {
      await this.createCommissione({
        concorso_id: c.id,
        nome: 'Giuria Archi',
        descrizione: 'Valuta tutti i candidati della sezione Archi (entrambe le categorie)',
        commissari_ids: commsCorso.slice(0, 2).map(x => x.id),
        sezioni_ids: [sezioneArchi.id],
        categorie_ids: [],
        include_tutte_categorie: true,
      });
    }

    this.setActiveConcorso(c.id);
  },

  // ---------- Ente (singleton) ----------
  getEnte() {
    return state.ente;
  },
  // Branding pubblico (visibile pre-login). Sicuro: non espone email/telefono/etc.
  getEntePublic() {
    return state.ente_public;
  },
  async saveEnte(patch) {
    if (state.ente) {
      let rec;
      if ('logo' in patch) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'logo') continue;
          fd.append(k, v == null ? '' : String(v));
        }
        appendFileField(fd, 'logo', patch.logo, 'logo.png');
        rec = await pb.collection('enti').update(state.ente.id, fd);
      } else {
        rec = await pb.collection('enti').update(state.ente.id, patch);
      }
      state.ente = mapEnte(rec);
    } else {
      const fd = new FormData();
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'logo') { appendFileField(fd, 'logo', v, 'logo.png'); continue; }
        if (v != null) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      const rec = await pb.collection('enti').create(fd);
      state.ente = mapEnte(rec);
    }
    // Sincronizza il branding pubblico (best-effort: errori non bloccano la save principale).
    try { await this._syncEntePublic(patch); } catch (e) { console.warn('enti_public sync failed:', e?.message); }
    notify();
    return state.ente;
  },

  // Mantiene `enti_public` allineato ai campi di branding di `enti`.
  // Chiamato internamente da saveEnte().
  async _syncEntePublic(patch) {
    const publicFields = ['nome', 'colore_primario', 'colore_secondario'];
    const hasPublicChange = publicFields.some(k => k in patch) || 'logo' in patch;
    if (!hasPublicChange) return;

    const buildFd = () => {
      const fd = new FormData();
      for (const k of publicFields) {
        if (k in patch) fd.append(k, patch[k] == null ? '' : String(patch[k]));
        else if (state.ente_public?.[k]) fd.append(k, state.ente_public[k]);
        else if (state.ente?.[k]) fd.append(k, state.ente[k]);
      }
      if ('logo' in patch) appendFileField(fd, 'logo', patch.logo, 'logo.png');
      return fd;
    };

    if (state.ente_public) {
      const rec = await pb.collection('enti_public').update(state.ente_public.id, buildFd());
      state.ente_public = mapEntePublic(rec);
    } else {
      const fd = buildFd();
      // Assicurati che 'nome' sia presente (required)
      if (!fd.has('nome') || !fd.get('nome')) fd.set('nome', state.ente?.nome || patch.nome || 'Ente');
      const rec = await pb.collection('enti_public').create(fd);
      state.ente_public = mapEntePublic(rec);
    }
  },

  // ---------- Iscrizioni (form pubblico auto-service) ----------
  // Trova il concorso del tenant attualmente aperto alle iscrizioni.
  // Regola: stato='ATTIVO' && iscrizioni_aperte=true && (iscrizioni_chiusura vuoto o > now).
  // Nota: chiamabile SENZA AUTH (listRule di concorsi richiede auth — la chiamata
  // pubblica deve passare per un endpoint dedicato, vedi `fetchConcorsoIscrizioniAperto`).
  async fetchConcorsoIscrizioniAperto() {
    // Pre-login non possiamo leggere concorsi (rule authRequired).
    // Strategia: esponiamo un endpoint pubblico in `enti_public` con il concorso corrente.
    // Per ora: se l'utente è autenticato leggiamo direttamente; altrimenti ritorniamo null
    // e ci aspettiamo che il deploy esponga una collection `concorso_iscrizione_pubblica`
    // oppure usiamo l'endpoint custom (vedi pb_hooks/iscrizione.pb.js in F5).
    const nowIso = new Date().toISOString();
    try {
      const items = await pb.collection('concorsi').getList(1, 1, {
        filter: pb.filter(
          'stato = "ATTIVO" && iscrizioni_aperte = true && (iscrizioni_chiusura = "" || iscrizioni_chiusura > {:now})',
          { now: nowIso },
        ),
        sort: '-created',
      });
      return items.items.length > 0 ? mapConcorso(items.items[0]) : null;
    } catch (e) {
      return null;
    }
  },

  // Crea una nuova iscrizione (form pubblico, no auth richiesto).
  // I file (foto/documento/ricevuta) vanno passati come File/Blob/dataURL.
  async createIscrizione(payload) {
    const fd = new FormData();
    const textFields = [
      'concorso', 'nome', 'cognome', 'data_nascita', 'luogo_nascita', 'nazionalita', 'sesso',
      'codice_fiscale', 'email', 'telefono', 'indirizzo', 'citta', 'provincia', 'cap', 'paese',
      'tutore_nome', 'tutore_cognome', 'tutore_email', 'tutore_telefono',
      'tipo', 'strumento', 'sezione', 'categoria', 'anni_studio', 'scuola_provenienza',
      'note_libere', 'gruppo_nome', 'durata_totale_min',
    ];
    for (const f of textFields) {
      if (payload[f] !== undefined && payload[f] !== null && payload[f] !== '') {
        fd.append(f, String(payload[f]));
      }
    }
    if (Array.isArray(payload.docenti_preparatori)) fd.append('docenti_preparatori', JSON.stringify(payload.docenti_preparatori));
    if (Array.isArray(payload.gruppo_membri)) fd.append('gruppo_membri', JSON.stringify(payload.gruppo_membri));
    if (Array.isArray(payload.programma)) fd.append('programma', JSON.stringify(payload.programma));
    fd.append('consenso_privacy', payload.consenso_privacy ? 'true' : 'false');
    fd.append('consenso_immagini', payload.consenso_immagini ? 'true' : 'false');
    fd.append('consenso_regolamento', payload.consenso_regolamento ? 'true' : 'false');
    fd.append('stato', 'pending');
    // Anti-bot: il backend usa questi campi per honeypot + min-time-on-page.
    // Il token di verifica viene rigenerato server-side (vedi pb_hooks/iscrizioni.pb.js).
    if (payload.website !== undefined) fd.append('website', String(payload.website || ''));
    if (payload._form_started_at) fd.append('_form_started_at', String(payload._form_started_at));

    for (const fk of ['foto', 'documento_identita', 'ricevuta_pagamento', 'autorizzazione_minore']) {
      appendFileField(fd, fk, payload[fk], `${fk}.bin`);
    }

    const rec = await pb.collection('iscrizioni').create(fd);
    return { id: rec.id };
  },

  // Lista iscrizioni del concorso attivo (admin only — la rule lato server impedisce ad altri).
  async listIscrizioni({ concorsoId = null, stato = null } = {}) {
    const filterParts = [];
    const params = {};
    if (concorsoId) { filterParts.push('concorso = {:c}'); params.c = concorsoId; }
    if (stato)      { filterParts.push('stato = {:s}'); params.s = stato; }
    const filter = filterParts.length ? pb.filter(filterParts.join(' && '), params) : '';
    const r = await pb.collection('iscrizioni').getList(1, 500, { filter, sort: '-created' });
    return r.items;
  },

  async approveIscrizione(iscrizioneId, { note = '' } = {}) {
    // L'hook server-side `pb_hooks/iscrizione.pb.js` (F5) intercetterà l'update
    // a stato=approved e creerà il record `candidati` corrispondente.
    const me = pb.authStore.model;
    return await pb.collection('iscrizioni').update(iscrizioneId, {
      stato: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: me?.id || null,
      note_admin: note,
    });
  },

  async rejectIscrizione(iscrizioneId, reason = '') {
    return await pb.collection('iscrizioni').update(iscrizioneId, {
      stato: 'rejected',
      rejected_reason: reason,
    });
  },

  // ---------- Candidati Gruppo ----------
  membriGruppo(gruppoId) {
    return state.candidati_gruppo
      .filter(cg => cg.gruppo_id === gruppoId)
      .map(cg => ({
        ...cg,
        candidato: state.candidati.find(c => c.id === cg.candidato_id),
      }))
      .filter(x => x.candidato);
  },
  gruppiByMembro(candidatoId) {
    return state.candidati_gruppo
      .filter(cg => cg.candidato_id === candidatoId)
      .map(cg => ({
        ...cg,
        gruppo: state.candidati.find(c => c.id === cg.gruppo_id),
      }))
      .filter(x => x.gruppo);
  },
  async addMembroGruppo(gruppoId, candidatoId, strumentoGruppo = '') {
    const existing = state.candidati_gruppo.find(cg =>
      cg.gruppo_id === gruppoId && cg.candidato_id === candidatoId
    );
    if (existing) return existing;
    const rec = await pb.collection('candidati_gruppo').create({
      gruppo: gruppoId,
      candidato: candidatoId,
      strumento_gruppo: strumentoGruppo || '',
    });
    const cg = mapCandidatoGruppo(rec);
    state.candidati_gruppo.push(cg);
    notify();
    return cg;
  },
  async removeMembroGruppo(gruppoId, candidatoId) {
    const cg = state.candidati_gruppo.find(m =>
      m.gruppo_id === gruppoId && m.candidato_id === candidatoId
    );
    if (!cg) return;
    await pb.collection('candidati_gruppo').delete(cg.id);
    state.candidati_gruppo = state.candidati_gruppo.filter(m => m.id !== cg.id);
    notify();
  },
};
