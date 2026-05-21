import { db } from '../db.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../utils.js';

export function renderDashboard(root) {
  const s = db.state;
  const ente = db.getEnte();

  const concorsiAttivi = s.concorsi.filter(c => c.stato === 'ATTIVO').length;
  const concorsiTotali = s.concorsi.length;
  const fasiInCorso = s.fasi.filter(f => f.stato === 'IN_CORSO').length;
  const candidatiTotali = s.candidati.length;
  const commissariTotali = s.commissari.length;
  const valutazioniTotali = s.valutazioni.length;
  const accountsTotali = s.accounts.length;

  const kpi = (label, value, icon_name, color = 'brand') => {
    const colors = {
      brand: 'bg-brand-50 text-brand-700',
      teal: 'bg-teal-50 text-teal-700',
      amber: 'bg-amber-50 text-amber-700',
      rose: 'bg-rose-50 text-rose-700',
      slate: 'bg-slate-100 text-slate-700',
    };
    return `
      <div class="bg-white border border-brand-100 rounded-2xl p-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-700 font-medium">${label}</p>
            <p class="text-2xl font-black text-ink-900 mt-0.5">${value}</p>
          </div>
          <div class="w-10 h-10 rounded-xl ${colors[color] || colors.brand} flex items-center justify-center shrink-0">
            ${icon(icon_name, { size: 20 })}
          </div>
        </div>
      </div>`;
  };

  root.innerHTML = `
    <section class="view-fade c-page">
      <header class="c-page-header">
        <p class="c-page-header__eyebrow">${escapeHtml(t('admin.dashboard.eyebrow'))}</p>
        <h1 class="c-page-header__title">${ente ? escapeHtml(ente.nome) : escapeHtml(t('admin.dashboard.title'))}</h1>
        ${ente?.descrizione ? `<p class="c-page-header__sub">${escapeHtml(ente.descrizione)}</p>` : ''}
      </header>

      <div class="c-page">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          ${kpi(t('admin.dashboard.concorsi'), `${concorsiAttivi}/${concorsiTotali}`, 'trophy', 'brand')}
          ${kpi(t('admin.dashboard.fasi'), fasiInCorso, 'flag', 'teal')}
          ${kpi(t('admin.dashboard.candidati'), candidatiTotali, 'graduation', 'amber')}
          ${kpi(t('admin.dashboard.valutazioni'), valutazioniTotali, 'list', 'slate')}
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          ${kpi(t('admin.dashboard.commissari'), commissariTotali, 'judge', 'brand')}
          ${kpi(t('admin.dashboard.accounts'), accountsTotali, 'user', 'teal')}
        </div>

        ${ente ? `
        <div class="bg-white border border-brand-100 rounded-2xl p-5">
          <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-700 font-medium mb-3">${escapeHtml(t('admin.dashboard.ente_info'))}</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            ${ente.email_contatto ? `<div><span class="text-ink-700">${escapeHtml(t('admin.settings.email'))}:</span> <span class="font-medium text-ink-900">${escapeHtml(ente.email_contatto)}</span></div>` : ''}
            ${ente.telefono ? `<div><span class="text-ink-700">${escapeHtml(t('admin.settings.phone'))}:</span> <span class="font-medium text-ink-900">${escapeHtml(ente.telefono)}</span></div>` : ''}
            ${ente.sito_web ? `<div><span class="text-ink-700">${escapeHtml(t('admin.settings.website'))}:</span> <a href="${escapeHtml(ente.sito_web)}" target="_blank" rel="noopener" class="font-medium text-brand-600 hover:underline">${escapeHtml(ente.sito_web)}</a></div>` : ''}
            ${ente.indirizzo ? `<div class="sm:col-span-2"><span class="text-ink-700">${escapeHtml(t('admin.settings.address'))}:</span> <span class="font-medium text-ink-900">${escapeHtml(ente.indirizzo)}</span></div>` : ''}
          </div>
        </div>
        ` : `
        <div class="bg-sun-50 border border-sun-400/40 rounded-2xl p-5">
          <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-sun-600 font-medium mb-1">${escapeHtml(t('admin.dashboard.no_ente'))}</p>
          <p class="text-sm text-ink-900">${escapeHtml(t('admin.dashboard.no_ente_desc'))}</p>
          <a href="#/admin?tab=impostazioni" class="c-btn c-btn--primary c-btn--sm mt-3">${escapeHtml(t('admin.dashboard.go_settings'))}</a>
        </div>
        `}
      </div>
    </section>
  `;
}