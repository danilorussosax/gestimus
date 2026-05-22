// Selettore concorso + create/edit (header bar del pannello Admin).
// Estratto da js/views/admin.js (refactoring).

import { db } from '../../db.js';
import { escapeHtml, modal, toast, confirmDialog, readImageResized } from '../../utils.js';
import { icon } from '../../icons.js';
import { t } from '../../i18n.js';
import { tiebreakStrategyHtml } from './common.js';
import { setAdminTab } from '../admin.js';

export function renderConcorsoSelector(root) {
  const concorsi = db.state.concorsi;
  root.innerHTML = `
    <section class="view-fade">
      <header class="c-page-header max-w-7xl mx-auto">
        <p class="c-page-header__eyebrow">${escapeHtml(t('admin.selector.eyebrow'))}</p>
        <h1 class="c-page-header__title">${escapeHtml(t('admin.selector.title'))}</h1>
        <p class="c-page-header__sub">${escapeHtml(t('admin.selector.subtitle'))}</p>
      </header>
      <div class="c-page max-w-7xl mx-auto">
        <div class="flex items-center justify-end mb-3">
          <a href="#/" class="c-btn c-btn--outline c-btn--sm">${escapeHtml(t('app.dashboard'))}</a>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${concorsi.map(c => {
            const fs = db.fasiByConcorso(c.id);
            const cs = db.candidatiByConcorso(c.id);
            const coms = db.commissariByConcorso(c.id);
            return `
              <div class="bg-white border border-brand-100 rounded-2xl p-5 hover:shadow-soft transition-shadow group">
                <div class="flex items-start justify-between gap-3 mb-3">
                  <div class="min-w-0 flex-1">
                    <p class="c-tile__eyebrow">${escapeHtml(t('admin.selector.tile_eyebrow'))}</p>
                    <h3 class="c-tile__title truncate">${escapeHtml(c.nome)}</h3>
                  </div>
                  <span class="c-tag ${c.stato === 'ATTIVO' ? 'c-tag--green' : 'c-tag--gray c-tag--no-dot'}">${escapeHtml(c.stato)}</span>
                </div>
                <p class="text-xs text-muted-foreground mb-3">${escapeHtml(t('admin.selector.tile_year', { anno: c.anno }))} · ${cs.length} ${escapeHtml(t('home.concorsi.col_candidati').toLowerCase())} · ${fs.length} ${escapeHtml(t('home.concorsi.col_fasi').toLowerCase())} · ${coms.length} commissari</p>
                <div class="flex items-center gap-2">
                  <button data-pick="${c.id}" class="flex-1 c-btn c-btn--primary c-btn--sm justify-center">
                    ${escapeHtml(t('admin.selector.open'))} ${icon('arrowRight', { size: 14 })}
                  </button>
                  <button data-edit-concorso="${c.id}" class="c-btn c-btn--ghost c-btn--sm !px-2" title="${escapeHtml(t('common.edit'))}">
                    ${icon('edit', { size: 14 })}
                  </button>
                  <button data-delete-concorso="${c.id}" class="c-btn c-btn--ghost c-btn--sm !px-2 text-rose-600 hover:bg-rose-50" title="${escapeHtml(t('common.delete'))}">
                    ${icon('trash', { size: 14 })}
                  </button>
                </div>
              </div>
            `;
          }).join('')}
          <button data-action="new-concorso" class="c-tile c-tile--padded c-tile--clickable flex flex-col items-center justify-center text-center" style="min-height:9rem;background:hsl(var(--accent));border-style:dashed">
            <span class="text-3xl font-light text-primary leading-none">+</span>
            <span class="mt-2 text-sm font-medium text-primary">${escapeHtml(t('admin.selector.create_new'))}</span>
          </button>
        </div>
      </div>
    </section>
  `;
  root.querySelectorAll('[data-pick]').forEach(b => {
    b.addEventListener('click', () => {
      // Scegliendo un concorso, l'utente atterra sempre sulla Dashboard (non
      // sull'ultima tab attiva — che potrebbe essere stale dalla sessione
      // precedente, es. "Impostazioni concorso").
      db.setActiveConcorso(b.dataset.pick);
      setAdminTab('dashboard');
      renderAdmin(root);
    });
  });
  root.querySelector('[data-action="new-concorso"]').addEventListener('click', openCreateConcorso);

  root.querySelectorAll('[data-edit-concorso]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = concorsi.find(x => x.id === b.dataset.editConcorso);
      if (c) openEditConcorso(c, () => renderConcorsoSelector(root));
    });
  });

  root.querySelectorAll('[data-delete-concorso]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = concorsi.find(x => x.id === b.dataset.deleteConcorso);
      if (!c) return;
      const fs = db.fasiByConcorso(c.id).length;
      const cs = db.candidatiByConcorso(c.id).length;
      const coms = db.commissariByConcorso(c.id).length;
      confirmDialog({
        title: t('admin.concorso.delete_title'),
        message: t('admin.concorso.delete_msg', { nome: escapeHtml(c.nome), candidati: cs, fasi: fs, commissari: coms }),
        danger: true,
        onConfirm: async () => {
          try {
            await db.deleteConcorso(c.id);
            toast(t('admin.concorso.deleted'), 'success');
            renderConcorsoSelector(root);
          } catch (e) {
            toast(t('admin.concorso.delete_error', { msg: e.message }), 'error');
          }
        },
      });
    });
  });
}

