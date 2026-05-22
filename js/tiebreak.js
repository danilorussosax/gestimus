// Cascata di rottura della parità per la classifica di una fase.
// Ordine FISSO (legalmente più difendibile), ogni step è abilitabile/disabilitabile:
//   1. scomposizione: confronta il punteggio dei criteri uno per uno, in ordine
//      di peso decrescente. Vince chi ha la migliore media sul primo criterio
//      che li differenzia.
//   2. presidente: confronta la media pesata dei SOLI voti del presidente di
//      commissione (commissioni.presidente).
//   3. eta: vince il candidato più giovane (data_nascita più recente). Per i
//      gruppi/ensemble usa la MEDIA delle date di nascita dei membri.
//   4. ex_aequo: marca i candidati ancora in parità come ex aequo (stessa
//      posizione, salta le posizioni successive equivalenti).
//
// La classifica congelata è scritta su candidati_fase.posizione_finale dal
// `db.concludiFase` (vedi db.js). Ogni candidato porta `tiebreak_log` con la
// catena dei passi effettivamente applicati (per audit/verbale).

import { mediaCandidato, getCriteri, getMetodoMedia, computeAggregate } from './scoring.js';

const STEPS = ['scomposizione', 'presidente', 'eta', 'ex_aequo'];

// Strategia di default: tutti i 4 step abilitati nell'ordine standard.
export function defaultTiebreakStrategy() {
  return STEPS.map(key => ({ key, enabled: true }));
}

// Risolve la strategia effettiva per una fase: override su fase, altrimenti
// default del concorso, altrimenti la cascata standard.
export function effectiveStrategy(fase, concorso) {
  const fromFase = sanitize(fase?.tiebreak_strategy);
  if (fromFase) return fromFase;
  const fromConcorso = sanitize(concorso?.default_tiebreak_strategy);
  if (fromConcorso) return fromConcorso;
  return defaultTiebreakStrategy();
}

function sanitize(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  // Forza l'ordine standard (i 4 step) e ignora chiavi extra; manteniamo
  // l'`enabled` indicato dall'utente.
  const byKey = new Map(raw.map(s => [s?.key, !!s?.enabled]));
  return STEPS.map(key => ({ key, enabled: byKey.has(key) ? byKey.get(key) : true }));
}

// --- Helpers ----------------------------------------------------------------

// Media aggregata su un singolo criterio: per ogni commissario prende il voto
// di quel criterio, poi applica il metodo della fase (aritmetica/olimpica/...).
export function mediaCandidatoSuCriterio(valutazioni, fase, criterioKey) {
  const metodo = getMetodoMedia(fase);
  const byCom = new Map();
  for (const v of valutazioni) {
    if (v.criterio !== criterioKey) continue;
    const arr = byCom.get(v.commissario_id) || [];
    arr.push(Number(v.voto) || 0);
    byCom.set(v.commissario_id, arr);
  }
  const totals = [];
  for (const voti of byCom.values()) {
    // Se ci sono più voti dello stesso commissario per lo stesso criterio
    // (non dovrebbe succedere) prendi l'ultimo: è il behaviour di saveValutazione.
    totals.push(voti[voti.length - 1]);
  }
  if (totals.length === 0) return 0;
  return computeAggregate(totals, metodo);
}

// Media pesata dei voti di UN solo commissario (il presidente).
export function votoPresidente(valutazioni, fase, presidenteId) {
  if (!presidenteId) return null;
  const criteri = getCriteri(fase);
  const miei = {};
  for (const v of valutazioni) {
    if (v.commissario_id !== presidenteId) continue;
    miei[v.criterio] = Number(v.voto) || 0;
  }
  if (Object.keys(miei).length === 0) return null;
  // Replico esattamente `pesato(voti, fase)` ma stand-alone così la funzione
  // resta isolata e testabile.
  return criteri.reduce((s, c) => s + (miei[c.key] || 0) * (c.peso || 0), 0);
}

