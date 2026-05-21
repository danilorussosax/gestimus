// One-shot migration: read legacy localStorage data and push records to PocketBase.
// Preserves legacy numeric IDs in `legacy_id` fields and uses them to resolve relations.
// Reads directly from localStorage (no longer dependent on db module after Phase B).

import { pb, dataURLToBlob } from './pb.js';

const LEGACY_KEY = 'gestionale_concorso_v1';

export function getLegacyState() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function legacyTotal() {
  const s = getLegacyState();
  if (!s) return 0;
  return (s.concorsi?.length || 0) + (s.commissari?.length || 0) + (s.candidati?.length || 0)
    + (s.fasi?.length || 0) + (s.candidati_fase?.length || 0) + (s.valutazioni?.length || 0);
}

export function clearLegacy() {
  localStorage.removeItem(LEGACY_KEY);
}

// Map<tableName, Map<legacyId, pbId>>
const idMap = {
  concorsi: new Map(),
  commissari: new Map(),
  candidati: new Map(),
  fasi: new Map(),
  candidati_fase: new Map(),
  valutazioni: new Map(),
};

function fmtDate(iso) {
  if (!iso) return '';
  // PB expects "YYYY-MM-DD HH:mm:ss.SSSZ" but it accepts ISO strings too.
  // Convert plain "YYYY-MM-DD" to full datetime to be safe.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso} 00:00:00.000Z`;
  return iso;
}

async function appendFile(formData, field, value, fallbackName) {
  if (!value) return;
  if (typeof value === 'string' && value.startsWith('data:')) {
    const blob = dataURLToBlob(value);
    if (blob) formData.append(field, blob, fallbackName);
  } else if (value && value.dataURL && typeof value.dataURL === 'string' && value.dataURL.startsWith('data:')) {
    const blob = dataURLToBlob(value.dataURL);
    if (blob) formData.append(field, blob, value.name || fallbackName);
  }
  // Anything else (already a URL, etc.) is skipped.
}

