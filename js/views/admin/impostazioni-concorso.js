// Tab "Impostazioni" del concorso selezionato.
// Pannello completo di modifica concorso embedded direttamente nella pagina
// (niente più modale "Modifica") + statistiche + zona pericolosa cancellazione.

import { db } from '../../db.js';
import { escapeHtml, fmtDate, confirmDialog, modal, toast, readImageResized } from '../../utils.js';
import { icon } from '../../icons.js';
import { tiebreakStrategyHtml } from './common.js';

export function renderImpostazioniConcorso(/** @type {any} */ root, /** @type {any} */ concorso) {
  const fasi = db.fasiByConcorso(concorso.id);
  const candidati = db.candidatiByConcorso(concorso.id);
  const commissari = db.commissariByConcorso(concorso.id);

  const isoToLocalDatetime = (/** @type {any} */ iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const pad = (/** @type {any} */ n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
  };

  root.innerHTML = `
    <div class="max-w-3xl space-y-6" data-impostazioni-concorso>
      <header>
        <h3 class="text-base font-semibold text-ink-900">Impostazioni del concorso</h3>
        <p class="text-sm text-ink-700 mt-1">Modifica anagrafica, branding e gestione del concorso selezionato. Le modifiche vengono salvate cliccando "Salva" in fondo alla pagina.</p>
      </header>

      <form data-form class="space-y-6">
        <!-- Logo + identità visiva -->
        <section class="bg-white border border-slate-200 rounded-2xl p-5">
          <p class="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-3">Logo del concorso</p>
          <div class="flex items-start gap-4">
            <div class="w-24 h-24 rounded-xl bg-slate-50 border border-brand-100 flex items-center justify-center overflow-hidden shrink-0" data-logo-frame>
              ${concorso.logo_url
                ? `<img data-logo-preview src="${escapeHtml(concorso.logo_url)}" alt="" class="w-full h-full object-contain" />`
                : `<span data-logo-placeholder class="text-slate-400">${icon('upload', { size: 28 })}</span>`}
            </div>
            <div class="flex-1 min-w-0">
              <label class="c-btn c-btn--outline c-btn--sm cursor-pointer inline-flex">
                <span>${concorso.logo_url ? 'Sostituisci logo' : 'Scegli logo'}</span>
                <input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="hidden" />
              </label>
              <p class="text-xs text-ink-700 mt-2">Sostituisce il logo applicativo nelle stampe PDF (verbali, protocollo) e nell'header dell'app. PNG, JPG, WebP o SVG. Max 5 MB.</p>
            </div>
          </div>
        </section>

        <!-- Anagrafica -->
        <section class="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <p class="text-[11px] uppercase tracking-wide font-semibold text-ink-500">Anagrafica</p>
          <label class="c-field">
            <span class="c-field__label">Nome del concorso</span>
            <input name="nome" type="text" required class="c-input" value="${escapeHtml(concorso.nome || '')}" placeholder="Es: Concorso Nazionale 2026" />
          </label>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label class="c-field">
              <span class="c-field__label">Anno</span>
              <input name="anno" type="number" min="2000" max="2100" required class="c-input" value="${escapeHtml(String(concorso.anno || ''))}" />
            </label>
            <label class="c-field">
              <span class="c-field__label">Data inizio</span>
              <input name="data_inizio" type="date" class="c-input" value="${escapeHtml(concorso.data_inizio || '')}" />
            </label>
            <label class="c-field">
              <span class="c-field__label">Stato</span>
              <select name="stato" class="c-input">
                <option value="ATTIVO" ${concorso.stato === 'ATTIVO' ? 'selected' : ''}>ATTIVO</option>
                <option value="ARCHIVIATO" ${concorso.stato === 'ARCHIVIATO' ? 'selected' : ''}>ARCHIVIATO</option>
              </select>
            </label>
          </div>
        </section>

        <!-- Modalità di valutazione -->
        <section class="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <p class="text-[11px] uppercase tracking-wide font-semibold text-ink-500">Modalità di valutazione</p>
          <label class="flex items-start gap-2 text-sm text-ink-700">
            <input name="anonimo" type="checkbox" class="rounded border-slate-300 mt-0.5" ${concorso.anonimo ? 'checked' : ''} />
            <span>
              <span class="font-medium text-ink-900">Modalità anonima</span><br />
              <span class="text-xs text-slate-500">Nasconde i nomi dei candidati ai commissari: durante la votazione vedono solo il numero progressivo. Utile per concorsi che richiedono valutazione cieca.</span>
            </span>
          </label>
        </section>

        <!-- Iscrizioni pubbliche -->
        <section class="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <p class="text-[11px] uppercase tracking-wide font-semibold text-ink-500">Iscrizioni pubbliche</p>
          <p class="text-xs text-slate-500 leading-snug">Quando aperte, il form auto-service all'indirizzo <code class="bg-slate-100 px-1 rounded">/#/iscrizione</code> accetta nuove iscrizioni. Lasciale chiuse per concorsi non ancora pubblicizzati o già pieni.</p>
          <label class="flex items-center gap-2 text-sm text-ink-700">
            <input name="iscrizioni_aperte" type="checkbox" class="rounded border-slate-300" ${concorso.iscrizioni_aperte ? 'checked' : ''} />
            <span>Accetta iscrizioni dal frontend pubblico</span>
          </label>
          <label class="c-field">
            <span class="c-field__label">Data/ora di chiusura iscrizioni <span class="text-slate-400">(opzionale)</span></span>
            <input name="iscrizioni_chiusura" type="datetime-local" class="c-input" value="${escapeHtml(isoToLocalDatetime(concorso.iscrizioni_chiusura))}" />
            <span class="text-[11px] text-slate-500 mt-1 block">Oltre questa data il form pubblico chiude le iscrizioni automaticamente. Lascia vuoto per nessun limite temporale.</span>
          </label>
        </section>

        <!-- Tiebreak default -->
        <section class="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <p class="text-[11px] uppercase tracking-wide font-semibold text-ink-500">Regole di rottura della parità (default)</p>
          <p class="text-xs text-slate-500 leading-snug">Cascata di default applicata a ogni fase del concorso. Ogni fase può comunque sovrascrivere questa policy nelle proprie impostazioni.</p>
          ${tiebreakStrategyHtml(concorso.default_tiebreak_strategy, null)}
        </section>

        <!-- Salva -->
        <div class="flex justify-end gap-3 sticky bottom-0 bg-gradient-to-t from-white via-white pt-3 -mt-1 pb-2">
          <button type="button" data-action="reset" class="c-btn c-btn--outline c-btn--sm">Annulla modifiche</button>
          <button type="submit" class="c-btn c-btn--primary">
            ${icon('check', { size: 16 })}<span>Salva impostazioni</span>
          </button>
        </div>
      </form>

      <!-- Statistiche -->
      <section class="bg-white border border-slate-200 rounded-2xl p-5">
        <p class="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-3">Statistiche</p>
        <div class="grid grid-cols-3 gap-3 text-sm">
          <div class="text-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
            <div class="text-2xl font-bold text-ink-900">${fasi.length}</div>
            <div class="text-[11px] text-ink-700 uppercase tracking-wide mt-1">Fasi</div>
          </div>
          <div class="text-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
            <div class="text-2xl font-bold text-ink-900">${candidati.length}</div>
            <div class="text-[11px] text-ink-700 uppercase tracking-wide mt-1">Candidati</div>
          </div>
          <div class="text-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
            <div class="text-2xl font-bold text-ink-900">${commissari.length}</div>
            <div class="text-[11px] text-ink-700 uppercase tracking-wide mt-1">Commissari</div>
          </div>
        </div>
        ${concorso.data_inizio ? `<p class="text-xs text-ink-700 mt-3">Data inizio prevista: <span class="font-medium text-ink-900">${fmtDate(concorso.data_inizio)}</span></p>` : ''}
      </section>

      <!-- Zona pericolosa -->
      <section class="bg-rose-50 border border-rose-200 rounded-2xl p-5">
        <div class="flex items-start gap-3">
          <span class="text-rose-700 shrink-0">${icon('warning', { size: 20 })}</span>
          <div class="flex-1">
            <h4 class="text-sm font-semibold text-rose-900">Zona pericolosa</h4>
            <p class="text-sm text-rose-800 mt-1">Eliminare il concorso rimuove anche tutti i dati associati (fasi, candidati, valutazioni). Operazione irreversibile.</p>
            <button type="button" data-action="delete" class="c-btn c-btn--sm mt-3 bg-rose-600 hover:bg-rose-700 text-white !border-rose-600">
              ${icon('trash', { size: 14 })}<span>Elimina concorso</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  `;

  // ---------- Logica del form ----------

  const form = root.querySelector('[data-form]');
  const logoInput = form.querySelector('[name="logo"]');
  const logoFrame = form.querySelector('[data-logo-frame]');
  let pendingLogoFile = /** @type {any} */ (null);

  // Preview live del nuovo logo selezionato
  logoInput.addEventListener('change', async (/** @type {any} */ e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast('Il logo supera i 5 MB', 'error');
      logoInput.value = '';
      return;
    }
    try {
      const dataURL = await readImageResized(file, 800, 0.85);
      pendingLogoFile = { dataURL, name: file.name };
      logoFrame.innerHTML = `<img data-logo-preview src="${escapeHtml(dataURL)}" alt="" class="w-full h-full object-contain" />`;
    } catch {
      toast('Errore caricamento logo', 'error');
    }
  });

  // Touched tracking del tiebreak (stesso meccanismo del form fase: se l'admin
  // non tocca i toggle, NON mandiamo l'array — manteniamo la policy ereditata).
  const tbContainer = form.querySelector('[data-tiebreak-steps]');
  if (tbContainer) {
    const startTouched = Array.isArray(concorso.default_tiebreak_strategy) && concorso.default_tiebreak_strategy.length > 0;
    if (startTouched) tbContainer.dataset.tbTouched = '1';
    tbContainer.addEventListener('change', (/** @type {any} */ ev) => {
      if (ev.target.matches('[data-tb-enabled]')) tbContainer.dataset.tbTouched = '1';
    });
  }

  // Reset: ricarica i valori originali ri-renderizzando la view
  form.querySelector('[data-action="reset"]').addEventListener('click', () => {
    const fresh = db.state.concorsi.find((/** @type {any} */ c) => c.id === concorso.id) || concorso;
    renderImpostazioniConcorso(root, fresh);
  });

  // Submit
  form.addEventListener('submit', async (/** @type {Event} */ e) => {
    e.preventDefault();
    const nome = form.querySelector('[name="nome"]').value.trim();
    if (!nome) {
      toast('Il nome è obbligatorio', 'error');
      return;
    }
    const anno = form.querySelector('[name="anno"]').value;
    const data_inizio = form.querySelector('[name="data_inizio"]').value || null;
    const stato = form.querySelector('[name="stato"]').value;
    const anonimo = form.querySelector('[name="anonimo"]').checked;
    const iscrizioni_aperte = form.querySelector('[name="iscrizioni_aperte"]').checked;
    // N45: la colonna iscrizioni_scadenza è date-only. Convertire l'input
    // datetime-local in UTC con toISOString() poteva spostare la data di un
    // giorno vicino a mezzanotte (es. 23/05 00:30 Roma → 22/05 22:30Z → 22/05).
    // Inviamo direttamente la DATA locale scelta dall'admin (il tempo è ignorato
    // dalla colonna), così la scadenza coincide col giorno selezionato.
    const iscrizioniChiusuraRaw = form.querySelector('[name="iscrizioni_chiusura"]').value;
    const iscrizioni_chiusura = iscrizioniChiusuraRaw ? iscrizioniChiusuraRaw.slice(0, 10) : '';

    let default_tiebreak_strategy = null;
    if (tbContainer && tbContainer.dataset.tbTouched === '1') {
      default_tiebreak_strategy = Array.from(tbContainer.querySelectorAll('[data-tb-key]')).map(el => ({
        key: el.dataset.tbKey,
        enabled: el.querySelector('[data-tb-enabled]').checked,
      }));
    }

    const patch = /** @type {Record<string, any>} */ ({ nome, anno: Number(anno), data_inizio, stato, anonimo, iscrizioni_aperte, iscrizioni_chiusura });
    if (default_tiebreak_strategy !== null) patch.default_tiebreak_strategy = default_tiebreak_strategy;
    if (pendingLogoFile) patch.logo = pendingLogoFile;

    try {
      await db.updateConcorso(concorso.id, patch);
      toast('Concorso aggiornato', 'success');
      const updated = db.state.concorsi.find((/** @type {any} */ c) => c.id === concorso.id);
      if (updated) renderImpostazioniConcorso(root, updated);
    } catch (/** @type {any} */ err) {
      toast(err?.message || 'Errore durante il salvataggio', 'error');
    }
  });

  // ---------- Zona pericolosa ----------

  // Doppia conferma: prima un warning standard (yes/no), poi un modal di
  // type-to-delete che richiede di scrivere il nome esatto del concorso per
  // sbloccare il bottone "Elimina definitivamente". Pattern GitHub-style:
  // riduce drasticamente le cancellazioni accidentali.
  root.querySelector('[data-action="delete"]').addEventListener('click', () => {
    confirmDialog({
      title: `Elimina ${concorso.nome}`,
      message: `Stai per eliminare "${escapeHtml(concorso.nome)}". Verranno rimossi anche ${candidati.length} candidati, ${fasi.length} fasi e ${commissari.length} commissari. Operazione irreversibile.`,
      danger: true,
      onConfirm: () => {
        openDeleteConfirmModal(concorso, candidati.length, fasi.length, commissari.length);
      },
    });
  });
}

