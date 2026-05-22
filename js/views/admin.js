import { db } from '../db.js';
import { pb } from '../pb.js';
import { escapeHtml, displayName } from '../utils.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { renderSezioni } from './admin/sezioni.js';
import { renderIscrizioni } from './admin/iscrizioni.js';
import { renderCandidati } from './admin/candidati.js';
import { renderCommissioni } from './admin/commissioni.js';
import { renderCommissari } from './admin/commissari.js';
import { renderRisultati } from './admin/risultati.js';
import { renderFasi } from './admin/fasi.js';
import { renderAudit } from './admin/audit.js';
import { renderConcorsoSelector, openCreateConcorso, openEditConcorso } from './admin/concorso-selector.js';
import { renderDashboard } from './admin/dashboard.js';
import { renderImpostazioniConcorso } from './admin/impostazioni-concorso.js';

let activeTab = 'dashboard';

export function setAdminTab(tab) { activeTab = tab; }

export function renderAdmin(root) {
  const concorsoId = db.state.meta.activeConcorsoId;
  // Permetti override via hash #/admin?tab=…
  const hashQ = (location.hash.split('?')[1] || '');
  const params = new URLSearchParams(hashQ);
  const tabParam = params.get('tab');
  if (tabParam) {
    activeTab = tabParam;
    // Pulisci la query per non rimanere "appiccicata" al tab al prossimo refresh
    history.replaceState(null, '', '#' + location.hash.split('?')[0].slice(1));
  }
  if (!concorsoId) {
    return renderConcorsoSelector(root);
  }
  const concorso = db.state.concorsi.find(c => c.id === concorsoId);
  if (!concorso) {
    db.setActiveConcorso(null);
    return renderConcorsoSelector(root);
  }

  const candCount = db.candidatiByConcorso(concorso.id).length;
  const fasiCount = db.fasiByConcorso(concorso.id).length;
  const comCount = db.commissariByConcorso(concorso.id).length;
  const sezCount = db.sezioniByConcorso(concorso.id).length;
  const commCount = db.commissioniByConcorso(concorso.id).length;
  const presidente = db.getPresidenteFor(concorso.id);
  // Reset stale activeTab (e.g., from a previous session)
  if (!['dashboard','fasi','candidati','commissari','sezioni','commissioni','iscrizioni','risultati','audit','impostazioni-concorso'].includes(activeTab)) activeTab = 'dashboard';

  root.innerHTML = `
    <section class="view-fade c-page">
      <div class="flex gap-6 lg:gap-8 items-start">
        <!-- Sidebar (Sneat-style: white surface, purple active pill) -->
        <aside class="hidden md:block w-60 lg:w-64 shrink-0 sticky top-24">
          <div class="bg-white border border-brand-100 relative">
            <a href="#/" class="block px-4 py-4 border-b border-brand-100 hover:bg-accent transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[-2px]">
              <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-700">${escapeHtml(t('admin.nav.eyebrow'))}</p>
              <h3 class="font-medium text-[15px] leading-tight mt-1 text-ink-900 inline-flex items-center gap-1.5">
                ${escapeHtml(t('admin.nav.eyebrow_title') || 'Generale')}
                <span class="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">${icon('arrowRight', { size: 14 })}</span>
              </h3>
            </a>

            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-700 px-4 pt-4 pb-2">${escapeHtml(t('admin.nav.sections'))}</p>
            <nav class="flex flex-col">
              ${navItem('dashboard', 'dashboard', t('admin.nav.dashboard'), null)}
              ${navItem('sezioni', 'folder', t('admin.nav.sezioni'), sezCount)}
              ${navItem('commissari', 'judge', t('admin.nav.commissari'), comCount)}
              ${navItem('commissioni', 'scale', t('admin.nav.commissioni'), commCount)}
              ${navItem('fasi', 'flag', t('admin.nav.fasi'), fasiCount)}
              ${navItem('iscrizioni', 'user', 'Iscrizioni', null)}
              ${navItem('candidati', 'graduation', t('admin.nav.candidati'), candCount)}
              ${navItem('risultati', 'trophy', t('admin.nav.risultati'), null)}
              ${navItem('audit', 'shield', t('admin.nav.audit'), null)}
              ${navItem('impostazioni-concorso', 'settings', t('admin.nav.impostazioni_concorso') || 'Impostazioni', null)}
            </nav>

            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-700 px-4 pt-5 pb-2 border-t border-brand-100 mt-3">${escapeHtml(t('admin.nav.admin_section'))}</p>
            <nav class="flex flex-col">
              <a href="#/admin?tab=utenti" class="flex items-center gap-3 px-4 h-10 transition w-full text-left text-[13px] font-medium border-l-2 border-l-transparent text-ink-700 hover:bg-brand-50 hover:text-ink-900">
                <span class="leading-none text-ink-700" aria-hidden="true">${icon('user', { size: 16 })}</span>
                <span class="flex-1">${escapeHtml(t('admin.nav.utenti'))}</span>
              </a>
              <a href="#/admin?tab=manuale" class="flex items-center gap-3 px-4 h-10 transition w-full text-left text-[13px] font-medium border-l-2 border-l-transparent text-ink-700 hover:bg-brand-50 hover:text-ink-900">
                <span class="leading-none text-ink-700" aria-hidden="true">${icon('book', { size: 16 })}</span>
                <span class="flex-1">${escapeHtml(t('admin.nav.manuale'))}</span>
              </a>
            </nav>

            <div class="mx-4 my-4 bg-brand-50 p-3 border-l-2 border-brand-500">
              <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-700">${escapeHtml(t('admin.concorso.active'))}</p>
              <div class="font-medium text-sm mt-1.5 leading-snug truncate text-ink-900">${escapeHtml(concorso.nome)}</div>
              <div class="text-[11px] text-ink-700 mt-0.5">${escapeHtml(t('admin.header.year_short', { anno: concorso.anno }))} · ${escapeHtml(t('admin.header.cands_short', { n: candCount }))}</div>
              ${presidente
                ? `<div class="text-[11px] text-ink-900 font-medium mt-2 flex items-center gap-1.5"><span class="text-[#b28600]">${icon('star', { size: 12 })}</span><span class="truncate">${escapeHtml(displayName(presidente))}</span></div>`
                : `<div class="text-[11px] text-[#b28600] font-medium mt-2 flex items-center gap-1.5">${icon('warning', { size: 12 })} ${escapeHtml(t('admin.header.no_president'))}</div>`}
            </div>

            <div class="px-4 pb-4 flex flex-col gap-2">
              <button data-action="switch-concorso" class="c-btn c-btn--ghost c-btn--sm !justify-start !gap-2" style="color:#525252">
                ${icon('refresh', { size: 14 })} <span>${escapeHtml(t('admin.concorso.change'))}</span>
              </button>
              <button data-action="new-concorso" class="c-btn c-btn--primary c-btn--sm !justify-start !gap-2">
                ${icon('plus', { size: 14 })} <span>${escapeHtml(t('admin.concorso.new'))}</span>
              </button>
            </div>
          </div>
        </aside>

        <!-- Main content -->
        <div class="flex-1 min-w-0">
          <!-- Breadcrumb / back link to concorsi list -->
          <button data-action="back-to-concorsi" class="inline-flex items-center gap-1.5 text-sm text-ink-700 hover:text-ink-900 hover:bg-brand-50 px-2 py-1 rounded-md mb-4 -ml-2 transition-colors">
            ${icon('arrowLeft', { size: 14 })}<span>${escapeHtml(t('admin.header.back_to_concorsi') || 'Gestione concorsi')}</span>
          </button>
          <header class="flex flex-wrap items-center gap-3 mb-6">
            <div class="flex-1 min-w-0">
              <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-700">${escapeHtml(t('admin.header.year_label', { anno: concorso.anno }))}</p>
              <div class="flex items-center gap-3 flex-wrap mt-1">
                <h2 class="text-2xl sm:text-[28px] font-light text-ink-900 tracking-tight truncate">${escapeHtml(concorso.nome)}</h2>
                <span class="c-tag ${concorso.stato === 'ATTIVO' ? 'c-tag--green' : 'c-tag--gray c-tag--no-dot'}">${escapeHtml(concorso.stato)}</span>
                ${concorso.anonimo ? `<span class="c-tag c-tag--purple c-tag--no-dot" title="${escapeHtml(t('admin.header.anonimo_title'))}">${icon('eyeOff', { size: 12 })}<span class="ml-1">${escapeHtml(t('admin.header.anonimo_tag'))}</span></span>` : ''}
              </div>
              <p class="text-sm text-ink-700 mt-1.5">${escapeHtml(t('admin.header.summary', { coms: comCount, fasi: fasiCount }))}</p>
            </div>
            <!-- Mobile-only: tab nav -->
            <nav class="md:hidden flex bg-white border border-brand-100 w-full overflow-x-auto no-scrollbar">
              ${mobileTab('dashboard', t('admin.nav.dashboard'),'dashboard')}
              ${mobileTab('sezioni', t('admin.nav.sezioni'),'folder')}
              ${mobileTab('commissari', t('admin.nav.commissari'),'judge')}
              ${mobileTab('commissioni', t('admin.nav.commissioni'),'scale')}
              ${mobileTab('fasi', t('admin.nav.fasi'),'flag')}
              ${mobileTab('iscrizioni', 'Iscrizioni','user')}
              ${mobileTab('candidati', t('admin.nav.candidati'),'graduation')}
              ${mobileTab('risultati', t('admin.nav.risultati'),'trophy')}
              ${mobileTab('audit', t('admin.nav.audit'),'shield')}
              ${mobileTab('impostazioni-concorso', t('admin.nav.impostazioni_concorso') || 'Impostazioni','settings')}
            </nav>
          </header>

          <div id="tab-content"></div>
        </div>
      </div>
    </section>
  `;

  root.querySelectorAll('[data-tab]').forEach(b => {
    b.addEventListener('click', () => {
      activeTab = b.dataset.tab;
      renderAdmin(root);
    });
  });

  root.querySelector('[data-action="new-concorso"]').addEventListener('click', openCreateConcorso);
  root.querySelector('[data-action="switch-concorso"]').addEventListener('click', () => {
    db.setActiveConcorso(null);
    renderAdmin(root);
  });
  root.querySelector('[data-action="back-to-concorsi"]')?.addEventListener('click', () => {
    db.setActiveConcorso(null);
    renderAdmin(root);
  });

  const content = root.querySelector('#tab-content');
  if (activeTab === 'dashboard') renderDashboard(content, concorso);
  else if (activeTab === 'fasi') renderFasi(content, concorso);
  else if (activeTab === 'sezioni') renderSezioni(content, concorso);
  else if (activeTab === 'candidati') renderCandidati(content, concorso);
  else if (activeTab === 'commissari') renderCommissari(content, concorso);
  else if (activeTab === 'commissioni') renderCommissioni(content, concorso);
  else if (activeTab === 'iscrizioni') renderIscrizioni(content, concorso);
  else if (activeTab === 'risultati') renderRisultati(content, concorso);
  else if (activeTab === 'audit') renderAudit(content, concorso);
  else if (activeTab === 'impostazioni-concorso') renderImpostazioniConcorso(content, concorso);
}

