// Tab "Sezioni & Categorie" del pannello Admin.
// Estratto da js/views/admin.js durante il refactoring per ridurre le 5660
// righe del file monolitico.

import { db } from '../../db.js';
import { escapeHtml, modal, confirmDialog, toast } from '../../utils.js';
import { icon } from '../../icons.js';
import { t } from '../../i18n.js';
import { iconaPerSezione } from './common.js';

export function renderSezioni(root, concorso) {
  const sezioni = db.sezioniByConcorso(concorso.id);
  root.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h3 class="text-sm font-bold text-slate-800 uppercase tracking-wider">${escapeHtml(t('admin.sezioni.heading'))}</h3>
      <button data-action="add-sez" class="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm">${escapeHtml(t('admin.sezioni.add'))}</button>
    </div>
    <p class="text-sm text-slate-600 mb-4">${t('admin.sezioni.subtitle')}</p>
    ${sezioni.length === 0 ? `
      <div class="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
        <div class="text-4xl mb-2">🗂</div>
        <p class="text-sm text-slate-500 italic">${escapeHtml(t('admin.sezioni.empty'))}</p>
      </div>
    ` : `
      <ul class="space-y-3">
        ${sezioni.map(s => sezioneCardHtml(s)).join('')}
      </ul>
    `}
  `;
  root.querySelector('[data-action="add-sez"]').addEventListener('click', () => openSezioneForm(concorso, null, () => renderSezioni(root, concorso)));
  root.querySelectorAll('[data-edit-sez]').forEach(b => b.addEventListener('click', () => {
    const s = db.state.sezioni.find(x => x.id === b.dataset.editSez);
    if (s) openSezioneForm(concorso, s, () => renderSezioni(root, concorso));
  }));
  root.querySelectorAll('[data-del-sez]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.delSez;
    const s = db.state.sezioni.find(x => x.id === id);
    confirmDialog({
      title: t('admin.sezioni.delete_title', { nome: s?.nome }),
      message: t('admin.sezioni.delete_msg'),
      danger: true,
      onConfirm: async () => {
        try { await db.deleteSezione(id); renderSezioni(root, concorso); }
        catch (e) { toast(e.message, 'error'); }
      }
    });
  }));
  root.querySelectorAll('[data-add-cat]').forEach(b => b.addEventListener('click', () => {
    const sezId = b.dataset.addCat;
    openCategoriaForm(sezId, null, () => renderSezioni(root, concorso));
  }));
  root.querySelectorAll('[data-edit-cat]').forEach(b => b.addEventListener('click', () => {
    const c = db.state.categorie.find(x => x.id === b.dataset.editCat);
    if (c) openCategoriaForm(c.sezione_id, c, () => renderSezioni(root, concorso));
  }));
  root.querySelectorAll('[data-del-cat]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.delCat;
    const c = db.state.categorie.find(x => x.id === id);
    confirmDialog({
      title: t('admin.categoria.delete_title', { nome: c?.nome }),
      message: t('admin.categoria.delete_msg'),
      danger: true,
      onConfirm: async () => {
        try { await db.deleteCategoria(id); renderSezioni(root, concorso); }
        catch (e) { toast(e.message, 'error'); }
      }
    });
  }));
  root.querySelectorAll('[data-copy-cats-from]').forEach(b => b.addEventListener('click', () => {
    openCopyCategorieModal(concorso, b.dataset.copyCatsFrom, () => renderSezioni(root, concorso));
  }));
}

// Modale: copia le categorie di una sezione sorgente in una o più sezioni destinazione.
function openCopyCategorieModal(concorso, fromSezioneId, onSaved) {
  const fromSez = db.state.sezioni.find(s => s.id === fromSezioneId);
  if (!fromSez) return;
  const fromCats = db.categorieBySezione(fromSezioneId);
  const otherSezioni = db.sezioniByConcorso(concorso.id).filter(s => s.id !== fromSezioneId);

  if (otherSezioni.length === 0) {
    toast('Non ci sono altre sezioni in cui copiare le categorie.', 'warn');
    return;
  }

  modal({
    title: `Copia categorie da “${fromSez.nome}”`,
    contentHtml: `
      <div class="space-y-4">
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <p class="text-xs font-semibold text-slate-600 mb-1.5">Categorie che verranno copiate (${fromCats.length}):</p>
          <ul class="text-sm text-slate-800 space-y-0.5">
            ${fromCats.map(c => `<li>· ${escapeHtml(c.nome)}${c.descrizione ? ` <span class="text-xs text-slate-500">(${escapeHtml(c.descrizione)})</span>` : ''}</li>`).join('')}
          </ul>
        </div>
        <fieldset>
          <legend class="text-sm font-semibold text-slate-800 mb-2">Sezioni destinazione</legend>
          <div class="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            ${otherSezioni.map(s => {
              const existingCats = db.categorieBySezione(s.id).length;
              return `
                <label class="flex items-start gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" name="dest" value="${s.id}" class="mt-0.5" />
                  <span class="min-w-0 flex-1">
                    <span class="font-medium text-slate-800">${escapeHtml(s.nome)}</span>
                    <span class="text-[11px] text-slate-500 ml-1">(${existingCats} categori${existingCats === 1 ? 'a' : 'e'})</span>
                  </span>
                </label>
              `;
            }).join('')}
          </div>
        </fieldset>
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="skipDup" checked />
          <span>Salta categorie con nome già presente nella destinazione</span>
        </label>
      </div>
    `,
    primaryLabel: 'Copia categorie',
    onPrimary: async (body) => {
      const destIds = Array.from(body.querySelectorAll('[name="dest"]:checked')).map(el => el.value);
      if (destIds.length === 0) {
        toast('Seleziona almeno una sezione destinazione.', 'error');
        return false;
      }
      const skipDup = body.querySelector('[name="skipDup"]').checked;
      try {
        const r = await db.copyCategorieToSezioni({
          from_sezione_id: fromSezioneId,
          to_sezioni_ids: destIds,
          skipDuplicates: skipDup,
        });
        const msg = `${r.created} categori${r.created === 1 ? 'a copiata' : 'e copiate'}` + (r.skipped > 0 ? `, ${r.skipped} saltat${r.skipped === 1 ? 'a' : 'e'} (duplicate)` : '');
        toast(msg, 'success');
        if (typeof onSaved === 'function') onSaved();
      } catch (e) {
        toast(e.message || 'Errore copia categorie', 'error');
        return false;
      }
    },
  });
}

function sezioneCardHtml(s) {
  const cats = db.categorieBySezione(s.id);
  const candCount = db.state.candidati.filter(c => Array.isArray(c.sezioni_ids) && c.sezioni_ids.includes(s.id)).length;
  return `
    <li class="bg-white border border-slate-200 rounded-2xl p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center text-lg shrink-0">${iconaPerSezione(s.nome)}</div>
          <div class="min-w-0">
            <h4 class="font-bold text-slate-900">${escapeHtml(s.nome)}</h4>
            ${s.descrizione ? `<p class="text-xs text-slate-500 mt-0.5">${escapeHtml(s.descrizione)}</p>` : ''}
            <p class="text-[11px] text-slate-500 mt-1">${escapeHtml(cats.length === 1 ? t('admin.sezioni.cats_one', { n: cats.length }) : t('admin.sezioni.cats_other', { n: cats.length }))} · ${escapeHtml(t('admin.sezioni.cands_count', { n: candCount }))}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button data-edit-sez="${s.id}" class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100 transition-colors" title="${escapeHtml(t('admin.sezioni.btn_edit_title'))}">${icon('edit', { size: 18 })}</button>
          <button data-del-sez="${s.id}" class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors" title="${escapeHtml(t('admin.sezioni.btn_delete_title'))}">${icon('trash', { size: 18 })}</button>
        </div>
      </div>
      <div class="mt-3 ml-13 sm:ml-13 pl-3 border-l-2 border-slate-100">
        ${cats.length === 0 ? `<p class="text-xs text-slate-400 italic mb-2">${escapeHtml(t('admin.sezioni.no_cats'))}</p>` : `
          <ul class="space-y-1.5 mb-2">
            ${cats.map(c => `
              <li class="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2">
                <div class="min-w-0">
                  <span class="text-sm font-medium text-slate-800">${escapeHtml(c.nome)}</span>
                  ${c.descrizione ? `<span class="text-[11px] text-slate-500 ml-2">${escapeHtml(c.descrizione)}</span>` : ''}
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <button data-edit-cat="${c.id}" class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-700 bg-white hover:bg-brand-50 border border-brand-100 transition-colors" title="${escapeHtml(t('admin.sezioni.btn_edit_title'))}">${icon('edit', { size: 18 })}</button>
                  <button data-del-cat="${c.id}" class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-white hover:bg-rose-50 border border-rose-100 transition-colors" title="${escapeHtml(t('admin.sezioni.btn_delete_title'))}">${icon('trash', { size: 18 })}</button>
                </div>
              </li>
            `).join('')}
          </ul>
        `}
        <div class="flex flex-wrap items-center gap-2">
          <button data-add-cat="${s.id}" class="text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5">${icon('plus', { size: 14 })}<span>${escapeHtml(t('admin.sezioni.add_cat'))}</span></button>
          ${cats.length > 0 ? `<button data-copy-cats-from="${s.id}" class="text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5" title="Copia queste categorie in altre sezioni">${icon('copy', { size: 14 })}<span>Copia in…</span></button>` : ''}
        </div>
      </div>
    </li>
  `;
}

function openSezioneForm(concorso, existing, onSaved) {
  const isEdit = !!existing;
  const inputCls = 'mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500';
  modal({
    title: isEdit ? t('admin.sezione.edit_title', { nome: existing.nome }) : t('admin.sezione.add_title'),
    contentHtml: `
      <form id="frm" class="space-y-3">
        <label class="block">
          <span class="text-sm font-medium text-slate-700">${escapeHtml(t('admin.concorso.field_simple_nome'))} <span class="text-rose-500">*</span></span>
          <input name="nome" required value="${escapeHtml(existing?.nome || '')}" class="${inputCls}" placeholder="${escapeHtml(t('admin.sezione.field_nome_ph'))}" />
        </label>
        <label class="block">
          <span class="text-sm font-medium text-slate-700">${escapeHtml(t('admin.sezione.field_descrizione'))}</span>
          <textarea name="descrizione" rows="2" class="${inputCls}" placeholder="${escapeHtml(t('admin.sezione.field_descrizione_ph'))}">${escapeHtml(existing?.descrizione || '')}</textarea>
        </label>
      </form>
    `,
    primaryLabel: isEdit ? t('admin.sezione.save_edit') : t('admin.sezione.save_create'),
    onPrimary: async (body) => {
      const data = Object.fromEntries(new FormData(body.querySelector('#frm')));
      if (!data.nome) return false;
      try {
        if (isEdit) await db.updateSezione(existing.id, { nome: data.nome.trim(), descrizione: (data.descrizione||'').trim() });
        else await db.createSezione({ concorso_id: concorso.id, nome: data.nome.trim(), descrizione: (data.descrizione||'').trim() });
        toast(isEdit ? t('admin.sezione.updated') : t('admin.sezione.created'), 'success');
        if (onSaved) onSaved();
      } catch (e) {
        console.error(e);
        toast(t('admin.concorso.error_prefix', { msg: e?.message || t('admin.sezione.error_fallback') }), 'error');
        return false;
      }
    }
  });
}

function openCategoriaForm(sezione_id, existing, onSaved) {
  const isEdit = !!existing;
  const sez = db.state.sezioni.find(s => s.id === sezione_id);
  const inputCls = 'mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500';
  modal({
    title: isEdit ? t('admin.categoria.edit_title', { nome: existing.nome }) : t('admin.categoria.add_title', { nome: sez?.nome || '' }),
    contentHtml: `
      <form id="frm" class="space-y-3">
        <label class="block">
          <span class="text-sm font-medium text-slate-700">${escapeHtml(t('admin.concorso.field_simple_nome'))} <span class="text-rose-500">*</span></span>
          <input name="nome" required value="${escapeHtml(existing?.nome || '')}" class="${inputCls}" placeholder="${escapeHtml(t('admin.categoria.field_nome_ph'))}" />
        </label>
        <label class="block">
          <span class="text-sm font-medium text-slate-700">${escapeHtml(t('admin.sezione.field_descrizione'))}</span>
          <textarea name="descrizione" rows="2" class="${inputCls}" placeholder="${escapeHtml(t('admin.categoria.field_descrizione_ph'))}">${escapeHtml(existing?.descrizione || '')}</textarea>
        </label>
      </form>
    `,
    primaryLabel: isEdit ? t('admin.categoria.save_edit') : t('admin.categoria.save_create'),
    onPrimary: async (body) => {
      const data = Object.fromEntries(new FormData(body.querySelector('#frm')));
      if (!data.nome) return false;
      try {
        if (isEdit) await db.updateCategoria(existing.id, { nome: data.nome.trim(), descrizione: (data.descrizione||'').trim() });
        else await db.createCategoria({ sezione_id, nome: data.nome.trim(), descrizione: (data.descrizione||'').trim() });
        toast(isEdit ? t('admin.categoria.updated') : t('admin.categoria.created'), 'success');
        if (onSaved) onSaved();
      } catch (e) {
        console.error(e);
        toast(t('admin.concorso.error_prefix', { msg: e?.message || t('admin.sezione.error_fallback') }), 'error');
        return false;
      }
    }
  });
}