function openDeleteConfirmModal(/** @type {any} */ concorso, /** @type {any} */ nCand, /** @type {any} */ nFasi, /** @type {any} */ nCom) {
  modal({
    title: `⚠ Conferma eliminazione definitiva`,
    contentHtml: `
      <div class="space-y-4">
        <div class="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-900">
          <p class="font-semibold mb-2">Stai per cancellare <strong>${escapeHtml(concorso.nome)}</strong> dal database.</p>
          <ul class="text-xs space-y-1 list-disc pl-5">
            <li>${nCand} candidati e tutte le loro valutazioni</li>
            <li>${nFasi} fasi con criteri e risultati</li>
            <li>${nCom} commissari assegnati a questo concorso</li>
            <li>tutte le iscrizioni pubbliche ricevute (incluse pending)</li>
          </ul>
          <p class="text-xs mt-3"><strong>L'operazione non è annullabile.</strong> Esegui un backup prima di procedere se hai dubbi.</p>
        </div>
        <label class="block">
          <span class="text-sm font-medium text-ink-800">Per confermare, digita il nome esatto del concorso:</span>
          <p class="font-mono text-sm bg-slate-100 border border-slate-200 rounded px-2 py-1 mt-1 mb-2 select-all">${escapeHtml(concorso.nome)}</p>
          <input data-delete-confirm-input type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                 placeholder="Scrivi qui il nome..." />
        </label>
      </div>
    `,
    primaryLabel: 'Elimina definitivamente',
    secondaryLabel: 'Annulla',
    onMount: (body) => {
      const input = /** @type {HTMLInputElement} */ (body.querySelector('[data-delete-confirm-input]'));
      // Il bottone primary del modal helper sta fuori dal body; recuperiamo
      // tutto il modal e cerchiamo lì il primary.
      const modalRoot = body.closest('[data-modal]') || body.parentElement;
      const primaryBtn = /** @type {HTMLButtonElement | null} */ (modalRoot?.querySelector('.c-btn--primary') || document.querySelector('#modal-root .c-btn--primary'));
      const sync = () => {
        const match = input.value.trim() === concorso.nome.trim();
        if (primaryBtn) {
          primaryBtn.disabled = !match;
          primaryBtn.classList.toggle('opacity-50', !match);
          primaryBtn.classList.toggle('cursor-not-allowed', !match);
          if (match) {
            primaryBtn.classList.add('bg-rose-600', 'hover:bg-rose-700', '!border-rose-600');
          }
        }
      };
      input.addEventListener('input', sync);
      input.focus();
      sync();
    },
    onPrimary: async (body) => {
      const input = /** @type {HTMLInputElement} */ (body.querySelector('[data-delete-confirm-input]'));
      if (input.value.trim() !== concorso.nome.trim()) {
        toast('Il nome inserito non corrisponde. Operazione annullata.', 'error');
        return false;
      }
      try {
        await db.deleteConcorso(concorso.id);
        toast('Concorso eliminato', 'success');
        db.setActiveConcorso(null);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (/** @type {any} */ err) {
        toast(err.message, 'error');
        return false;
      }
    },
  });
}