// Età (in anni decimali) di un candidato a una data di riferimento.
// Per i gruppi (tipo === 'gruppo' con `membri` popolato): media delle età dei
// membri. Se mancano date, ritorna null e la regola eta cade alla successiva.
export function etaCandidato(cand, refDate, allCandidati = []) {
  const ref = refDate ? new Date(refDate) : new Date();
  if (!cand) return null;
  if (cand.tipo === 'gruppo') {
    const membriIds = Array.isArray(cand.membri) ? cand.membri : [];
    if (membriIds.length === 0) return null;
    const eta = membriIds
      .map(id => allCandidati.find(c => c.id === id))
      .filter(c => c && c.data_nascita)
      .map(c => yearsBetween(c.data_nascita, ref));
    if (eta.length === 0) return null;
    return eta.reduce((s, x) => s + x, 0) / eta.length;
  }
  if (!cand.data_nascita) return null;
  return yearsBetween(cand.data_nascita, ref);
}

function yearsBetween(birth, ref) {
  const d = new Date(birth);
  if (isNaN(d.getTime())) return null;
  return (ref.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.2425);
}

// Genera un id breve per identificare un gruppo di ex aequo (no crypto, basta
// che sia univoco nella scope della fase).
function exAequoGroupId() {
  return 'ea_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// Tolleranza per confrontare medie float (evita falsi positivi di parità).
const EPS = 1e-9;
function eq(a, b) { return Math.abs(a - b) <= EPS; }

// --- Algoritmo principale ---------------------------------------------------

// Input:
//   rows: [{ cf, cand, media, valutazioni }]  (già ordinati per media desc)
//   fase: oggetto fase (per criteri/scala/metodo)
//   ctx: { presidenteId, refDate, allCandidati, strategy }
// Output:
//   [{ ...row, posizione_finale, tiebreak_log, ex_aequo_group }]
//   ordinati per posizione_finale ascendente.
export function rankWithTieBreak(rows, fase, ctx = {}) {
  const strategy = (ctx.strategy && ctx.strategy.length ? ctx.strategy : defaultTiebreakStrategy())
    .filter(s => s.enabled);
  const presidenteId = ctx.presidenteId || null;
  const refDate = ctx.refDate || fase?.data_prevista || new Date().toISOString();
  const allCandidati = ctx.allCandidati || [];

  // Ordino in modo deterministico per partenza (media desc, poi fingerprint
  // ASCII del nome candidato per tiebreak finale stabile).
  const sorted = rows.slice().sort((a, b) => {
    if (!eq(a.media, b.media)) return b.media - a.media;
    const na = (a.cand?.numero_candidato ?? 0);
    const nb = (b.cand?.numero_candidato ?? 0);
    return na - nb;
  });

  // Raggruppo per media identica (entro EPS).
  const groups = [];
  let cur = [];
  for (const r of sorted) {
    if (cur.length === 0 || eq(cur[0].media, r.media)) cur.push(r);
    else { groups.push(cur); cur = [r]; }
  }
  if (cur.length) groups.push(cur);

  // Risolvo cascata su ogni gruppo con ≥2 candidati.
  const resolved = [];
  for (const g of groups) {
    if (g.length === 1) {
      resolved.push({ ...g[0], tiebreak_log: [], ex_aequo_group: null });
      continue;
    }
    // Ogni candidato del gruppo accumula il log dei passi tentati.
    const enriched = g.map(r => ({ ...r, tiebreak_log: [{ step: 'pari_su_media', valore: round2(r.media), motivazione: `Stessa media aggregata ${round2(r.media)}` }] }));
    const ordered = applyCascade(enriched, strategy, fase, { presidenteId, refDate, allCandidati });
    for (const r of ordered) resolved.push(r);
  }

  // Calcolo posizione_finale considerando gli ex aequo: candidati con stesso
  // ex_aequo_group condividono la stessa posizione; quelli successivi assumono
  // la posizione = indice+1 (sistema "competition ranking" 1224: chi è dopo
  // due primi ex aequo è 3°, non 2°).
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    if (r.ex_aequo_group && i > 0 && resolved[i - 1].ex_aequo_group === r.ex_aequo_group) {
      r.posizione_finale = resolved[i - 1].posizione_finale;
    } else {
      r.posizione_finale = i + 1;
    }
  }

  return resolved;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Applica la cascata di step al gruppo (≥2 candidati). Restituisce il gruppo
// riordinato. Step che non differenziano vengono annotati nel log e si passa
// al successivo. Lo step finale ex_aequo, se enabled, marca i sopravvissuti
// con uno stesso ex_aequo_group.
function applyCascade(group, strategy, fase, ctx) {
  // Lavoriamo per "sotto-gruppi": parto da un solo gruppo (tutti pari su media),
  // a ogni step lo divido in sotto-gruppi di ulteriori parità; quelli con
  // un solo elemento sono "vinti" e tolti dalla competizione.
  let buckets = [group];

  for (const step of strategy) {
    if (step.key === 'ex_aequo') break; // ex_aequo si gestisce DOPO i 3 step
    const newBuckets = [];
    for (const bucket of buckets) {
      if (bucket.length === 1) { newBuckets.push(bucket); continue; }
      const sub = splitByStep(bucket, step.key, fase, ctx);
      // Annota il log per ogni candidato del bucket. Se il bucket si divide,
      // chi sta in cima vince su quello step; chi resta legato registra "pari".
      annotateStep(sub, step.key);
      for (const sb of sub) newBuckets.push(sb);
    }
    buckets = newBuckets;
    // Se tutti i bucket hanno taglia 1 abbiamo risolto, stop.
    if (buckets.every(b => b.length === 1)) break;
  }

  // Gestione ex_aequo finale: per ogni bucket residuo con >1 candidato, se la
  // strategia ha ex_aequo abilitato → marca con un ex_aequo_group. Altrimenti,
  // restano pari ma senza marca esplicita (UI mostrerà comunque la parità).
  const hasExAequo = strategy.some(s => s.key === 'ex_aequo');
  for (const bucket of buckets) {
    if (bucket.length <= 1) continue;
    if (hasExAequo) {
      const gid = exAequoGroupId();
      for (const r of bucket) {
        r.ex_aequo_group = gid;
        r.tiebreak_log = [...(r.tiebreak_log || []), {
          step: 'ex_aequo',
          valore: bucket.length,
          motivazione: `Parità non risolta dalle regole precedenti: ex aequo dichiarato (${bucket.length} candidati). La posizione successiva non viene assegnata; i premi previsti si dividono in parti uguali.`,
        }];
      }
    } else {
      for (const r of bucket) {
        r.tiebreak_log = [...(r.tiebreak_log || []), {
          step: 'parita_residua',
          valore: bucket.length,
          motivazione: `Parità non risolta e regola ex aequo disattivata: ordine ${r.cand?.numero_candidato ?? '?'} usato come tiebreak finale.`,
        }];
      }
    }
  }

  // Output piatto: per ogni bucket nell'ordine corrente, srotola i candidati.
  const out = [];
  for (const bucket of buckets) for (const r of bucket) out.push(r);
  return out;
}

// Divide il bucket in sotto-bucket secondo lo step. Sotto-bucket di taglia 1
// = "vinti" (uno per "scaglione" di punteggio). Sotto-bucket di taglia >1 =
// ancora in parità per lo step successivo.
function splitByStep(bucket, stepKey, fase, ctx) {
  const scored = bucket.map(r => ({ r, score: stepScore(r, stepKey, fase, ctx) }));
  if (scored.every(s => s.score == null)) return [bucket];
  // Score può essere number (presidente, eta) o string (scomposizione = chiave
  // composita "0000xxxxx|0000yyy|..."). Normalizzo il confronto: stringhe in
  // ordine lessicografico DESC, numeri in ordine numerico DESC. Null in coda.
  const cmp = (a, b) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === 'string' || typeof b === 'string') {
      const sa = String(a), sb = String(b);
      if (sa === sb) return 0;
      return sa < sb ? 1 : -1; // desc
    }
    return b - a;
  };
  const same = (a, b) => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    if (typeof a === 'string' || typeof b === 'string') return String(a) === String(b);
    return eq(a, b);
  };
  scored.sort((a, b) => cmp(a.score, b.score));
  const subs = [];
  let cur = [];
  for (const s of scored) {
    if (cur.length === 0 || same(cur[0].score, s.score)) cur.push(s);
    else { subs.push(cur.map(x => x.r)); cur = [s]; }
  }
  if (cur.length) subs.push(cur.map(x => x.r));
  return subs;
}

