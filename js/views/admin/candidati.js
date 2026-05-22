// Tab "Candidati" + modali storico + membri gruppo.
// Estratto da js/views/admin.js (refactoring).

import { db } from '../../db.js';
import {
  escapeHtml, modal, toast, confirmDialog, displayName, fmtDate, fmtBytes,
  ageFromDate, readImageResized, NATIONALITIES,
} from '../../utils.js';
import { t } from '../../i18n.js';
import { openImportModal } from './import.js';

export function openStoricoCandidato(cand) {
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const key = `${norm(cand.nome)}|${norm(cand.cognome)}`;
  const allMatches = db.state.candidati.filter(c =>
    c.id !== cand.id && `${norm(c.nome)}|${norm(c.cognome)}` === key
  );

  const rows = allMatches.map(c => {
    const concorso = db.state.concorsi.find(x => x.id === c.concorso_id);
    return { cand: c, concorso };
  }).sort((a, b) => (b.concorso?.anno || 0) - (a.concorso?.anno || 0));

  modal({
    title: t('admin.storico.title', { nome: escapeHtml(displayName(cand)) }),
    width: 'max-w-2xl',
    contentHtml: rows.length === 0 ? `
      <p class="text-sm text-slate-500 italic text-center py-8">${t('admin.storico.empty')}</p>
    ` : `
      <div class="space-y-3">
        ${rows.map(({ cand: c, concorso }) => {
          const fasi = db.fasiByConcorso(concorso?.id);
          const cfs = db.state.candidati_fase.filter(cf => cf.candidato_id === c.id);
          const vals = db.state.valutazioni.filter(v => cfs.some(cf => cf.id === v.candidato_fase_id));
          return `
            <div class="bg-white border border-slate-200 rounded-xl p-4">
              <div class="flex items-center justify-between gap-3 mb-2">
                <div>
                  <span class="font-semibold text-slate-900">${escapeHtml(concorso?.nome || '—')}</span>
                  <span class="text-xs text-slate-500 ml-2">${concorso?.anno || '—'}</span>
                </div>
                <span class="text-xs text-slate-500">#${c.numero_candidato}</span>
              </div>
              <div class="grid grid-cols-4 gap-2 text-xs">
                <div class="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                  <div class="text-slate-500">fasi</div>
                  <div class="font-bold text-slate-800">${fasi.length}</div>
                </div>
                <div class="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                  <div class="text-slate-500">esibizioni</div>
                  <div class="font-bold text-slate-800">${cfs.length}</div>
                </div>
                <div class="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                  <div class="text-slate-500">valutazioni</div>
                  <div class="font-bold text-slate-800">${vals.length}</div>
                </div>
                <div class="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                  <div class="text-slate-500">strumento</div>
                  <div class="font-bold text-slate-800 truncate text-[11px]">${escapeHtml(c.strumento || '—')}</div>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
    `,
    primaryLabel: null,
    secondaryLabel: t('common.close'),
  });
}

// ---------- Gestione membri gruppo ----------
export function openMembriGruppoModal(concorso, gruppo, onSaved) {
  // Guardia: la modale ha senso solo per candidati di tipo 'gruppo'.
  if (!gruppo || gruppo.tipo !== 'gruppo') {
    toast(t('admin.gruppo.not_group') || 'Questo candidato non è un gruppo', 'error');
    return;
  }
  const membri = db.membriGruppo(gruppo.id);
  const membriIds = new Set(membri.map(m => m.candidato_id));
  const candidatiDisponibili = db.candidatiByConcorso(concorso.id)
    .filter(c => c.id !== gruppo.id && c.tipo !== 'gruppo' && !membriIds.has(c.id));

  modal({
    title: t('admin.gruppo.members_title', { nome: gruppo.nome }),
    width: 'max-w-2xl',
    contentHtml: `
      <div class="space-y-4">
        ${membri.length > 0 ? `
          <div>
            <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">${escapeHtml(t('admin.gruppo.current_members'))} (${membri.length})</p>
            <div class="space-y-2">
              ${membri.map(m => `
                <div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-medium text-slate-800 text-sm truncate">${escapeHtml(displayName(m.candidato))}</span>
                    ${m.strumento_gruppo ? `<span class="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded-full">${escapeHtml(m.strumento_gruppo)}</span>` : ''}
                  </div>
                  <button data-remove-member="${m.candidato_id}" class="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium shrink-0">${escapeHtml(t('common.delete'))}</button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : `<p class="text-sm text-slate-500 italic">${escapeHtml(t('admin.gruppo.no_members'))}</p>`}

        <div class="pt-3 border-t border-slate-200">
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">${escapeHtml(t('admin.gruppo.add_member'))}</p>
          <input type="text" data-search-candidate class="mb-2 w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-brand-500" placeholder="Cerca candidato..." />
          ${candidatiDisponibili.length === 0 ? `<p class="text-sm text-slate-400 italic">${escapeHtml(t('admin.gruppo.no_candidates'))}</p>` : `
            <div class="space-y-2 max-h-48 overflow-y-auto">
              ${candidatiDisponibili.map(c => `
                <div data-candidate-row class="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2 hover:border-brand-200 transition">
                  <div class="min-w-0">
                    <div class="font-medium text-slate-800 text-sm truncate">${escapeHtml(displayName(c))} · ${escapeHtml(c.strumento || '—')}</div>
                  </div>
                  <button data-add-member="${c.id}" class="text-xs text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg font-medium shrink-0">+ ${escapeHtml(t('admin.gruppo.add'))}</button>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `,
    onMount: (body) => {
      body.querySelectorAll('[data-remove-member]').forEach(b => {
        b.addEventListener('click', async () => {
          await db.removeMembroGruppo(gruppo.id, b.dataset.removeMember);
          openMembriGruppoModal(concorso, gruppo, onSaved);
        });
      });
      body.querySelectorAll('[data-add-member]').forEach(b => {
        b.addEventListener('click', async () => {
          await db.addMembroGruppo(gruppo.id, b.dataset.addMember);
          openMembriGruppoModal(concorso, gruppo, onSaved);
        });
      });
      body.querySelector('[data-search-candidate]')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        const rows = body.querySelectorAll('[data-candidate-row]');
        rows.forEach(row => {
          const text = row.textContent.toLowerCase();
          row.classList.toggle('hidden', q && !text.includes(q));
        });
      });
    },
  });
}

// ---------- Fasi (tab admin) ----------

export function renderCandidati(root, concorso) {
  const list = db.candidatiByConcorso(concorso.id);
  root.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
      <p class="text-sm text-slate-600">${escapeHtml(t('admin.candidati.count', { n: list.length }))}</p>
      <div class="flex items-center gap-2">
        <button data-action="import" class="text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-lg">${escapeHtml(t('admin.candidati.import'))}</button>
        <button data-action="add" class="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm">${escapeHtml(t('admin.candidati.add'))}</button>
      </div>
    </div>

    ${list.length === 0 ? `
      <div class="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
        <div class="text-4xl mb-2">🎓</div>
        <p class="text-sm text-slate-500 italic">${escapeHtml(t('admin.candidati.empty'))}</p>
      </div>
    ` : `
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        ${list.map(c => candidatoCardHtml(c)).join('')}
      </div>
    `}
  `;

  root.querySelector('[data-action="add"]').addEventListener('click', () => openCandidatoForm(concorso, null, () => renderCandidati(root, concorso)));
  root.querySelector('[data-action="import"]').addEventListener('click', () => openImportModal(concorso, 'candidati', () => renderCandidati(root, concorso)));

  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const c = db.state.candidati.find(x => x.id === b.dataset.edit);
    if (c) openCandidatoForm(concorso, c, () => renderCandidati(root, concorso));
  }));

  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.del;
    confirmDialog({
      title: t('admin.candidati.delete_title'),
      message: t('admin.candidati.delete_msg'),
      danger: true,
      onConfirm: async () => {
        try { await db.deleteCandidato(id); renderCandidati(root, concorso); }
        catch (e) { toast(e.message, 'error'); }
      }
    });
  }));

  root.querySelectorAll('[data-manage-members]').forEach(b => b.addEventListener('click', () => {
    const c = db.state.candidati.find(x => x.id === b.dataset.manageMembers);
    if (c) openMembriGruppoModal(concorso, c, () => renderCandidati(root, concorso));
  }));
  root.querySelectorAll('[data-history]').forEach(b => b.addEventListener('click', () => {
    const c = db.state.candidati.find(x => x.id === b.dataset.history);
    if (c) openStoricoCandidato(c);
  }));
}

