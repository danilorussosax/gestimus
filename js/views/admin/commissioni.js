// Tab "Commissioni" del pannello Admin.
// Estratto da js/views/admin.js (refactoring).

import { db } from '../../db.js';
import { escapeHtml, modal, toast, confirmDialog, displayName, safeUrl, formFields } from '../../utils.js';
import { icon } from '../../icons.js';
import { t } from '../../i18n.js';
import { iconaPerSezione } from './common.js';

export function renderCommissioni(root, concorso) {
  const list = db.commissioniByConcorso(concorso.id);
  const sezioni = db.sezioniByConcorso(concorso.id);
  const allCom = db.commissariByConcorso(concorso.id);
  root.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h3 class="text-sm font-bold text-slate-800 uppercase tracking-wider">${escapeHtml(t('admin.commissioni.heading'))}</h3>
      <button data-action="add-comm" class="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm">${escapeHtml(t('admin.commissioni.add'))}</button>
    </div>
    <p class="text-sm text-slate-600 mb-4">${t('admin.commissioni.subtitle')}</p>

    ${allCom.length === 0 ? `<div class="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-4 text-sm">${escapeHtml(t('admin.commissioni.warn_no_com'))}</div>` : ''}
    ${sezioni.length === 0 ? `<div class="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-4 text-sm">${escapeHtml(t('admin.commissioni.warn_no_sez'))}</div>` : ''}

    ${list.length === 0 ? `
      <div class="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
        <div class="text-4xl mb-2">⚖</div>
        <p class="text-sm text-slate-500 italic">${escapeHtml(t('admin.commissioni.empty'))}</p>
      </div>
    ` : `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        ${list.map(c => commissioneCardHtml(c)).join('')}
      </div>
    `}
  `;
  root.querySelector('[data-action="add-comm"]').addEventListener('click', () => openCommissioneForm(concorso, null, () => renderCommissioni(root, concorso)));
  root.querySelectorAll('[data-edit-comm]').forEach(b => b.addEventListener('click', () => {
    const c = db.state.commissioni.find(x => x.id === b.dataset.editComm);
    if (c) openCommissioneForm(concorso, c, () => renderCommissioni(root, concorso));
  }));
  root.querySelectorAll('[data-del-comm]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.delComm;
    const c = db.state.commissioni.find(x => x.id === id);
    confirmDialog({
      title: t('admin.commissioni.delete_title', { nome: c?.nome }),
      message: t('admin.commissioni.delete_msg'),
      danger: true,
      onConfirm: async () => {
        try { await db.deleteCommissione(id); renderCommissioni(root, concorso); }
        catch (e) { toast(e.message, 'error'); }
      }
    });
  }));
}

function commissioneCardHtml(c) {
  const members = c.commissari_ids.map(id => db.state.commissari.find(x => x.id === id)).filter(Boolean);
  const sezs = c.sezioni_ids.map(id => db.state.sezioni.find(x => x.id === id)).filter(Boolean);
  const directCats = c.categorie_ids.map(id => db.state.categorie.find(x => x.id === id)).filter(Boolean);
  const effectiveCatIds = db.effectiveCategorieForCommissione(c);
  const allCats = effectiveCatIds.map(id => db.state.categorie.find(x => x.id === id)).filter(Boolean);
  const autoCats = allCats.filter(cat => !c.categorie_ids.includes(cat.id));
  // Presidente di QUESTA commissione (non di altre)
  const pres = c.presidente_id ? db.state.commissari.find(x => x.id === c.presidente_id) : null;
  return `
    <div class="bg-white border border-slate-200 rounded-2xl p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h4 class="font-bold text-slate-900 truncate">${escapeHtml(c.nome)}</h4>
          ${c.descrizione ? `<p class="text-xs text-slate-500 mt-0.5">${escapeHtml(c.descrizione)}</p>` : ''}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button data-edit-comm="${c.id}" class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100 transition-colors" title="${escapeHtml(t('admin.sezioni.btn_edit_title'))}">${icon('edit', { size: 18 })}</button>
          <button data-del-comm="${c.id}" class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors" title="${escapeHtml(t('admin.sezioni.btn_delete_title'))}">${icon('trash', { size: 18 })}</button>
        </div>
      </div>
      ${pres ? `
        <div class="mt-3 inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-2.5 py-1.5">
          <span class="text-base">🎯</span>
          <div class="text-[11px] leading-tight">
            <div class="font-bold uppercase tracking-wider text-[9px] text-amber-700">Presidente</div>
            <div class="font-semibold">${escapeHtml(displayName(pres))}</div>
          </div>
        </div>
      ` : `
        <div class="mt-3 inline-flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50/50 border border-dashed border-amber-300 rounded-lg px-2.5 py-1">
          <span>⚠</span><span class="italic">Nessun presidente — modifica per assegnarne uno</span>
        </div>
      `}
      <div class="mt-3 grid grid-cols-1 gap-2">
        <div>
          <div class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">${escapeHtml(t('admin.commissioni.col_members', { n: members.length }))}</div>
          <div class="flex flex-wrap gap-1">
            ${members.length === 0 ? `<span class="text-xs text-slate-400 italic">${escapeHtml(t('admin.commissioni.no_one'))}</span>` : members.map(m => {
              // 🎯 visibile SOLO se questo commissario è presidente di QUESTA
              // commissione (non se lo è di un'altra). Membri presidenti
              // altrove appaiono come membri normali in questa card.
              const isPresQui = c.presidente_id === m.id;
              return `
              <span class="inline-flex items-center gap-1 text-[11px] ${isPresQui ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded-full">
                <span class="w-4 h-4 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[9px] overflow-hidden">${m.foto_url && safeUrl(m.foto_url) ? `<img src="${safeUrl(m.foto_url)}" class="w-full h-full object-cover" alt="" />` : '🧑‍⚖️'}</span>
                ${escapeHtml(displayName(m))}${isPresQui ? ' 🎯' : ''}
              </span>`;
            }).join('')}
          </div>
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">${escapeHtml(t('admin.commissioni.col_sezioni', { n: sezs.length }))}${c.include_tutte_categorie && sezs.length ? escapeHtml(t('admin.commissioni.col_sezioni_auto')) : ''}</div>
          <div class="flex flex-wrap gap-1">
            ${sezs.length === 0 ? `<span class="text-xs text-slate-400 italic">${escapeHtml(t('admin.commissioni.no_sezioni'))}</span>` : sezs.map(s => `<span class="text-[11px] bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-medium">${iconaPerSezione(s.nome)} ${escapeHtml(s.nome)}</span>`).join('')}
          </div>
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">${escapeHtml(t('admin.commissioni.col_categorie', { n: allCats.length }))}</div>
          <div class="flex flex-wrap gap-1">
            ${allCats.length === 0 ? `<span class="text-xs text-slate-400 italic">${escapeHtml(t('admin.commissioni.no_categorie'))}</span>` : allCats.map(cat => {
              const isAuto = autoCats.includes(cat);
              const sez = db.state.sezioni.find(s => s.id === cat.sezione_id);
              return `<span class="text-[11px] ${isAuto ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded-full" title="${escapeHtml(sez?.nome || '')}${isAuto ? escapeHtml(t('admin.commissioni.cat_auto')) : ''}">${escapeHtml(cat.nome)}${isAuto ? ' ✨' : ''}</span>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---------- Iscrizioni (tab admin) ----------
// Stato locale del tab: lista cached + filtri. Ricaricata via refresh()
const _iscrizioniState = { items: [], filtro_stato: '', loading: false, error: null };

function openCommissioneForm(concorso, existing, onSaved) {
  const isEdit = !!existing;
  const allCom = db.commissariByConcorso(concorso.id);
  const sezioni = db.sezioniByConcorso(concorso.id);
  const inputCls = 'mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500';

  let selCommissari = new Set(existing?.commissari_ids || []);
  let selSezioni = new Set(existing?.sezioni_ids || []);
  let selCategorie = new Set(existing?.categorie_ids || []);
  let includeTutte = !!existing?.include_tutte_categorie;
  let selPresidente = existing?.presidente_id || '';

  const renderCommList = () => allCom.map(c => `
    <label class="flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer">
      <input type="checkbox" data-comm="${c.id}" ${selCommissari.has(c.id) ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-brand-600" />
      <div class="w-6 h-6 rounded-full bg-amber-100 text-amber-700 overflow-hidden flex items-center justify-center text-xs shrink-0">${c.foto_url && safeUrl(c.foto_url) ? `<img src="${safeUrl(c.foto_url)}" alt="" class="w-full h-full object-cover" />` : '🧑‍⚖️'}</div>
      <span class="text-sm text-slate-800 truncate">${escapeHtml(displayName(c))}${db.isPresidenteDiQualcheCommissione(c.id) ? ' 🎯' : ''}</span>
      <span class="text-[10px] text-slate-500 ml-auto truncate">${escapeHtml(c.specialita || '')}</span>
    </label>
  `).join('');

  const renderSezList = () => sezioni.map(s => `
    <label class="flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer">
      <input type="checkbox" data-sez="${s.id}" ${selSezioni.has(s.id) ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-brand-600" />
      <span class="text-sm text-slate-800">${escapeHtml(s.nome)}</span>
      <span class="text-[10px] text-slate-500 ml-auto">${escapeHtml(t('admin.commissione.cats_n_per_sez', { n: db.categorieBySezione(s.id).length }))}</span>
    </label>
  `).join('');

  const renderCatList = () => {
    if (sezioni.length === 0) return `<span class="text-xs text-slate-400 italic">${escapeHtml(t('admin.commissione.no_sez_avail'))}</span>`;
    return sezioni.map(s => {
      const cats = db.categorieBySezione(s.id);
      if (cats.length === 0) return '';
      return `
        <div class="border border-slate-200 rounded-lg p-2 bg-slate-50">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">${escapeHtml(s.nome)}</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1">
            ${cats.map(c => `
              <label class="flex items-center gap-2 bg-white hover:bg-brand-50 border border-slate-200 rounded-md px-2 py-1 cursor-pointer">
                <input type="checkbox" data-cat="${c.id}" ${selCategorie.has(c.id) ? 'checked' : ''} class="w-3.5 h-3.5 rounded border-slate-300 text-brand-600" />
                <span class="text-xs text-slate-800 truncate">${escapeHtml(c.nome)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  };

  modal({
    title: isEdit ? t('admin.commissione.edit_title', { nome: existing.nome }) : t('admin.commissione.add_title'),
    width: 'max-w-2xl',
    contentHtml: `
      <form id="frm" class="space-y-4" autocomplete="off">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block sm:col-span-2">
            <span class="text-sm font-medium text-slate-700">${escapeHtml(t('admin.commissione.field_nome'))} <span class="text-rose-500">*</span></span>
            <input name="nome" required value="${escapeHtml(existing?.nome || '')}" class="${inputCls}" placeholder="${escapeHtml(t('admin.commissione.field_nome_ph'))}" />
          </label>
          <label class="block sm:col-span-2">
            <span class="text-sm font-medium text-slate-700">${escapeHtml(t('admin.sezione.field_descrizione'))}</span>
            <textarea name="descrizione" rows="2" class="${inputCls}" placeholder="${escapeHtml(t('admin.sezione.field_descrizione_ph'))}">${escapeHtml(existing?.descrizione || '')}</textarea>
          </label>
        </div>

        <section class="pt-4 border-t border-slate-200">
          <header class="mb-2">
            <h4 class="text-sm font-bold text-slate-900">${escapeHtml(t('admin.commissione.section_membri'))}</h4>
            <p class="text-xs text-slate-500">${escapeHtml(t('admin.commissione.section_membri_help'))}</p>
          </header>
          <div class="space-y-1.5 max-h-56 overflow-y-auto pr-1" id="comm-list">
            ${allCom.length === 0 ? `<span class="text-xs text-slate-400 italic">${escapeHtml(t('admin.commissione.no_com_avail'))}</span>` : renderCommList()}
          </div>
          <div class="mt-2 text-[11px] text-slate-500">${t('admin.commissione.selected')}</div>

          <!-- Selezione presidente DI QUESTA COMMISSIONE -->
          <div class="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <label class="block">
              <span class="text-sm font-semibold text-amber-900 flex items-center gap-1.5">🎯 Presidente della commissione</span>
              <p class="text-[11px] text-amber-800 mt-0.5 mb-2">Il presidente pilota le fasi a cui questa commissione è assegnata: avvia/conclude, gestisce il timer, conferma le valutazioni.</p>
              <select id="presidente-select" class="${inputCls} mt-0">
                <option value="">— Nessun presidente (l'admin gestirà le fasi) —</option>
                ${allCom.map(c => `<option value="${escapeHtml(c.id)}" ${selPresidente === c.id ? 'selected' : ''} data-com-id="${escapeHtml(c.id)}">${escapeHtml(displayName(c))}${c.specialita ? ' · ' + escapeHtml(c.specialita) : ''}</option>`).join('')}
              </select>
              <p class="text-[10px] text-amber-700 mt-1 italic">Il presidente deve essere uno dei membri sopra selezionati.</p>
            </label>
          </div>
        </section>

        <section class="pt-4 border-t border-slate-200">
          <header class="mb-2">
            <h4 class="text-sm font-bold text-slate-900">${escapeHtml(t('admin.commissione.section_sezioni'))}</h4>
            <p class="text-xs text-slate-500">${escapeHtml(t('admin.commissione.section_sezioni_help'))}</p>
          </header>
          <div class="space-y-1.5 max-h-44 overflow-y-auto pr-1" id="sez-list">
            ${sezioni.length === 0 ? `<span class="text-xs text-slate-400 italic">${escapeHtml(t('admin.commissione.no_sez_avail'))}</span>` : renderSezList()}
          </div>
          ${sezioni.length > 0 ? `
            <label class="mt-3 flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 cursor-pointer">
              <input type="checkbox" id="incl-tutte" ${includeTutte ? 'checked' : ''} class="mt-0.5 w-4 h-4 rounded border-emerald-300 text-emerald-600" />
              <div>
                <span class="text-sm font-semibold text-emerald-900">${escapeHtml(t('admin.commissione.include_all_label'))}</span>
                <p class="text-[11px] text-emerald-800 mt-0.5">${t('admin.commissione.include_all_help')}</p>
              </div>
            </label>
          ` : ''}
        </section>

        <section class="pt-4 border-t border-slate-200">
          <header class="mb-2">
            <h4 class="text-sm font-bold text-slate-900">${escapeHtml(t('admin.commissione.section_categorie'))}</h4>
            <p class="text-xs text-slate-500">${escapeHtml(t('admin.commissione.section_categorie_help'))}</p>
          </header>
          <div class="space-y-2" id="cat-list">${renderCatList()}</div>
        </section>
      </form>
    `,
    primaryLabel: isEdit ? t('admin.commissione.save_edit') : t('admin.commissione.save_create'),
    onMount: (body) => {
      const updateCount = () => {
        body.querySelector('[data-comm-count]').textContent = String(selCommissari.size);
      };
      // Quando "Includi tutte le categorie" è attivo, le categorie delle
      // sezioni scelte vengono auto-popolate e le relative checkbox bloccate
      // in stato checked: l'admin vede subito cosa verrà attaccato e non può
      // de-selezionare manualmente (il flag domina). Cambia sezione o flag
      // → ri-sincronizza.
      const syncCategorieAuto = () => {
        if (!includeTutte) {
          // Riabilita le checkbox: lo stato delle categorie è quello che
          // l'admin ha scelto manualmente (selCategorie).
          body.querySelectorAll('input[data-cat]').forEach((cb) => { /** @type {HTMLInputElement} */ (cb).disabled = false; });
          return;
        }
        // Calcola unione delle categorie delle sezioni selezionate
        const auto = new Set();
        for (const sezId of selSezioni) {
          db.categorieBySezione(sezId).forEach((c) => auto.add(c.id));
        }
        selCategorie = auto;
        body.querySelectorAll('input[data-cat]').forEach((el) => {
          const cb = /** @type {HTMLInputElement} */ (el);
          cb.checked = auto.has(cb.dataset.cat);
          cb.disabled = true;
        });
      };

      body.addEventListener('change', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t.dataset.comm) {
          if (t.checked) selCommissari.add(t.dataset.comm); else selCommissari.delete(t.dataset.comm);
          if (!t.checked && t.dataset.comm === selPresidente) {
            selPresidente = '';
            const sel = /** @type {HTMLSelectElement|null} */ (body.querySelector('#presidente-select'));
            if (sel) sel.value = '';
          }
          updateCount();
        } else if (t.dataset.sez) {
          if (t.checked) selSezioni.add(t.dataset.sez); else selSezioni.delete(t.dataset.sez);
          // Re-sync se la modalità "tutte" è attiva: il cambio sezione cambia
          // l'insieme delle categorie auto-derivate.
          if (includeTutte) syncCategorieAuto();
        } else if (t.dataset.cat) {
          if (t.checked) selCategorie.add(t.dataset.cat); else selCategorie.delete(t.dataset.cat);
        } else if (t.id === 'incl-tutte') {
          includeTutte = t.checked;
          syncCategorieAuto();
        } else if (t.id === 'presidente-select') {
          selPresidente = t.value;
        }
      });
      updateCount();
      // Sync iniziale: in edit-mode `existing.include_tutte_categorie` può
      // venire da una sessione precedente; ripristiniamo coerenza con le
      // sezioni selezionate.
      if (includeTutte) syncCategorieAuto();
    },
    onPrimary: async (body) => {
      const data = formFields(body.querySelector('#frm'));
      if (!data.nome) return false;
      // Verifica che il presidente sia tra i membri selezionati. Se non lo è
      // (l'admin ha cambiato i membri dopo aver scelto il presidente), lo azzero.
      const presidenteValido = selPresidente && selCommissari.has(selPresidente) ? selPresidente : '';
      // Se "tutte le categorie" è attivo, espandi qui — il flag in-memory
      // non viene persistito, quello che conta è l'array `categorie_ids`
      // mandato al backend. Difesa contro race su syncCategorieAuto.
      let finalCategorieIds = Array.from(selCategorie);
      if (includeTutte) {
        const auto = new Set();
        for (const sezId of selSezioni) {
          db.categorieBySezione(sezId).forEach((c) => auto.add(c.id));
        }
        finalCategorieIds = Array.from(auto);
      }
      const payload = {
        nome: data.nome.trim(),
        descrizione: (data.descrizione || '').trim(),
        commissari_ids: Array.from(selCommissari),
        sezioni_ids: Array.from(selSezioni),
        categorie_ids: finalCategorieIds,
        include_tutte_categorie: includeTutte,
        presidente_id: presidenteValido,
      };
      try {
        if (isEdit) await db.updateCommissione(existing.id, payload);
        else await db.createCommissione({ concorso_id: concorso.id, ...payload });
        toast(isEdit ? t('admin.commissione.updated') : t('admin.commissione.created'), 'success');
        if (onSaved) onSaved();
      } catch (e) {
        console.error(e);
        toast(t('admin.concorso.error_prefix', { msg: e?.message || t('admin.sezione.error_fallback') }), 'error');
        return false;
      }
    }
  });
}