// Modale "Nuovo concorso" — usato dal pulsante data-action="new-concorso".
// Al salvataggio crea il concorso, lo imposta come attivo e rientra in renderAdmin.
export function openCreateConcorso() {
  const currentYear = new Date().getFullYear();
  modal({
    title: t('admin.concorso.new_title') || 'Nuovo concorso',
    contentHtml: `
      <div class="space-y-4">
        <label class="c-field">
          <span class="c-field__label">${escapeHtml(t('admin.concorso.field_nome') || 'Nome')}</span>
          <input name="nome" type="text" required class="c-input" placeholder="Concorso Internazionale 2026" autofocus />
        </label>
        <div class="grid grid-cols-2 gap-4">
          <label class="c-field">
            <span class="c-field__label">${escapeHtml(t('admin.concorso.field_anno') || 'Anno')}</span>
            <input name="anno" type="number" min="2000" max="2100" required class="c-input" value="${currentYear}" />
          </label>
          <label class="c-field">
            <span class="c-field__label">${escapeHtml(t('admin.concorso.field_data_inizio') || 'Data inizio')}</span>
            <input name="data_inizio" type="date" class="c-input" />
          </label>
        </div>
        <label class="c-field">
          <span class="c-field__label">${escapeHtml(t('admin.concorso.field_logo') || 'Logo (opzionale)')}</span>
          <input name="logo" type="file" accept="image/*" class="c-input" />
        </label>
        <label class="flex items-center gap-2 text-sm text-ink-700">
          <input name="anonimo" type="checkbox" class="rounded border-slate-300" />
          <span>${escapeHtml(t('admin.concorso.field_anonimo') || 'Modalità anonima (nasconde i nomi ai commissari)')}</span>
        </label>
      </div>
    `,
    primaryLabel: t('common.create') || 'Crea',
    onPrimary: async (body) => {
      const nome = body.querySelector('[name="nome"]').value.trim();
      const anno = body.querySelector('[name="anno"]').value;
      const data_inizio = body.querySelector('[name="data_inizio"]').value || null;
      const anonimo = body.querySelector('[name="anonimo"]').checked;
      const logoFile = body.querySelector('[name="logo"]').files[0] || null;
      if (!nome) { toast(t('admin.concorso.required_nome') || 'Il nome è obbligatorio', 'error'); return false; }
      try {
        const logo = logoFile ? await readImageResized(logoFile, 800, 0.85) : undefined;
        const c = await db.createConcorso({ nome, anno: Number(anno), data_inizio, logo });
        if (anonimo) await db.updateConcorso(c.id, { anonimo: true });
        db.setActiveConcorso(c.id);
        toast(t('admin.concorso.created') || 'Concorso creato', 'success');
        renderAdmin(document.getElementById('app-root'));
      } catch (e) {
        toast(e?.message || 'Errore', 'error');
        return false;
      }
    },
  });
}