function candidatoCardHtml(c) {
  const eta = ageFromDate(c.data_nascita) ?? c.eta;
  const docenti = c.docenti_preparatori || [];
  const sezioni = (c.sezioni_ids || []).map(id => db.state.sezioni.find(s => s.id === id)).filter(Boolean);
  const categorie = (c.categorie_ids || []).map(id => db.state.categorie.find(x => x.id === id)).filter(Boolean);
  const isGruppo = c.tipo === 'gruppo';
  const membri = isGruppo ? db.membriGruppo(c.id) : [];
  return `
    <div class="bg-white border ${isGruppo ? 'border-purple-200 bg-purple-50/30' : 'border-slate-200'} rounded-2xl p-4 flex items-start gap-3 hover:border-slate-300 transition">
      <div class="w-14 h-14 rounded-full ${isGruppo ? 'bg-purple-100' : 'bg-slate-100'} overflow-hidden flex items-center justify-center text-2xl text-slate-400 shrink-0 ring-2 ring-white shadow-soft">
        ${c.foto ? `<img src="${c.foto}" alt="" class="w-full h-full object-cover" />` : (isGruppo ? '🎻' : '👤')}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-mono text-[11px] text-slate-500">#${String(c.numero_candidato).padStart(3,'0')}</span>
          ${isGruppo ? `<span class="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full font-bold uppercase tracking-wider">${escapeHtml(t('admin.candidati.gruppo_badge'))}</span>` : ''}
          ${!isGruppo && c.nazionalita ? `<span class="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded-full font-medium">${escapeHtml(c.nazionalita)}</span>` : ''}
        </div>
        <h4 class="font-semibold text-slate-900 truncate mt-0.5">${escapeHtml(displayName(c))}</h4>
        <p class="text-xs text-slate-600 truncate">${escapeHtml(c.strumento || '—')}${!isGruppo && eta ? ` · ${escapeHtml(t('admin.candidati.years', { n: eta }))}` : ''}</p>
        ${isGruppo && membri.length > 0 ? `
          <div class="mt-1.5 flex items-center gap-1 flex-wrap">
            ${membri.map(m => `<span class="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">${escapeHtml(m.candidato?.nome || '')} ${escapeHtml(m.candidato?.cognome || '')}${m.strumento_gruppo ? ' · ' + escapeHtml(m.strumento_gruppo) : ''}</span>`).join('')}
          </div>
        ` : ''}
        ${membri.length > 0 ? `<p class="text-[10px] text-purple-600 mt-0.5 font-medium">${escapeHtml(t('admin.candidati.members_count', { n: membri.length }))}</p>` : ''}
        ${!isGruppo && c.data_nascita ? `<p class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(t('admin.candidati.born_on', { date: fmtDate(c.data_nascita) }))}</p>` : ''}
        ${(sezioni.length || categorie.length) ? `
          <div class="mt-1.5 flex items-center gap-1 flex-wrap">
            ${sezioni.map(s => `<span class="text-[10px] px-1.5 py-0.5 bg-brand-50 text-brand-700 rounded-full font-medium">${iconaPerSezione(s.nome)} ${escapeHtml(s.nome)}</span>`).join('')}
            ${categorie.map(cat => `<span class="text-[10px] px-1.5 py-0.5 bg-cyan-50 text-cyan-700 rounded-full font-medium">📑 ${escapeHtml(cat.nome)}</span>`).join('')}
          </div>
        ` : ''}
        <div class="mt-2 flex items-center gap-1.5 flex-wrap">
          ${docenti.length > 0 ? `<span class="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-full font-medium" title="${escapeHtml(docenti.join(' · '))}">${escapeHtml(docenti.length === 1 ? t('admin.candidati.docenti_count_one', { n: docenti.length }) : t('admin.candidati.docenti_count_other', { n: docenti.length }))}</span>` : ''}
        </div>
      </div>
      <div class="flex flex-col gap-1 shrink-0">
        <button data-edit="${c.id}" class="text-xs text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg font-medium">${escapeHtml(t('admin.candidati.btn_edit'))}</button>
        ${isGruppo ? `<button data-manage-members="${c.id}" class="text-xs text-purple-600 hover:bg-purple-50 px-2 py-1 rounded-lg font-medium">${escapeHtml(t('admin.candidati.btn_members'))}</button>` : ''}
        ${!isGruppo ? `<button data-history="${c.id}" class="text-xs text-amber-600 hover:bg-amber-50 px-2 py-1 rounded-lg font-medium">${escapeHtml(t('admin.candidati.btn_history'))}</button>` : ''}
        <button data-del="${c.id}" class="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium">${escapeHtml(t('admin.candidati.btn_delete'))}</button>
      </div>
    </div>
  `;
}