function navItem(id, iconName, label, count) {
  const active = activeTab === id;
  const base = 'flex items-center gap-3 px-4 h-10 transition w-full text-left text-[13px] font-medium border-l-2';
  const cls = active
    ? `${base} bg-[#edf5ff] border-l-brand-500 text-ink-900`
    : `${base} border-l-transparent text-ink-700 hover:bg-brand-50 hover:text-ink-900`;
  const countBadge = count != null
    ? `<span class="text-[10px] font-mono px-1.5 py-0.5 ${active ? 'bg-white text-brand-700' : 'bg-brand-50 text-ink-700 border border-brand-100'}">${count}</span>`
    : '';
  return `
    <button data-tab="${id}" class="${cls}">
      <span class="leading-none ${active ? 'text-brand-600' : 'text-ink-700'}" aria-hidden="true">${icon(iconName, { size: 16 })}</span>
      <span class="flex-1">${label}</span>
      ${countBadge}
    </button>
  `;
}

function mobileTab(id, label, iconName) {
  const active = activeTab === id;
  return `<button data-tab="${id}" class="text-sm font-medium px-3 h-10 transition whitespace-nowrap inline-flex items-center gap-2 border-b-2 ${active ? 'border-b-brand-500 text-ink-900 bg-white' : 'border-b-transparent text-ink-700 hover:bg-brand-50'}">
    <span aria-hidden="true" class="${active ? 'text-brand-600' : 'text-ink-700'}">${icon(iconName, { size: 14 })}</span>${label}
  </button>`;
}

// ---------- Concorso Selector ----------