// Modale "Modifica concorso" — usato dal pulsante data-action="edit-concorso".
export function openEditConcorso(concorso, onSaved) {
  modal({
    title: t('admin.concorso.edit_title') || 'Modifica concorso',
    contentHtml: `
      <div class="space-y-4">
        <label class="c-field">
          <span class="c-field__label">${escapeHtml(t('admin.concorso.field_nome') || 'Nome')}</span>
          <input name="nome" type="text" required class="c-input" value="${escapeHtml(concorso.nome || '')}" autofocus />
        </label>
        <div class="grid grid-cols-2 gap-4">
          <label class="c-field">
            <span class="c-field__label">${escapeHtml(t('admin.concorso.field_anno') || 'Anno')}</span>
            <input name="anno" type="number" min="2000" max="2100" required class="c-input" value="${escapeHtml(String(concorso.anno || ''))}" />
          </label>
          <label class="c-field">
            <span class="c-field__label">${escapeHtml(t('admin.concorso.field_data_inizio') || 'Data inizio')}</span>
            <input name="data_inizio" type="date" class="c-input" value="${escapeHtml(concorso.data_inizio || '')}" />
          </label>
        </div>
        <label class="c-field">
          <span class="c-field__label">${escapeHtml(t('admin.concorso.field_stato') || 'Stato')}</span>
          <select name="stato" class="c-input">
            <option value="ATTIVO" ${concorso.stato === 'ATTIVO' ? 'selected' : ''}>ATTIVO</option>
            <option value="ARCHIVIATO" ${concorso.stato === 'ARCHIVIATO' ? 'selected' : ''}>ARCHIVIATO</option>
          </select>
        </label>
        <label class="c-field">
          <span class="c-field__label">${escapeHtml(t('admin.concorso.field_logo') || 'Logo (sostituisci)')}</span>
          <input name="logo" type="file" accept="image/*" class="c-input" />
          ${concorso.logo_url ? `<img src="${escapeHtml(concorso.logo_url)}" alt="" class="mt-2 w-20 h-20 rounded-xl object-contain border border-brand-100" />` : ''}
        </label>
        <label class="flex items-center gap-2 text-sm text-ink-700">
          <input name="anonimo" type="checkbox" class="rounded border-slate-300" ${concorso.anonimo ? 'checked' : ''} />
          <span>${escapeHtml(t('admin.concorso.field_anonimo') || 'Modalità anonima (nasconde i nomi ai commissari)')}</span>
        </label>

        <div class="pt-4 mt-2 border-t border-slate-200">
          <p class="c-field__label mb-2">Iscrizioni pubbliche</p>
          <p class="text-[11px] text-slate-500 leading-snug mb-3">Quando aperte, il form auto-service all'indirizzo <code class="bg-slate-100 px-1 rounded">/#/iscrizione</code> accetta nuove iscrizioni. Lasciale chiuse per concorsi non ancora pubblicizzati o già pieni.</p>
          <label class="flex items-center gap-2 text-sm text-ink-700">
            <input name="iscrizioni_aperte" type="checkbox" class="rounded border-slate-300" ${concorso.iscrizioni_aperte ? 'checked' : ''} />
            <span>Accetta iscrizioni dal frontend pubblico</span>
          </label>
          <label class="c-field mt-3">
            <span class="c-field__label">Data/ora di chiusura iscrizioni (opzionale)</span>
            <input name="iscrizioni_chiusura" type="datetime-local" class="c-input" value="${escapeHtml((concorso.iscrizioni_chiusura || '').slice(0, 16))}" />
            <span class="text-[11px] text-slate-500 mt-1 block">Oltre questa data il form pubblico chiude le iscrizioni automaticamente. Lascia vuoto per nessun limite temporale.</span>
          </label>
        </div>

        <div class="pt-4 mt-2 border-t border-slate-200">
          <p class="c-field__label mb-2">${escapeHtml(t('admin.concorso.tiebreak_default_label') || 'Regole di rottura della parità (default)')}</p>
          <p class="text-[11px] text-slate-500 leading-snug mb-3">${escapeHtml(t('admin.concorso.tiebreak_default_help') || 'Cascata di default applicata a ogni fase del concorso. Ogni fase può comunque sovrascrivere questa policy nelle proprie impostazioni.')}</p>
          ${tiebreakStrategyHtml(concorso.default_tiebreak_strategy, null)}
        </div>
      </div>
    `,
    primaryLabel: t('common.save') || 'Salva',
    onMount: (body) => {
      // Stesso meccanismo "touched" del form fase: se l'admin tocca un toggle
      // mandiamo l'array completo; altrimenti restiamo sul default standard.
      const tbContainer = body.querySelector('[data-tiebreak-steps]');
      if (tbContainer) {
        const startTouched = Array.isArray(concorso.default_tiebreak_strategy) && concorso.default_tiebreak_strategy.length > 0;
        if (startTouched) tbContainer.dataset.tbTouched = '1';
        tbContainer.addEventListener('change', (ev) => {
          if (ev.target.matches('[data-tb-enabled]')) tbContainer.dataset.tbTouched = '1';
        });
      }
    },
    onPrimary: async (body) => {
      const nome = body.querySelector('[name="nome"]').value.trim();
      const anno = body.querySelector('[name="anno"]').value;
      const data_inizio = body.querySelector('[name="data_inizio"]').value || null;
      const stato = body.querySelector('[name="stato"]').value;
      const anonimo = body.querySelector('[name="anonimo"]').checked;
      const iscrizioni_aperte = body.querySelector('[name="iscrizioni_aperte"]').checked;
      const iscrizioniChiusuraRaw = body.querySelector('[name="iscrizioni_chiusura"]').value;
      // datetime-local → ISO con timezone, oppure '' per nessun limite
      const iscrizioni_chiusura = iscrizioniChiusuraRaw ? new Date(iscrizioniChiusuraRaw).toISOString() : '';
      const logoFile = body.querySelector('[name="logo"]').files[0] || null;
      if (!nome) { toast(t('admin.concorso.required_nome') || 'Il nome è obbligatorio', 'error'); return false; }
      // Tiebreak default: invia array solo se l'admin ha toccato qualcosa.
      const tbContainer = body.querySelector('[data-tiebreak-steps]');
      let default_tiebreak_strategy = null;
      if (tbContainer && tbContainer.dataset.tbTouched === '1') {
        default_tiebreak_strategy = Array.from(tbContainer.querySelectorAll('[data-tb-key]')).map(el => ({
          key: el.dataset.tbKey,
          enabled: el.querySelector('[data-tb-enabled]').checked,
        }));
      }
      try {
        const patch = { nome, anno: Number(anno), data_inizio, stato, anonimo, iscrizioni_aperte, iscrizioni_chiusura };
        if (default_tiebreak_strategy !== null) patch.default_tiebreak_strategy = default_tiebreak_strategy;
        if (logoFile) patch.logo = await readImageResized(logoFile, 800, 0.85);
        await db.updateConcorso(concorso.id, patch);
        toast(t('admin.concorso.updated') || 'Concorso aggiornato', 'success');
        if (onSaved) onSaved();
      } catch (e) {
        toast(e?.message || 'Errore', 'error');
        return false;
      }
    },
  });
}
