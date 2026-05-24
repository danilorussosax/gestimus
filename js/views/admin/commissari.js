// Tab "Commissari" + form + archivio + credenziali.
// Estratto da js/views/admin.js (refactoring).

import { db } from '../../db.js';
import {
  escapeHtml, safeUrl, modal, toast, confirmDialog, displayName, ageFromDate,
  readImageResized, NATIONALITIES,
} from '../../utils.js';
import { t } from '../../i18n.js';
import { openImportModal } from './import.js';

export function renderCommissari(root, concorso) {
  const list = db.commissariByConcorso(concorso.id);
  // "Presidente" qui = commissario che è presidente di ALMENO UNA commissione
  // del concorso (concetto refactorizzato: il presidente è di commissione, non
  // di concorso). Mostriamo un riferimento per l'header — i veri presidenti
  // sono visualizzati per ciascuna commissione nel tab Commissioni.
  const presidente = list.find(c => db.isPresidenteDiQualcheCommissione(c.id));
  root.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h3 class="text-sm font-bold text-slate-800 uppercase tracking-wider">${escapeHtml(t('admin.commissari.heading'))}</h3>
      <div class="flex items-center gap-2">
        <button data-action="import" class="text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-lg">${escapeHtml(t('admin.commissari.import'))}</button>
        <button data-action="add" class="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm">${escapeHtml(t('admin.commissari.add'))}</button>
      </div>
    </div>
    <p class="text-sm text-slate-600 mb-4">${t('admin.commissari.summary', { n: list.length, pres: presidente ? t('admin.commissari.summary_pres', { name: escapeHtml(displayName(presidente)) }) : `<span class="text-amber-700 font-medium">${escapeHtml(t('admin.commissari.summary_no_pres'))}</span>` })}</p>

    ${list.length > 0 && !presidente ? `
      <div class="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-4 text-sm">
        ${t('admin.commissari.warn_no_pres')}
      </div>
    ` : ''}

    ${list.length === 0 ? `
      <div class="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
        <div class="text-4xl mb-2">🧑‍⚖️</div>
        <p class="text-sm text-slate-500 italic">${escapeHtml(t('admin.commissari.empty'))}</p>
      </div>
    ` : `
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        ${list.map(c => commissarioCardHtml(c)).join('')}
      </div>
    `}

    <!-- Archivio integrato -->
    <div class="mt-8 pt-6 border-t-2 border-dashed border-brand-100" id="archivio-host"></div>
  `;

  root.querySelector('[data-action="add"]').addEventListener('click', () => openCommissarioForm(concorso, null, () => renderCommissari(root, concorso)));
  root.querySelector('[data-action="import"]').addEventListener('click', () => openImportModal(concorso, 'commissari', () => renderCommissari(root, concorso)));

  // Render archive in the host below
  const archHost = root.querySelector('#archivio-host');
  if (archHost) renderArchivio(archHost, concorso, () => renderCommissari(root, concorso));

  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const c = db.state.commissari.find(x => x.id === b.dataset.edit);
    if (c) openCommissarioForm(concorso, c, () => renderCommissari(root, concorso));
  }));

  root.querySelectorAll('[data-unassign]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.unassign;
    const c = db.state.commissari.find(x => x.id === id);
    confirmDialog({
      title: t('admin.commissari.unassign_title'),
      message: t('admin.commissari.unassign_msg', { name: c ? displayName(c) : '' }),
      danger: false,
      onConfirm: async () => {
        try {
          await db.disassegnaCommissarioDaConcorso(id, concorso.id);
          renderCommissari(root, concorso);
        } catch (e) { toast(e.message, 'error'); }
      }
    });
  }));

  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.del;
    const c = db.state.commissari.find(x => x.id === id);
    const otherConcorsi = c ? (c.concorsi_ids || []).filter(x => x !== concorso.id).length : 0;
    confirmDialog({
      title: t('admin.commissari.delete_title'),
      message: otherConcorsi > 0
        ? t('admin.commissari.delete_msg_multi', { n: otherConcorsi })
        : t('admin.commissari.delete_msg'),
      danger: true,
      onConfirm: async () => {
        try { await db.deleteCommissario(id); renderCommissari(root, concorso); }
        catch (e) { toast(e.message, 'error'); }
      }
    });
  }));

  root.querySelectorAll('[data-cv]').forEach(b => b.addEventListener('click', () => {
    const c = db.state.commissari.find(x => x.id === b.dataset.cv);
    if (c?.cv) openCvText(c.cv);
  }));
}

// Mostra il CV (testo semplice / markdown) in sola lettura. Niente parsing md:
// rendiamo il testo grezzo con escape, preservando gli a-capo.
function openCvText(text) {
  modal({
    title: t('admin.commissario.cv_title'),
    wide: true,
    secondaryLabel: t('common.close'),
    contentHtml: `<div class="whitespace-pre-wrap break-words text-sm text-ink-800 leading-relaxed max-h-[60vh] overflow-y-auto font-mono">${escapeHtml(text || '')}</div>`,
  });
}

function commissarioCardHtml(c) {
  const eta = ageFromDate(c.data_nascita);
  // Il commissario è "presidente" se lo è in almeno una commissione (del concorso).
  // Il refactor 1700000035 ha spostato il concetto da commissari.is_presidente
  // a commissioni.presidente — vedi db.isPresidenteDiQualcheCommissione.
  const isPres = db.isPresidenteDiQualcheCommissione(c.id);
  const ringCls = isPres ? 'ring-2 ring-amber-400' : 'ring-2 ring-white';
  const cardCls = isPres ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200';
  return `
    <div class="bg-white border ${cardCls} rounded-2xl p-4 flex items-start gap-3 hover:border-slate-300 transition">
      <div class="w-14 h-14 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 overflow-hidden flex items-center justify-center text-2xl text-amber-700 shrink-0 ${ringCls} shadow-soft">
        ${c.foto_url && safeUrl(c.foto_url) ? `<img src="${safeUrl(c.foto_url)}" alt="" class="w-full h-full object-cover" />` : '🧑‍⚖️'}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <h4 class="font-semibold text-slate-900 truncate">${escapeHtml(displayName(c))}</h4>
          ${isPres ? `<span class="text-[10px] font-bold px-1.5 py-0.5 bg-amber-500 text-white rounded-full">${escapeHtml(t('admin.commissari.presidente_tag'))}</span>` : ''}
          ${c.nazionalita ? `<span class="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded-full font-medium">${escapeHtml(c.nazionalita)}</span>` : ''}
        </div>
        <p class="text-xs text-slate-600 truncate">${escapeHtml(c.specialita || '—')}${eta ? ` · ${escapeHtml(t('admin.candidati.years', { n: eta }))}` : ''}</p>
        ${c.email ? `<p class="text-[11px] text-slate-500 truncate mt-0.5">✉ ${escapeHtml(c.email)}</p>` : ''}
        ${c.telefono ? `<p class="text-[11px] text-slate-500 truncate">☎ ${escapeHtml(c.telefono)}</p>` : ''}
        <div class="mt-2 flex items-center gap-1.5 flex-wrap">
          ${c.cv ? `<button data-cv="${c.id}" class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-full font-medium" title="${escapeHtml(t('admin.commissario.cv_view'))}">📄 CV</button>` : ''}
          ${c.bio ? `<span class="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-full font-medium" title="${escapeHtml(c.bio)}">📝 bio</span>` : ''}
        </div>
      </div>
      <div class="flex flex-col gap-1 shrink-0">
        <button data-edit="${c.id}" class="text-xs text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg font-medium">${escapeHtml(t('admin.commissari.btn_edit'))}</button>
        <button data-unassign="${c.id}" class="text-xs text-amber-700 hover:bg-amber-50 px-2 py-1 rounded-lg font-medium" title="${escapeHtml(t('admin.commissari.btn_unassign_title'))}">${escapeHtml(t('admin.commissari.btn_unassign'))}</button>
        <button data-del="${c.id}" class="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium" title="${escapeHtml(t('admin.commissari.btn_delete_title'))}">${escapeHtml(t('admin.commissari.btn_delete'))}</button>
      </div>
    </div>
  `;
}

function openCommissarioForm(concorso, com, onSaved) {
  const isEdit = !!com;
  let initNome = com?.nome || '';
  let initCognome = com?.cognome || '';
  if (com && !initCognome && initNome.includes(' ')) {
    const parts = initNome.split(/\s+/);
    initNome = parts[0];
    initCognome = parts.slice(1).join(' ');
  }
  let fotoData = com?.foto_url || null;
  let cvData = com?.cv || ''; // CV come testo (plain/markdown)
  const initialFoto = com?.foto_url || null;
  const initialCv = com?.cv || '';
  const todayISO = new Date().toISOString().slice(0,10);
  const linkedAccount = isEdit ? db.getAccountForCommissario(com.id) : null;

  const inputCls = 'mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500';
  const lText = (text, required = false) => `<span class="text-sm font-medium text-slate-700">${text}${required ? ' <span class="text-rose-500">*</span>' : ''}</span>`;

  modal({
    title: isEdit ? t('admin.commissario.edit_title') : t('admin.commissario.add_title'),
    width: 'max-w-3xl',
    contentHtml: `
      <form id="frm" class="space-y-5" autocomplete="off">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            ${lText(escapeHtml(t('admin.candidato.field_nome')), true)}
            <input name="nome" required value="${escapeHtml(initNome)}" class="${inputCls}" />
          </label>
          <label class="block">
            ${lText(escapeHtml(t('admin.candidato.field_cognome')), true)}
            <input name="cognome" required value="${escapeHtml(initCognome)}" class="${inputCls}" />
          </label>
          <label class="block">
            ${lText(escapeHtml(t('admin.commissario.field_specialita')), true)}
            <input name="specialita" required value="${escapeHtml(com?.specialita || '')}" class="${inputCls}" placeholder="${escapeHtml(t('admin.commissario.field_specialita_ph'))}" />
          </label>
          <label class="block">
            ${lText(escapeHtml(t('admin.candidato.field_data_nascita')))}
            <input name="data_nascita" type="date" value="${escapeHtml(com?.data_nascita || '')}" max="${todayISO}" class="${inputCls}" />
          </label>
          <label class="block">
            ${lText(escapeHtml(t('admin.candidato.field_nazionalita')))}
            <input name="nazionalita" list="naz-list-com" value="${escapeHtml(com?.nazionalita || '')}" class="${inputCls}" placeholder="${escapeHtml(t('admin.candidato.field_nazionalita_ph'))}" />
            <datalist id="naz-list-com">
              ${NATIONALITIES.map(n => `<option value="${n}">`).join('')}
            </datalist>
          </label>
          <label class="block">
            ${lText(escapeHtml(t('admin.commissario.field_email')))}
            <input name="email" type="email" value="${escapeHtml(com?.email || '')}" class="${inputCls}" placeholder="${escapeHtml(t('admin.commissario.field_email_ph'))}" />
          </label>
          <label class="block sm:col-span-2">
            ${lText(escapeHtml(t('admin.commissario.field_telefono')))}
            <input name="telefono" type="tel" value="${escapeHtml(com?.telefono || '')}" class="${inputCls}" placeholder="${escapeHtml(t('admin.commissario.field_telefono_ph'))}" />
          </label>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
          <div>
            <span class="text-sm font-medium text-slate-700 block mb-2">${escapeHtml(t('admin.candidato.field_foto'))}</span>
            <div class="flex items-center gap-3">
              <div data-foto-preview class="w-20 h-20 rounded-full bg-slate-100 border-2 border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                ${fotoData && safeUrl(fotoData) ? `<img src="${safeUrl(fotoData)}" alt="" class="w-full h-full object-cover" />` : '<span class="text-3xl text-slate-400">🧑‍⚖️</span>'}
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

          <div>
            <span class="text-sm font-medium text-slate-700 block mb-2">${escapeHtml(t('admin.candidato.field_cv'))}</span>
            <div data-cv-zone class="flex items-center gap-2 flex-wrap"></div>
            <textarea data-cv-text rows="6" class="${inputCls} mt-2 hidden font-mono text-[13px]" placeholder="${escapeHtml(t('admin.commissario.cv_placeholder'))}">${escapeHtml(cvData)}</textarea>
            <p class="text-[10px] text-slate-500 mt-1.5">${escapeHtml(t('admin.commissario.cv_help'))}</p>
          </div>
        </div>

        <div class="pt-4 border-t border-slate-200">
          <label class="block">
            <span class="text-sm font-medium text-slate-700">${escapeHtml(t('admin.commissario.field_bio'))}</span>
            <textarea name="bio" rows="3" class="${inputCls}" placeholder="${escapeHtml(t('admin.commissario.field_bio_ph'))}">${escapeHtml(com?.bio || '')}</textarea>
          </label>
        </div>

        <!-- Il ruolo di presidente è ora gestito per ogni singola commissione
             (vedi tab Commissioni → "Presidente della commissione"). -->
        <div class="pt-4 border-t border-slate-200">
          <div class="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-900 flex items-start gap-2">
            <span class="text-base shrink-0">🎯</span>
            <p>Per nominare un commissario <strong>presidente</strong>, vai al tab <em>Commissioni</em>, apri (o crea) la commissione e seleziona il presidente dal menù "Presidente della commissione". Un commissario può essere presidente di commissioni diverse.</p>
          </div>
        </div>

        <div class="pt-4 border-t border-slate-200">
          <header class="mb-2">
            <h4 class="text-sm font-bold text-slate-900">${escapeHtml(t('admin.commissario.section_credenziali'))}</h4>
            <p class="text-xs text-slate-500">${escapeHtml(t('admin.commissario.section_credenziali_help'))}</p>
          </header>
          ${linkedAccount ? (() => {
            const accState = linkedAccount.attivo ? t('admin.commissario.acc_state_active') : t('admin.commissario.acc_state_disabled');
            const accLine = t('admin.commissario.acc_active', { state: accState, email: '__EMAIL__' });
            const [accLeft, accRight] = accLine.split('__EMAIL__');
            return `
            <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <div class="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                ${linkedAccount.attivo ? '✅' : '⏸'} ${escapeHtml(accLeft)}<span class="font-mono">${escapeHtml(linkedAccount.email)}</span>${escapeHtml(accRight || '')}
              </div>
              <div class="mt-2 flex items-center gap-2 flex-wrap">
                <button type="button" data-acc-action="reset" class="text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg">${escapeHtml(t('admin.commissario.acc_reset'))}</button>
                <button type="button" data-acc-action="toggle" class="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg">${escapeHtml(linkedAccount.attivo ? t('admin.commissario.acc_disable') : t('admin.commissario.acc_enable'))}</button>
                <button type="button" data-acc-action="delete" class="text-xs font-medium text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg ml-auto">${escapeHtml(t('admin.commissario.acc_delete'))}</button>
              </div>
            </div>`;
          })() : `
            <label class="flex items-start gap-3 mb-3 cursor-pointer">
              <input type="checkbox" id="acc-create-toggle" class="mt-1 w-4 h-4 rounded border-slate-300 text-brand-600" />
              <div>
                <span class="text-sm font-semibold text-slate-800">${escapeHtml(t('admin.commissario.acc_create_label'))}</span>
                <span class="block text-xs text-slate-500 mt-0.5">${escapeHtml(t('admin.commissario.acc_create_help'))}</span>
              </div>
            </label>
            <div id="acc-create-fields" class="hidden space-y-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <label class="block">
                <span class="text-xs font-medium text-slate-700">${escapeHtml(t('admin.commissario.acc_email_label'))}</span>
                <input id="acc-email" type="email" value="${escapeHtml(com?.email || '')}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="${escapeHtml(t('admin.commissario.field_email_ph'))}" />
              </label>
              <label class="block">
                <span class="text-xs font-medium text-slate-700">${escapeHtml(t('admin.commissario.acc_pwd_label'))}</span>
                <div class="mt-1 flex gap-2">
                  <input id="acc-password" type="text" minlength="6" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="" />
                  <button type="button" id="acc-genpwd" class="text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-2 rounded-lg whitespace-nowrap">${escapeHtml(t('admin.commissario.acc_gen'))}</button>
                </div>
                <p class="text-[10px] text-slate-500 mt-1">${escapeHtml(t('admin.commissario.acc_pwd_help'))}</p>
              </label>
            </div>
          `}
        </div>
      </form>
    `,
    primaryLabel: isEdit ? t('admin.commissario.save_edit') : t('admin.commissario.save_create'),
    onMount: (body) => {
      const fotoInput = body.querySelector('[data-foto-input]');
      const fotoPick  = body.querySelector('[data-foto-pick]');
      const fotoClear = body.querySelector('[data-foto-clear]');
      const fotoPrev  = body.querySelector('[data-foto-preview]');

      const setFotoUI = () => {
        // A4: safeUrl anche nella preview del form (dataURL upload o foto_url).
        fotoPrev.innerHTML = fotoData && safeUrl(fotoData)
          ? `<img src="${safeUrl(fotoData)}" alt="" class="w-full h-full object-cover" />`
          : '<span class="text-3xl text-slate-400">🧑‍⚖️</span>';
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
        } catch { toast(t('admin.candidato.foto_error'), 'error'); }
        finally { fotoInput.value = ''; }
      });
      fotoClear.addEventListener('click', () => { fotoData = null; setFotoUI(); });

      // CV come TESTO (plain/markdown). Il pulsante "Inserisci/Modifica" rivela
      // la textarea; il valore della textarea è la sorgente di verità (cvData).
      const cvText = body.querySelector('[data-cv-text]');
      const cvZone = body.querySelector('[data-cv-zone]');
      const renderCvZone = () => {
        const has = cvData.trim().length > 0;
        const open = !cvText.classList.contains('hidden');
        cvZone.innerHTML = `
          <button type="button" data-cv-edit class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition">
            ${escapeHtml(open ? t('admin.commissario.cv_close') : (has ? t('admin.commissario.cv_edit') : t('admin.commissario.cv_add')))}
          </button>
          ${has ? `
            <button type="button" data-cv-view class="text-xs font-medium text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded-lg">${escapeHtml(t('admin.commissario.cv_view'))}</button>
            <button type="button" data-cv-clear class="text-xs font-medium text-rose-600 hover:text-rose-800 px-2 py-1 rounded-lg">${escapeHtml(t('admin.candidato.remove'))}</button>
            <span class="text-[11px] text-slate-500">${escapeHtml(t('admin.commissario.cv_chars', { n: cvData.length }))}</span>
          ` : ''}`;
      };
      renderCvZone();
      cvZone.addEventListener('click', (e) => {
        const a = e.target.closest('[data-cv-edit],[data-cv-view],[data-cv-clear]');
        if (!a) return;
        if (a.matches('[data-cv-edit]')) {
          cvText.classList.toggle('hidden');
          if (!cvText.classList.contains('hidden')) cvText.focus();
        } else if (a.matches('[data-cv-view]')) {
          openCvText(cvData);
        } else if (a.matches('[data-cv-clear]')) {
          cvData = '';
          cvText.value = '';
          cvText.classList.add('hidden');
        }
        renderCvZone();
      });
      cvText.addEventListener('input', () => {
        cvData = cvText.value;
        renderCvZone();
      });

      // ---- Account credentials (create flow) ----
      const accToggle = body.querySelector('#acc-create-toggle');
      const accFields = body.querySelector('#acc-create-fields');
      const genBtn    = body.querySelector('#acc-genpwd');
      if (accToggle && accFields) {
        accToggle.addEventListener('change', () => {
          accFields.classList.toggle('hidden', !accToggle.checked);
          if (accToggle.checked) body.querySelector('#acc-password')?.focus();
        });
      }
      if (genBtn) {
        genBtn.addEventListener('click', () => {
          const pwdInput = body.querySelector('#acc-password');
          if (pwdInput) pwdInput.value = generatePassword(12);
        });
      }

      // ---- Account credentials (existing-account actions) ----
      body.querySelectorAll('[data-acc-action]').forEach(b => b.addEventListener('click', async () => {
        if (!linkedAccount) return;
        const action = b.dataset.accAction;
        if (action === 'reset') {
          const newPwd = generatePassword(12);
          try {
            await db.resetAccountPassword(linkedAccount.id, newPwd);
            showCredentialsModal({ email: linkedAccount.email, password: newPwd, title: t('admin.commissario.acc_reset_title'), subject: displayName({ nome: linkedAccount.nome, cognome: linkedAccount.cognome }) });
          } catch (e) { toast(t('admin.commissario.acc_reset_error', { msg: e.message }), 'error'); }
        } else if (action === 'toggle') {
          try {
            await db.updateAccount(linkedAccount.id, { attivo: !linkedAccount.attivo });
            toast(linkedAccount.attivo ? t('admin.commissario.acc_disabled_done') : t('admin.commissario.acc_enabled_done'), 'success');
            // Re-open form to refresh
            const concorsoArg = concorso;
            // close+reopen
            body.closest('.fixed')?.remove();
            openCommissarioForm(concorsoArg, com, onSaved);
          } catch (e) { toast(t('admin.concorso.error_prefix', { msg: e.message }), 'error'); }
        } else if (action === 'delete') {
          if (!confirm(t('admin.commissario.acc_delete_confirm'))) return;
          try {
            await db.deleteAccount(linkedAccount.id);
            toast(t('admin.commissario.acc_deleted'), 'success');
            const concorsoArg = concorso;
            body.closest('.fixed')?.remove();
            openCommissarioForm(concorsoArg, com, onSaved);
          } catch (e) { toast(t('admin.concorso.error_prefix', { msg: e.message }), 'error'); }
        }
      }));
    },
    onPrimary: async (body) => {
      const form = body.querySelector('#frm');
      if (!form.reportValidity()) return false;
      const data = Object.fromEntries(new FormData(form));
      // is_presidente NON è più gestito qui: il ruolo presidente è attributo
      // della commissione (vedi openCommissioneForm). Lasciamo il campo DB
      // a false per nuovi record per non confondere logica legacy.
      const baseFields = {
        nome: (data.nome || '').trim(),
        cognome: (data.cognome || '').trim(),
        specialita: (data.specialita || '').trim(),
        email: (data.email || '').trim(),
        telefono: (data.telefono || '').trim(),
        data_nascita: data.data_nascita || null,
        nazionalita: (data.nazionalita || '').trim(),
        bio: (data.bio || '').trim(),
      };
      if (!baseFields.nome || !baseFields.cognome || !baseFields.specialita) {
        toast(t('admin.commissario.required_missing'), 'error');
        return false;
      }
      // Account creation flow (when toggle is checked AND no account exists yet)
      const accToggle = body.querySelector('#acc-create-toggle');
      const wantsAccount = accToggle && accToggle.checked && !linkedAccount;
      let accEmail = '', accPassword = '';
      if (wantsAccount) {
        accEmail = (body.querySelector('#acc-email')?.value || '').trim();
        accPassword = body.querySelector('#acc-password')?.value || '';
        if (!accEmail || accPassword.length < 6) {
          toast(t('admin.commissario.acc_invalid'), 'error');
          return false;
        }
      }

      try {
        let savedCommissario;
        if (isEdit) {
          const patch = { ...baseFields };
          if (fotoData !== initialFoto) patch.foto = fotoData;
          if (cvData !== initialCv) patch.cv = cvData;
          savedCommissario = await db.updateCommissario(com.id, patch);
          toast(t('admin.commissario.updated'), 'success');
        } else {
          savedCommissario = await db.createCommissario({
            concorso_id: concorso.id,
            ...baseFields,
            foto: fotoData,
            cv: cvData,
          });
          toast(t('admin.commissario.added'), 'success');
        }
        // Create linked account if requested
        if (wantsAccount && savedCommissario) {
          try {
            await db.createAccount({
              email: accEmail,
              password: accPassword,
              nome: baseFields.nome,
              cognome: baseFields.cognome,
              role: 'commissario',
              commissario_id: savedCommissario.id,
              attivo: true,
            });
            // Show credentials modal one-time
            showCredentialsModal({
              email: accEmail,
              password: accPassword,
              title: t('admin.commissario.cred_modal.created_title'),
              subject: `${baseFields.nome} ${baseFields.cognome}`.trim(),
            });
          } catch (e) {
            console.error('Account creation failed:', e);
            let msg;
            if (e?.code === 'email_taken') {
              msg = t('admin.commissario.acc_email_taken', { email: accEmail });
            } else {
              // Extract PB field-level validation message if available
              const fieldErrors = e?.data?.data;
              if (fieldErrors && typeof fieldErrors === 'object') {
                const first = Object.values(fieldErrors).find(v => v?.message);
                msg = first?.message || e?.data?.message || e.message;
              } else {
                msg = e?.data?.message || e.message;
              }
            }
            toast(t('admin.commissario.acc_creation_failed', { msg }), 'error');
          }
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

// ---------- Helpers credenziali ----------
function generatePassword(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < length; i++) out += chars[arr[i] % chars.length];
  return out;
}

function showCredentialsModal({ email, password, title = t('admin.commissario.cred_modal.title'), subject = '' }) {
  modal({
    title,
    contentHtml: `
      <div class="space-y-3">
        ${subject ? `<p class="text-sm">${t('admin.commissario.cred_modal.transmit_to', { name: escapeHtml(subject) })}</p>` : ''}
        <div class="bg-slate-900 text-emerald-300 rounded-xl p-4 font-mono text-sm space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-slate-400 shrink-0">${escapeHtml(t('admin.commissario.cred_modal.email'))}</span>
            <span class="flex-1 truncate select-all">${escapeHtml(email)}</span>
            <button data-copy="email" class="text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-emerald-300">${escapeHtml(t('admin.commissario.cred_modal.copy'))}</button>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-slate-400 shrink-0">${escapeHtml(t('admin.commissario.cred_modal.pwd'))}&nbsp;&nbsp;</span>
            <span class="flex-1 truncate select-all">${escapeHtml(password)}</span>
            <button data-copy="password" class="text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-emerald-300">${escapeHtml(t('admin.commissario.cred_modal.copy'))}</button>
          </div>
        </div>
        <div class="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg px-3 py-2">${t('admin.commissario.cred_modal.warning')}</div>
      </div>
    `,
    primaryLabel: t('admin.commissario.cred_modal.confirm'),
    secondaryLabel: t('common.close'),
    onMount: (body) => {
      body.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
        const what = b.dataset.copy === 'email' ? email : password;
        try {
          await navigator.clipboard.writeText(what);
          const orig = b.textContent;
          b.textContent = t('admin.commissario.cred_modal.copied');
          setTimeout(() => { b.textContent = orig; }, 1500);
        } catch {
          toast(t('admin.commissario.cred_modal.copy_failed'), 'warn');
        }
      }));
    },
    onPrimary: () => {},
  });
}

// ---------- Archivio commissari (vista deduplicata + import) ----------

function renderArchivio(root, concorso, onChanged) {
  // Archivio anagrafica per-tenant (migration 1700000042): ogni commissario è
  // un record unico con `concorsi_ids[]`. Niente più dedup per fingerprint.
  const archive = db.archivioCommissari();
  // Set degli id già assegnati al concorso corrente (per dimmare il pulsante).
  const presentInConcorso = new Set(
    db.commissariByConcorso(concorso.id).map(c => c.id)
  );

  // Compute filter dropdown options
  const specialitaOpts = [...new Set(archive.map(c => c.specialita).filter(Boolean))].sort();
  const nazionalitaOpts = [...new Set(archive.map(c => c.nazionalita).filter(Boolean))].sort();
  // Concorsi index for badge rendering
  const concorsoMap = Object.fromEntries(db.state.concorsi.map(c => [c.id, c]));

  // UI state
  const ui = {
    q: '',
    specialita: '',
    nazionalita: '',
    onlyMissing: false, // se true, mostra solo non già presenti nel concorso
    sort: 'nome',      // 'nome' | 'recente' | 'concorsi'
  };

  root.innerHTML = `
    <div class="flex flex-wrap items-center gap-3 mb-3">
      <div>
        <h3 class="text-sm font-bold text-slate-800 uppercase tracking-wider">${escapeHtml(t('admin.archivio.heading'))}</h3>
        <p class="text-xs text-slate-500">${t('admin.archivio.subtitle', { n: archive.length })}</p>
      </div>
    </div>

    <div class="bg-white border border-brand-100 rounded-2xl p-4 mb-4 shadow-soft">
      <div class="grid grid-cols-1 md:grid-cols-12 gap-2">
        <div class="md:col-span-5 relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          <input id="arch-q" type="search" placeholder="${escapeHtml(t('admin.archivio.search_ph'))}" class="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
        </div>
        <select id="arch-spec" class="md:col-span-3 border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-brand-500">
          <option value="">${escapeHtml(t('admin.archivio.all_specialita'))}</option>
          ${specialitaOpts.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
        </select>
        <select id="arch-naz" class="md:col-span-2 border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-brand-500">
          <option value="">${escapeHtml(t('admin.archivio.all_nazionalita'))}</option>
          ${nazionalitaOpts.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
        </select>
        <select id="arch-sort" class="md:col-span-2 border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-brand-500">
          <option value="nome">${escapeHtml(t('admin.archivio.sort_nome'))}</option>
          <option value="recente">${escapeHtml(t('admin.archivio.sort_recente'))}</option>
          <option value="concorsi">${escapeHtml(t('admin.archivio.sort_concorsi'))}</option>
        </select>
      </div>
      <div class="mt-2 flex items-center gap-3 text-xs">
        <label class="inline-flex items-center gap-1.5 cursor-pointer text-slate-600 hover:text-slate-900">
          <input id="arch-only-missing" type="checkbox" class="w-3.5 h-3.5 rounded border-slate-300 text-brand-600" />
          ${t('admin.archivio.only_missing')}
        </label>
        <button id="arch-clear" class="text-brand-600 hover:text-brand-800 font-medium ml-auto">${escapeHtml(t('admin.archivio.clear_filters'))}</button>
      </div>
    </div>

    <div id="arch-results"></div>
  `;

  const apply = () => {
    let list = archive.slice();
    if (ui.specialita) list = list.filter(c => c.specialita === ui.specialita);
    if (ui.nazionalita) list = list.filter(c => c.nazionalita === ui.nazionalita);
    if (ui.onlyMissing) list = list.filter(c => !presentInConcorso.has(c.id));
    if (ui.q) {
      const q = ui.q.toLowerCase();
      list = list.filter(c => {
        const hay = `${c.nome} ${c.cognome} ${c.specialita || ''} ${c.email || ''} ${c.telefono || ''} ${c.nazionalita || ''} ${c.bio || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (ui.sort === 'nome') list.sort((a,b) => `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`, 'it'));
    else if (ui.sort === 'concorsi') list.sort((a,b) => b.concorsi_ids.length - a.concorsi_ids.length);
    // 'recente' uses creation order (last in state.commissari first); approx by reversing
    else if (ui.sort === 'recente') list.sort((a,b) => 0); // PB created order is db.state.commissari order; rough
    return list;
  };

  const renderResults = () => {
    const list = apply();
    const host = root.querySelector('#arch-results');
    if (list.length === 0) {
      host.innerHTML = `
        <div class="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <div class="text-4xl mb-2">🔎</div>
          <p class="text-sm text-slate-500 italic">${escapeHtml(t('admin.archivio.no_match'))}</p>
        </div>`;
      return;
    }
    host.innerHTML = `
      <div class="text-xs text-slate-500 mb-2">${escapeHtml(list.length === 1 ? t('admin.archivio.results_one', { n: list.length }) : t('admin.archivio.results_other', { n: list.length }))}</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        ${list.map(c => archivioCardHtml(c, concorso, concorsoMap, presentInConcorso)).join('')}
      </div>
    `;
    host.querySelectorAll('[data-arch-import]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.archImport;
      const entry = archive.find(x => x.id === id);
      if (!entry) return;
      b.disabled = true;
      b.textContent = t('admin.archivio.importing');
      try {
        // Nuovo modello: solo assegnazione (no clonazione di record).
        await db.assegnaCommissarioAConcorso(id, concorso.id);
        toast(t('admin.archivio.added_msg', { name: displayName(entry) }), 'success');
        if (onChanged) onChanged();
        else renderArchivio(root, concorso);
      } catch (e) {
        console.error(e);
        toast(t('admin.archivio.import_error', { msg: e?.message || '' }), 'error');
        b.disabled = false;
        b.textContent = t('admin.archivio.add_to_concorso');
      }
    }));
    host.querySelectorAll('[data-arch-cv]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.archCv;
      const entry = archive.find(x => x.id === id);
      if (entry?.cv) openCvText(entry.cv);
    }));
  };

  // Wire filters
  const qIn = root.querySelector('#arch-q');
  qIn.addEventListener('input', () => { ui.q = qIn.value; renderResults(); });
  root.querySelector('#arch-spec').addEventListener('change', (e) => { ui.specialita = e.target.value; renderResults(); });
  root.querySelector('#arch-naz').addEventListener('change', (e) => { ui.nazionalita = e.target.value; renderResults(); });
  root.querySelector('#arch-sort').addEventListener('change', (e) => { ui.sort = e.target.value; renderResults(); });
  root.querySelector('#arch-only-missing').addEventListener('change', (e) => { ui.onlyMissing = e.target.checked; renderResults(); });
  root.querySelector('#arch-clear').addEventListener('click', () => {
    ui.q = ''; ui.specialita = ''; ui.nazionalita = ''; ui.onlyMissing = false; ui.sort = 'nome';
    qIn.value = '';
    root.querySelector('#arch-spec').value = '';
    root.querySelector('#arch-naz').value = '';
    root.querySelector('#arch-sort').value = 'nome';
    root.querySelector('#arch-only-missing').checked = false;
    renderResults();
  });

  renderResults();
  qIn.focus();
}