export async function runMigration({ onProgress } = {}) {
  const state = getLegacyState();
  if (!state) throw new Error('Nessun dato legacy da migrare in localStorage');
  const report = {
    concorsi: 0,
    commissari: 0,
    candidati: 0,
    fasi: 0,
    candidati_fase: 0,
    valutazioni: 0,
    errors: [],
  };
  const log = (k, msg) => { onProgress?.({ stage: k, message: msg, report }); };

  // ---------- CONCORSI ----------
  log('concorsi', `Migrazione ${state.concorsi.length} concorsi…`);
  for (const c of state.concorsi) {
    try {
      const rec = await pb.collection('concorsi').create({
        nome: c.nome,
        anno: Number(c.anno) || new Date().getFullYear(),
        data_inizio: fmtDate(c.data_inizio),
        stato: c.stato || 'ATTIVO',
        legacy_id: c.id,
      });
      idMap.concorsi.set(c.id, rec.id);
      report.concorsi++;
    } catch (e) {
      report.errors.push(`concorso ${c.id}: ${e.message}`);
    }
  }

  // ---------- COMMISSARI ----------
  log('commissari', `Migrazione ${state.commissari.length} commissari…`);
  for (const c of state.commissari) {
    const concorsoPbId = idMap.concorsi.get(c.concorso_id);
    if (!concorsoPbId) { report.errors.push(`commissario ${c.id}: concorso non trovato`); continue; }
    try {
      const fd = new FormData();
      fd.append('concorso', concorsoPbId);
      fd.append('nome', c.nome || '');
      fd.append('cognome', c.cognome || '');
      fd.append('specialita', c.specialita || '');
      fd.append('email', c.email || '');
      fd.append('telefono', c.telefono || '');
      if (c.data_nascita) fd.append('data_nascita', fmtDate(c.data_nascita));
      fd.append('nazionalita', c.nazionalita || '');
      fd.append('bio', c.bio || '');
      fd.append('stato', c.stato || 'ATTIVO');
      fd.append('legacy_id', String(c.id));
      await appendFile(fd, 'foto', c.foto, `comm-${c.id}.jpg`);
      await appendFile(fd, 'cv', c.cv, c.cv?.name || `comm-${c.id}-cv`);
      const rec = await pb.collection('commissari').create(fd);
      idMap.commissari.set(c.id, rec.id);
      report.commissari++;
    } catch (e) {
      report.errors.push(`commissario ${c.id}: ${e.message}`);
    }
  }

  // ---------- CANDIDATI ----------
  log('candidati', `Migrazione ${state.candidati.length} candidati…`);
  for (const c of state.candidati) {
    const concorsoPbId = idMap.concorsi.get(c.concorso_id);
    if (!concorsoPbId) { report.errors.push(`candidato ${c.id}: concorso non trovato`); continue; }
    try {
      const fd = new FormData();
      fd.append('concorso', concorsoPbId);
      fd.append('numero_candidato', String(c.numero_candidato || 1));
      fd.append('nome', c.nome || '');
      fd.append('cognome', c.cognome || '');
      fd.append('strumento', c.strumento || '');
      if (c.data_nascita) fd.append('data_nascita', fmtDate(c.data_nascita));
      fd.append('nazionalita', c.nazionalita || '');
      fd.append('docenti_preparatori', JSON.stringify(c.docenti_preparatori || []));
      if (c.data_iscrizione) fd.append('data_iscrizione', fmtDate(c.data_iscrizione));
      fd.append('legacy_id', String(c.id));
      await appendFile(fd, 'foto', c.foto, `cand-${c.id}.jpg`);
      await appendFile(fd, 'cv', c.cv, c.cv?.name || `cand-${c.id}-cv`);
      const rec = await pb.collection('candidati').create(fd);
      idMap.candidati.set(c.id, rec.id);
      report.candidati++;
    } catch (e) {
      report.errors.push(`candidato ${c.id}: ${e.message}`);
    }
  }

  // ---------- FASI ----------
  log('fasi', `Migrazione ${state.fasi.length} fasi…`);
  for (const f of state.fasi) {
    const concorsoPbId = idMap.concorsi.get(f.concorso_id);
    if (!concorsoPbId) { report.errors.push(`fase ${f.id}: concorso non trovato`); continue; }
    try {
      // Translate commissari_ids legacy → PB ids if present
      let commissariPbIds = null;
      if (Array.isArray(f.commissari_ids)) {
        commissariPbIds = f.commissari_ids
          .map(legacyId => idMap.commissari.get(legacyId))
          .filter(Boolean);
      }
      const rec = await pb.collection('fasi').create({
        concorso: concorsoPbId,
        ordine: Number(f.ordine) || 1,
        nome: f.nome,
        ammessi: f.ammessi != null ? Number(f.ammessi) : null,
        data_prevista: fmtDate(f.data_prevista),
        scala: Number(f.scala) || 10,
        modo_valutazione: f.modo_valutazione === 'sincrona' ? 'sincrona' : 'autonoma',
        pesi: f.pesi || null,
        commissari_ids: commissariPbIds,
        stato: f.stato || 'PIANIFICATA',
        legacy_id: f.id,
      });
      idMap.fasi.set(f.id, rec.id);
      report.fasi++;
    } catch (e) {
      report.errors.push(`fase ${f.id}: ${e.message}`);
    }
  }

  // ---------- CANDIDATI_FASE ----------
  log('candidati_fase', `Migrazione ${state.candidati_fase.length} righe candidati_fase…`);
  for (const cf of state.candidati_fase) {
    const fasePbId = idMap.fasi.get(cf.fase_id);
    const candPbId = idMap.candidati.get(cf.candidato_id);
    if (!fasePbId || !candPbId) {
      report.errors.push(`candidati_fase ${cf.id}: relazione mancante`);
      continue;
    }
    try {
      const rec = await pb.collection('candidati_fase').create({
        fase: fasePbId,
        candidato: candPbId,
        posizione: Number(cf.posizione) || 1,
        stato: cf.stato || 'IN_ATTESA',
        ammesso_prossima_fase: !!cf.ammesso_prossima_fase,
        legacy_id: cf.id,
      });
      idMap.candidati_fase.set(cf.id, rec.id);
      report.candidati_fase++;
    } catch (e) {
      report.errors.push(`candidati_fase ${cf.id}: ${e.message}`);
    }
  }

  // ---------- VALUTAZIONI ----------
  log('valutazioni', `Migrazione ${state.valutazioni.length} valutazioni…`);
  for (const v of state.valutazioni) {
    const cfPbId = idMap.candidati_fase.get(v.candidato_fase_id);
    const comPbId = idMap.commissari.get(v.commissario_id);
    if (!cfPbId || !comPbId) {
      report.errors.push(`valutazione ${v.id}: relazione mancante`);
      continue;
    }
    try {
      await pb.collection('valutazioni').create({
        candidato_fase: cfPbId,
        commissario: comPbId,
        criterio: v.criterio,
        voto: Number(v.voto) || 0,
        note: v.note || '',
        timestamp: fmtDate(v.timestamp),
        legacy_id: v.id,
      });
      report.valutazioni++;
    } catch (e) {
      report.errors.push(`valutazione ${v.id}: ${e.message}`);
    }
  }

  log('done', 'Migrazione completata');
  return report;
}
