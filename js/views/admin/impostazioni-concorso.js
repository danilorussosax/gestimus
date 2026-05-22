// Tab "Impostazioni" del concorso selezionato.
// Prima era un bottoncino "Modifica" inline accanto al titolo: ora è un tab
// dedicato con sezione anagrafica + bottoni per modifica e cancellazione.

import { db } from '../../db.js';
import { escapeHtml, fmtDate, confirmDialog, toast } from '../../utils.js';
import { icon } from '../../icons.js';
import { t } from '../../i18n.js';
import { openEditConcorso } from './concorso-selector.js';

export function renderImpostazioniConcorso(root, concorso) {
  const fasi = db.fasiByConcorso(concorso.id);
  const candidati = db.candidatiByConcorso(concorso.id);
  const commissari = db.commissariByConcorso(concorso.id);

  root.innerHTML = `
    <div class="max-w-3xl space-y-6">
      <header>
        <h3 class="text-base font-semibold text-ink-900">${escapeHtml(t('admin.impostazioni_concorso.title') || 'Impostazioni del concorso')}</h3>
        <p class="text-sm text-ink-700 mt-1">${escapeHtml(t('admin.impostazioni_concorso.subtitle') || 'Modifica anagrafica, branding e gestione del concorso selezionato.')}</p>
      </header>

      <!-- Anagrafica -->
      <section class="bg-white border border-slate-200 rounded-2xl p-5">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <p class="text-[11px] uppercase tracking-wide font-semibold text-ink-500">${escapeHtml(t('admin.impostazioni_concorso.anagrafica') || 'Anagrafica')}</p>
            <h4 class="text-lg font-semibold text-ink-900 mt-1">${escapeHtml(concorso.nome)}</h4>
          </div>
          <button data-action="edit" class="c-btn c-btn--primary c-btn--sm">
            ${icon('edit', { size: 14 })}<span>${escapeHtml(t('admin.impostazioni_concorso.edit') || 'Modifica')}</span>
          </button>
        </div>
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><dt class="text-ink-700">${escapeHtml(t('admin.impostazioni_concorso.anno') || 'Anno')}:</dt><dd class="text-ink-900 font-medium">${concorso.anno}</dd></div>
          <div><dt class="text-ink-700">${escapeHtml(t('admin.impostazioni_concorso.stato') || 'Stato')}:</dt><dd><span class="c-tag ${concorso.stato === 'ATTIVO' ? 'c-tag--green' : 'c-tag--gray c-tag--no-dot'}">${escapeHtml(concorso.stato)}</span></dd></div>
          <div><dt class="text-ink-700">${escapeHtml(t('admin.impostazioni_concorso.anonimo') || 'Modalità anonima')}:</dt><dd class="text-ink-900">${concorso.anonimo ? '✓ Attiva' : '— Disattivata'}</dd></div>
          <div><dt class="text-ink-700">${escapeHtml(t('admin.impostazioni_concorso.iscrizioni') || 'Iscrizioni pubbliche')}:</dt><dd class="text-ink-900">${concorso.iscrizioni_aperte ? '✓ Aperte' : '— Chiuse'}</dd></div>
          ${concorso.data_inizio ? `<div><dt class="text-ink-700">${escapeHtml(t('admin.impostazioni_concorso.data_inizio') || 'Data inizio')}:</dt><dd class="text-ink-900">${fmtDate(concorso.data_inizio)}</dd></div>` : ''}
          ${concorso.iscrizioni_scadenza ? `<div><dt class="text-ink-700">${escapeHtml(t('admin.impostazioni_concorso.scadenza_iscrizioni') || 'Scadenza iscrizioni')}:</dt><dd class="text-ink-900">${fmtDate(concorso.iscrizioni_scadenza)}</dd></div>` : ''}
        </dl>
      </section>

      <!-- Statistiche -->
      <section class="bg-white border border-slate-200 rounded-2xl p-5">
        <p class="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-3">${escapeHtml(t('admin.impostazioni_concorso.stats') || 'Statistiche')}</p>
        <div class="grid grid-cols-3 gap-3 text-sm">
          <div class="text-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
            <div class="text-2xl font-bold text-ink-900">${fasi.length}</div>
            <div class="text-[11px] text-ink-700 uppercase tracking-wide mt-1">${escapeHtml(t('admin.nav.fasi') || 'Fasi')}</div>
          </div>
          <div class="text-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
            <div class="text-2xl font-bold text-ink-900">${candidati.length}</div>
            <div class="text-[11px] text-ink-700 uppercase tracking-wide mt-1">${escapeHtml(t('admin.nav.candidati') || 'Candidati')}</div>
          </div>
          <div class="text-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
            <div class="text-2xl font-bold text-ink-900">${commissari.length}</div>
            <div class="text-[11px] text-ink-700 uppercase tracking-wide mt-1">${escapeHtml(t('admin.nav.commissari') || 'Commissari')}</div>
          </div>
        </div>
      </section>

      <!-- Zona pericolosa: cancellazione -->
      <section class="bg-rose-50 border border-rose-200 rounded-2xl p-5">
        <div class="flex items-start gap-3">
          <span class="text-rose-700 shrink-0">${icon('warning', { size: 20 })}</span>
          <div class="flex-1">
            <h4 class="text-sm font-semibold text-rose-900">${escapeHtml(t('admin.impostazioni_concorso.danger_title') || 'Zona pericolosa')}</h4>
            <p class="text-sm text-rose-800 mt-1">${escapeHtml(t('admin.impostazioni_concorso.danger_desc') || 'Eliminare il concorso rimuove anche tutti i dati associati (fasi, candidati, valutazioni). Operazione irreversibile.')}</p>
            <button data-action="delete" class="c-btn c-btn--sm mt-3 bg-rose-600 hover:bg-rose-700 text-white !border-rose-600">
              ${icon('trash', { size: 14 })}<span>${escapeHtml(t('admin.impostazioni_concorso.delete') || 'Elimina concorso')}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  `;

  root.querySelector('[data-action="edit"]').addEventListener('click', () => {
    openEditConcorso(concorso, () => {
      // Dopo il salvataggio re-renderizza la pagina
      const updated = db.state.concorsi.find((c) => c.id === concorso.id);
      if (updated) renderImpostazioniConcorso(root, updated);
    });
  });

  root.querySelector('[data-action="delete"]').addEventListener('click', () => {
    confirmDialog({
      title: t('admin.concorso.delete_title') || `Elimina ${concorso.nome}`,
      message: t('admin.concorso.delete_msg', {
        nome: escapeHtml(concorso.nome),
        candidati: candidati.length,
        fasi: fasi.length,
        commissari: commissari.length,
      }),
      danger: true,
      onConfirm: async () => {
        try {
          await db.deleteConcorso(concorso.id);
          toast(t('admin.concorso.deleted') || 'Concorso eliminato', 'success');
          db.setActiveConcorso(null);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } catch (e) {
          toast(e.message, 'error');
        }
      },
    });
  });
}