function archivioCardHtml(c, concorso, concorsoMap, presentInConcorso) {
  const eta = ageFromDate(c.data_nascita);
  const inThis = presentInConcorso.has(c.id);
  const concorsiIds = Array.isArray(c.concorsi_ids) ? c.concorsi_ids : [];
  const concorsiBadges = concorsiIds.map(id => {
    const con = concorsoMap[id];
    const isCurrent = id === concorso.id;
    return `<span class="text-[10px] px-1.5 py-0.5 rounded-full ${isCurrent ? 'bg-brand-100 text-brand-800 font-semibold' : 'bg-slate-100 text-slate-600'}" title="${escapeHtml(con?.nome || '')}">${escapeHtml((con?.nome || '?').slice(0, 22))}${(con?.nome||'').length > 22 ? '…' : ''}</span>`;
  }).join(' ');

  return `
    <div class="bg-white border ${inThis ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200'} rounded-2xl p-4 flex flex-col gap-3 hover:border-brand-300 transition">
      <div class="flex items-start gap-3">
        <div class="w-14 h-14 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 overflow-hidden flex items-center justify-center text-2xl text-amber-700 shrink-0 ring-2 ring-white shadow-soft">
          ${c.foto_url && safeUrl(c.foto_url) ? `<img src="${safeUrl(c.foto_url)}" alt="" class="w-full h-full object-cover" />` : '🧑‍⚖️'}
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="font-semibold text-slate-900 truncate">${escapeHtml(displayName(c))}</h4>
          <p class="text-xs text-slate-600 truncate">${escapeHtml(c.specialita || '—')}${eta ? ` · ${escapeHtml(t('admin.candidati.years', { n: eta }))}` : ''}${c.nazionalita ? ` · ${escapeHtml(c.nazionalita)}` : ''}</p>
          ${c.email ? `<p class="text-[11px] text-slate-500 truncate mt-0.5">✉ ${escapeHtml(c.email)}</p>` : ''}
          ${c.telefono ? `<p class="text-[11px] text-slate-500 truncate">☎ ${escapeHtml(c.telefono)}</p>` : ''}
        </div>
      </div>
      ${c.bio ? `<p class="text-[11px] text-slate-600 leading-relaxed line-clamp-2">${escapeHtml(c.bio)}</p>` : ''}
      <div class="flex items-center gap-1.5 flex-wrap">
        ${c.cv ? `<button data-arch-cv="${c.id}" class="text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-full font-medium" title="${escapeHtml(t('admin.commissario.cv_view'))}">📄 CV</button>` : ''}
        <span class="text-[10px] text-slate-500">${escapeHtml(concorsiIds.length === 1 ? t('admin.archivio.in_concorsi_one', { n: concorsiIds.length }) : t('admin.archivio.in_concorsi_other', { n: concorsiIds.length }))}</span>
        ${concorsiBadges}
      </div>
      <div class="mt-auto pt-1">
        ${inThis
          ? `<button disabled class="w-full text-xs font-semibold text-emerald-700 bg-emerald-100 px-3 py-2 rounded-lg cursor-default">${escapeHtml(t('admin.archivio.already_in'))}</button>`
          : `<button data-arch-import="${c.id}" class="w-full text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3 py-2 rounded-lg shadow-sm transition">${escapeHtml(t('admin.archivio.add_to_concorso'))}</button>`}
      </div>
    </div>
  `;
}

// ---------- Sezioni & Categorie ----------

// ---------- Commissioni ----------
