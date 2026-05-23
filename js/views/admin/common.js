// Utility condivise dai moduli admin/* (cross-module helpers).

import { escapeHtml } from '../../utils.js';
import { t } from '../../i18n.js';
import { db } from '../../db.js';
import { mediaCandidato } from '../../scoring.js';
import { rankWithTieBreak } from '../../tiebreak.js';

// N124: ranking di una fase con risoluzione pareggi, condiviso tra la tab
// Risultati e il Verbale. Il motore rankWithTieBreak era esportato ma mai
// chiamato → i pareggi non venivano risolti (ordine per sola media). Calcoliamo
// on-the-fly dai voti: le fasi CONCLUSA hanno voti congelati dal trigger DB,
// quindi il risultato è stabile e riproducibile (niente bisogno di persistere
// posizione_finale). Restituisce righe { cf, cand, media, valutazioni,
// posizione_finale, tiebreak_log, ex_aequo_group } ordinate per posizione.
export function rankFase(fase, cfs = null) {
  const list = cfs || db.candidatiFaseList(fase.id);
  const rows = list.map((cf) => {
    const cand = db.state.candidati.find((c) => c.id === cf.candidato_id);
    const vs = db.valutazioniByCandidatoFase(cf.id);
    return { cf, cand, media: mediaCandidato(vs, fase), valutazioni: vs };
  });
  return rankWithTieBreak(rows, fase, {
    presidenteId: db.getPresidenteForFase(fase)?.id || null,
    allCandidati: db.state.candidati,
    getMembri: (cid) => db.membriGruppo(cid),
    strategy: fase.tiebreak_strategy,
  });
}

/**
 * Emoji per categoria strumentale, dedotta euristicamente dal nome della
 * sezione. L'ordine è importante: pattern più specifici prima di quelli
 * generici (es. "trombone" → ottoni prima che "tromb" matchi qualcosa di
 * più ampio). Fallback: 🎵.
 */
export function iconaPerSezione(nome) {
  const s = String(nome || '').toLowerCase();
  if (/canto|voce|voice|soprano|tenor|baritono|contralto|mezzosoprano|lirica|opera/.test(s)) return '🎤';
  if (/coro|choir|coral/.test(s)) return '🎼';
  if (/piano|tastier|harpsichord|clavicembal|fisarmonic|accordion|organo|\borgan\b/.test(s)) return '🎹';
  if (/chitarr|guitar/.test(s)) return '🎸';
  if (/sax|flaut|flute|clarinet|oboe|fagott|bassoon|legni|woodwind/.test(s)) return '🎷';
  if (/tromb[oa]ne|tromb[ae]|trumpet|corno|horn|tuba|ottoni|brass|fiati|wind/.test(s)) return '🎺';
  if (/percuss|drum|batter|marimba|vibrafon|xilo|timpan/.test(s)) return '🥁';
  if (/viol|arch|cello|contrabb|double\s*bass|string/.test(s)) return '🎻';
  if (/arpa|harp/.test(s)) return '🎵';
  if (/composiz|composit/.test(s)) return '🎼';
  if (/direz|conduct|maestro/.test(s)) return '🎙';
  if (/camera|chamber|ensemble|quartett|quintet|musica\s*da\s*camera/.test(s)) return '🎶';
  return '🎵';
}

/**
 * Rende il blocco "Cascata tiebreak" usato sia nel form fase (override
 * per-fase) sia nel form concorso (default per tutte le fasi del concorso).
 * `current` = override esistente (array) o null. `inherited` = default
 * del concorso (array) o null. Se entrambi assenti, mostra l'opzione
 * "standard" (tutti i passi abilitati).
 */
export function tiebreakStrategyHtml(current, inherited = null) {
  const STEPS = [
    { key: 'scomposizione', icon: '🧩', titolo: 'Scomposizione del voto', breve: 'Confronta i criteri uno per uno, in ordine di peso decrescente. Vince chi ha la media più alta sul criterio più importante che li differenzia.' },
    { key: 'presidente',   icon: '🎯', titolo: 'Voto del Presidente di giuria', breve: 'Il voto del Presidente diventa decisivo: vince chi ha la media più alta calcolata sui soli voti del Presidente.' },
    { key: 'eta',          icon: '🌱', titolo: 'Criterio anagrafico', breve: 'Vince il candidato più giovane al momento dell\'esibizione. Per i gruppi si usa la media delle date di nascita dei membri.' },
    { key: 'ex_aequo',     icon: '🤝', titolo: 'Ex aequo (extrema ratio)', breve: 'Se nessuna regola precedente risolve la parità, viene dichiarato ex aequo: stessa posizione ai candidati, la posizione successiva non viene assegnata; il premio si divide in parti uguali.' },
  ];
  const isInherited = !Array.isArray(current) || current.length === 0;
  const source = isInherited ? inherited : current;
  const enabledByKey = (key) => {
    if (!Array.isArray(source)) return true;
    const row = source.find(s => s?.key === key);
    return row ? !!row.enabled : true;
  };
  return `
    <div class="space-y-3">
      ${isInherited ? `
        <div class="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-900 flex items-center gap-2">
          <span>ℹ️</span>
          <span>${escapeHtml(t('admin.fase.tiebreak.inherited') || 'Questa fase usa la cascata di default del concorso. Modifica i toggle qui sotto per applicare una policy specifica a questa fase.')}</span>
        </div>
      ` : ''}
      <p class="text-xs text-slate-600">${escapeHtml(t('admin.fase.tiebreak.help') || 'L\'ordine della cascata è fisso: si parte dal primo step abilitato e si scende solo se la parità resta. Lascia almeno "Ex aequo" attivo per chiudere casi residui in modo legalmente difendibile.')}</p>
      <input type="hidden" name="tiebreak_strategy_json" value="" />
      <div class="space-y-2" data-tiebreak-steps>
        ${STEPS.map((s, i) => `
          <label class="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-brand-200 transition" data-tb-key="${s.key}">
            <input type="checkbox" class="mt-1 w-4 h-4" data-tb-enabled ${enabledByKey(s.key) ? 'checked' : ''} />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-[11px] font-bold inline-flex items-center justify-center">${i + 1}</span>
                <span class="text-base" aria-hidden="true">${s.icon}</span>
                <span class="font-semibold text-sm text-slate-900">${escapeHtml(s.titolo)}</span>
              </div>
              <p class="text-[12px] text-slate-600 mt-1 leading-relaxed">${escapeHtml(s.breve)}</p>
            </div>
          </label>
        `).join('')}
      </div>
    </div>
  `;
}