function openCv(cv) {
  if (!cv?.dataURL) return;
  if (cv.type === 'application/pdf') {
    const win = window.open();
    if (win) {
      win.document.title = cv.name || 'CV';
      win.document.body.style.margin = '0';
      win.document.body.innerHTML = `<iframe src="${cv.dataURL}" style="width:100vw;height:100vh;border:0"></iframe>`;
      return;
    }
  }
  // fallback: download
  const a = document.createElement('a');
  a.href = cv.dataURL;
  a.download = cv.name || 'cv';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function cvBadge(cv) {
  return `
    <div class="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
      <div class="min-w-0">
        <div class="text-sm font-medium text-emerald-900 truncate">📄 ${escapeHtml(cv.name || 'CV')}</div>
        <div class="text-[11px] text-emerald-700">${fmtBytes(cv.size || 0)}</div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button type="button" data-cv-pick class="text-xs font-medium text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded-lg">${escapeHtml(t('admin.candidato.cv_replace'))}</button>
        <button type="button" data-cv-clear class="text-xs font-medium text-rose-600 hover:text-rose-800 px-2 py-1 rounded-lg">${escapeHtml(t('admin.candidato.remove'))}</button>
      </div>
    </div>
  `;
}

function fotoPreviewHtml(fotoData) {
  return fotoData
    ? `<img src="${fotoData}" alt="" class="w-full h-full object-cover" />`
    : '<span class="text-3xl text-slate-400">👤</span>';
}

function openCandidatoForm(concorso, candidato, onSaved) {
  const isEdit = !!candidato;
  // Backward compat: split legacy combined nome.
  let initNome = candidato?.nome || '';
  let initCognome = candidato?.cognome || '';
  if (candidato && !initCognome && initNome.includes(' ')) {
    const parts = initNome.split(/\s+/);
    initNome = parts[0];
    initCognome = parts.slice(1).join(' ');
  }
  const initStrumento = candidato?.strumento || '';
  const initData = candidato?.data_nascita || '';
  const initNaz = candidato?.nazionalita || '';
  const initDocenti = (candidato?.docenti_preparatori || []).join('\n');
  let fotoData = candidato?.foto || null;
  const initialFoto = candidato?.foto || null;
  const todayISO = new Date().toISOString().slice(0,10);
  const initSezIds = new Set(Array.isArray(candidato?.sezioni_ids) ? candidato.sezioni_ids : []);
  const initCatIds = new Set(Array.isArray(candidato?.categorie_ids) ? candidato.categorie_ids : []);
  const allSezioni = db.sezioniByConcorso(concorso.id);

  const inputCls = 'mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500';
  const labelCls = 'block';
  const labelText = (text, required = false) => `<span class="text-sm font-medium text-slate-700">${text}${required ? ' <span class="text-rose-500">*</span>' : ''}</span>`;

  modal({
    title: isEdit ? t('admin.candidato.edit_title') : t('admin.candidato.add_title'),
    width: 'max-w-3xl',
    contentHtml: `
      <form id="frm" class="space-y-5" autocomplete="off">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="${labelCls}">
            ${labelText(escapeHtml(t('admin.candidato.field_nome')), true)}
            <input name="nome" required value="${escapeHtml(initNome)}" class="${inputCls}" />
          </label>
          <label class="${labelCls}">
            ${labelText(escapeHtml(t('admin.candidato.field_cognome')), true)}
            <input name="cognome" required value="${escapeHtml(initCognome)}" class="${inputCls}" />
          </label>
          <label class="${labelCls}">
            ${labelText(escapeHtml(t('admin.candidato.field_strumento')), true)}
            <input name="strumento" required value="${escapeHtml(initStrumento)}" class="${inputCls}" placeholder="${escapeHtml(t('admin.candidato.field_strumento_ph'))}" />
          </label>
          <label class="${labelCls}">
            ${labelText(escapeHtml(t('admin.candidato.field_data_nascita')), true)}
            <input name="data_nascita" type="date" required value="${escapeHtml(initData)}" max="${todayISO}" class="${inputCls}" />
          </label>
          <label class="${labelCls}">
            ${labelText(escapeHtml(t('admin.candidato.field_tipo')))}
            <select name="tipo" class="${inputCls}" ${isEdit && candidato?.tipo === 'gruppo' ? '' : ''}>
              <option value="individuale" ${(!candidato || candidato.tipo !== 'gruppo') ? 'selected' : ''}>${escapeHtml(t('admin.candidato.tipo_individuale'))}</option>
              <option value="gruppo" ${candidato?.tipo === 'gruppo' ? 'selected' : ''}>${escapeHtml(t('admin.candidato.tipo_gruppo'))}</option>
            </select>
          </label>
          <label class="${labelCls} sm:col-span-2">
            ${labelText(escapeHtml(t('admin.candidato.field_nazionalita')), true)}
            <input name="nazionalita" required list="naz-list" value="${escapeHtml(initNaz)}" class="${inputCls}" placeholder="${escapeHtml(t('admin.candidato.field_nazionalita_ph'))}" />
            <datalist id="naz-list">
              ${NATIONALITIES.map(n => `<option value="${n}">`).join('')}
            </datalist>
          </label>
        </div>

        <div class="pt-4 border-t border-slate-200">
          <div>
            <span class="text-sm font-medium text-slate-700 block mb-2">${escapeHtml(t('admin.candidato.field_foto'))}</span>
            <div class="flex items-center gap-3">
              <div data-foto-preview class="w-20 h-20 rounded-full bg-slate-100 border-2 border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                ${fotoPreviewHtml(fotoData)}
              </div>
              <div class="flex-1 min-w-0">
                <button type="button" data-foto-pick class="inline-flex items-center px-3 py-1.5 text-sm font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg transition">
                  ${escapeHtml(fotoData ? t('admin.candidato.foto_change') : t('admin.candidato.foto_load'))}
                </button>
                <button type="button" data-foto-clear class="ml-1 text-xs font-medium text-rose-600 hover:text-rose-800 ${fotoData ? '' : 'hidden'}">${escapeHtml(t('admin.candidato.remove'))}</button>
                <input data-foto-input type="file" accept="image/*" class="hidden" />
                <p class="text-[10px] text-slate-500 mt-1.5">${escapeHtml(t('admin.candidato.foto_help'))}</p>
              </div>
            </div>
          </div>
        </div>

        <div class="pt-4 border-t border-slate-200">
          <label class="${labelCls}">
            <span class="text-sm font-medium text-slate-700">${escapeHtml(t('admin.candidato.field_docenti'))} <span class="text-[11px] text-slate-500">${escapeHtml(t('admin.candidato.field_docenti_help'))}</span></span>
            <textarea name="docenti" rows="3" class="${inputCls}" placeholder="${escapeHtml(t('admin.candidato.field_docenti_ph'))}">${escapeHtml(initDocenti)}</textarea>
          </label>
        </div>

        <div class="pt-4 border-t border-slate-200">
          <header class="mb-2">
            <h4 class="text-sm font-semibold text-slate-700">${escapeHtml(t('admin.candidato.section_iscrizione'))}</h4>
            <p class="text-[11px] text-slate-500">${escapeHtml(t('admin.candidato.section_iscrizione_help'))}</p>
          </header>
          ${allSezioni.length === 0 ? `<p class="text-xs text-slate-400 italic">${t('admin.candidato.no_sezioni')}</p>` : `
            <div class="space-y-2">
              ${allSezioni.map(s => {
                const cats = db.categorieBySezione(s.id);
                return `
                  <div class="border border-slate-200 rounded-lg p-2.5 bg-slate-50">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" data-cand-sez="${s.id}" ${initSezIds.has(s.id) ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-brand-600" />
                      <span class="text-sm font-semibold text-slate-800">${escapeHtml(s.nome)}</span>
                      <span class="text-[10px] text-slate-500">${escapeHtml(t('admin.candidato.cats_count', { n: cats.length }))}</span>
                    </label>
                    ${cats.length > 0 ? `
                      <div class="mt-2 ml-6 grid grid-cols-1 sm:grid-cols-2 gap-1">
                        ${cats.map(c => `
                          <label class="flex items-center gap-2 bg-white hover:bg-brand-50 border border-slate-200 rounded-md px-2 py-1 cursor-pointer">
                            <input type="checkbox" data-cand-cat="${c.id}" ${initCatIds.has(c.id) ? 'checked' : ''} class="w-3.5 h-3.5 rounded border-slate-300 text-brand-600" />
                            <span class="text-xs text-slate-700">${escapeHtml(c.nome)}</span>
                          </label>
                        `).join('')}
                      </div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      </form>
    `,
    primaryLabel: isEdit ? t('admin.candidato.save_edit') : t('admin.candidato.save_create'),
    onMount: (body) => {
      const fotoInput = body.querySelector('[data-foto-input]');
      const fotoPick  = body.querySelector('[data-foto-pick]');
      const fotoClear = body.querySelector('[data-foto-clear]');
      const fotoPrev  = body.querySelector('[data-foto-preview]');

      const setFotoUI = () => {
        fotoPrev.innerHTML = fotoPreviewHtml(fotoData);
        fotoPick.textContent = fotoData ? t('admin.candidato.foto_change') : t('admin.candidato.foto_load');
        fotoClear.classList.toggle('hidden', !fotoData);
      };

      fotoPick.addEventListener('click', () => fotoInput.click());
      fotoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          fotoData = await readImageResized(file, 480, 0.85);
          setFotoUI();
        } catch {
          toast(t('admin.candidato.foto_error'), 'error');
        } finally {
          fotoInput.value = '';
        }
      });
      fotoClear.addEventListener('click', () => { fotoData = null; setFotoUI(); });
    },
    onPrimary: async (body) => {
      const form = body.querySelector('#frm');
      if (!form.reportValidity()) return false;
      const data = Object.fromEntries(new FormData(form));
      const docenti = (data.docenti || '').split('\n').map(s => s.trim()).filter(Boolean);
      // Read sezioni/categorie selections
      const sezIds = Array.from(body.querySelectorAll('input[data-cand-sez]:checked')).map(i => i.dataset.candSez);
      const catIds = Array.from(body.querySelectorAll('input[data-cand-cat]:checked')).map(i => i.dataset.candCat);
      const tipo = (data.tipo || 'individuale').trim() || 'individuale';
      const baseFields = {
        nome: (data.nome || '').trim(),
        cognome: (data.cognome || '').trim(),
        strumento: (data.strumento || '').trim(),
        data_nascita: data.data_nascita,
        nazionalita: (data.nazionalita || '').trim(),
        docenti_preparatori: docenti,
        sezioni_ids: sezIds,
        categorie_ids: catIds,
        tipo,
      };
      // Per gruppi, cognome e data_nascita non sono obbligatori
      const missingIndividual = !baseFields.nome || !baseFields.cognome || !baseFields.strumento || !baseFields.data_nascita || !baseFields.nazionalita;
      const missingGruppo = !baseFields.nome || !baseFields.strumento;
      if ((tipo === 'individuale' && missingIndividual) || (tipo === 'gruppo' && missingGruppo)) {
        toast(t('admin.candidato.required_missing'), 'error');
        return false;
      }
      try {
        if (isEdit) {
          const patch = { ...baseFields };
          if (fotoData !== initialFoto) patch.foto = fotoData;
          await db.updateCandidato(candidato.id, patch);
          toast(t('admin.candidato.updated'), 'success');
        } else {
          await db.createCandidato({
            concorso_id: concorso.id,
            ...baseFields,
            foto: fotoData,
          });
          toast(t('admin.candidato.added'), 'success');
        }
        if (onSaved) onSaved();
      } catch (e) {
        console.error(e);
        toast(t('admin.concorso.error_prefix', { msg: e.message }), 'error');
        return false;
      }
    }
  });
}

// ---------- Commissari ----------
