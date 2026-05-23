// Tab "Fasi" del pannello Admin: render + card + form + wizard +
// modale shared fields + tiebreak + fase detail.
// Estratto da js/views/admin.js (refactoring).

import { db } from '../../db.js';
import { renderAdmin } from '../admin.js';
import {
  escapeHtml, modal, toast, confirmDialog, displayName, fmtDate,
} from '../../utils.js';
import { fmtVoto, getScala, mediaCandidato, METODI_MEDIA, slugifyKey, suggerisciMetodo } from '../../scoring.js';
import { icon } from '../../icons.js';
import { t } from '../../i18n.js';
import { iconaPerSezione, tiebreakStrategyHtml, computeAdmittedIds } from './common.js';

export function renderFasi(root, concorso) {
  const fasi = db.fasiByConcorso(concorso.id);
  const sezioni = db.sezioniByConcorso(concorso.id);
  const groups = gruppoFasi(fasi, sezioni);
  // Concorso senza sezioni: niente raggruppamento (legacy / micro-concorsi).
  // In quel caso usiamo la vista piatta di prima.
  const useGrouped = sezioni.length > 0;
  root.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <p class="text-sm text-slate-600">${escapeHtml(t('admin.fasi.count', { n: fasi.length }) || `${fasi.length} fasi`)}</p>
      <button data-action="new-fase-shared" class="text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-2 rounded-lg">
        ＋ ${escapeHtml(t('admin.fasi.add_shared') || 'Fase globale')}
      </button>
    </div>

    ${fasiGuidanceHtml(fasi.length === 0)}

    ${useGrouped ? `
      <div class="space-y-4" data-fasi-groups>
        ${groups.map(g => gruppoFasiCardHtml(g, concorso)).join('')}
      </div>
    ` : (fasi.length === 0 ? fasiEmptyHtml() : `
      <div class="space-y-3" data-fasi-list>
        ${fasi.map(f => faseCardHtml(f, concorso)).join('')}
      </div>
    `)}
  `;

  // Pulsante "Fase globale" in alto: apre il form classico per una fase shared
  // (sezioni_ids vuoto). Le altre creazioni partono dalle card-gruppo.
  root.querySelector('[data-action="new-fase-shared"]')?.addEventListener('click', () => {
    openFaseForm(concorso, null, () => renderFasi(root, concorso));
  });
  // Vista legacy (senza sezioni): mantieni il bottone "new-fase" se compare.
  root.querySelectorAll('[data-action="new-fase"]').forEach(b => b.addEventListener('click', () => {
    openFaseForm(concorso, null, () => renderFasi(root, concorso));
  }));

  // Refresh "shallow" (solo tab content): per azioni interne tipo apertura
  // modali, edit form, drag-reorder ecc. dove sidebar e header restano coerenti.
  const refresh = () => renderFasi(root, concorso);
  // Refresh "full" (renderAdmin completo): per azioni globali che cambiano lo
  // stato del concorso (start/conclude/sorteggio/delete fase) e i counts in
  // sidebar+header. Chiamiamo direttamente renderAdmin(app-root) invece di
  // dispatchare un HashChangeEvent: più affidabile (alcuni browser non
  // notificano l'hashchange se l'hash effettivo non cambia, lasciando la UI
  // in stato parziale = bug grafico osservato dopo "Avvia").
  const fullRefresh = () => {
    const appRoot = document.getElementById('app-root');
    if (appRoot) renderAdmin(appRoot);
    else renderFasi(root, concorso); // fallback
  };

  // Handler dei pulsanti a livello gruppo (add-fase, edit-shared, wizard, delete-group).
  root.querySelectorAll('[data-group-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const action = btn.dataset.groupAction;
      const key = btn.dataset.key;
      const group = groups.find(g => g.key === key);
      if (!group) return;
      if (action === 'wizard' || action === 'add-fase') {
        openFaseWizard(concorso, group, refresh);
      } else if (action === 'edit-shared') {
        openSharedFieldsModal(concorso, group, refresh);
      } else if (action === 'delete-group') {
        // Elimina TUTTE le sotto-fasi del gruppo. Safety: blocco preventivo se
        // c'è qualcosa IN_CORSO (gestito anche dall'attributo `disabled` sul
        // bottone, replicato qui per resistenza a manipolazioni DOM).
        const running = group.fasi.filter(f => f.stato === 'IN_CORSO');
        if (running.length > 0) {
          toast((t('admin.fasi.group.delete_block_running') || 'Impossibile eliminare: {n} sotto-fasi sono IN_CORSO. Concludile prima.').replace('{n}', running.length), 'error');
          return;
        }
        const concluse = group.fasi.filter(f => f.stato === 'CONCLUSA').length;
        const sezioniRecord = group.sezioneIds.map(id => db.state.sezioni.find(s => s.id === id)).filter(Boolean);
        const groupLabel = group.type === 'shared'
          ? (t('admin.fasi.group.shared_title') || 'Fasi globali (tutte le sezioni)')
          : sezioniRecord.map(s => s.nome).join(', ');
        const listaNomi = group.fasi
          .slice()
          .sort((a, b) => a.ordine - b.ordine)
          .map(f => `<li class="flex items-center justify-between gap-2"><span><span class="font-mono text-slate-400">#${f.ordine}</span> ${escapeHtml(f.nome)}</span><span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full ${f.stato === 'CONCLUSA' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">${escapeHtml(prettyStato(f.stato))}</span></li>`)
          .join('');
        modal({
          title: t('admin.fasi.group.delete_confirm_title') || 'Elimina gruppo di fasi',
          contentHtml: `
            <div class="text-sm space-y-3">
              <p>${(t('admin.fasi.group.delete_confirm_msg') || 'Stai per eliminare <strong>tutte e {n} le sotto-fasi</strong> del gruppo <em>{scope}</em>:').replace('{n}', group.fasi.length).replace('{scope}', escapeHtml(groupLabel))}</p>
              <ul class="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 max-h-48 overflow-auto space-y-1">${listaNomi}</ul>
              ${concluse > 0 ? `<div class="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-800">${(t('admin.fasi.group.delete_warn_concluse') || '⚠ {n} sotto-fasi sono CONCLUSE: tutte le valutazioni associate andranno perse irrimediabilmente.').replace('{n}', concluse)}</div>` : ''}
              <p class="text-xs text-slate-500 italic">${escapeHtml(t('admin.fasi.group.delete_irreversible') || 'L\'operazione non è reversibile.')}</p>
            </div>
          `,
          primaryLabel: t('admin.fasi.group.delete_confirm_btn') || 'Elimina tutte',
          secondaryLabel: t('modal.cancel') || 'Annulla',
          onPrimary: async () => {
            // Sequenziale: ogni deleteFase fa loadAll → non parallelizzo per
            // evitare race su state.fasi. Tolleriamo errori singoli.
            const failed = [];
            for (const f of group.fasi) {
              try { await db.deleteFase(f.id); }
              catch (e) { failed.push({ id: f.id, nome: f.nome, msg: e?.message || 'errore' }); }
            }
            if (failed.length === 0) {
              toast((t('admin.fasi.group.delete_ok') || '{n} sotto-fasi eliminate').replace('{n}', group.fasi.length), 'success');
            } else {
              const ok = group.fasi.length - failed.length;
              const why = failed.map(f => `${f.nome}: ${f.msg}`).slice(0, 3).join(' · ');
              toast((t('admin.fasi.group.delete_partial') || 'Eliminate {ok}/{tot} — {ko} errori: {why}').replace('{ok}', ok).replace('{tot}', group.fasi.length).replace('{ko}', failed.length).replace('{why}', why), 'error');
            }
            refresh();
          },
        });
      }
    });
  });

  root.querySelectorAll('[data-fase-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const action = btn.dataset.faseAction;
      const id = btn.dataset.id;
      const fase = db.state.fasi.find(f => f.id === id);
      if (!fase) return;
      btn.disabled = true;
      try {
        if (action === 'edit') {
          openFaseForm(concorso, fase, refresh);
        } else if (action === 'detail') {
          openFaseDetail(id);
        } else if (action === 'start') {
          await db.startFase(id);
          toast(t('admin.fase.started') || 'Fase avviata', 'success');
          fullRefresh();
        } else if (action === 'end') {
          confirmDialog({
            title: t('admin.fase.end_title') || 'Concludi fase',
            message: t('admin.fase.end_msg', { nome: fase.nome }) || `Concludere "${fase.nome}"? Non sarà più modificabile.`,
            onConfirm: async () => {
              try {
                // N144: ammissione = top-`ammessi` della classifica, calcolata qui.
                await db.concludiFase(id, computeAdmittedIds(fase));
                toast(t('admin.fase.ended') || 'Fase conclusa', 'success');
                fullRefresh();
              } catch (e) { toast(e?.message || 'Errore', 'error'); }
            },
          });
        } else if (action === 'sorteggio') {
          if (fase.stato === 'CONCLUSA') { toast('Fase già conclusa', 'warn'); return; }
          confirmDialog({
            title: t('admin.fase.sorteggio_title') || 'Sorteggio ordine candidati',
            message: t('admin.fase.sorteggio_msg', { nome: fase.nome }) || `Generare un nuovo ordine casuale dei candidati per "${fase.nome}"?`,
            onConfirm: async () => {
              try {
                const r = await db.sorteggiaFase(id);
                toast(t('admin.fase.sorteggio_done', { seed: r?.seed }) || `Ordine sorteggiato (seed: ${r?.seed})`, 'success');
                fullRefresh();
              } catch (e) { toast(e?.message || 'Errore', 'error'); }
            },
          });
        } else if (action === 'delete') {
          confirmDialog({
            title: t('admin.fase.delete_title') || 'Elimina fase',
            message: t('admin.fase.delete_msg', { nome: fase.nome }) || `Eliminare definitivamente "${fase.nome}"? Tutte le valutazioni associate andranno perse.`,
            danger: true,
            onConfirm: async () => {
              try {
                await db.deleteFase(id);
                toast(t('admin.fase.deleted') || 'Fase eliminata', 'success');
                fullRefresh();
              } catch (e) { toast(e?.message || 'Errore', 'error'); }
            },
          });
        } else if (action === 'move-up' || action === 'move-down') {
          const idx = fasi.findIndex(f => f.id === id);
          const newIdx = action === 'move-up' ? idx - 1 : idx + 1;
          if (newIdx < 0 || newIdx >= fasi.length) return;
          const ids = fasi.map(f => f.id);
          [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
          await db.reorderFasi(concorso.id, ids);
          refresh();
        }
      } catch (e) {
        toast(e?.message || 'Errore', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// ---------- Vista raggruppata fasi (modello "fase madre per sezione") ----------
// Le fasi vengono raggruppate dalla UI in base a `sezioni_ids` (signature):
//   - sezioni_ids = []           → gruppo "shared" (vale per tutte le sezioni)
//   - sezioni_ids = [X]          → gruppo "single" (fase madre della sezione X)
//   - sezioni_ids = [X,Y,...]    → gruppo "multi" (caso avanzato/raro)
// Il record "fase madre" NON esiste come riga separata: la madre è la card
// che raggruppa le sotto-fasi. I "campi condivisi" (commissione, scala,
// criteri, modo, tempo) si applicano via batch update sulle figlie. Quando
// le figlie divergono su un campo, la card mostra un badge "drift".

const SHARED_FIELDS = ['commissione_id', 'scala', 'metodo_media', 'modo_valutazione', 'tempo_minuti', 'criteri'];


// Ritorna il valore se TUTTE le fasi concordano, altrimenti undefined.
// Usa JSON.stringify per confronti strutturali (criteri = array di oggetti).
function sharedValue(fasi, key) {
  if (!fasi || fasi.length === 0) return undefined;
  const first = JSON.stringify(fasi[0][key] ?? null);
  for (let i = 1; i < fasi.length; i++) {
    if (JSON.stringify(fasi[i][key] ?? null) !== first) return undefined;
  }
  return fasi[0][key];
}

// Lista dei campi condivisi che divergono tra le sotto-fasi del gruppo.
function computeDrift(fasi) {
  if (!fasi || fasi.length < 2) return [];
  return SHARED_FIELDS.filter(k => sharedValue(fasi, k) === undefined);
}

// Raggruppa le fasi del concorso per signature di sezioni_ids e garantisce
// che ogni sezione del concorso abbia un gruppo (anche vuoto, per CTA).
function gruppoFasi(fasi, sezioni) {
  const groups = new Map();
  for (const f of fasi) {
    const ids = Array.isArray(f.sezioni_ids) ? [...f.sezioni_ids].sort() : [];
    const key = ids.length === 0 ? '__shared__' : ids.length === 1 ? `s:${ids[0]}` : `m:${ids.join(',')}`;
    const type = ids.length === 0 ? 'shared' : ids.length === 1 ? 'single' : 'multi';
    if (!groups.has(key)) groups.set(key, { key, type, sezioneIds: ids, fasi: [] });
    groups.get(key).fasi.push(f);
  }
  // Ordina le sotto-fasi per ordine globale (rispecchia la sequenza di valutazione).
  for (const g of groups.values()) g.fasi.sort((a, b) => a.ordine - b.ordine);
  // Sezioni del concorso senza fasi → card vuota con CTA "Crea fasi per X".
  for (const s of sezioni) {
    const key = `s:${s.id}`;
    if (!groups.has(key)) groups.set(key, { key, type: 'single', sezioneIds: [s.id], fasi: [] });
  }
  // Ordering: shared in cima, poi per nome sezione, poi i multi-section in fondo.
  const rank = { shared: 0, single: 1, multi: 2 };
  return [...groups.values()].sort((a, b) => {
    if (rank[a.type] !== rank[b.type]) return rank[a.type] - rank[b.type];
    if (a.type === 'single') {
      const sa = sezioni.find(s => s.id === a.sezioneIds[0])?.nome || '';
      const sb = sezioni.find(s => s.id === b.sezioneIds[0])?.nome || '';
      return sa.localeCompare(sb);
    }
    return 0;
  });
}

// Label "umana" di uno stato fase: lo stato interno usa underscore per leggibilità
// del codice (IN_CORSO), la UI lo mostra senza (IN CORSO).
function prettyStato(stato) {
  return String(stato || 'PIANIFICATA').replace(/_/g, ' ');
}

// Card del gruppo (fase madre = aggregazione visiva delle sotto-fasi).
// Header con titolo (sezione o "Fasi globali"), valori condivisi e drift,
// più i pulsanti per il batch edit e l'aggiunta di sotto-fasi. Body con la
// lista delle sotto-fasi (innerFaseRowHtml) o uno stato vuoto + wizard CTA.
function gruppoFasiCardHtml(group, concorso) {
  const sezioniRecord = group.sezioneIds.map(id => db.state.sezioni.find(s => s.id === id)).filter(Boolean);
  const title = group.type === 'shared'
    ? (t('admin.fasi.group.shared_title') || 'Fasi globali (tutte le sezioni)')
    : group.type === 'multi'
      ? (t('admin.fasi.group.multi_title', { names: sezioniRecord.map(s => s.nome).join(' + ') }) || `Fasi su: ${sezioniRecord.map(s => s.nome).join(' + ')}`)
      : (sezioniRecord[0]?.nome || '???');
  const subtitle = group.type === 'shared'
    ? (t('admin.fasi.group.shared_sub') || 'Si applicano a tutti i candidati del concorso, indipendentemente dalla sezione.')
    : group.type === 'single'
      ? (t('admin.fasi.group.single_sub') || 'Fase madre della sezione: le sotto-fasi qui sotto formano la sequenza di valutazione.')
      : (t('admin.fasi.group.multi_sub') || 'Caso avanzato: la fase coinvolge più sezioni contemporaneamente.');
  // Per i gruppi single-sezione l'icona riflette lo strumento della sezione
  // (es. Pianoforte → 🎹, Fiati → 🎺). I gruppi "shared" e "multi" usano icone
  // dedicate per distinguersi visivamente.
  const icon = group.type === 'shared'
    ? '🌐'
    : group.type === 'multi'
      ? '🔗'
      : iconaPerSezione(sezioniRecord[0]?.nome);

  // Valori condivisi e drift (solo se ci sono ≥2 sotto-fasi).
  const drift = computeDrift(group.fasi);
  const sharedComm = sharedValue(group.fasi, 'commissione_id');
  const sharedScala = sharedValue(group.fasi, 'scala');
  const sharedModo = sharedValue(group.fasi, 'modo_valutazione');
  const sharedTempo = sharedValue(group.fasi, 'tempo_minuti');
  const commAssegnata = sharedComm ? db.state.commissioni.find(c => c.id === sharedComm) : null;

  const metaPills = group.fasi.length === 0 ? '' : `
    <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
      ${commAssegnata
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">🎼 ${escapeHtml(commAssegnata.nome)}</span>`
        : (drift.includes('commissione_id')
          ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200" title="${escapeHtml(t('admin.fasi.group.drift_title') || 'I valori divergono tra le sotto-fasi')}">⚠ ${escapeHtml(t('admin.fasi.group.drift_comm') || 'Commissioni diverse')}</span>`
          : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200 italic">${escapeHtml(t('admin.fasi.group.no_comm') || 'Nessuna commissione')}</span>`)}
      ${sharedScala !== undefined
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200">Scala ${sharedScala}</span>`
        : (drift.includes('scala') ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">⚠ scala diff.</span>` : '')}
      ${sharedModo
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200">${escapeHtml(sharedModo)}</span>`
        : (drift.includes('modo_valutazione') ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">⚠ modo diff.</span>` : '')}
      ${sharedTempo !== undefined && sharedTempo > 0
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200">⏱ ${sharedTempo}′</span>`
        : (drift.includes('tempo_minuti') ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">⚠ tempo diff.</span>` : '')}
      ${drift.includes('criteri') ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">⚠ criteri diff.</span>` : ''}
    </div>
  `;

  return `
    <section class="bg-white border border-slate-200 rounded-2xl shadow-soft overflow-hidden">
      <header class="bg-gradient-to-br from-brand-50/60 to-white border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-3 flex-wrap">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xl" aria-hidden="true">${icon}</span>
            <h3 class="font-bold text-slate-900 text-lg truncate">${escapeHtml(title)}</h3>
            ${group.fasi.length > 0 ? `<span class="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">${group.fasi.length} ${escapeHtml(t('admin.fasi.group.count_fasi') || (group.fasi.length === 1 ? 'sotto-fase' : 'sotto-fasi'))}</span>` : `<span class="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-50 text-slate-400 border border-dashed border-slate-200">${escapeHtml(t('admin.fasi.group.empty_badge') || 'vuoto')}</span>`}
          </div>
          <p class="text-xs text-slate-600 mt-1 leading-snug">${escapeHtml(subtitle)}</p>
          ${metaPills}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${group.fasi.length > 1 ? `<button data-group-action="edit-shared" data-key="${escapeHtml(group.key)}" class="text-xs font-medium text-brand-700 hover:bg-brand-50 px-3 py-1.5 rounded-lg border border-brand-100">⚙ ${escapeHtml(t('admin.fasi.group.edit_shared') || 'Configurazione condivisa')}</button>` : ''}
          ${group.fasi.length > 0 ? (() => {
            const anyRunning = group.fasi.some(f => f.stato === 'IN_CORSO');
            const disabled = anyRunning ? 'disabled' : '';
            const titleAttr = anyRunning
              ? (t('admin.fasi.group.delete_disabled_title') || 'Impossibile: c\'è almeno una sotto-fase IN_CORSO. Concludila prima.')
              : (t('admin.fasi.group.delete_title') || 'Elimina tutte le sotto-fasi del gruppo');
            return `<button data-group-action="delete-group" data-key="${escapeHtml(group.key)}" class="text-xs font-medium text-rose-700 hover:bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100 disabled:opacity-40 disabled:cursor-not-allowed" title="${escapeHtml(titleAttr)}" ${disabled}>🗑 ${escapeHtml(t('admin.fasi.group.delete_btn') || 'Elimina gruppo')}</button>`;
          })() : ''}
          ${group.fasi.length === 0
            ? `<button data-group-action="wizard" data-key="${escapeHtml(group.key)}" class="text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg shadow-sm">${escapeHtml(t('admin.fasi.group.wizard_cta') || 'Configura fasi')}</button>`
            : `<button data-group-action="add-fase" data-key="${escapeHtml(group.key)}" class="text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg shadow-sm">＋ ${escapeHtml(t('admin.fasi.group.add_fase') || 'Aggiungi sotto-fase')}</button>`}
        </div>
      </header>
      ${group.fasi.length === 0 ? `
        <div class="px-5 py-8 text-center">
          <div class="text-3xl mb-2" aria-hidden="true">🎼</div>
          <p class="text-sm text-slate-600 max-w-md mx-auto">${escapeHtml(t('admin.fasi.group.empty_msg') || 'Nessuna fase configurata per questa sezione. Usa il wizard per crearne una unica o una sequenza (eliminatoria → semifinale → finale).')}</p>
        </div>
      ` : `
        <div class="divide-y divide-slate-100">
          ${group.fasi.map((f, i) => innerFaseRowHtml(f, concorso, group, i)).join('')}
        </div>
      `}
    </section>
  `;
}

// Riga compatta di sotto-fase dentro la card-gruppo. Mantiene tutte le azioni
// della card piatta esistente (start/end/sorteggio/edit/delete/move) ma rimuove
// le info già visibili nel header del gruppo (scope sezione, commissione condivisa).
function innerFaseRowHtml(f, concorso, group, indexInGroup) {
  const stato = f.stato || 'PIANIFICATA';
  const statoColors = {
    PIANIFICATA: 'bg-slate-100 text-slate-700 border-slate-200',
    IN_CORSO:    'bg-blue-100 text-blue-800 border-blue-200',
    CONCLUSA:    'bg-emerald-100 text-emerald-800 border-emerald-200',
  };
  const drift = computeDrift(group.fasi);
  const cfs = db.candidatiFaseList(f.id).length;
  const commIds = db.getFaseCommissariIds(f);
  const criteriCount = Array.isArray(f.criteri) ? f.criteri.length : 0;
  const tempo = Number(f.tempo_minuti) || 0;
  // Mostra solo i campi che divergono dal gruppo (così sappiamo dov'è l'override).
  const driftPills = [];
  if (drift.includes('scala')) driftPills.push(`scala ${f.scala || 10}`);
  if (drift.includes('tempo_minuti') && tempo > 0) driftPills.push(`⏱ ${tempo}′`);
  if (drift.includes('modo_valutazione')) driftPills.push(`${f.modo_valutazione || 'autonoma'}`);
  if (drift.includes('metodo_media')) driftPills.push(`media ${f.metodo_media || 'aritmetica'}`);
  if (drift.includes('criteri')) driftPills.push(`${criteriCount} criteri`);
  if (drift.includes('commissione_id')) {
    const c = f.commissione_id ? db.state.commissioni.find(x => x.id === f.commissione_id) : null;
    driftPills.push(c ? `🎼 ${c.nome}` : (t('admin.fasi.group.no_comm') || 'nessuna comm.'));
  }

  return `
    <div class="px-5 py-3.5 flex items-start gap-3 hover:bg-slate-50/60 transition-colors">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs font-mono uppercase tracking-wider text-slate-400">#${f.ordine}</span>
          <h4 class="font-semibold text-slate-900 text-base">${escapeHtml(f.nome)}</h4>
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statoColors[stato] || statoColors.PIANIFICATA}">${escapeHtml(prettyStato(stato))}</span>
          ${driftPills.length > 0 ? `<span class="text-[10px] font-medium text-amber-700 inline-flex items-center gap-1" title="${escapeHtml(t('admin.fasi.group.override_title') || 'Valori specifici di questa sotto-fase')}">▾ ${driftPills.map(p => escapeHtml(p)).join(' · ')}</span>` : ''}
        </div>
        <div class="mt-0.5 text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
          ${f.ammessi != null ? `<span><strong>${f.ammessi}</strong> ${escapeHtml(t('admin.fasi.row.passing') || 'passano')}</span>` : `<span class="italic">${escapeHtml(t('admin.fasi.row.passing_all') || 'tutti gli ammessi passano')}</span>`}
          ${f.data_prevista ? `<span>📅 ${escapeHtml(fmtDate(f.data_prevista))}</span>` : ''}
          <span>👥 ${commIds.length} ${escapeHtml(t('admin.fasi.row.commissari') || 'commissari')}</span>
          <span>🎓 ${cfs} ${escapeHtml(t('admin.fasi.row.candidati') || 'candidati')}</span>
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5">
          ${stato === 'PIANIFICATA' ? `<button data-fase-action="start"     data-id="${f.id}" class="text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 rounded-md shadow-sm">▶ ${escapeHtml(t('admin.fase.start') || 'Avvia')}</button>` : ''}
          ${stato === 'IN_CORSO'    ? `<button data-fase-action="end"       data-id="${f.id}" class="text-[11px] font-medium text-white bg-rose-600 hover:bg-rose-700 px-2.5 py-1 rounded-md shadow-sm">■ ${escapeHtml(t('admin.fase.end') || 'Concludi')}</button>` : ''}
          ${stato !== 'CONCLUSA'    ? `<button data-fase-action="sorteggio" data-id="${f.id}" class="text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md">🎲 ${escapeHtml(t('admin.fase.sorteggio') || 'Sorteggio')}</button>` : ''}
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button data-fase-action="move-up"   data-id="${f.id}" class="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed" title="${escapeHtml(t('admin.fasi.row.move_up') || 'Sposta su')}"   ${f.ordine === 1 ? 'disabled' : ''}>${icon('arrowUp', { size: 16 })}</button>
        <button data-fase-action="move-down" data-id="${f.id}" class="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" title="${escapeHtml(t('admin.fasi.row.move_down') || 'Sposta giù')}">${icon('arrowDown', { size: 16 })}</button>
        <button data-fase-action="detail"    data-id="${f.id}" class="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" title="${escapeHtml(t('common.detail') || 'Dettaglio')}">${icon('list', { size: 16 })}</button>
        <button data-fase-action="edit"      data-id="${f.id}" class="w-8 h-8 inline-flex items-center justify-center rounded-md text-brand-700 hover:bg-brand-50" title="${escapeHtml(t('common.edit'))}">${icon('edit', { size: 16 })}</button>
        <button data-fase-action="delete"    data-id="${f.id}" class="w-8 h-8 inline-flex items-center justify-center rounded-md text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed" title="${escapeHtml(t('common.delete'))}" ${stato === 'IN_CORSO' ? 'disabled' : ''}>${icon('trash', { size: 16 })}</button>
      </div>
    </div>
  `;
}

// Guida espandibile in cima alla pagina fasi. È un <details> nativo: stato
// gestito dal browser, niente JS. Auto-open se non ci sono fasi (l'admin sta
// configurando per la prima volta), altrimenti collassato per non rumoreggiare.
function fasiGuidanceHtml(autoOpen = false) {
  return `
    <details ${autoOpen ? 'open' : ''} class="bg-brand-50/60 border border-brand-100 rounded-2xl mb-4 group">
      <summary class="cursor-pointer list-none px-4 py-3 flex items-center gap-2.5 select-none">
        <span class="w-7 h-7 rounded-full bg-brand-100 text-brand-700 inline-flex items-center justify-center text-sm shrink-0">💡</span>
        <span class="text-sm font-semibold text-brand-900">${escapeHtml(t('admin.fasi.guide.title'))}</span>
        <span class="ml-auto text-brand-600 group-open:rotate-180 transition-transform text-sm" aria-hidden="true">▾</span>
      </summary>
      <div class="px-4 pb-4 pt-1 text-[13px] text-slate-700 leading-relaxed">
        <!-- NB: i testi dei tip contengono HTML (<strong>/<em>) deliberato → niente escape sui valori, solo sui titoli. -->
        <p class="mb-3">${t('admin.fasi.guide.intro')}</p>
        <ul class="space-y-1.5 pl-1">
          <li>🗂 <strong>${escapeHtml(t('admin.fasi.guide.tip_grouped_title'))}</strong> — ${t('admin.fasi.guide.tip_grouped')}</li>
          <li>🧙 <strong>${escapeHtml(t('admin.fasi.guide.tip_wizard_title'))}</strong> — ${t('admin.fasi.guide.tip_wizard')}</li>
          <li>🔗 <strong>${escapeHtml(t('admin.fasi.guide.tip_shared_title'))}</strong> — ${t('admin.fasi.guide.tip_shared')}</li>
          <li>🔧 <strong>${escapeHtml(t('admin.fasi.guide.tip_override_title'))}</strong> — ${t('admin.fasi.guide.tip_override')}</li>
          <li>🎻 <strong>${escapeHtml(t('admin.fasi.guide.tip_scope_title'))}</strong> — ${t('admin.fasi.guide.tip_scope')}</li>
          <li>🌐 <strong>${escapeHtml(t('admin.fasi.guide.tip_global_title'))}</strong> — ${t('admin.fasi.guide.tip_global')}</li>
          <li>🏆 <strong>${escapeHtml(t('admin.fasi.guide.tip_ammessi_title'))}</strong> — ${t('admin.fasi.guide.tip_ammessi')}</li>
          <li>🗑 <strong>${escapeHtml(t('admin.fasi.guide.tip_delete_title'))}</strong> — ${t('admin.fasi.guide.tip_delete')}</li>
          <li>⚖ <strong>${escapeHtml(t('admin.fasi.guide.tip_tiebreak_title'))}</strong> — ${t('admin.fasi.guide.tip_tiebreak')}</li>
          <li>▶️ <strong>${escapeHtml(t('admin.fasi.guide.tip_flow_title'))}</strong> — ${t('admin.fasi.guide.tip_flow')}</li>
        </ul>
        <p class="mt-3 text-xs text-slate-500 italic">${escapeHtml(t('admin.fasi.guide.footer'))}</p>
      </div>
    </details>
  `;
}

function fasiEmptyHtml() {
  return `
    <div class="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-8 sm:p-10 text-center">
      <div class="text-5xl mb-3">🎼</div>
      <h3 class="text-lg font-bold text-slate-800">${escapeHtml(t('admin.fasi.empty_title'))}</h3>
      <p class="text-sm text-slate-600 mt-2 max-w-xl mx-auto">${escapeHtml(t('admin.fasi.empty_desc'))}</p>
      <ol class="text-left max-w-md mx-auto mt-5 space-y-2.5 text-sm text-slate-700">
        <li class="flex gap-3 items-start"><span class="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0 mt-0.5">1</span><span>${escapeHtml(t('admin.fasi.empty_step1'))}</span></li>
        <li class="flex gap-3 items-start"><span class="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0 mt-0.5">2</span><span>${escapeHtml(t('admin.fasi.empty_step2'))}</span></li>
        <li class="flex gap-3 items-start"><span class="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0 mt-0.5">3</span><span>${escapeHtml(t('admin.fasi.empty_step3'))}</span></li>
      </ol>
      <button data-action="new-fase" class="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-lg shadow-sm">
        ＋ ${escapeHtml(t('admin.fasi.empty_cta'))}
      </button>
    </div>
  `;
}

function faseCardHtml(f, concorso) {
  const stato = f.stato || 'PIANIFICATA';
  const statoColors = {
    PIANIFICATA: 'bg-slate-100 text-slate-700 border-slate-200',
    IN_CORSO:    'bg-blue-100 text-blue-800 border-blue-200',
    CONCLUSA:    'bg-emerald-100 text-emerald-800 border-emerald-200',
  };
  const cfs = db.candidatiFaseList(f.id).length;
  const commIds = db.getFaseCommissariIds(f);
  const criteriCount = Array.isArray(f.criteri) ? f.criteri.length : 0;
  const tempo = Number(f.tempo_minuti) || 0;
  // Scope: sezioni a cui la fase è ristretta + commissione assegnata.
  const scopeSezioni = Array.isArray(f.sezioni_ids)
    ? f.sezioni_ids.map(id => db.state.sezioni.find(s => s.id === id)).filter(Boolean)
    : [];
  const commAssegnata = f.commissione_id ? db.state.commissioni.find(c => c.id === f.commissione_id) : null;
  return `
    <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-soft hover:shadow-md transition-shadow">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-mono uppercase tracking-wider text-slate-500">#${f.ordine}</span>
            <h3 class="font-bold text-slate-900 text-lg">${escapeHtml(f.nome)}</h3>
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statoColors[stato] || statoColors.PIANIFICATA}">${escapeHtml(prettyStato(stato))}</span>
            ${f.modo_valutazione === 'sincrona' ? `<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200">sincrona</span>` : ''}
          </div>
          ${scopeSezioni.length > 0 || commAssegnata ? `
            <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              ${scopeSezioni.length > 0 ? `
                <span class="text-slate-500 font-mono uppercase tracking-wider">Solo:</span>
                ${scopeSezioni.map(s => `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">${iconaPerSezione(s.nome)} ${escapeHtml(s.nome)}</span>`).join('')}
              ` : `<span class="text-slate-500 italic">Tutte le sezioni</span>`}
              ${commAssegnata ? `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">🎼 ${escapeHtml(commAssegnata.nome)}</span>` : ''}
            </div>
          ` : ''}
          <div class="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>Scala ${f.scala || 10}</span>
            <span>Media: ${escapeHtml(f.metodo_media || 'aritmetica')}</span>
            ${f.ammessi != null ? `<span>Ammessi: ${f.ammessi}</span>` : ''}
            ${f.data_prevista ? `<span>Data: ${escapeHtml(fmtDate(f.data_prevista))}</span>` : ''}
            ${tempo > 0 ? `<span>Tempo: ${tempo}′</span>` : ''}
            <span>Criteri: ${criteriCount}</span>
            <span>Commissari: ${commIds.length}</span>
            <span>Candidati: ${cfs}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button data-fase-action="move-up"   data-id="${f.id}" class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="Sposta su"   ${f.ordine === 1 ? 'disabled' : ''}>${icon('arrowUp', { size: 18 })}</button>
          <button data-fase-action="move-down" data-id="${f.id}" class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors" title="Sposta giù">${icon('arrowDown', { size: 18 })}</button>
          <button data-fase-action="detail"    data-id="${f.id}" class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors" title="${escapeHtml(t('common.detail') || 'Dettaglio')}">${icon('list', { size: 18 })}</button>
          <button data-fase-action="edit"      data-id="${f.id}" class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100 transition-colors" title="${escapeHtml(t('common.edit'))}">${icon('edit', { size: 18 })}</button>
          <button data-fase-action="delete"    data-id="${f.id}" class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="${escapeHtml(t('common.delete'))}" ${stato === 'IN_CORSO' ? 'disabled' : ''}>${icon('trash', { size: 18 })}</button>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        ${stato === 'PIANIFICATA' ? `<button data-fase-action="start"     data-id="${f.id}" class="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-md shadow-sm">▶ ${escapeHtml(t('admin.fase.start') || 'Avvia')}</button>` : ''}
        ${stato === 'IN_CORSO'    ? `<button data-fase-action="end"       data-id="${f.id}" class="text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 px-3 py-1.5 rounded-md shadow-sm">■ ${escapeHtml(t('admin.fase.end') || 'Concludi')}</button>` : ''}
        ${stato !== 'CONCLUSA'    ? `<button data-fase-action="sorteggio" data-id="${f.id}" class="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-md">🎲 ${escapeHtml(t('admin.fase.sorteggio') || 'Sorteggio')}</button>` : ''}
      </div>
    </div>
  `;
}

function openFaseForm(concorso, fase, onSaved, defaults = null) {
  const isEdit = !!fase;
  // In creazione, `defaults` permette di pre-popolare i campi (es. il wizard
  // passa i valori condivisi del gruppo + sezioni_ids della fase madre).
  const f = fase || defaults || {};
  const criteri = Array.isArray(f.criteri) && f.criteri.length > 0 ? f.criteri : [
    { key: 'tecnica',         label: 'Tecnica',         peso: 0.35 },
    { key: 'interpretazione', label: 'Interpretazione', peso: 0.35 },
    { key: 'intonazione',     label: 'Intonazione',     peso: 0.15 },
    { key: 'musicalita',      label: 'Musicalità',      peso: 0.15 },
  ];

  // Numero di commissari effettivi per questa fase (o, per fase nuova, totale del concorso).
  // Usato per suggerire il metodo di media più adatto.
  const nCommissari = isEdit
    ? db.getFaseCommissariIds(f).length
    : db.commissariByConcorso(concorso.id).length;
  const suggerito = suggerisciMetodo(nCommissari);
  const currentMetodo = f.metodo_media || suggerito.metodo;

  modal({
    title: isEdit ? (t('admin.fase.edit_title') || `Modifica fase: ${f.nome}`) : (t('admin.fase.new_title') || 'Nuova fase'),
    wide: true,
    contentHtml: `
      <div class="space-y-6">

        <!-- ====== Sezione 1: Generale ====== -->
        <section data-section="generale">
          <header class="flex items-center gap-2 mb-3">
            <span class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center">1</span>
            <h3 class="font-semibold text-slate-900">Informazioni generali</h3>
          </header>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="c-field">
              <span class="c-field__label">${escapeHtml(t('admin.fase.field_nome') || 'Nome')}</span>
              <input name="nome" type="text" required class="c-input" value="${escapeHtml(f.nome || '')}" placeholder="Eliminatoria" autofocus />
            </label>
            <label class="c-field">
              <span class="c-field__label">${escapeHtml(t('admin.fase.field_data') || 'Data prevista')}</span>
              <input name="data_prevista" type="date" class="c-input" value="${escapeHtml(f.data_prevista || '')}" />
            </label>
          </div>
        </section>

        <!-- ====== Sezione 2: Esecuzione ====== -->
        <section data-section="esecuzione">
          <header class="flex items-center gap-2 mb-3">
            <span class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center">2</span>
            <h3 class="font-semibold text-slate-900">Modalità di esecuzione</h3>
          </header>

          <!-- Tre card numeriche con stile coerente alle card di modalità di valutazione.
               Ogni card ha icona + titolo + descrizione + input numerico + chip preset cliccabili. -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
            ${numericCardHtml({
              key: 'scala',
              icon: '🎯',
              title: t('admin.fase.field_scala') || 'Scala di voto',
              value: f.scala || 10,
              min: 1, max: 100, suffix: null,
              desc: 'Voto massimo che un commissario può assegnare.',
              presets: [{ v: 10, label: '0–10' }, { v: 25, label: '0–25' }, { v: 100, label: '0–100' }],
              tip: '<strong>10</strong> è lo standard nei conservatori italiani, <strong>100</strong> nei concorsi internazionali.',
            })}
            ${numericCardHtml({
              key: 'tempo_minuti',
              icon: '⏱',
              title: t('admin.fase.field_tempo') || 'Tempo per candidato',
              value: f.tempo_minuti || 0,
              min: 0, max: 600, suffix: 'min',
              desc: 'Minuti previsti per l\'esibizione. Attiva un cronometro condiviso.',
              presets: [{ v: 0, label: 'Libero' }, { v: 5, label: '5 min' }, { v: 10, label: '10 min' }, { v: 15, label: '15 min' }],
              tip: '<strong>0</strong> = nessun limite cronometrato.',
            })}
            ${numericCardHtml({
              key: 'ammessi',
              icon: '🏆',
              title: t('admin.fase.field_ammessi') || 'Posti per la fase successiva',
              value: f.ammessi ?? '',
              min: 0, max: 9999, suffix: null,
              desc: 'Quanti candidati al massimo passano alla fase seguente.',
              presets: [{ v: '', label: 'Tutti' }, { v: 5, label: 'Top 5' }, { v: 10, label: 'Top 10' }, { v: 20, label: 'Top 20' }],
              tip: '<strong>Vuoto</strong> = tutti gli ammessi dal verdetto della commissione.',
            })}
          </div>

          <!-- Testi custom esito (PDF protocollo + tab Risultati) -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <label class="c-field">
              <span class="c-field__label">Testo esito "ammesso"</span>
              <input name="testo_esito_promosso" class="c-input" maxlength="80"
                     value="${escapeHtml(f.testo_esito_promosso || '')}"
                     placeholder="es. AMMESSO ALLA SEMIFINALE" />
              <span class="text-[11px] text-slate-500 mt-1 block">Testo mostrato nella colonna esito per i candidati ammessi alla fase successiva. Vuoto = default "PROMOSSO".</span>
            </label>
            <label class="c-field">
              <span class="c-field__label">Testo esito "eliminato"</span>
              <input name="testo_esito_eliminato" class="c-input" maxlength="80"
                     value="${escapeHtml(f.testo_esito_eliminato || '')}"
                     placeholder="es. NON AMMESSO" />
              <span class="text-[11px] text-slate-500 mt-1 block">Testo mostrato per i non ammessi. Vuoto = default "ELIMINATO".</span>
            </label>
          </div>

          <!-- Modalità di valutazione: scelta cruciale, mostrata come due radio-card -->
          <p class="c-field__label mb-2">Modalità di valutazione</p>
          <input type="hidden" name="modo_valutazione" value="${f.modo_valutazione === 'sincrona' ? 'sincrona' : 'autonoma'}" />
          <div data-modo-cards class="grid grid-cols-1 md:grid-cols-2 gap-2">
            ${modoValutazioneCardHtml('autonoma', f.modo_valutazione !== 'sincrona')}
            ${modoValutazioneCardHtml('sincrona', f.modo_valutazione === 'sincrona')}
          </div>
        </section>

        <!-- ====== Sezione 3: Metodo di calcolo media ====== -->
        <section data-section="metodo">
          <header class="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center">3</span>
              <h3 class="font-semibold text-slate-900">Metodo di calcolo della media</h3>
            </div>
            <div class="text-xs bg-amber-50 text-amber-900 border border-amber-200 rounded-full px-3 py-1 inline-flex items-center gap-1.5">
              <span>👥</span>
              <span><strong>${nCommissari}</strong> commissari ${isEdit ? 'su questa fase' : 'nel concorso'}</span>
            </div>
          </header>
          <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3 flex items-start gap-3">
            <span class="text-lg shrink-0">🎯</span>
            <div class="text-sm">
              <p class="font-semibold text-emerald-900">Consigliato: ${escapeHtml(METODI_MEDIA[suggerito.metodo]?.nome || suggerito.metodo)}</p>
              <p class="text-emerald-800 text-xs mt-0.5">${escapeHtml(suggerito.motivo)}</p>
            </div>
          </div>
          <input type="hidden" name="metodo_media" value="${escapeHtml(currentMetodo)}" />
          <div data-metodo-cards class="grid grid-cols-1 md:grid-cols-2 gap-2">
            ${Object.entries(METODI_MEDIA).map(([key, m]) => metodoMediaCardHtml(key, m, currentMetodo, suggerito.metodo)).join('')}
          </div>
        </section>

        <!-- ====== Sezione 4: Criteri ====== -->
        <section data-section="criteri">
          <header class="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center">4</span>
              <h3 class="font-semibold text-slate-900">${escapeHtml(t('admin.fase.field_criteri') || 'Criteri di valutazione')}</h3>
            </div>
            <p class="text-xs font-mono text-slate-600">Totale pesi: <span data-pesi-sum class="font-bold">0%</span></p>
          </header>
          <p class="text-xs text-slate-600 mb-2">Ogni criterio contribuisce alla media finale in base al suo peso. La somma dei pesi dovrebbe essere 100%.</p>
          <div data-criteri-list class="space-y-2">
            ${criteri.map((c, i) => criterioRowHtml(c, i)).join('')}
          </div>
          <button type="button" data-add-criterio class="mt-2 text-xs font-medium text-brand-700 hover:text-brand-900 inline-flex items-center gap-1">+ Aggiungi criterio</button>
        </section>

        <!-- ====== Sezione 5: Restrizione e assegnazione ====== -->
        <section data-section="scope">
          <header class="flex items-center gap-2 mb-3">
            <span class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center">5</span>
            <h3 class="font-semibold text-slate-900">Restrizione e assegnazione</h3>
          </header>
          ${faseScopeHtml(concorso, f)}
        </section>

        <!-- ====== Sezione 6: Regole di spareggio ====== -->
        <section data-section="tiebreak">
          <header class="flex items-center gap-2 mb-3">
            <span class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center">6</span>
            <h3 class="font-semibold text-slate-900">${escapeHtml(t('admin.fase.tiebreak.title') || 'Regole di rottura della parità')}</h3>
          </header>
          ${tiebreakStrategyHtml(f.tiebreak_strategy, concorso?.default_tiebreak_strategy)}
        </section>

      </div>
    `,
    primaryLabel: isEdit ? (t('common.save') || 'Salva') : (t('common.create') || 'Crea'),
    onMount: (body) => {
      // -- Criteri: lista dinamica + totale live --
      const listEl = body.querySelector('[data-criteri-list]');
      const sumEl = body.querySelector('[data-pesi-sum]');
      const recompute = () => {
        const tot = Array.from(listEl.querySelectorAll('[name="crit_peso"]'))
          .reduce((s, inp) => s + (Number(inp.value) || 0), 0);
        sumEl.textContent = `${tot}%`;
        sumEl.className = tot === 100 ? 'font-bold text-emerald-600' : 'font-bold text-amber-600';
      };
      body.querySelector('[data-add-criterio]').addEventListener('click', () => {
        const i = listEl.querySelectorAll('[data-criterio-row]').length;
        const div = document.createElement('div');
        div.innerHTML = criterioRowHtml({ key: '', label: '', peso: 0 }, i);
        listEl.appendChild(div.firstElementChild);
        recompute();
      });
      listEl.addEventListener('click', (ev) => {
        const rm = ev.target.closest('[data-remove-criterio]');
        if (!rm) return;
        const row = rm.closest('[data-criterio-row]');
        if (row && listEl.querySelectorAll('[data-criterio-row]').length > 1) { row.remove(); recompute(); }
      });
      listEl.addEventListener('input', (ev) => {
        if (ev.target.matches('[name="crit_peso"]')) recompute();
      });
      recompute();

      // -- Metodo media: radio-card selection --
      const cardsEl = body.querySelector('[data-metodo-cards]');
      const hidden = body.querySelector('[name="metodo_media"]');
      cardsEl.addEventListener('click', (ev) => {
        const card = ev.target.closest('[data-metodo-key]');
        if (!card) return;
        const key = card.dataset.metodoKey;
        hidden.value = key;
        cardsEl.querySelectorAll('[data-metodo-key]').forEach(el => {
          const isSel = el.dataset.metodoKey === key;
          el.classList.toggle('ring-2', isSel);
          el.classList.toggle('ring-brand-500', isSel);
          el.classList.toggle('bg-brand-50/40', isSel);
          el.classList.toggle('border-brand-300', isSel);
          el.querySelector('[data-metodo-check]').textContent = isSel ? '●' : '○';
        });
      });

      // -- Sezione 5: chip multi-select per le sezioni di scope --
      const sezChipsEl = body.querySelector('[data-sez-chips]');
      const sezHidden = sezChipsEl ? body.querySelector('[name="sezioni_ids"]') : null;
      if (sezChipsEl && sezHidden) {
        sezChipsEl.addEventListener('click', (ev) => {
          const btn = ev.target.closest('[data-sez-id]');
          if (!btn) return;
          const cur = new Set(sezHidden.value ? sezHidden.value.split(',').filter(Boolean) : []);
          const id = btn.dataset.sezId;
          if (cur.has(id)) cur.delete(id); else cur.add(id);
          sezHidden.value = [...cur].join(',');
          const isSel = cur.has(id);
          btn.classList.toggle('bg-brand-600', isSel);
          btn.classList.toggle('text-white', isSel);
          btn.classList.toggle('border-brand-600', isSel);
          btn.classList.toggle('hover:bg-brand-700', isSel);
          btn.classList.toggle('bg-white', !isSel);
          btn.classList.toggle('text-slate-700', !isSel);
          btn.classList.toggle('border-slate-200', !isSel);
          btn.classList.toggle('hover:border-brand-300', !isSel);
          btn.classList.toggle('hover:bg-brand-50', !isSel);
        });
      }

      // -- Card numeriche (scala / tempo / ammessi): chip preset cliccabili --
      body.querySelectorAll('[data-numcard-presets]').forEach(grp => {
        const inputName = grp.dataset.numcardPresets;
        const input = body.querySelector(`[name="${inputName}"]`);
        if (!input) return;
        grp.addEventListener('click', (ev) => {
          const btn = ev.target.closest('[data-preset]');
          if (!btn) return;
          input.value = btn.dataset.preset;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      });

      // -- Modo valutazione: radio-card selection (autonoma / sincrona) --
      const modoCards = body.querySelector('[data-modo-cards]');
      const modoHidden = body.querySelector('[name="modo_valutazione"]');
      modoCards.addEventListener('click', (ev) => {
        const card = ev.target.closest('[data-modo-key]');
        if (!card) return;
        const key = card.dataset.modoKey;
        modoHidden.value = key;
        modoCards.querySelectorAll('[data-modo-key]').forEach(el => {
          const isSel = el.dataset.modoKey === key;
          el.classList.toggle('ring-2', isSel);
          el.classList.toggle('ring-brand-500', isSel);
          el.classList.toggle('bg-brand-50/40', isSel);
          el.classList.toggle('border-brand-300', isSel);
          el.querySelector('[data-modo-check]').textContent = isSel ? '●' : '○';
        });
      });

      // Tiebreak: marca "touched" al primo click così onPrimary distingue
      // "default ereditato" da "esplicitamente impostato uguale al default".
      // Se la fase aveva GIÀ un override (current non null), parte già touched.
      const tbContainer = body.querySelector('[data-tiebreak-steps]');
      if (tbContainer) {
        const startTouched = Array.isArray(f.tiebreak_strategy) && f.tiebreak_strategy.length > 0;
        if (startTouched) tbContainer.dataset.tbTouched = '1';
        tbContainer.addEventListener('change', (ev) => {
          if (ev.target.matches('[data-tb-enabled]')) tbContainer.dataset.tbTouched = '1';
        });
      }
    },
    onPrimary: async (body) => {
      const nome = body.querySelector('[name="nome"]').value.trim();
      const scala = Number(body.querySelector('[name="scala"]').value) || 10;
      const tempo_minuti = Number(body.querySelector('[name="tempo_minuti"]').value) || 0;
      const ammessiRaw = body.querySelector('[name="ammessi"]').value;
      const ammessi = ammessiRaw === '' ? null : Number(ammessiRaw);
      const data_prevista = body.querySelector('[name="data_prevista"]').value || null;
      const modo_valutazione = body.querySelector('[name="modo_valutazione"]').value;
      const metodo_media = body.querySelector('[name="metodo_media"]').value;
      // Sezione 5: scope sezioni + commissione assegnata.
      const sezHiddenEl = body.querySelector('[name="sezioni_ids"]');
      const sezioni_ids = sezHiddenEl && sezHiddenEl.value
        ? sezHiddenEl.value.split(',').filter(Boolean)
        : [];
      const commissione_id = body.querySelector('[name="commissione_id"]')?.value || null;
      const testo_esito_promosso = (body.querySelector('[name="testo_esito_promosso"]')?.value || '').trim();
      const testo_esito_eliminato = (body.querySelector('[name="testo_esito_eliminato"]')?.value || '').trim();
      if (!nome) { toast(t('admin.fase.required_nome') || 'Il nome è obbligatorio', 'error'); return false; }

      const criteriParsed = Array.from(body.querySelectorAll('[data-criterio-row]')).map((row, i) => {
        const label = row.querySelector('[name="crit_label"]').value.trim();
        const keyRaw = row.querySelector('[name="crit_key"]').value.trim();
        const key = keyRaw || slugifyKey(label) || `crit_${i+1}`;
        // Input UI: percentuale 0-100 → convertita a decimale 0-1 per il DB (scoring.js usa peso*voto).
        const pesoPct = Math.max(0, Math.min(100, Number(row.querySelector('[name="crit_peso"]').value) || 0));
        return { key, label, peso: pesoPct / 100 };
      }).filter(c => c.label);
      if (criteriParsed.length === 0) { toast('Almeno un criterio richiesto', 'error'); return false; }
      // Warning soft (non bloccante): se la somma non è 100%, avvisa l'utente.
      const totPct = Math.round(criteriParsed.reduce((s, c) => s + c.peso * 100, 0));
      if (totPct !== 100) {
        const ok = confirm(`La somma dei pesi è ${totPct}% (consigliato 100%). Vuoi salvare comunque?`);
        if (!ok) return false;
      }

      // Sezione 6: regole di spareggio. Costruisco l'array dai checkbox; se
      // tutti i toggle restano allo stato di "default", salvo null (eredita
      // dal concorso). Distinguo "esplicitamente uguale al default" guardando
      // se l'admin ha toccato almeno una volta i checkbox (data-tb-touched).
      const tbContainer = body.querySelector('[data-tiebreak-steps]');
      let tiebreak_strategy = null;
      if (tbContainer && tbContainer.dataset.tbTouched === '1') {
        tiebreak_strategy = Array.from(tbContainer.querySelectorAll('[data-tb-key]')).map(el => ({
          key: el.dataset.tbKey,
          enabled: el.querySelector('[data-tb-enabled]').checked,
        }));
      }

      try {
        const payload = { nome, scala, tempo_minuti, ammessi, data_prevista, modo_valutazione, metodo_media, criteri: criteriParsed, sezioni_ids, commissione_id, tiebreak_strategy, testo_esito_promosso, testo_esito_eliminato };
        if (isEdit) {
          await db.updateFase(fase.id, payload);
          toast(t('admin.fase.updated') || 'Fase aggiornata', 'success');
        } else {
          await db.createFase({ concorso_id: concorso.id, ...payload });
          toast(t('admin.fase.created') || 'Fase creata', 'success');
        }
        if (onSaved) onSaved();
      } catch (e) {
        toast(e?.message || 'Errore', 'error');
        return false;
      }
    },
  });
}

// Wizard di creazione fasi per un gruppo (sezione o shared).
// Due modalità:
//   - Gruppo vuoto → wizard completo con template (unica / elim+finale /
//     elim+semi+finale / personalizzato), nomi+ammessi delle figlie, campi
//     condivisi (commissione/scala/criteri/modo/tempo). Submit: crea N record.
//   - Gruppo con fasi esistenti → delega a openFaseForm pre-popolando i campi
//     dai sharedValue del gruppo (così la nuova sotto-fase eredita la config).
function openFaseWizard(concorso, group, onSaved) {
  // Caso "add": ricava i defaults dai campi condivisi del gruppo e delega
  // al form standard. Non chiediamo template all'admin: sta solo aggiungendo
  // una sotto-fase a una sequenza esistente.
  if (group.fasi.length > 0) {
    const defaults = { sezioni_ids: group.sezioneIds.slice() };
    for (const k of SHARED_FIELDS) {
      const sv = sharedValue(group.fasi, k);
      if (sv !== undefined) defaults[k] = sv;
    }
    return openFaseForm(concorso, null, onSaved, defaults);
  }

  // Caso "initial": wizard completo per configurare le fasi di una sezione vuota.
  const sezioniRecord = group.sezioneIds.map(id => db.state.sezioni.find(s => s.id === id)).filter(Boolean);
  const groupLabel = group.type === 'shared'
    ? (t('admin.fasi.wizard.scope_shared') || 'tutte le sezioni')
    : sezioniRecord.map(s => s.nome).join(', ');

  // Template preset: ognuno definisce la lista di nomi+ammessi suggeriti.
  // L'admin può sempre passare a "personalizzato" e gestire la lista a mano.
  const TEMPLATES = {
    unica:    { label: t('admin.fasi.wizard.tpl_unica') || 'Fase unica',                       items: [{ nome: t('admin.fasi.wizard.tpl_unica_name') || 'Audizione',  ammessi: '' }] },
    elim_fin: { label: t('admin.fasi.wizard.tpl_elim_fin') || 'Eliminatoria + Finale',         items: [{ nome: t('admin.fase.preset.elim')  || 'Eliminatoria', ammessi: 10 }, { nome: t('admin.fase.preset.finale') || 'Finale', ammessi: '' }] },
    elim_semi_fin: { label: t('admin.fasi.wizard.tpl_full') || 'Eliminatoria + Semifinale + Finale', items: [{ nome: t('admin.fase.preset.elim')  || 'Eliminatoria', ammessi: 20 }, { nome: t('admin.fase.preset.semi')  || 'Semifinale', ammessi: 6 }, { nome: t('admin.fase.preset.finale') || 'Finale', ammessi: '' }] },
    custom:   { label: t('admin.fasi.wizard.tpl_custom') || 'Personalizzato',                  items: [{ nome: 'Fase 1', ammessi: '' }] },
  };
  let currentTpl = 'unica';

  // Criteri default (gli stessi usati da openFaseForm in creazione).
  const criteriDefault = [
    { key: 'tecnica',         label: 'Tecnica',         peso: 0.35 },
    { key: 'interpretazione', label: 'Interpretazione', peso: 0.35 },
    { key: 'intonazione',     label: 'Intonazione',     peso: 0.15 },
    { key: 'musicalita',      label: 'Musicalità',      peso: 0.15 },
  ];
  const nCommissari = db.commissariByConcorso(concorso.id).length;
  const suggerito = suggerisciMetodo(nCommissari);

  const renderItemsList = (items) => items.map((it, i) => `
    <div class="grid grid-cols-12 gap-2 items-center" data-wiz-row="${i}">
      <div class="col-span-1 text-center text-xs font-mono text-slate-400">#${i + 1}</div>
      <input type="text" data-wiz-nome class="col-span-7 c-input" placeholder="${escapeHtml(t('admin.fase.field_nome') || 'Nome fase')}" value="${escapeHtml(it.nome)}" />
      <input type="number" data-wiz-ammessi min="0" class="col-span-3 c-input" placeholder="${escapeHtml(t('admin.fasi.wizard.passing_placeholder') || 'Ammessi (vuoto = tutti)')}" value="${it.ammessi === '' || it.ammessi == null ? '' : it.ammessi}" />
      <button type="button" data-wiz-remove class="col-span-1 text-rose-600 hover:bg-rose-50 rounded-md text-lg" title="${escapeHtml(t('common.delete') || 'Rimuovi')}">×</button>
    </div>
  `).join('');

  modal({
    title: t('admin.fasi.wizard.title', { scope: groupLabel }) || `Configura fasi per ${groupLabel}`,
    wide: true,
    contentHtml: `
      <div class="space-y-6">
        <!-- Banner scope -->
        <div class="bg-brand-50/60 border border-brand-100 rounded-xl px-4 py-3 text-sm text-slate-700">
          <p>${escapeHtml(t('admin.fasi.wizard.scope_intro', { scope: groupLabel }) || `Stai configurando le fasi per: ${groupLabel}.`)} <span class="text-slate-500">${escapeHtml(t('admin.fasi.wizard.scope_help') || 'Tutte le sotto-fasi create qui condivideranno i campi della "configurazione comune" qui sotto.')}</span></p>
        </div>

        <!-- Step 1: template -->
        <section>
          <header class="flex items-center gap-2 mb-3">
            <span class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center">1</span>
            <h3 class="font-semibold text-slate-900">${escapeHtml(t('admin.fasi.wizard.step_template') || 'Quante fasi?')}</h3>
          </header>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2" data-wiz-templates>
            ${Object.entries(TEMPLATES).map(([k, tpl]) => `
              <button type="button" data-wiz-tpl="${k}" class="text-left rounded-xl border px-3 py-2.5 transition ${k === currentTpl ? 'border-brand-300 bg-brand-50/40 ring-2 ring-brand-500' : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/30'}">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold text-slate-900">${escapeHtml(tpl.label)}</span>
                  <span data-wiz-check class="ml-auto text-brand-600 text-xs">${k === currentTpl ? '●' : '○'}</span>
                </div>
                <p class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(tpl.items.map(i => i.nome).join(' → '))}</p>
              </button>
            `).join('')}
          </div>
        </section>

        <!-- Step 2: lista fasi -->
        <section>
          <header class="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center">2</span>
              <h3 class="font-semibold text-slate-900">${escapeHtml(t('admin.fasi.wizard.step_list') || 'Nome e posti per ogni fase')}</h3>
            </div>
            <button type="button" data-wiz-add class="text-xs font-medium text-brand-700 hover:text-brand-900 inline-flex items-center gap-1">+ ${escapeHtml(t('admin.fasi.wizard.add_row') || 'Aggiungi fase')}</button>
          </header>
          <p class="text-xs text-slate-500 mb-2">${escapeHtml(t('admin.fasi.wizard.list_help') || '"Ammessi" = quanti candidati passano alla fase successiva. Vuoto = passano tutti gli ammessi dal verdetto della commissione.')}</p>
          <div class="space-y-2" data-wiz-items>${renderItemsList(TEMPLATES[currentTpl].items)}</div>
        </section>

        <!-- Step 3: configurazione comune -->
        <section>
          <header class="flex items-center gap-2 mb-3">
            <span class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center">3</span>
            <h3 class="font-semibold text-slate-900">${escapeHtml(t('admin.fasi.wizard.step_shared') || 'Configurazione comune (vale per tutte le sotto-fasi)')}</h3>
          </header>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            ${numericCardHtml({
              key: 'scala', icon: '🎯',
              title: t('admin.fase.field_scala') || 'Scala di voto',
              value: 10, min: 1, max: 100, suffix: null,
              desc: t('admin.fase.field_scala_desc') || 'Voto massimo che un commissario può assegnare.',
              presets: [{ v: 10, label: '0–10' }, { v: 25, label: '0–25' }, { v: 100, label: '0–100' }],
              tip: t('admin.fase.field_scala_tip') || '<strong>10</strong> standard, <strong>100</strong> concorsi internazionali.',
            })}
            ${numericCardHtml({
              key: 'tempo_minuti', icon: '⏱',
              title: t('admin.fase.field_tempo') || 'Tempo per candidato',
              value: 0, min: 0, max: 600, suffix: 'min',
              desc: t('admin.fase.field_tempo_desc') || 'Minuti previsti per l\'esibizione.',
              presets: [{ v: 0, label: t('admin.fase.field_tempo_libero') || 'Libero' }, { v: 5, label: '5 min' }, { v: 10, label: '10 min' }, { v: 15, label: '15 min' }],
              tip: t('admin.fase.field_tempo_tip') || '<strong>0</strong> = nessun limite.',
            })}
            <div class="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-2">
              <div class="flex items-center gap-2"><span class="text-xl">🎼</span><p class="font-semibold text-sm">${escapeHtml(t('admin.fase.commissione') || 'Commissione')}</p></div>
              <p class="text-xs text-slate-600">${escapeHtml(t('admin.fasi.wizard.comm_help') || 'Stessa commissione per tutte le sotto-fasi. Vuoto = tutti i commissari del concorso.')}</p>
              <select name="commissione_id" class="c-input">
                <option value="">${escapeHtml(t('admin.fasi.wizard.comm_none') || '— Nessuna —')}</option>
                ${db.commissioniByConcorso(concorso.id).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nome)} · ${(c.commissari_ids || []).length} comm.</option>`).join('')}
              </select>
            </div>
          </div>

          <p class="c-field__label mb-2">${escapeHtml(t('admin.fase.modo_label') || 'Modalità di valutazione')}</p>
          <input type="hidden" name="modo_valutazione" value="autonoma" />
          <div data-modo-cards class="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
            ${modoValutazioneCardHtml('autonoma', true)}
            ${modoValutazioneCardHtml('sincrona', false)}
          </div>

          <p class="c-field__label mb-2">${escapeHtml(t('admin.fase.metodo_label') || 'Metodo di calcolo media')}</p>
          <input type="hidden" name="metodo_media" value="${escapeHtml(suggerito.metodo)}" />
          <div data-metodo-cards class="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
            ${Object.entries(METODI_MEDIA).map(([key, m]) => metodoMediaCardHtml(key, m, suggerito.metodo, suggerito.metodo)).join('')}
          </div>

          <p class="c-field__label mb-2 flex items-center justify-between">
            <span>${escapeHtml(t('admin.fase.field_criteri') || 'Criteri di valutazione')}</span>
            <span class="text-xs font-mono text-slate-600">Tot: <span data-pesi-sum class="font-bold">0%</span></span>
          </p>
          <div data-criteri-list class="space-y-2">${criteriDefault.map((c, i) => criterioRowHtml(c, i)).join('')}</div>
          <button type="button" data-add-criterio class="mt-2 text-xs font-medium text-brand-700 hover:text-brand-900 inline-flex items-center gap-1">+ ${escapeHtml(t('admin.fase.add_criterio') || 'Aggiungi criterio')}</button>
        </section>
      </div>
    `,
    primaryLabel: t('admin.fasi.wizard.cta_create') || 'Crea fasi',
    onMount: (body) => {
      // Template chooser: cliccando un template rigenera la lista.
      body.querySelector('[data-wiz-templates]').addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-wiz-tpl]');
        if (!btn) return;
        currentTpl = btn.dataset.wizTpl;
        body.querySelectorAll('[data-wiz-tpl]').forEach(el => {
          const sel = el.dataset.wizTpl === currentTpl;
          el.classList.toggle('ring-2', sel);
          el.classList.toggle('ring-brand-500', sel);
          el.classList.toggle('bg-brand-50/40', sel);
          el.classList.toggle('border-brand-300', sel);
          el.querySelector('[data-wiz-check]').textContent = sel ? '●' : '○';
        });
        body.querySelector('[data-wiz-items]').innerHTML = renderItemsList(TEMPLATES[currentTpl].items);
      });
      // Add row + remove row.
      body.querySelector('[data-wiz-add]').addEventListener('click', () => {
        const list = body.querySelector('[data-wiz-items]');
        const i = list.querySelectorAll('[data-wiz-row]').length;
        const div = document.createElement('div');
        div.innerHTML = renderItemsList([{ nome: `Fase ${i + 1}`, ammessi: '' }]).trim();
        list.appendChild(div.firstElementChild);
      });
      body.querySelector('[data-wiz-items]').addEventListener('click', (ev) => {
        const rm = ev.target.closest('[data-wiz-remove]');
        if (!rm) return;
        const list = body.querySelector('[data-wiz-items]');
        if (list.querySelectorAll('[data-wiz-row]').length > 1) rm.closest('[data-wiz-row]').remove();
      });
      // -- Replica handler dei sotto-componenti riusati da openFaseForm --
      // (criteri sum, modo cards, metodo cards, numeric presets)
      const listEl = body.querySelector('[data-criteri-list]');
      const sumEl = body.querySelector('[data-pesi-sum]');
      const recompute = () => {
        const tot = Array.from(listEl.querySelectorAll('[name="crit_peso"]'))
          .reduce((s, inp) => s + (Number(inp.value) || 0), 0);
        sumEl.textContent = `${tot}%`;
        sumEl.className = tot === 100 ? 'font-bold text-emerald-600' : 'font-bold text-amber-600';
      };
      body.querySelector('[data-add-criterio]').addEventListener('click', () => {
        const i = listEl.querySelectorAll('[data-criterio-row]').length;
        const div = document.createElement('div');
        div.innerHTML = criterioRowHtml({ key: '', label: '', peso: 0 }, i);
        listEl.appendChild(div.firstElementChild);
        recompute();
      });
      listEl.addEventListener('click', (ev) => {
        const rm = ev.target.closest('[data-remove-criterio]');
        if (!rm) return;
        if (listEl.querySelectorAll('[data-criterio-row]').length > 1) { rm.closest('[data-criterio-row]').remove(); recompute(); }
      });
      listEl.addEventListener('input', (ev) => { if (ev.target.matches('[name="crit_peso"]')) recompute(); });
      recompute();

      const modoCards = body.querySelector('[data-modo-cards]');
      const modoHidden = body.querySelector('[name="modo_valutazione"]');
      modoCards.addEventListener('click', (ev) => {
        const card = ev.target.closest('[data-modo-key]');
        if (!card) return;
        const key = card.dataset.modoKey;
        modoHidden.value = key;
        modoCards.querySelectorAll('[data-modo-key]').forEach(el => {
          const isSel = el.dataset.modoKey === key;
          el.classList.toggle('ring-2', isSel); el.classList.toggle('ring-brand-500', isSel);
          el.classList.toggle('bg-brand-50/40', isSel); el.classList.toggle('border-brand-300', isSel);
          el.querySelector('[data-modo-check]').textContent = isSel ? '●' : '○';
        });
      });

      const metodoCards = body.querySelector('[data-metodo-cards]');
      const metodoHidden = body.querySelector('[name="metodo_media"]');
      metodoCards.addEventListener('click', (ev) => {
        const card = ev.target.closest('[data-metodo-key]');
        if (!card) return;
        const key = card.dataset.metodoKey;
        metodoHidden.value = key;
        metodoCards.querySelectorAll('[data-metodo-key]').forEach(el => {
          const isSel = el.dataset.metodoKey === key;
          el.classList.toggle('ring-2', isSel); el.classList.toggle('ring-brand-500', isSel);
          el.classList.toggle('bg-brand-50/40', isSel); el.classList.toggle('border-brand-300', isSel);
          el.querySelector('[data-metodo-check]').textContent = isSel ? '●' : '○';
        });
      });

      body.querySelectorAll('[data-numcard-presets]').forEach(grp => {
        const inputName = grp.dataset.numcardPresets;
        const input = body.querySelector(`[name="${inputName}"]`);
        if (!input) return;
        grp.addEventListener('click', (ev) => {
          const btn = ev.target.closest('[data-preset]');
          if (!btn) return;
          input.value = btn.dataset.preset;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      });
    },
    onPrimary: async (body) => {
      // Raccogli items (nome + ammessi).
      const rows = Array.from(body.querySelectorAll('[data-wiz-row]'));
      const items = rows.map(r => ({
        nome: r.querySelector('[data-wiz-nome]').value.trim(),
        ammessi: r.querySelector('[data-wiz-ammessi]').value,
      })).filter(it => it.nome);
      if (items.length === 0) { toast(t('admin.fasi.wizard.err_no_items') || 'Aggiungi almeno una fase', 'error'); return false; }
      const dupes = items.map(i => i.nome.toLowerCase()).filter((n, i, a) => a.indexOf(n) !== i);
      if (dupes.length > 0) { toast((t('admin.fasi.wizard.err_dup') || 'Nomi duplicati: {names}').replace('{names}', dupes.join(', ')), 'error'); return false; }

      // Campi condivisi.
      const scala = Number(body.querySelector('[name="scala"]').value) || 10;
      const tempo_minuti = Number(body.querySelector('[name="tempo_minuti"]').value) || 0;
      const modo_valutazione = body.querySelector('[name="modo_valutazione"]').value;
      const metodo_media = body.querySelector('[name="metodo_media"]').value;
      const commissione_id = body.querySelector('[name="commissione_id"]').value || null;

      // Criteri (validazione standard come in openFaseForm).
      const criteriParsed = Array.from(body.querySelectorAll('[data-criterio-row]')).map((row, i) => {
        const label = row.querySelector('[name="crit_label"]').value.trim();
        const keyRaw = row.querySelector('[name="crit_key"]').value.trim();
        const key = keyRaw || slugifyKey(label) || `crit_${i+1}`;
        const pesoPct = Math.max(0, Math.min(100, Number(row.querySelector('[name="crit_peso"]').value) || 0));
        return { key, label, peso: pesoPct / 100 };
      }).filter(c => c.label);
      if (criteriParsed.length === 0) { toast(t('admin.fase.err_no_criteri') || 'Almeno un criterio richiesto', 'error'); return false; }
      const totPct = Math.round(criteriParsed.reduce((s, c) => s + c.peso * 100, 0));
      if (totPct !== 100) {
        const ok = confirm((t('admin.fase.warn_pesi') || 'La somma dei pesi è {tot}% (consigliato 100%). Continuo?').replace('{tot}', totPct));
        if (!ok) return false;
      }

      // Crea i record sequenzialmente (db.createFase incrementa l'ordine globale
      // automaticamente). Se uno fallisce, le precedenti restano create: lo
      // segnaliamo e ricarichiamo. Una vera transazionalità richiederebbe un hook server.
      const created = [];
      try {
        for (const it of items) {
          const ammessi = it.ammessi === '' || it.ammessi == null ? null : Number(it.ammessi);
          const rec = await db.createFase({
            concorso_id: concorso.id,
            nome: it.nome,
            scala, tempo_minuti, ammessi,
            data_prevista: null,
            modo_valutazione, metodo_media,
            criteri: criteriParsed,
            sezioni_ids: group.sezioneIds.slice(),
            commissione_id,
          });
          created.push(rec);
        }
        toast((t('admin.fasi.wizard.ok_created') || '{n} fasi create').replace('{n}', created.length), 'success');
        if (onSaved) onSaved();
      } catch (e) {
        toast((t('admin.fasi.wizard.err_partial') || 'Errore dopo {n} fasi: {msg}').replace('{n}', created.length).replace('{msg}', e?.message || ''), 'error');
        if (onSaved) onSaved();
        return false;
      }
    },
  });
}

// Batch edit dei campi condivisi su tutte le sotto-fasi del gruppo.
// I campi che divergono già (drift) sono mostrati con un warning: salvare
// propagherà il nuovo valore SOVRASCRIVENDO la differenza esistente. Per
// ogni campo l'admin può scegliere "non modificare" (mantieni come adesso,
// niente write per quel campo) oppure imposta un nuovo valore.
function openSharedFieldsModal(concorso, group, onSaved) {
  const drift = computeDrift(group.fasi);
  const fasi = group.fasi;
  // Valori correnti consensus (se tutte le fasi concordano) o vuoto/null.
  const cur = {
    commissione_id: sharedValue(fasi, 'commissione_id') ?? '',
    scala: sharedValue(fasi, 'scala'),
    tempo_minuti: sharedValue(fasi, 'tempo_minuti'),
    modo_valutazione: sharedValue(fasi, 'modo_valutazione'),
    metodo_media: sharedValue(fasi, 'metodo_media'),
    criteri: sharedValue(fasi, 'criteri') || (Array.isArray(fasi[0].criteri) ? fasi[0].criteri : []),
  };

  const fieldRow = (key, label, html, isDrift) => `
    <div class="border ${isDrift ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white'} rounded-xl p-3">
      <label class="flex items-start gap-3">
        <input type="checkbox" data-batch-toggle="${key}" class="mt-1 w-4 h-4" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="font-semibold text-sm text-slate-800">${escapeHtml(label)}</span>
            ${isDrift ? `<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">⚠ ${escapeHtml(t('admin.fasi.batch.drift_tag') || 'diverso tra fasi')}</span>` : ''}
          </div>
          <div class="mt-2" data-batch-field="${key}">${html}</div>
          <p class="text-[11px] text-slate-500 mt-1.5">${escapeHtml(isDrift ? (t('admin.fasi.batch.drift_help') || 'Attiva la spunta e imposta il nuovo valore: verrà propagato a tutte le sotto-fasi, sovrascrivendo le differenze attuali.') : (t('admin.fasi.batch.field_help') || 'Attiva la spunta per modificare questo campo su tutte le sotto-fasi.'))}</p>
        </div>
      </label>
    </div>
  `;

  modal({
    title: t('admin.fasi.batch.title') || 'Configurazione comune',
    wide: true,
    contentHtml: `
      <div class="space-y-4">
        <div class="bg-brand-50/60 border border-brand-100 rounded-xl px-4 py-3 text-sm text-slate-700">
          <p>${escapeHtml((t('admin.fasi.batch.intro') || 'Modifica i campi che vuoi applicare a tutte le {n} sotto-fasi di questo gruppo. I campi senza spunta restano invariati su ogni sotto-fase.').replace('{n}', fasi.length))}</p>
        </div>

        ${fieldRow('commissione_id', t('admin.fase.commissione') || 'Commissione', `
          <select name="commissione_id" class="c-input w-full">
            <option value="" ${!cur.commissione_id ? 'selected' : ''}>— ${escapeHtml(t('admin.fasi.wizard.comm_none') || 'Nessuna')} —</option>
            ${db.commissioniByConcorso(concorso.id).map(c => `<option value="${escapeHtml(c.id)}" ${cur.commissione_id === c.id ? 'selected' : ''}>${escapeHtml(c.nome)} · ${(c.commissari_ids || []).length} comm.</option>`).join('')}
          </select>
        `, drift.includes('commissione_id'))}

        ${fieldRow('scala', t('admin.fase.field_scala') || 'Scala di voto', `
          <input type="number" name="scala" class="c-input w-full" min="1" max="100" value="${cur.scala ?? 10}" />
        `, drift.includes('scala'))}

        ${fieldRow('tempo_minuti', t('admin.fase.field_tempo') || 'Tempo per candidato (min)', `
          <input type="number" name="tempo_minuti" class="c-input w-full" min="0" max="600" value="${cur.tempo_minuti ?? 0}" />
        `, drift.includes('tempo_minuti'))}

        ${fieldRow('modo_valutazione', t('admin.fase.modo_label') || 'Modalità di valutazione', `
          <select name="modo_valutazione" class="c-input w-full">
            <option value="autonoma" ${cur.modo_valutazione !== 'sincrona' ? 'selected' : ''}>${escapeHtml(t('com.pres.modo_async') || 'Autonoma')}</option>
            <option value="sincrona" ${cur.modo_valutazione === 'sincrona' ? 'selected' : ''}>${escapeHtml(t('com.pres.modo_sync') || 'Sincrona')}</option>
          </select>
        `, drift.includes('modo_valutazione'))}

        ${fieldRow('metodo_media', t('admin.fase.metodo_label') || 'Metodo di media', `
          <select name="metodo_media" class="c-input w-full">
            ${Object.entries(METODI_MEDIA).map(([k, m]) => `<option value="${escapeHtml(k)}" ${cur.metodo_media === k ? 'selected' : ''}>${escapeHtml(m.nome || k)}</option>`).join('')}
          </select>
        `, drift.includes('metodo_media'))}

        <div class="border ${drift.includes('criteri') ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white'} rounded-xl p-3">
          <label class="flex items-start gap-3">
            <input type="checkbox" data-batch-toggle="criteri" class="mt-1 w-4 h-4" />
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <span class="font-semibold text-sm text-slate-800">${escapeHtml(t('admin.fase.field_criteri') || 'Criteri di valutazione')}</span>
                ${drift.includes('criteri') ? `<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">⚠ ${escapeHtml(t('admin.fasi.batch.drift_tag') || 'diverso tra fasi')}</span>` : ''}
                <span class="text-xs font-mono text-slate-600 ml-auto">Tot: <span data-pesi-sum class="font-bold">0%</span></span>
              </div>
              <p class="text-[11px] text-slate-500 mt-1.5 mb-2">${escapeHtml(t('admin.fasi.batch.criteri_help') || 'Attiva la spunta per propagare la stessa lista di criteri/pesi a tutte le sotto-fasi.')}</p>
              <div data-criteri-list class="space-y-2">${(cur.criteri.length ? cur.criteri : [{ key: 'tecnica', label: 'Tecnica', peso: 1 }]).map((c, i) => criterioRowHtml(c, i)).join('')}</div>
              <button type="button" data-add-criterio class="mt-2 text-xs font-medium text-brand-700 hover:text-brand-900 inline-flex items-center gap-1">+ ${escapeHtml(t('admin.fase.add_criterio') || 'Aggiungi criterio')}</button>
            </div>
          </label>
        </div>
      </div>
    `,
    primaryLabel: t('admin.fasi.batch.cta_save') || 'Applica alle sotto-fasi',
    onMount: (body) => {
      // Criteri list events (uguali al form principale).
      const listEl = body.querySelector('[data-criteri-list]');
      const sumEl = body.querySelector('[data-pesi-sum]');
      const recompute = () => {
        const tot = Array.from(listEl.querySelectorAll('[name="crit_peso"]'))
          .reduce((s, inp) => s + (Number(inp.value) || 0), 0);
        sumEl.textContent = `${tot}%`;
        sumEl.className = tot === 100 ? 'font-bold text-emerald-600' : 'font-bold text-amber-600';
      };
      body.querySelector('[data-add-criterio]').addEventListener('click', () => {
        const i = listEl.querySelectorAll('[data-criterio-row]').length;
        const div = document.createElement('div');
        div.innerHTML = criterioRowHtml({ key: '', label: '', peso: 0 }, i);
        listEl.appendChild(div.firstElementChild);
        recompute();
      });
      listEl.addEventListener('click', (ev) => {
        const rm = ev.target.closest('[data-remove-criterio]');
        if (!rm) return;
        if (listEl.querySelectorAll('[data-criterio-row]').length > 1) { rm.closest('[data-criterio-row]').remove(); recompute(); }
      });
      listEl.addEventListener('input', (ev) => { if (ev.target.matches('[name="crit_peso"]')) recompute(); });
      recompute();
    },
    onPrimary: async (body) => {
      // Raccogli solo i campi con la spunta attiva.
      const patch = {};
      body.querySelectorAll('[data-batch-toggle]').forEach(cb => {
        if (!cb.checked) return;
        const key = cb.dataset.batchToggle;
        if (key === 'criteri') {
          const list = body.querySelector('[data-criteri-list]');
          const criteri = Array.from(list.querySelectorAll('[data-criterio-row]')).map((row, i) => {
            const label = row.querySelector('[name="crit_label"]').value.trim();
            const keyRaw = row.querySelector('[name="crit_key"]').value.trim();
            const k = keyRaw || slugifyKey(label) || `crit_${i+1}`;
            const pesoPct = Math.max(0, Math.min(100, Number(row.querySelector('[name="crit_peso"]').value) || 0));
            return { key: k, label, peso: pesoPct / 100 };
          }).filter(c => c.label);
          if (criteri.length === 0) { toast(t('admin.fase.err_no_criteri') || 'Almeno un criterio richiesto', 'error'); throw new Error('skip'); }
          patch.criteri = criteri;
        } else if (key === 'scala' || key === 'tempo_minuti') {
          patch[key] = Number(body.querySelector(`[name="${key}"]`).value) || 0;
        } else if (key === 'commissione_id') {
          patch.commissione_id = body.querySelector('[name="commissione_id"]').value || null;
        } else {
          patch[key] = body.querySelector(`[name="${key}"]`).value;
        }
      });
      if (Object.keys(patch).length === 0) {
        toast(t('admin.fasi.batch.err_nothing') || 'Seleziona almeno un campo da modificare', 'warn');
        return false;
      }
      // Applica a tutte le sotto-fasi del gruppo. Promise.allSettled per non
      // perdere update parziali se uno fallisce (es. fase IN_CORSO / hook server).
      const results = await Promise.allSettled(fasi.map(f => db.updateFase(f.id, patch)));
      const ok = results.filter(r => r.status === 'fulfilled').length;
      const ko = results.filter(r => r.status === 'rejected');
      if (ko.length === 0) {
        toast((t('admin.fasi.batch.ok') || 'Configurazione propagata a {n} sotto-fasi').replace('{n}', ok), 'success');
      } else {
        const reasons = ko.map(r => r.reason?.message || 'errore').slice(0, 3).join(' · ');
        toast((t('admin.fasi.batch.partial') || 'Aggiornate {ok}/{tot} — {ko} errori: {why}').replace('{ok}', ok).replace('{tot}', fasi.length).replace('{ko}', ko.length).replace('{why}', reasons), 'error');
      }
      if (onSaved) onSaved();
    },
  });
}

// Sezione "Regole di spareggio" — gestisce sia il form fase sia il form
// concorso (per il default). Resa unica con un parametro:
//   - `current` = valore corrente (array o null)
//   - `inherited` = valore "ereditato" da mostrare nel banner quando current è null
// Output: HTML con 4 toggle (uno per step) + hidden input `tiebreak_strategy_json`
// che onPrimary leggerà.

// Sezione "Restrizione e assegnazione" del form fase:
// - Sezioni di scope: vuoto = la fase coinvolge tutti i candidati del concorso.
//   Con almeno una selezionata, solo i candidati che appartengono ad almeno una
//   delle sezioni scelte passano in questa fase. Permette tracce parallele per sezione.
// - Commissione: se assegnata, sostituisce la lista commissari della fase con i
//   membri della commissione (gestita da getFaseCommissariIds in db.js).
function faseScopeHtml(concorso, f) {
  const sezioniConcorso = db.sezioniByConcorso(concorso.id);
  const commissioniConcorso = db.commissioniByConcorso(concorso.id);
  const selSez = new Set(Array.isArray(f.sezioni_ids) ? f.sezioni_ids : []);
  const selComm = f.commissione_id || '';
  return `
    <div class="space-y-4">
      <div>
        <p class="c-field__label mb-2">Limita ai candidati delle sezioni</p>
        <p class="text-[11px] text-slate-500 leading-snug mb-2">Lascia tutto deselezionato per includere <strong>tutti</strong> i candidati del concorso. Selezionando una o più sezioni, solo i candidati che vi appartengono parteciperanno a questa fase: le fasi diventano tracce parallele per sezione.</p>
        ${sezioniConcorso.length === 0 ? `
          <div class="text-xs text-slate-500 italic bg-slate-50 border border-dashed border-slate-200 rounded-lg px-3 py-2">
            Nessuna sezione definita. Crea le sezioni dal tab <em>Sezioni</em> per poter scopare le fasi.
          </div>
        ` : `
          <div class="flex flex-wrap gap-1.5" data-sez-chips>
            ${sezioniConcorso.map(s => {
              const isSel = selSez.has(s.id);
              return `
                <button type="button" data-sez-id="${escapeHtml(s.id)}"
                  class="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${isSel ? 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700' : 'bg-white text-slate-700 border-slate-200 hover:border-brand-300 hover:bg-brand-50'}">
                  ${escapeHtml(s.nome)}
                </button>
              `;
            }).join('')}
          </div>
          <input type="hidden" name="sezioni_ids" value="${escapeHtml([...selSez].join(','))}" />
        `}
      </div>

      <div>
        <p class="c-field__label mb-2">Commissione assegnata</p>
        <p class="text-[11px] text-slate-500 leading-snug mb-2">Una commissione raggruppa commissari + sezioni + categorie. Assegnandone una alla fase, solo i suoi membri valuteranno. Lascia "Nessuna" per usare automaticamente <strong>tutti i commissari del concorso</strong>.</p>
        <select name="commissione_id" class="c-input">
          <option value="" ${!selComm ? 'selected' : ''}>— Nessuna (tutti i commissari del concorso)</option>
          ${commissioniConcorso.map(c => {
            const nMembri = (c.commissari_ids || []).length;
            return `<option value="${escapeHtml(c.id)}" ${selComm === c.id ? 'selected' : ''}>${escapeHtml(c.nome)} · ${nMembri} commissari</option>`;
          }).join('')}
        </select>
        ${commissioniConcorso.length === 0 ? `
          <p class="text-[11px] text-amber-700 italic mt-1">Nessuna commissione creata per questo concorso. Crea una commissione dal tab <em>Commissioni</em> per poterla assegnare.</p>
        ` : ''}
      </div>
    </div>
  `;
}

// Card con input numerico + chip preset cliccabili. Riusata per scala / tempo / ammessi
// nella sezione "Modalità di esecuzione". Lo stile è coerente con le radio-card di
// modalità di valutazione e metodo di media.
function numericCardHtml({ key, icon, title, value, min, max, suffix, desc, presets, tip }) {
  const isEmpty = value === '' || value == null;
  const inputAttrs = `name="${escapeHtml(key)}" type="number" min="${min}" max="${max}" class="c-input pr-12 text-xl font-bold tabular-nums"`;
  return `
    <div class="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-2 hover:shadow-soft transition-shadow">
      <div class="flex items-center gap-2">
        <span class="text-xl shrink-0" aria-hidden="true">${icon}</span>
        <p class="font-semibold text-sm text-slate-900 min-w-0">${escapeHtml(title)}</p>
      </div>
      <p class="text-xs text-slate-600 leading-snug">${escapeHtml(desc)}</p>
      <div class="relative" data-numcard-input>
        <input ${inputAttrs} value="${escapeHtml(String(isEmpty ? '' : value))}" placeholder="—" />
        ${suffix ? `<span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 pointer-events-none">${escapeHtml(suffix)}</span>` : ''}
      </div>
      <div class="flex flex-wrap gap-1" data-numcard-presets="${escapeHtml(key)}">
        ${presets.map(p => `<button type="button" data-preset="${escapeHtml(String(p.v))}" class="text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-brand-100 hover:text-brand-800 px-2 py-1 rounded-md transition-colors">${escapeHtml(p.label)}</button>`).join('')}
      </div>
      <p class="text-[11px] text-slate-500 leading-snug mt-auto pt-1 border-t border-slate-100">${tip}</p>
    </div>
  `;
}

// Card per la modalità di valutazione. La scelta è cruciale e cambia il comportamento
// del flusso commissario (autonoma) vs presidente (sincrona) → la rendiamo molto esplicita.
const MODI_VALUTAZIONE = {
  autonoma: {
    icon: '👤',
    nome: 'Valutazione autonoma',
    breve: 'Ogni commissario procede al proprio ritmo, valutando in sequenza i candidati.',
    scenari: [
      'Valutazioni in differita su registrazioni audio/video',
      'Audizioni dal vivo con commissari indipendenti',
      'Concorsi con candidati numerosi (sblocca tutti i giurati in parallelo)',
    ],
    tip: 'Default consigliato per la maggior parte dei concorsi musicali.',
  },
  sincrona: {
    icon: '🎼',
    nome: 'Valutazione sincrona',
    breve: 'Tutta la commissione vota lo stesso candidato in contemporanea. Il presidente gestisce l\'avanzamento.',
    scenari: [
      'Audizioni dal vivo con candidato fisicamente presente in sala',
      'Finali con un solo candidato per volta sul palco',
      'Fasi con tempo cronometrato e cambio candidato visibile a tutti',
    ],
    tip: 'Richiede un presidente di giuria designato per pilotare il flusso.',
  },
};

function modoValutazioneCardHtml(key, selected) {
  const m = MODI_VALUTAZIONE[key];
  const ringCls = selected ? 'ring-2 ring-brand-500 bg-brand-50/40 border-brand-300' : 'border-slate-200 hover:border-brand-200';
  return `
    <button type="button" data-modo-key="${escapeHtml(key)}"
            class="text-left rounded-xl border ${ringCls} bg-white p-3 transition-all hover:shadow-soft flex flex-col gap-2">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-xl shrink-0" aria-hidden="true">${m.icon}</span>
          <p class="font-semibold text-sm text-slate-900">${escapeHtml(m.nome)}</p>
        </div>
        <span data-modo-check class="text-base text-brand-600 leading-none shrink-0">${selected ? '●' : '○'}</span>
      </div>
      <p class="text-xs text-slate-600 leading-snug">${escapeHtml(m.breve)}</p>
      <div class="text-[11px] text-slate-500 space-y-0.5 mt-1 pt-2 border-t border-slate-100">
        <p class="font-semibold text-slate-700 mb-0.5">Quando usarla:</p>
        ${m.scenari.map(s => `<p class="flex gap-1.5"><span class="text-brand-500">·</span><span>${escapeHtml(s)}</span></p>`).join('')}
        <p class="text-slate-400 italic mt-1">${escapeHtml(m.tip)}</p>
      </div>
    </button>
  `;
}

// Card di selezione metodo di media. `key` = chiave (aritmetica/olimpica/...),
// `m` = descrittore da METODI_MEDIA, `selected` = chiave correntemente scelta,
// `suggerito` = chiave consigliata in base al numero di commissari.
function metodoMediaCardHtml(key, m, selected, suggerito) {
  const isSel = key === selected;
  const isSug = key === suggerito;
  const ringCls = isSel ? 'ring-2 ring-brand-500 bg-brand-50/40 border-brand-300' : 'border-slate-200 hover:border-brand-200';
  return `
    <button type="button" data-metodo-key="${escapeHtml(key)}"
            class="text-left rounded-xl border ${ringCls} bg-white p-3 transition-all hover:shadow-soft flex flex-col gap-2">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-xl shrink-0" aria-hidden="true">${m.icon}</span>
          <div class="min-w-0">
            <p class="font-semibold text-sm text-slate-900 truncate">${escapeHtml(m.nome)}</p>
            ${isSug ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded-full mt-0.5">🎯 consigliato</span>` : ''}
          </div>
        </div>
        <span data-metodo-check class="text-base text-brand-600 leading-none shrink-0">${isSel ? '●' : '○'}</span>
      </div>
      <p class="text-xs text-slate-600 leading-snug">${escapeHtml(m.breve)}</p>
      <div class="text-[11px] text-slate-500 space-y-0.5 mt-1 pt-2 border-t border-slate-100">
        <p><span class="font-semibold text-emerald-700">+</span> ${escapeHtml(m.pro)}</p>
        <p><span class="font-semibold text-rose-700">−</span> ${escapeHtml(m.contro)}</p>
        <p class="text-slate-400 italic">${escapeHtml(m.consigliata)}</p>
      </div>
    </button>
  `;
}

function criterioRowHtml(c, i) {
  // Il peso è memorizzato come decimale 0-1 nel DB ma mostrato in % all'utente.
  const pesoPct = Math.round((Number(c.peso) || 0) * 100);
  return `
    <div data-criterio-row class="grid grid-cols-12 gap-2 items-end">
      <label class="col-span-5 c-field">
        ${i === 0 ? '<span class="c-field__label">Etichetta</span>' : ''}
        <input name="crit_label" type="text" class="c-input" value="${escapeHtml(c.label || '')}" placeholder="Tecnica" />
      </label>
      <label class="col-span-4 c-field">
        ${i === 0 ? '<span class="c-field__label">Chiave (opzionale)</span>' : ''}
        <input name="crit_key" type="text" class="c-input font-mono text-xs" value="${escapeHtml(c.key || '')}" placeholder="auto" />
      </label>
      <label class="col-span-2 c-field">
        ${i === 0 ? '<span class="c-field__label">Peso (%)</span>' : ''}
        <div class="relative">
          <input name="crit_peso" type="number" step="1" min="0" max="100" class="c-input pr-7" value="${pesoPct}" />
          <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">%</span>
        </div>
      </label>
      <button type="button" data-remove-criterio class="col-span-1 h-9 text-rose-600 hover:bg-rose-50 rounded-md flex items-center justify-center" title="Rimuovi">${icon('trash', { size: 14 })}</button>
    </div>
  `;
}

// ---------- Fase Detail Modal ----------
function openFaseDetail(faseId) {
  const fase = db.state.fasi.find(f => f.id === faseId);
  if (!fase) return;
  const cfs = db.candidatiFaseList(faseId);
  const rows = cfs.map(cf => {
    const cand = db.state.candidati.find(c => c.id === cf.candidato_id);
    const vs = db.valutazioniByCandidatoFase(cf.id);
    const media = mediaCandidato(vs, fase);
    return { cf, cand, media, voti: vs };
  }).sort((a,b) => b.media - a.media);

  modal({
    title: t('admin.fase.detail_title', { nome: fase.nome }),
    wide: true,
    contentHtml: `
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="text-xs text-slate-500 uppercase tracking-wider">
            <tr>
              <th class="text-left py-2 pr-3">${escapeHtml(t('admin.fase.col_pos'))}</th>
              <th class="text-left py-2 pr-3">${escapeHtml(t('admin.fase.col_cand'))}</th>
              <th class="text-left py-2 pr-3">${escapeHtml(t('admin.fase.col_strumento'))}</th>
              <th class="text-right py-2 pr-3">${escapeHtml(t('admin.fase.col_media_pesata'))}</th>
              <th class="text-center py-2 pr-3">${escapeHtml(t('admin.fase.col_stato'))}</th>
              <th class="text-center py-2">${escapeHtml(t('admin.fase.col_promosso'))}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${rows.map(({ cf, cand, media }, idx) => `
              <tr>
                <td class="py-2 pr-3 text-slate-500">${idx + 1}</td>
                <td class="py-2 pr-3">
                  <div class="font-medium text-slate-900">#${String(cand?.numero_candidato || '').padStart(3,'0')} · ${escapeHtml(displayName(cand))}</div>
                </td>
                <td class="py-2 pr-3 text-slate-600">${escapeHtml(cand?.strumento || '—')}</td>
                <td class="py-2 pr-3 text-right font-mono ${(() => { const s = getScala(fase); return media >= 0.8*s ? 'text-emerald-700 font-semibold' : media >= 0.65*s ? 'text-slate-900' : 'text-rose-700'; })()}">${fmtVoto(media, getScala(fase))} <span class="text-[10px] text-slate-400">/${getScala(fase)}</span></td>
                <td class="py-2 pr-3 text-center">
                  <span class="text-[11px] px-2 py-0.5 rounded-full ${cf.stato === 'COMPLETATO' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${cf.stato}</span>
                </td>
                <td class="py-2 text-center">${cf.ammesso_prossima_fase ? '✅' : '—'}</td>
              </tr>
            `).join('')}
            ${rows.length === 0 ? `<tr><td colspan="6" class="text-center py-6 text-slate-500 italic">${escapeHtml(t('admin.fase.detail_empty'))}</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    `,
    primaryLabel: null,
    secondaryLabel: t('common.close'),
  });
}

// ---------- Candidati ----------