// Score da massimizzare per ogni step. null = step non applicabile.
function stepScore(row, stepKey, fase, ctx) {
  if (stepKey === 'scomposizione') {
    // Per "scomposizione" non esiste UN solo score: la regola è iterativa sui
    // criteri in ordine di peso decrescente. Gestisco direttamente in
    // splitByStep tramite la funzione composita qui sotto. Quindi qui torno
    // un "rank composito" che viene gestito dal caller speciale.
    return scomposizioneCompositeScore(row, fase);
  }
  if (stepKey === 'presidente') {
    const v = votoPresidente(row.valutazioni || [], fase, ctx.presidenteId);
    return v == null ? null : v;
  }
  if (stepKey === 'eta') {
    const e = etaCandidato(row.cand, ctx.refDate, ctx.allCandidati);
    if (e == null) return null;
    // Più giovane vince → età minore vince → restituisco -età così "massimo".
    return -e;
  }
  return null;
}

// Per la scomposizione costruisco un "rank composito" come array di medie
// criterio-per-criterio in ordine di peso decrescente, e lo serializzo come
// stringa lessicograficamente ordinabile: così splitByStep può usarlo come
// chiave per il sub-grouping. La comparazione tra stringhe è equivalente alla
// comparazione lessicografica degli array (numero per numero).
function scomposizioneCompositeScore(row, fase) {
  const criteri = (fase?.criteri || []).slice().sort((a, b) => (b.peso || 0) - (a.peso || 0));
  if (criteri.length === 0) return null;
  const parts = criteri.map(c => {
    const v = mediaCandidatoSuCriterio(row.valutazioni || [], fase, c.key);
    // Padding a 10 cifre prima del punto + 6 dopo: serializzazione monotona.
    return v.toFixed(6).padStart(20, '0');
  });
  // Restituisce numero "fittizio": converto la composta in float monotono.
  // Trick: float64 ha ~15-17 cifre significative; con ≥3 criteri sfora.
  // Alternativa robusta: ritorno una stringa e splitByStep tratta i valori
  // come strings se sono strings. Modifico splitByStep di conseguenza.
  return parts.join('|'); // string, splitByStep gestisce sia number sia string
}

function annotateStep(subs, stepKey) {
  const label = stepLabel(stepKey);
  for (let i = 0; i < subs.length; i++) {
    const isFirst = i === 0;
    const sub = subs[i];
    if (sub.length === 1 && subs.length > 1) {
      // Singleton "vincitore" su questo step.
      sub[0].tiebreak_log = [...(sub[0].tiebreak_log || []), {
        step: stepKey,
        vinto: isFirst,
        motivazione: isFirst
          ? `Vince su ${label}.`
          : `Risolto da ${label} (posizione ${i + 1} nel sottogruppo).`,
      }];
    } else if (sub.length === 1 && subs.length === 1) {
      // Stesso bucket di partenza (1 elemento) — niente da annotare.
    } else if (sub.length > 1) {
      // Ancora in parità su questo step → annota "non risolve".
      for (const r of sub) {
        r.tiebreak_log = [...(r.tiebreak_log || []), {
          step: stepKey,
          vinto: false,
          motivazione: `Pari anche su ${label}: passo alla regola successiva.`,
        }];
      }
    }
  }
}

function stepLabel(key) {
  switch (key) {
    case 'scomposizione': return 'scomposizione del voto (criterio con peso maggiore)';
    case 'presidente': return 'voto del Presidente di giuria';
    case 'eta': return 'criterio anagrafico (più giovane vince)';
    case 'ex_aequo': return 'ex aequo';
    default: return key;
  }
}

// Ordine "umano" dei 4 step (per UI).
export const TIEBREAK_STEPS = STEPS.slice();

export function stepInfo(key) {
  const info = {
    scomposizione: {
      titolo: 'Scomposizione del voto',
      breve: 'Confronta i criteri uno per uno, in ordine di peso decrescente.',
      esempio: 'Pari su media 8.50? Vince chi ha la media più alta su "Tecnica" (peso 35%). Se ancora pari, su "Interpretazione" e così via.',
    },
    presidente: {
      titolo: 'Voto del Presidente di giuria',
      breve: 'Il voto del Presidente diventa decisivo.',
      esempio: 'Pari? Vince il candidato con la media più alta calcolata sui soli voti del Presidente.',
    },
    eta: {
      titolo: 'Criterio anagrafico',
      breve: 'Vince il candidato anagraficamente più giovane.',
      esempio: 'Pari? Vince il più giovane al momento dell\'esibizione. Per i gruppi si usa la media delle date di nascita dei membri.',
    },
    ex_aequo: {
      titolo: 'Ex aequo (extrema ratio)',
      breve: 'Se la parità non è risolta, dichiarata pari merito.',
      esempio: 'Stessa posizione ai candidati. La posizione immediatamente successiva non viene assegnata; il premio della posizione e di quella successiva si sommano e dividono in parti uguali (gestione € fuori dal sistema).',
    },
  };
  return info[key] || null;
}
