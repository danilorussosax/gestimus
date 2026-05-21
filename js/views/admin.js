import { db, fingerprintCommissario } from '../db.js';
import { pb } from '../pb.js';
import {
  escapeHtml, fmtDate, modal, confirmDialog, toast,
  readFileAsDataURL, readImageResized, ageFromDate, displayName, fmtBytes, NATIONALITIES,
} from '../utils.js';
import { CRITERI, CRITERI_LABEL, PESI, mediaCandidato, suggestEliminatoria, getPesiFor, getScala, fmtVoto, getModoValutazione, getMetodoMedia, METODI_MEDIA, suggerisciMetodo, getCriteri, defaultCriteri, slugifyKey } from '../scoring.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';

let activeTab = 'fasi';

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
  if (!['fasi','candidati','commissari','sezioni','commissioni','iscrizioni','risultati','audit'].includes(activeTab)) activeTab = 'fasi';

  root.innerHTML = `
    <section class="view-fade c-page">
      <div class="flex gap-6 lg:gap-8 items-start">
        <!-- Sidebar (Sneat-style: white surface, purple active pill) -->
        <aside class="hidden md:block w-60 lg:w-64 shrink-0 sticky top-24">
          <div class="bg-white border border-brand-100 relative">
            <a href="#/" class="block px-4 py-4 border-b border-brand-100 hover:bg-accent transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[-2px]">
              <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-700">${escapeHtml(t('admin.nav.eyebrow'))}</p>
              <h3 class="font-medium text-[15px] leading-tight mt-1 text-ink-900 inline-flex items-center gap-1.5">
                ${escapeHtml(t('admin.nav.dashboard'))}
                <span class="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">${icon('arrowRight', { size: 14 })}</span>
              </h3>
            </a>

            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-700 px-4 pt-4 pb-2">${escapeHtml(t('admin.nav.sections'))}</p>
            <nav class="flex flex-col">
              ${navItem('fasi', 'flag', t('admin.nav.fasi'), fasiCount)}
              ${navItem('sezioni', 'folder', t('admin.nav.sezioni'), sezCount)}
              ${navItem('candidati', 'graduation', t('admin.nav.candidati'), candCount)}
              ${navItem('commissari', 'judge', t('admin.nav.commissari'), comCount)}
              ${navItem('commissioni', 'scale', t('admin.nav.commissioni'), commCount)}
              ${navItem('iscrizioni', 'user', 'Iscrizioni', null)}
              ${navItem('risultati', 'trophy', t('admin.nav.risultati'), null)}
              ${navItem('audit', 'shield', t('admin.nav.audit'), null)}
            </nav>

            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-700 px-4 pt-5 pb-2 border-t border-brand-100 mt-3">${escapeHtml(t('admin.nav.admin_section'))}</p>
            <nav class="flex flex-col">
              <a href="#/admin?tab=dashboard" class="flex items-center gap-3 px-4 h-10 transition w-full text-left text-[13px] font-medium border-l-2 border-l-transparent text-ink-700 hover:bg-brand-50 hover:text-ink-900">
                <span class="leading-none text-ink-700" aria-hidden="true">${icon('chart', { size: 16 })}</span>
                <span class="flex-1">${escapeHtml(t('admin.nav.dashboard'))}</span>
              </a>
              <a href="#/admin?tab=statistiche" class="flex items-center gap-3 px-4 h-10 transition w-full text-left text-[13px] font-medium border-l-2 border-l-transparent text-ink-700 hover:bg-brand-50 hover:text-ink-900">
                <span class="leading-none text-ink-700" aria-hidden="true">${icon('grid', { size: 16 })}</span>
                <span class="flex-1">${escapeHtml(t('admin.nav.statistiche'))}</span>
              </a>
              <a href="#/admin?tab=utenti" class="flex items-center gap-3 px-4 h-10 transition w-full text-left text-[13px] font-medium border-l-2 border-l-transparent text-ink-700 hover:bg-brand-50 hover:text-ink-900">
                <span class="leading-none text-ink-700" aria-hidden="true">${icon('user', { size: 16 })}</span>
                <span class="flex-1">${escapeHtml(t('admin.nav.utenti'))}</span>
              </a>
              <a href="#/admin?tab=impostazioni" class="flex items-center gap-3 px-4 h-10 transition w-full text-left text-[13px] font-medium border-l-2 border-l-transparent text-ink-700 hover:bg-brand-50 hover:text-ink-900">
                <span class="leading-none text-ink-700" aria-hidden="true">${icon('settings', { size: 16 })}</span>
                <span class="flex-1">${escapeHtml(t('admin.nav.impostazioni'))}</span>
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
          <header class="flex flex-wrap items-center gap-3 mb-6">
            <div class="flex-1 min-w-0">
              <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-700">${escapeHtml(t('admin.header.year_label', { anno: concorso.anno }))}</p>
              <div class="flex items-center gap-3 flex-wrap mt-1">
                <h2 class="text-2xl sm:text-[28px] font-light text-ink-900 tracking-tight truncate">${escapeHtml(concorso.nome)}</h2>
                <span class="c-tag ${concorso.stato === 'ATTIVO' ? 'c-tag--green' : 'c-tag--gray c-tag--no-dot'}">${escapeHtml(concorso.stato)}</span>
                ${concorso.anonimo ? `<span class="c-tag c-tag--purple c-tag--no-dot" title="${escapeHtml(t('admin.header.anonimo_title'))}">${icon('eyeOff', { size: 12 })}<span class="ml-1">${escapeHtml(t('admin.header.anonimo_tag'))}</span></span>` : ''}
                <button data-action="edit-concorso" aria-label="${escapeHtml(t('admin.header.edit_concorso_aria'))}" class="text-xs text-ink-700 hover:text-ink-900 hover:bg-brand-50 px-2 py-1 font-medium transition inline-flex items-center gap-1.5">
                  ${icon('edit', { size: 12 })} ${escapeHtml(t('admin.header.edit_concorso'))}
                </button>
              </div>
              <p class="text-sm text-ink-700 mt-1.5">${escapeHtml(t('admin.header.summary', { coms: comCount, fasi: fasiCount }))}</p>
            </div>
            <!-- Mobile-only: tab nav -->
            <nav class="md:hidden flex bg-white border border-brand-100 w-full overflow-x-auto no-scrollbar">
              ${mobileTab('fasi', t('admin.nav.fasi'),'flag')}
              ${mobileTab('sezioni', t('admin.nav.sezioni'),'folder')}
              ${mobileTab('candidati', t('admin.nav.candidati'),'graduation')}
              ${mobileTab('commissari', t('admin.nav.commissari'),'judge')}
              ${mobileTab('commissioni', t('admin.nav.commissioni'),'scale')}
              ${mobileTab('iscrizioni', 'Iscrizioni','user')}
              ${mobileTab('risultati', t('admin.nav.risultati'),'trophy')}
              ${mobileTab('audit', t('admin.nav.audit'),'shield')}
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
  root.querySelector('[data-action="edit-concorso"]')?.addEventListener('click', () => {
    openEditConcorso(concorso, () => renderAdmin(root));
  });

  const content = root.querySelector('#tab-content');
  if (activeTab === 'fasi') renderFasi(content, concorso);
  else if (activeTab === 'sezioni') renderSezioni(content, concorso);
  else if (activeTab === 'candidati') renderCandidati(content, concorso);
  else if (activeTab === 'commissari') renderCommissari(content, concorso);
  else if (activeTab === 'commissioni') renderCommissioni(content, concorso);
  else if (activeTab === 'iscrizioni') renderIscrizioni(content, concorso);
  else if (activeTab === 'risultati') renderRisultati(content, concorso);
  else if (activeTab === 'audit') renderAudit(content, concorso);
}

// ---------- Audit log ----------
const AUDIT_LABEL_KEYS = {
  'concorso.create':  ['🆕', 'admin.audit.label.concorso_create'],
  'concorso.delete':  ['🗑', 'admin.audit.label.concorso_delete'],
  'fase.start':       ['▶',  'admin.audit.label.fase_start'],
  'fase.complete':    ['🏁', 'admin.audit.label.fase_complete'],
  'fase.sorteggio':   ['🎲', 'admin.audit.label.fase_sorteggio'],
  'account.create':   ['🔑', 'admin.audit.label.account_create'],
  'account.delete':   ['🗑', 'admin.audit.label.account_delete'],
  'auth.login':       ['🔓', 'admin.audit.label.auth_login'],
  'auth.logout':      ['🔒', 'admin.audit.label.auth_logout'],
};

async function renderAudit(root, concorso) {
  let scope = 'concorso'; // 'concorso' | 'all'
  let q = '';

  const renderShell = () => {
    root.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h3 class="text-sm font-bold text-ink-900 uppercase tracking-wider">${escapeHtml(t('admin.audit.title'))}</h3>
          <p class="text-xs text-ink-500 mt-0.5">${escapeHtml(t('admin.audit.subtitle'))}</p>
        </div>
        <div class="flex items-center gap-2">
          <div class="inline-flex bg-canvas border border-slate-200 rounded-lg p-0.5">
            <button data-scope="concorso" class="text-xs font-medium px-3 py-1.5 rounded-md ${scope === 'concorso' ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-700'}">${escapeHtml(t('admin.audit.scope_only'))}</button>
            <button data-scope="all" class="text-xs font-medium px-3 py-1.5 rounded-md ${scope === 'all' ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-700'}">${escapeHtml(t('admin.audit.scope_all'))}</button>
          </div>
          <input data-q value="${escapeHtml(q)}" placeholder="${escapeHtml(t('admin.audit.search_ph'))}" class="text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-56 focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
        </div>
      </div>
      <div data-list class="bg-white ring-1 ring-slate-900/5 rounded-xl overflow-hidden shadow-soft">
        <div class="px-4 py-12 text-center text-sm text-ink-500">${escapeHtml(t('admin.audit.loading'))}</div>
      </div>
    `;
    root.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
      scope = b.dataset.scope;
      load();
    }));
    const qEl = root.querySelector('[data-q]');
    qEl.addEventListener('input', () => { q = qEl.value; renderList(); });
  };

  let items = [];
  const load = async () => {
    const list = root.querySelector('[data-list]');
    list.innerHTML = `<div class="px-4 py-12 text-center text-sm text-ink-500">${escapeHtml(t('admin.audit.loading'))}</div>`;
    try {
      items = await db.fetchAuditLog({ concorsoId: scope === 'concorso' ? concorso.id : null });
    } catch (e) {
      list.innerHTML = `<div class="px-4 py-12 text-center text-sm text-rose-600">${escapeHtml(t('admin.audit.error', { msg: e.message }))}</div>`;
      return;
    }
    renderList();
  };

  const renderList = () => {
    const list = root.querySelector('[data-list]');
    const filtered = q.trim()
      ? items.filter(i => {
          const hay = `${i.action} ${i.actor_email} ${i.target_label}`.toLowerCase();
          return hay.includes(q.toLowerCase());
        })
      : items;
    if (filtered.length === 0) {
      list.innerHTML = `<div class="px-4 py-12 text-center text-sm text-ink-500">${escapeHtml(t('admin.audit.empty'))}</div>`;
      return;
    }
    list.innerHTML = filtered.map(it => {
      const mapping = AUDIT_LABEL_KEYS[it.action];
      const icon = mapping ? mapping[0] : '•';
      const label = mapping ? t(mapping[1]) : it.action;
      const ts = new Date(it.created).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
      const target = it.target_label ? ` · ${escapeHtml(it.target_label)}` : '';
      const actor = it.actor_email ? `<span class="text-ink-700">${escapeHtml(it.actor_email)}</span>` : `<span class="text-ink-500 italic">${escapeHtml(t('admin.audit.system'))}</span>`;
      return `
        <div class="flex items-start gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-canvas">
          <span class="text-base shrink-0 w-7 h-7 rounded-md bg-brand-50 text-brand-600 flex items-center justify-center" aria-hidden="true">${icon}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-ink-900 truncate">${escapeHtml(label)}${target}</div>
            <div class="text-xs text-ink-500 mt-0.5">${actor}${it.actor_role ? ' <span class="text-[10px] font-bold uppercase tracking-wider text-ink-500">·</span> ' + escapeHtml(it.actor_role) : ''}</div>
          </div>
          <div class="text-[11px] text-ink-500 font-mono shrink-0">${escapeHtml(ts)}</div>
        </div>
      `;
    }).join('');
  };

  renderShell();
  load();
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
function renderConcorsoSelector(root) {
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
      db.setActiveConcorso(b.dataset.pick);
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
function openCreateConcorso() {
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
function openEditConcorso(concorso, onSaved) {
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
      </div>
    `,
    primaryLabel: t('common.save') || 'Salva',
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
      try {
        const patch = { nome, anno: Number(anno), data_inizio, stato, anonimo, iscrizioni_aperte, iscrizioni_chiusura };
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

function openStoricoCandidato(cand) {
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
function openMembriGruppoModal(concorso, gruppo, onSaved) {
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
function renderFasi(root, concorso) {
  const fasi = db.fasiByConcorso(concorso.id);
  root.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
      <p class="text-sm text-slate-600">${escapeHtml(t('admin.fasi.count', { n: fasi.length }) || `${fasi.length} fasi`)}</p>
      <button data-action="new-fase" class="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm">
        ${escapeHtml(t('admin.fasi.add') || 'Nuova fase')}
      </button>
    </div>

    ${fasi.length === 0 ? `
      <div class="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
        <div class="text-4xl mb-2">🎼</div>
        <p class="text-sm text-slate-500 italic">${escapeHtml(t('admin.fasi.empty') || 'Nessuna fase creata. Crea la prima per iniziare.')}</p>
      </div>
    ` : `
      <div class="space-y-3" data-fasi-list>
        ${fasi.map(f => faseCardHtml(f, concorso)).join('')}
      </div>
    `}
  `;

  root.querySelector('[data-action="new-fase"]')?.addEventListener('click', () => {
    openFaseForm(concorso, null, () => renderFasi(root, concorso));
  });

  const refresh = () => renderFasi(root, concorso);

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
          refresh();
        } else if (action === 'end') {
          confirmDialog({
            title: t('admin.fase.end_title') || 'Concludi fase',
            message: t('admin.fase.end_msg', { nome: fase.nome }) || `Concludere "${fase.nome}"? Non sarà più modificabile.`,
            onConfirm: async () => {
              try {
                await db.concludiFase(id);
                toast(t('admin.fase.ended') || 'Fase conclusa', 'success');
                refresh();
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
                refresh();
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
                refresh();
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
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statoColors[stato] || statoColors.PIANIFICATA}">${escapeHtml(stato)}</span>
            ${f.modo_valutazione === 'sincrona' ? `<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200">sincrona</span>` : ''}
          </div>
          ${scopeSezioni.length > 0 || commAssegnata ? `
            <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              ${scopeSezioni.length > 0 ? `
                <span class="text-slate-500 font-mono uppercase tracking-wider">Solo:</span>
                ${scopeSezioni.map(s => `<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">${escapeHtml(s.nome)}</span>`).join('')}
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
        <div class="flex items-center gap-1 shrink-0">
          <button data-fase-action="move-up"   data-id="${f.id}" class="p-1.5 rounded-md text-slate-600 hover:bg-slate-100" title="Sposta su"   ${f.ordine === 1 ? 'disabled' : ''}>${icon('arrowUp', { size: 14 })}</button>
          <button data-fase-action="move-down" data-id="${f.id}" class="p-1.5 rounded-md text-slate-600 hover:bg-slate-100" title="Sposta giù">${icon('arrowDown', { size: 14 })}</button>
          <button data-fase-action="detail"    data-id="${f.id}" class="p-1.5 rounded-md text-slate-600 hover:bg-slate-100" title="${escapeHtml(t('common.detail') || 'Dettaglio')}">${icon('list', { size: 14 })}</button>
          <button data-fase-action="edit"      data-id="${f.id}" class="p-1.5 rounded-md text-brand-600 hover:bg-brand-50" title="${escapeHtml(t('common.edit'))}">${icon('edit', { size: 14 })}</button>
          <button data-fase-action="delete"    data-id="${f.id}" class="p-1.5 rounded-md text-rose-600 hover:bg-rose-50" title="${escapeHtml(t('common.delete'))}" ${stato === 'IN_CORSO' ? 'disabled' : ''}>${icon('trash', { size: 14 })}</button>
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

function openFaseForm(concorso, fase, onSaved) {
  const isEdit = !!fase;
  const f = fase || {};
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

      try {
        const payload = { nome, scala, tempo_minuti, ammessi, data_prevista, modo_valutazione, metodo_media, criteri: criteriParsed, sezioni_ids, commissione_id };
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
function renderCandidati(root, concorso) {
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
            ${sezioni.map(s => `<span class="text-[10px] px-1.5 py-0.5 bg-brand-50 text-brand-700 rounded-full font-medium">🗂 ${escapeHtml(s.nome)}</span>`).join('')}
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
function renderCommissari(root, concorso) {
  const list = db.commissariByConcorso(concorso.id);
  const presidente = list.find(c => c.is_presidente);
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

  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.del;
    confirmDialog({
      title: t('admin.commissari.delete_title'),
      message: t('admin.commissari.delete_msg'),
      danger: true,
      onConfirm: async () => {
        try { await db.deleteCommissario(id); renderCommissari(root, concorso); }
        catch (e) { toast(e.message, 'error'); }
      }
    });
  }));

  root.querySelectorAll('[data-cv]').forEach(b => b.addEventListener('click', () => {
    const c = db.state.commissari.find(x => x.id === b.dataset.cv);
    if (c?.cv) openCv(c.cv);
  }));
}

function commissarioCardHtml(c) {
  const eta = ageFromDate(c.data_nascita);
  const ringCls = c.is_presidente ? 'ring-2 ring-amber-400' : 'ring-2 ring-white';
  const cardCls = c.is_presidente ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200';
  return `
    <div class="bg-white border ${cardCls} rounded-2xl p-4 flex items-start gap-3 hover:border-slate-300 transition">
      <div class="w-14 h-14 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 overflow-hidden flex items-center justify-center text-2xl text-amber-700 shrink-0 ${ringCls} shadow-soft">
        ${c.foto ? `<img src="${c.foto}" alt="" class="w-full h-full object-cover" />` : '🧑‍⚖️'}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <h4 class="font-semibold text-slate-900 truncate">${escapeHtml(displayName(c))}</h4>
          ${c.is_presidente ? `<span class="text-[10px] font-bold px-1.5 py-0.5 bg-amber-500 text-white rounded-full">${escapeHtml(t('admin.commissari.presidente_tag'))}</span>` : ''}
          ${c.nazionalita ? `<span class="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded-full font-medium">${escapeHtml(c.nazionalita)}</span>` : ''}
        </div>
        <p class="text-xs text-slate-600 truncate">${escapeHtml(c.specialita || '—')}${eta ? ` · ${escapeHtml(t('admin.candidati.years', { n: eta }))}` : ''}</p>
        ${c.email ? `<p class="text-[11px] text-slate-500 truncate mt-0.5">✉ ${escapeHtml(c.email)}</p>` : ''}
        ${c.telefono ? `<p class="text-[11px] text-slate-500 truncate">☎ ${escapeHtml(c.telefono)}</p>` : ''}
        <div class="mt-2 flex items-center gap-1.5 flex-wrap">
          ${c.cv ? `<button data-cv="${c.id}" class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-full font-medium" title="${escapeHtml(c.cv.name || 'CV')}">📄 CV</button>` : ''}
          ${c.bio ? `<span class="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-full font-medium" title="${escapeHtml(c.bio)}">📝 bio</span>` : ''}
        </div>
      </div>
      <div class="flex flex-col gap-1 shrink-0">
        <button data-edit="${c.id}" class="text-xs text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg font-medium">${escapeHtml(t('admin.commissari.btn_edit'))}</button>
        <button data-del="${c.id}" class="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium">${escapeHtml(t('admin.commissari.btn_delete'))}</button>
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
  let fotoData = com?.foto || null;
  let cvData = com?.cv || null;
  const initialFoto = com?.foto || null;
  const initialCv = com?.cv || null;
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
                ${fotoData ? `<img src="${fotoData}" alt="" class="w-full h-full object-cover" />` : '<span class="text-3xl text-slate-400">🧑‍⚖️</span>'}
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
            <div data-cv-zone>
              ${cvData ? cvBadge(cvData) : `
                <button type="button" data-cv-pick class="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-300 rounded-lg transition">
                  ${escapeHtml(t('admin.candidato.cv_load'))}
                </button>
              `}
            </div>
            <input data-cv-input type="file" accept=".pdf,.doc,.docx,application/pdf" class="hidden" />
            <p class="text-[10px] text-slate-500 mt-1.5">${escapeHtml(t('admin.candidato.cv_help'))}</p>
          </div>
        </div>

        <div class="pt-4 border-t border-slate-200">
          <label class="block">
            <span class="text-sm font-medium text-slate-700">${escapeHtml(t('admin.commissario.field_bio'))}</span>
            <textarea name="bio" rows="3" class="${inputCls}" placeholder="${escapeHtml(t('admin.commissario.field_bio_ph'))}">${escapeHtml(com?.bio || '')}</textarea>
          </label>
        </div>

        <div class="pt-4 border-t border-slate-200">
          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" name="is_presidente" ${com?.is_presidente ? 'checked' : ''} class="mt-1 w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500" />
            <div>
              <span class="text-sm font-semibold text-slate-800">${escapeHtml(t('admin.commissario.field_is_pres_label'))}</span>
              <span class="block text-xs text-slate-500 mt-0.5">${t('admin.commissario.field_is_pres_help')}</span>
            </div>
          </label>
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
        fotoPrev.innerHTML = fotoData
          ? `<img src="${fotoData}" alt="" class="w-full h-full object-cover" />`
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

      const cvInput = body.querySelector('[data-cv-input]');
      const cvZone  = body.querySelector('[data-cv-zone]');
      const renderCvZone = () => {
        cvZone.innerHTML = cvData ? cvBadge(cvData) : `
          <button type="button" data-cv-pick class="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-300 rounded-lg transition">
            ${escapeHtml(t('admin.candidato.cv_load'))}
          </button>`;
      };
      cvZone.addEventListener('click', (e) => {
        const a = e.target.closest('[data-cv-pick],[data-cv-clear]');
        if (!a) return;
        if (a.matches('[data-cv-pick]')) cvInput.click();
        else if (a.matches('[data-cv-clear]')) { cvData = null; renderCvZone(); }
      });
      cvInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
          toast(t('admin.candidato.cv_too_big'), 'error');
          cvInput.value = '';
          return;
        }
        try {
          const dataURL = await readFileAsDataURL(file);
          cvData = { name: file.name, type: file.type || 'application/octet-stream', size: file.size, dataURL };
          renderCvZone();
        } catch { toast(t('admin.candidato.cv_error'), 'error'); }
        finally { cvInput.value = ''; }
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
      const isPresidenteVal = !!data.is_presidente;
      const baseFields = {
        nome: (data.nome || '').trim(),
        cognome: (data.cognome || '').trim(),
        specialita: (data.specialita || '').trim(),
        email: (data.email || '').trim(),
        telefono: (data.telefono || '').trim(),
        data_nascita: data.data_nascita || null,
        nazionalita: (data.nazionalita || '').trim(),
        bio: (data.bio || '').trim(),
        is_presidente: isPresidenteVal,
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
  const archive = db.getArchivioCommissari();
  // Map of fingerprint → already in current concorso?
  const presentInConcorso = new Set(
    db.commissariByConcorso(concorso.id).map(c => fingerprintCommissario(c))
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
    if (ui.onlyMissing) list = list.filter(c => !presentInConcorso.has(c.fingerprint));
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
      const fp = b.dataset.archImport;
      const entry = archive.find(x => x.fingerprint === fp);
      if (!entry) return;
      b.disabled = true;
      b.textContent = t('admin.archivio.importing');
      try {
        await importFromArchivio(entry, concorso.id);
        toast(t('admin.archivio.added_msg', { name: displayName(entry) }), 'success');
        // Re-render parent (commissari tab) so the upper grid also updates,
        // otherwise just re-render the archive view in place.
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
      const fp = b.dataset.archCv;
      const entry = archive.find(x => x.fingerprint === fp);
      if (entry?.cv) openCv(entry.cv);
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
  const inThis = presentInConcorso.has(c.fingerprint);
  const concorsiBadges = c.concorsi_ids.map(id => {
    const con = concorsoMap[id];
    const isCurrent = id === concorso.id;
    return `<span class="text-[10px] px-1.5 py-0.5 rounded-full ${isCurrent ? 'bg-brand-100 text-brand-800 font-semibold' : 'bg-slate-100 text-slate-600'}" title="${escapeHtml(con?.nome || '')}">${escapeHtml((con?.nome || '?').slice(0, 22))}${(con?.nome||'').length > 22 ? '…' : ''}</span>`;
  }).join(' ');

  return `
    <div class="bg-white border ${inThis ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200'} rounded-2xl p-4 flex flex-col gap-3 hover:border-brand-300 transition">
      <div class="flex items-start gap-3">
        <div class="w-14 h-14 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 overflow-hidden flex items-center justify-center text-2xl text-amber-700 shrink-0 ring-2 ring-white shadow-soft">
          ${c.foto ? `<img src="${c.foto}" alt="" class="w-full h-full object-cover" />` : '🧑‍⚖️'}
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
        ${c.cv ? `<button data-arch-cv="${c.fingerprint}" class="text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-full font-medium" title="${escapeHtml(c.cv.name || 'CV')}">📄 CV</button>` : ''}
        <span class="text-[10px] text-slate-500">${escapeHtml(c.concorsi_ids.length === 1 ? t('admin.archivio.in_concorsi_one', { n: c.concorsi_ids.length }) : t('admin.archivio.in_concorsi_other', { n: c.concorsi_ids.length }))}</span>
        ${concorsiBadges}
      </div>
      <div class="mt-auto pt-1">
        ${inThis
          ? `<button disabled class="w-full text-xs font-semibold text-emerald-700 bg-emerald-100 px-3 py-2 rounded-lg cursor-default">${escapeHtml(t('admin.archivio.already_in'))}</button>`
          : `<button data-arch-import="${c.fingerprint}" class="w-full text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3 py-2 rounded-lg shadow-sm transition">${escapeHtml(t('admin.archivio.add_to_concorso'))}</button>`}
      </div>
    </div>
  `;
}

async function importFromArchivio(source, targetConcorsoId) {
  // Convert PB file URLs back to dataURLs so db.createCommissario can re-upload them.
  let fotoDataURL = null;
  let cvData = null;
  if (source.foto) {
    try {
      const r = await fetch(source.foto);
      if (r.ok) {
        const blob = await r.blob();
        fotoDataURL = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    } catch (e) { /* skip foto on error */ }
  }
  if (source.cv?.dataURL) {
    try {
      const r = await fetch(source.cv.dataURL);
      if (r.ok) {
        const blob = await r.blob();
        const dataURL = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        cvData = { name: source.cv.name || 'cv', dataURL };
      }
    } catch (e) { /* skip cv on error */ }
  }
  return await db.createCommissario({
    concorso_id: targetConcorsoId,
    nome: source.nome,
    cognome: source.cognome,
    specialita: source.specialita,
    email: source.email,
    telefono: source.telefono,
    data_nascita: source.data_nascita,
    nazionalita: source.nazionalita,
    bio: source.bio,
    foto: fotoDataURL,
    cv: cvData,
    is_presidente: false, // never auto-promote on import
  });
}

// ---------- Sezioni & Categorie ----------
function renderSezioni(root, concorso) {
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
}

function sezioneCardHtml(s) {
  const cats = db.categorieBySezione(s.id);
  const candCount = db.state.candidati.filter(c => Array.isArray(c.sezioni_ids) && c.sezioni_ids.includes(s.id)).length;
  return `
    <li class="bg-white border border-slate-200 rounded-2xl p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center text-lg shrink-0">🗂</div>
          <div class="min-w-0">
            <h4 class="font-bold text-slate-900">${escapeHtml(s.nome)}</h4>
            ${s.descrizione ? `<p class="text-xs text-slate-500 mt-0.5">${escapeHtml(s.descrizione)}</p>` : ''}
            <p class="text-[11px] text-slate-500 mt-1">${escapeHtml(cats.length === 1 ? t('admin.sezioni.cats_one', { n: cats.length }) : t('admin.sezioni.cats_other', { n: cats.length }))} · ${escapeHtml(t('admin.sezioni.cands_count', { n: candCount }))}</p>
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button data-edit-sez="${s.id}" class="text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg" title="${escapeHtml(t('admin.sezioni.btn_edit_title'))}">${escapeHtml(t('admin.sezioni.btn_edit'))}</button>
          <button data-del-sez="${s.id}" class="text-xs font-medium text-rose-600 hover:bg-rose-50 px-2 py-1.5 rounded-lg" title="${escapeHtml(t('admin.sezioni.btn_delete_title'))}">🗑</button>
        </div>
      </div>
      <div class="mt-3 ml-13 sm:ml-13 pl-3 border-l-2 border-slate-100">
        ${cats.length === 0 ? `<p class="text-xs text-slate-400 italic mb-2">${escapeHtml(t('admin.sezioni.no_cats'))}</p>` : `
          <ul class="space-y-1.5 mb-2">
            ${cats.map(c => `
              <li class="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-1.5">
                <div class="min-w-0">
                  <span class="text-sm font-medium text-slate-800">${escapeHtml(c.nome)}</span>
                  ${c.descrizione ? `<span class="text-[11px] text-slate-500 ml-2">${escapeHtml(c.descrizione)}</span>` : ''}
                </div>
                <div class="flex items-center gap-1">
                  <button data-edit-cat="${c.id}" class="text-[11px] text-brand-700 hover:bg-brand-100 px-2 py-0.5 rounded" title="${escapeHtml(t('admin.sezioni.btn_edit_title'))}">⚙</button>
                  <button data-del-cat="${c.id}" class="text-[11px] text-rose-600 hover:bg-rose-50 px-2 py-0.5 rounded" title="${escapeHtml(t('admin.sezioni.btn_delete_title'))}">🗑</button>
                </div>
              </li>
            `).join('')}
          </ul>
        `}
        <button data-add-cat="${s.id}" class="text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1 rounded-lg">${escapeHtml(t('admin.sezioni.add_cat'))}</button>
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

// ---------- Commissioni ----------
function renderCommissioni(root, concorso) {
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
  return `
    <div class="bg-white border border-slate-200 rounded-2xl p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h4 class="font-bold text-slate-900 truncate">${escapeHtml(c.nome)}</h4>
          ${c.descrizione ? `<p class="text-xs text-slate-500 mt-0.5">${escapeHtml(c.descrizione)}</p>` : ''}
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button data-edit-comm="${c.id}" class="text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg" title="${escapeHtml(t('admin.sezioni.btn_edit_title'))}">⚙</button>
          <button data-del-comm="${c.id}" class="text-xs font-medium text-rose-600 hover:bg-rose-50 px-2 py-1.5 rounded-lg" title="${escapeHtml(t('admin.sezioni.btn_delete_title'))}">🗑</button>
        </div>
      </div>
      <div class="mt-3 grid grid-cols-1 gap-2">
        <div>
          <div class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">${escapeHtml(t('admin.commissioni.col_members', { n: members.length }))}</div>
          <div class="flex flex-wrap gap-1">
            ${members.length === 0 ? `<span class="text-xs text-slate-400 italic">${escapeHtml(t('admin.commissioni.no_one'))}</span>` : members.map(m => `
              <span class="inline-flex items-center gap-1 text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                <span class="w-4 h-4 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[9px] overflow-hidden">${m.foto ? `<img src="${m.foto}" class="w-full h-full object-cover" alt="" />` : '🧑‍⚖️'}</span>
                ${escapeHtml(displayName(m))}${m.is_presidente ? ' 🎯' : ''}
              </span>
            `).join('')}
          </div>
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">${escapeHtml(t('admin.commissioni.col_sezioni', { n: sezs.length }))}${c.include_tutte_categorie && sezs.length ? escapeHtml(t('admin.commissioni.col_sezioni_auto')) : ''}</div>
          <div class="flex flex-wrap gap-1">
            ${sezs.length === 0 ? `<span class="text-xs text-slate-400 italic">${escapeHtml(t('admin.commissioni.no_sezioni'))}</span>` : sezs.map(s => `<span class="text-[11px] bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-medium">${escapeHtml(s.nome)}</span>`).join('')}
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

async function renderIscrizioni(root, concorso) {
  // Render con dati cached, poi reload in background.
  doRender();
  await loadIscrizioni(concorso.id);
  doRender();

  function doRender() {
    const items = _iscrizioniState.items;
    const flt = _iscrizioniState.filtro_stato;
    const filtered = flt ? items.filter(i => i.stato === flt) : items;
    const counts = {
      total: items.length,
      pending: items.filter(i => i.stato === 'pending').length,
      verified: items.filter(i => i.stato === 'email_verified').length,
      approved: items.filter(i => i.stato === 'approved').length,
      rejected: items.filter(i => i.stato === 'rejected').length,
    };

    root.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p class="text-sm text-slate-600">${filtered.length} iscrizioni${flt ? ` (filtrate per "${escapeHtml(flt)}")` : ''}</p>
        <div class="flex items-center gap-1.5">
          <button data-isc-refresh class="c-btn c-btn--ghost c-btn--sm !gap-1">${icon('refresh', { size: 14 })} <span>Aggiorna</span></button>
          <button data-isc-export class="c-btn c-btn--ghost c-btn--sm !gap-1">${icon('download', { size: 14 })} <span>Esporta CSV</span></button>
        </div>
      </div>

      <!-- Filtri stato come pills -->
      <div class="flex flex-wrap gap-1.5 mb-4" data-isc-filters>
        ${iscFilterPill('', 'Tutte', counts.total, flt === '')}
        ${iscFilterPill('pending', 'In attesa', counts.pending, flt === 'pending', 'bg-amber-50 text-amber-800 border-amber-200')}
        ${iscFilterPill('email_verified', 'Email verificata', counts.verified, flt === 'email_verified', 'bg-sky-50 text-sky-800 border-sky-200')}
        ${iscFilterPill('approved', 'Approvate', counts.approved, flt === 'approved', 'bg-emerald-50 text-emerald-800 border-emerald-200')}
        ${iscFilterPill('rejected', 'Rifiutate', counts.rejected, flt === 'rejected', 'bg-rose-50 text-rose-800 border-rose-200')}
      </div>

      ${_iscrizioniState.loading && items.length === 0 ? `
        <div class="text-center py-10 text-slate-500">Caricamento…</div>
      ` : _iscrizioniState.error ? `
        <div class="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-800">${escapeHtml(_iscrizioniState.error)}</div>
      ` : filtered.length === 0 ? `
        <div class="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <div class="text-4xl mb-2">📭</div>
          <p class="text-sm text-slate-500 italic">Nessuna iscrizione${flt ? ' con questo stato' : ''}. Le iscrizioni inviate dal form pubblico /#/iscrizione compariranno qui.</p>
        </div>
      ` : `
        <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th class="text-left px-3 py-2.5">Data</th>
                <th class="text-left px-3 py-2.5">Candidato</th>
                <th class="text-left px-3 py-2.5 hidden sm:table-cell">Email</th>
                <th class="text-left px-3 py-2.5 hidden md:table-cell">Strumento</th>
                <th class="text-left px-3 py-2.5">Stato</th>
                <th class="text-right px-3 py-2.5">Azioni</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${filtered.map(i => iscrizioneRowHtml(i)).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    root.querySelector('[data-isc-refresh]')?.addEventListener('click', async () => {
      await loadIscrizioni(concorso.id, true);
      doRender();
    });
    root.querySelector('[data-isc-export]')?.addEventListener('click', () => exportIscrizioniCsv(filtered, concorso));
    root.querySelectorAll('[data-isc-filter]').forEach(b => b.addEventListener('click', () => {
      _iscrizioniState.filtro_stato = b.dataset.iscFilter;
      doRender();
    }));
    root.querySelectorAll('[data-isc-detail]').forEach(b => b.addEventListener('click', () => {
      const i = items.find(x => x.id === b.dataset.iscDetail);
      if (i) openIscrizioneDetail(i, concorso, async () => {
        await loadIscrizioni(concorso.id, true);
        doRender();
      });
    }));
  }

  async function loadIscrizioni(concorsoId, force = false) {
    if (_iscrizioniState.loading && !force) return;
    _iscrizioniState.loading = true;
    _iscrizioniState.error = null;
    try {
      _iscrizioniState.items = await db.listIscrizioni({ concorsoId });
    } catch (e) {
      _iscrizioniState.error = `Errore caricamento iscrizioni: ${e?.message || e}`;
    } finally {
      _iscrizioniState.loading = false;
    }
  }
}

function iscFilterPill(value, label, count, active, colors = 'bg-slate-100 text-slate-700 border-slate-200') {
  const cls = active
    ? 'bg-brand-600 text-white border-brand-600'
    : colors;
  return `<button data-isc-filter="${escapeHtml(value)}" class="text-xs font-medium border ${cls} px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 hover:brightness-95 transition">
    <span>${escapeHtml(label)}</span>
    <span class="text-[10px] font-bold ${active ? 'bg-white/20 text-white' : 'bg-white text-slate-600'} px-1.5 py-0.5 rounded-full">${count}</span>
  </button>`;
}

function iscrizioneRowHtml(i) {
  const statoColors = {
    pending:        'bg-amber-100 text-amber-800',
    email_verified: 'bg-sky-100 text-sky-800',
    approved:       'bg-emerald-100 text-emerald-800',
    rejected:       'bg-rose-100 text-rose-800',
  };
  const statoLabel = {
    pending: 'In attesa',
    email_verified: 'Verificata',
    approved: 'Approvata',
    rejected: 'Rifiutata',
  };
  const created = new Date(i.created).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' });
  const ora = new Date(i.created).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return `
    <tr class="hover:bg-slate-50 transition-colors cursor-pointer" data-isc-detail="${escapeHtml(i.id)}">
      <td class="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap">${escapeHtml(created)}<br/><span class="text-slate-400">${escapeHtml(ora)}</span></td>
      <td class="px-3 py-2.5">
        <p class="font-medium text-slate-900">${escapeHtml(i.nome)} ${escapeHtml(i.cognome)}</p>
        ${i.tipo === 'gruppo' ? `<p class="text-[11px] text-purple-700">${escapeHtml(i.gruppo_nome || 'Gruppo')}</p>` : ''}
      </td>
      <td class="px-3 py-2.5 text-xs text-slate-600 hidden sm:table-cell">${escapeHtml(i.email || '')}</td>
      <td class="px-3 py-2.5 text-xs text-slate-700 hidden md:table-cell">${escapeHtml(i.strumento || '—')}</td>
      <td class="px-3 py-2.5"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${statoColors[i.stato] || 'bg-slate-100 text-slate-700'}">${escapeHtml(statoLabel[i.stato] || i.stato)}</span></td>
      <td class="px-3 py-2.5 text-right">
        <button class="c-btn c-btn--ghost c-btn--sm !px-2" title="Vedi dettagli">${icon('arrowRight', { size: 14 })}</button>
      </td>
    </tr>
  `;
}

function openIscrizioneDetail(isc, concorso, onChanged) {
  const eta = isc.data_nascita ? Math.floor((Date.now() - new Date(isc.data_nascita).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
  const isMinor = eta !== null && eta < 18;
  // File URL via PB
  const fileUrl = (field) => isc[field] ? `${pb.baseUrl}/api/files/${isc.collectionId}/${isc.id}/${isc[field]}` : null;
  const fotoUrl = fileUrl('foto');
  const docUrl  = fileUrl('documento_identita');
  const recUrl  = fileUrl('ricevuta_pagamento');
  const minUrl  = fileUrl('autorizzazione_minore');

  const programma = Array.isArray(isc.programma) ? isc.programma : (() => { try { return JSON.parse(isc.programma || '[]'); } catch { return []; } })();
  const docenti = Array.isArray(isc.docenti_preparatori) ? isc.docenti_preparatori : (() => { try { return JSON.parse(isc.docenti_preparatori || '[]'); } catch { return []; } })();
  const gruppoMembri = Array.isArray(isc.gruppo_membri) ? isc.gruppo_membri : (() => { try { return JSON.parse(isc.gruppo_membri || '[]'); } catch { return []; } })();

  modal({
    title: `${isc.nome} ${isc.cognome} · ${isc.strumento || '—'}`,
    wide: true,
    contentHtml: `
      <div class="space-y-5 text-sm">
        <!-- Header con stato e azioni -->
        <div class="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-slate-100">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded ${isc.stato === 'approved' ? 'bg-emerald-100 text-emerald-800' : isc.stato === 'rejected' ? 'bg-rose-100 text-rose-800' : isc.stato === 'email_verified' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}">${escapeHtml(isc.stato)}</span>
            <span class="text-xs text-slate-500">creata il ${new Date(isc.created).toLocaleString('it-IT')}</span>
          </div>
          ${fotoUrl ? `<img src="${escapeHtml(fotoUrl)}" alt="" class="w-16 h-16 rounded-full object-cover ring-2 ring-slate-200" />` : ''}
        </div>

        <!-- Anagrafica -->
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Anagrafica</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
            <div><span class="text-slate-500">Nato il:</span> <strong>${escapeHtml(isc.data_nascita || '—')}</strong>${eta !== null ? ` <span class="text-slate-400">(${eta} anni)</span>` : ''}</div>
            <div><span class="text-slate-500">Luogo nascita:</span> <strong>${escapeHtml(isc.luogo_nascita || '—')}</strong></div>
            <div><span class="text-slate-500">Nazionalità:</span> <strong>${escapeHtml(isc.nazionalita || '—')}</strong></div>
            <div><span class="text-slate-500">Sesso:</span> <strong>${escapeHtml(isc.sesso || '—')}</strong></div>
            <div class="col-span-2"><span class="text-slate-500">Codice fiscale:</span> <strong class="font-mono">${escapeHtml(isc.codice_fiscale || '—')}</strong></div>
          </div>
        </section>

        <!-- Contatti -->
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Contatti</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
            <div class="col-span-2"><span class="text-slate-500">Email:</span> <strong><a href="mailto:${escapeHtml(isc.email)}" class="text-brand-700 hover:underline">${escapeHtml(isc.email)}</a></strong></div>
            <div><span class="text-slate-500">Telefono:</span> <strong><a href="tel:${escapeHtml(isc.telefono || '')}" class="hover:underline">${escapeHtml(isc.telefono || '—')}</a></strong></div>
            <div class="col-span-3"><span class="text-slate-500">Indirizzo:</span> <strong>${escapeHtml(isc.indirizzo || '—')}, ${escapeHtml(isc.citta || '—')} ${escapeHtml(isc.cap || '')} (${escapeHtml(isc.provincia || '—')}) · ${escapeHtml(isc.paese || '—')}</strong></div>
          </div>
        </section>

        ${isMinor || isc.tutore_nome ? `
        <!-- Tutore -->
        <section class="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-amber-800 mb-2">⚠ Candidato minorenne · dati tutore</h3>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div><span class="text-slate-600">Nome:</span> <strong>${escapeHtml(isc.tutore_nome || '—')} ${escapeHtml(isc.tutore_cognome || '')}</strong></div>
            <div><span class="text-slate-600">Email:</span> <strong>${escapeHtml(isc.tutore_email || '—')}</strong></div>
            <div><span class="text-slate-600">Telefono:</span> <strong>${escapeHtml(isc.tutore_telefono || '—')}</strong></div>
          </div>
        </section>
        ` : ''}

        <!-- Dati artistici -->
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Dati artistici</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
            <div><span class="text-slate-500">Tipo:</span> <strong>${escapeHtml(isc.tipo || 'individuale')}</strong></div>
            <div><span class="text-slate-500">Strumento:</span> <strong>${escapeHtml(isc.strumento || '—')}</strong></div>
            <div><span class="text-slate-500">Anni studio:</span> <strong>${escapeHtml(String(isc.anni_studio || '—'))}</strong></div>
            <div class="col-span-3"><span class="text-slate-500">Scuola/Conservatorio:</span> <strong>${escapeHtml(isc.scuola_provenienza || '—')}</strong></div>
            ${docenti.length > 0 ? `<div class="col-span-3"><span class="text-slate-500">Docenti:</span> <strong>${docenti.map(d => escapeHtml(d)).join(' · ')}</strong></div>` : ''}
          </div>
        </section>

        ${isc.tipo === 'gruppo' && gruppoMembri.length > 0 ? `
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Membri del gruppo (${escapeHtml(isc.gruppo_nome || '')})</h3>
          <ul class="space-y-1 text-xs">
            ${gruppoMembri.map(m => `<li>· <strong>${escapeHtml(m.nome || '')} ${escapeHtml(m.cognome || '')}</strong> — ${escapeHtml(m.strumento || '—')}${m.data_nascita ? ` (${escapeHtml(m.data_nascita)})` : ''}</li>`).join('')}
          </ul>
        </section>
        ` : ''}

        <!-- Programma -->
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Programma musicale (${programma.length} brani · ${isc.durata_totale_min || 0} min)</h3>
          ${programma.length > 0 ? `
            <ol class="space-y-1 text-xs list-decimal pl-5">
              ${programma.map(p => `<li><strong>${escapeHtml(p.titolo || '—')}</strong> — ${escapeHtml(p.autore || 'autore sconosciuto')} <span class="text-slate-500">(${escapeHtml(String(p.durata_min || 0))} min)</span></li>`).join('')}
            </ol>
          ` : '<p class="text-xs italic text-slate-500">Nessun brano inserito.</p>'}
        </section>

        <!-- Allegati -->
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Allegati</h3>
          <div class="flex flex-wrap gap-2 text-xs">
            ${fotoUrl ? `<a href="${escapeHtml(fotoUrl)}" target="_blank" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5">📷 Foto</a>` : '<span class="text-slate-400 italic">Foto non allegata</span>'}
            ${docUrl  ? `<a href="${escapeHtml(docUrl)}"  target="_blank" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5">📄 Documento ID</a>` : '<span class="text-slate-400 italic">Doc identità non allegato</span>'}
            ${recUrl  ? `<a href="${escapeHtml(recUrl)}"  target="_blank" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5">💳 Ricevuta</a>` : '<span class="text-slate-400 italic">Ricevuta non allegata</span>'}
            ${minUrl  ? `<a href="${escapeHtml(minUrl)}"  target="_blank" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5">✍ Autorizzazione</a>` : ''}
          </div>
        </section>

        <!-- Note libere -->
        ${isc.note_libere ? `
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Note del candidato</h3>
          <p class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs whitespace-pre-wrap">${escapeHtml(isc.note_libere)}</p>
        </section>
        ` : ''}

        <!-- Consensi -->
        <section class="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Consensi</h3>
          <div class="text-xs space-y-1">
            <p>${isc.consenso_privacy ? '✅' : '❌'} Privacy (GDPR)</p>
            <p>${isc.consenso_immagini ? '✅' : '⚪'} Uso immagini</p>
            <p>${isc.consenso_regolamento ? '✅' : '❌'} Regolamento</p>
          </div>
        </section>

        ${isc.note_admin ? `<section><h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Note admin</h3><p class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs whitespace-pre-wrap">${escapeHtml(isc.note_admin)}</p></section>` : ''}
        ${isc.rejected_reason ? `<section><h3 class="font-mono text-[10px] uppercase tracking-wider text-rose-700 mb-2">Motivo del rifiuto</h3><p class="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs whitespace-pre-wrap">${escapeHtml(isc.rejected_reason)}</p></section>` : ''}
      </div>
    `,
    primaryLabel: isc.stato === 'approved' || isc.stato === 'rejected' ? null : '✓ Approva',
    secondaryLabel: 'Chiudi',
    onPrimary: async (body) => {
      try {
        await db.approveIscrizione(isc.id);
        toast(`Iscrizione di ${isc.nome} ${isc.cognome} approvata`, 'success');
        if (onChanged) onChanged();
      } catch (e) {
        toast(`Errore: ${e?.message || e}`, 'error');
        return false;
      }
    },
  });

  // Aggiungo a runtime un pulsante "Rifiuta" accanto al primary (solo se stato attivo).
  if (isc.stato !== 'approved' && isc.stato !== 'rejected') {
    setTimeout(() => {
      const modalEl = document.querySelector('#modal-root .c-btn--primary');
      if (modalEl && !modalEl.parentElement.querySelector('[data-isc-reject]')) {
        const btn = document.createElement('button');
        btn.className = 'c-btn c-btn--outline text-rose-700 border-rose-300 hover:bg-rose-50';
        btn.setAttribute('data-isc-reject', '1');
        btn.textContent = '✕ Rifiuta';
        btn.addEventListener('click', async () => {
          const reason = prompt('Motivo del rifiuto (verrà comunicato al candidato):');
          if (reason === null) return;
          try {
            await db.rejectIscrizione(isc.id, reason);
            toast('Iscrizione rifiutata', 'info');
            document.querySelector('#modal-root .modal-close')?.click();
            if (onChanged) onChanged();
          } catch (e) { toast(`Errore: ${e?.message || e}`, 'error'); }
        });
        modalEl.parentElement.insertBefore(btn, modalEl);
      }
    }, 50);
  }
}

// Export CSV — file RFC 4180 con BOM UTF-8 per Excel.
function exportIscrizioniCsv(items, concorso) {
  const csvField = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const header = ['Data', 'Stato', 'Nome', 'Cognome', 'Email', 'Telefono', 'Data nascita', 'Luogo nascita', 'Nazionalità', 'Sesso', 'Strumento', 'Tipo', 'Gruppo', 'Anni studio', 'Scuola', 'Brani', 'Durata tot', 'Indirizzo', 'Città', 'CAP', 'Provincia'];
  const lines = [header.map(csvField).join(',')];
  for (const i of items) {
    const programma = Array.isArray(i.programma) ? i.programma : [];
    const briefBrani = programma.map(p => `${p.titolo || ''} — ${p.autore || ''}`).join(' | ');
    lines.push([
      new Date(i.created).toLocaleString('it-IT'),
      i.stato,
      i.nome, i.cognome, i.email, i.telefono, i.data_nascita, i.luogo_nascita, i.nazionalita, i.sesso,
      i.strumento, i.tipo, i.gruppo_nome, i.anni_studio, i.scuola_provenienza,
      briefBrani, i.durata_totale_min,
      i.indirizzo, i.citta, i.cap, i.provincia,
    ].map(csvField).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const safeName = (concorso.nome || 'iscrizioni').replace(/[\\/\x00-\x1f]+/g, '_').replaceAll(' ', '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${safeName}_iscrizioni.csv`; a.click();
  URL.revokeObjectURL(url);
  toast(`${items.length} iscrizioni esportate`, 'success');
}

function openCommissioneForm(concorso, existing, onSaved) {
  const isEdit = !!existing;
  const allCom = db.commissariByConcorso(concorso.id);
  const sezioni = db.sezioniByConcorso(concorso.id);
  const inputCls = 'mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500';

  let selCommissari = new Set(existing?.commissari_ids || []);
  let selSezioni = new Set(existing?.sezioni_ids || []);
  let selCategorie = new Set(existing?.categorie_ids || []);
  let includeTutte = !!existing?.include_tutte_categorie;

  const renderCommList = () => allCom.map(c => `
    <label class="flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer">
      <input type="checkbox" data-comm="${c.id}" ${selCommissari.has(c.id) ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-brand-600" />
      <div class="w-6 h-6 rounded-full bg-amber-100 text-amber-700 overflow-hidden flex items-center justify-center text-xs shrink-0">${c.foto ? `<img src="${c.foto}" alt="" class="w-full h-full object-cover" />` : '🧑‍⚖️'}</div>
      <span class="text-sm text-slate-800 truncate">${escapeHtml(displayName(c))}${c.is_presidente ? ' 🎯' : ''}</span>
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
        body.querySelector('[data-comm-count]').textContent = selCommissari.size;
      };
      body.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.comm) {
          if (t.checked) selCommissari.add(t.dataset.comm); else selCommissari.delete(t.dataset.comm);
          updateCount();
        } else if (t.dataset.sez) {
          if (t.checked) selSezioni.add(t.dataset.sez); else selSezioni.delete(t.dataset.sez);
        } else if (t.dataset.cat) {
          if (t.checked) selCategorie.add(t.dataset.cat); else selCategorie.delete(t.dataset.cat);
        } else if (t.id === 'incl-tutte') {
          includeTutte = t.checked;
        }
      });
      updateCount();
    },
    onPrimary: async (body) => {
      const data = Object.fromEntries(new FormData(body.querySelector('#frm')));
      if (!data.nome) return false;
      const payload = {
        nome: data.nome.trim(),
        descrizione: (data.descrizione || '').trim(),
        commissari_ids: Array.from(selCommissari),
        sezioni_ids: Array.from(selSezioni),
        categorie_ids: Array.from(selCategorie),
        include_tutte_categorie: includeTutte,
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

function renderRisultati(root, concorso) {
  const fasi = db.fasiByConcorso(concorso.id);
  const finale = fasi.find(f => f.ordine === fasi.length && f.stato === 'CONCLUSA');

  root.innerHTML = `
    <div class="space-y-6">
      ${fasi.map(f => buildFaseSummary(f)).join('')}
      ${finale ? buildPodio(finale, concorso) : ''}
      ${buildVerbaleBlock(concorso)}
      <div class="flex justify-end gap-2">
        <button data-action="export-pdf" class="text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 px-3.5 py-2 rounded-lg shadow-soft">${escapeHtml(t('admin.risultati.export_pdf'))}</button>
        <button data-action="export" class="text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 px-3.5 py-2 rounded-lg">${escapeHtml(t('admin.risultati.export_csv'))}</button>
      </div>
    </div>
  `;

  root.querySelector('[data-action="export"]').addEventListener('click', () => exportCsv(concorso));
  root.querySelector('[data-action="export-pdf"]').addEventListener('click', () => exportProtocolloPdf(concorso));
  bindVerbaleBlock(root, concorso);
}

async function exportProtocolloPdf(concorso) {
  // Verifica che jsPDF + autoTable siano caricati (defer, possono non essere ancora pronti).
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast(t('admin.risultati.pdf_not_loaded'), 'warn');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  // jspdf-autotable estende il prototype: se il CDN non l'ha caricato, doc.autoTable è undefined.
  if (typeof doc.autoTable !== 'function') {
    toast(t('admin.risultati.pdf_not_loaded') || 'Plugin autoTable non caricato. Ricarica la pagina.', 'warn');
    return;
  }
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  const presidente = db.getPresidenteFor(concorso.id);

  // Header con logo (in alto-sx) + titolo — logo del concorso se presente, altrimenti logo applicativo
  try {
    const logoSrc = concorso.logo_url || './logo.png';
    const logoData = await loadImageDataURL(logoSrc);
    if (logoData) doc.addImage(logoData, 'PNG', margin, margin - 10, 42, 42);
  } catch { /* logo non bloccante */ }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(46, 38, 61); // ink-900 Sneat
  doc.text(concorso.nome, margin + 52, margin + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(93, 89, 108); // ink-700
  const subtitle = t('admin.risultati.pdf_subtitle', { anno: concorso.anno, date: new Date().toLocaleString('it-IT') });
  doc.text(subtitle, margin + 52, margin + 26);
  if (concorso.anonimo) {
    doc.setFontSize(9);
    doc.setTextColor(115, 103, 240);
    doc.text(t('admin.risultati.pdf_anonimo'), margin + 52, margin + 40);
  }
  doc.setDrawColor(231, 229, 235);
  doc.line(margin, margin + 50, pageW - margin, margin + 50);

  let cursorY = margin + 70;
  const fasi = db.fasiByConcorso(concorso.id);

  for (const fase of fasi) {
    const cfs = db.candidatiFaseList(fase.id);
    if (cfs.length === 0) continue;
    const scala = getScala(fase);
    const rows = cfs.map(cf => {
      const cand = db.state.candidati.find(c => c.id === cf.candidato_id);
      const vs = db.valutazioniByCandidatoFase(cf.id);
      const media = mediaCandidato(vs, fase);
      return { cand, cf, media };
    }).sort((a,b) => b.media - a.media);

    // Header fase
    if (cursorY > 720) { doc.addPage(); cursorY = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(46, 38, 61);
    doc.text(t('admin.risultati.pdf_phase', { ordine: fase.ordine, nome: fase.nome }), margin, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(93, 89, 108);
    doc.text(t('admin.risultati.pdf_phase_meta', { stato: fase.stato, scala, n: cfs.length }), margin, cursorY + 14);
    cursorY += 22;

    const PROMOSSO_LABEL = t('admin.risultati.pdf_promosso');
    const ELIMINATO_LABEL = t('admin.risultati.pdf_eliminato');
    doc.autoTable({
      startY: cursorY,
      margin: { left: margin, right: margin },
      head: [[t('admin.risultati.pdf_col_pos'), t('admin.risultati.pdf_col_num'), t('admin.risultati.pdf_col_cand'), t('admin.risultati.pdf_col_strumento'), t('admin.risultati.pdf_col_media'), t('admin.risultati.pdf_col_esito')]],
      body: rows.map((r, i) => [
        i + 1,
        String(r.cand?.numero_candidato || '').padStart(3, '0'),
        r.cand ? displayName(r.cand) : '—',
        r.cand?.strumento || '',
        fmtVoto(r.media, scala),
        r.cf.stato !== 'COMPLETATO' ? '—'
          : r.cf.ammesso_prossima_fase ? PROMOSSO_LABEL : ELIMINATO_LABEL,
      ]),
      styles: { fontSize: 9, cellPadding: 5, lineColor: [231, 229, 235], textColor: [46, 38, 61] },
      headStyles: { fillColor: [115, 103, 240], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 247, 250] },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 5) {
          if (d.cell.raw === PROMOSSO_LABEL) d.cell.styles.textColor = [22, 163, 74];
          if (d.cell.raw === ELIMINATO_LABEL) d.cell.styles.textColor = [225, 29, 72];
        }
      },
    });
    cursorY = doc.lastAutoTable.finalY + 24;
  }

  // Footer firma presidente (ultima pagina)
  const totalPages = doc.internal.getNumberOfPages();
  doc.setPage(totalPages);
  const pageH = doc.internal.pageSize.getHeight();
  if (cursorY > pageH - 100) { doc.addPage(); cursorY = margin; }
  const sigY = Math.max(cursorY + 30, pageH - 110);
  doc.setDrawColor(165, 163, 174);
  doc.line(pageW - margin - 220, sigY, pageW - margin, sigY);
  doc.setFontSize(9);
  doc.setTextColor(93, 89, 108);
  doc.text(t('admin.risultati.pdf_signature'), pageW - margin - 220, sigY + 12);
  if (presidente) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(46, 38, 61);
    doc.text(displayName(presidente), pageW - margin - 220, sigY + 26);
  }

  // Numerazione pagine
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(165, 163, 174);
    doc.text(t('admin.risultati.pdf_page', { p, total: totalPages }), pageW - margin, pageH - 20, { align: 'right' });
    doc.text(concorso.nome, margin, pageH - 20);
  }

  const safeName = concorso.nome.replace(/[^\w\-]+/g, '_');
  doc.save(`Protocollo_${safeName}_${concorso.anno}.pdf`);
  toast(t('admin.risultati.pdf_done'), 'success');
}

function loadImageDataURL(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function buildFaseSummary(fase) {
  const cfs = db.candidatiFaseList(fase.id);
  if (cfs.length === 0) return `
    <div class="bg-white border border-slate-200 rounded-2xl p-5">
      <h3 class="font-semibold text-slate-900">${escapeHtml(fase.nome)}</h3>
      <p class="text-sm text-slate-500 italic mt-1">${escapeHtml(t('admin.risultati.fase_not_started'))}</p>
    </div>
  `;
  const rows = cfs.map(cf => {
    const cand = db.state.candidati.find(c => c.id === cf.candidato_id);
    const vs = db.valutazioniByCandidatoFase(cf.id);
    const media = mediaCandidato(vs, fase);
    return { cf, cand, media };
  }).sort((a,b) => b.media - a.media);

  return `
    <div class="bg-white border border-slate-200 rounded-2xl p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold text-slate-900">${escapeHtml(fase.nome)}</h3>
        <span class="text-xs px-2 py-0.5 rounded-full ${fase.stato === 'CONCLUSA' ? 'bg-slate-200 text-slate-700' : 'bg-brand-100 text-brand-800'}">${fase.stato}</span>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="text-xs text-slate-500 uppercase tracking-wider">
            <tr>
              <th class="text-left py-2 pr-3">${escapeHtml(t('admin.risultati.col_pos'))}</th>
              <th class="text-left py-2 pr-3">${escapeHtml(t('admin.risultati.col_cand'))}</th>
              <th class="text-right py-2 pr-3">${escapeHtml(t('admin.risultati.col_media'))}</th>
              <th class="text-center py-2 pr-3">${escapeHtml(t('admin.risultati.col_esito'))}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${rows.map((r, i) => `
              <tr>
                <td class="py-2 pr-3 text-slate-500">${i+1}</td>
                <td class="py-2 pr-3"><span class="font-medium text-slate-900">#${String(r.cand?.numero_candidato||'').padStart(3,'0')}</span> · ${escapeHtml(displayName(r.cand))} <span class="text-slate-500 text-xs">(${escapeHtml(r.cand?.strumento || '')})</span></td>
                <td class="py-2 pr-3 text-right font-mono">${fmtVoto(r.media, getScala(fase))} <span class="text-[10px] text-slate-400">/${getScala(fase)}</span></td>
                <td class="py-2 pr-3 text-center">
                  ${r.cf.stato !== 'COMPLETATO' ? `<span class="text-xs text-amber-700">${escapeHtml(t('admin.risultati.in_attesa'))}</span>`
                    : r.cf.ammesso_prossima_fase ? `<span class="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-medium">${escapeHtml(t('admin.risultati.promosso'))}</span>`
                    : `<span class="text-xs px-2 py-0.5 bg-rose-100 text-rose-800 rounded-full font-medium">${escapeHtml(t('admin.risultati.eliminato'))}</span>`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function buildPodio(fase, concorso) {
  const cfs = db.candidatiFaseList(fase.id);
  const rows = cfs.map(cf => {
    const cand = db.state.candidati.find(c => c.id === cf.candidato_id);
    const vs = db.valutazioniByCandidatoFase(cf.id);
    return { cand, media: mediaCandidato(vs, fase) };
  }).sort((a,b) => b.media - a.media);

  if (rows.length < 1) return '';

  const medals = ['🏆','🥈','🥉'];
  return `
    <div class="bg-gradient-to-br from-amber-50 to-orange-100 border border-amber-200 rounded-2xl p-6">
      <h3 class="font-bold text-slate-900 text-lg">${escapeHtml(t('admin.risultati.podio_title'))}</h3>
      <p class="text-sm text-slate-600 mt-1">${escapeHtml(concorso.nome)}</p>
      <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        ${rows.slice(0, 3).map((r, i) => `
          <div class="bg-white rounded-xl p-4 shadow-soft border border-amber-200">
            <div class="text-3xl">${medals[i]}</div>
            <div class="text-xs text-slate-500 uppercase tracking-wider mt-2">${escapeHtml(i === 0 ? t('admin.risultati.first_prize') : i === 1 ? t('admin.risultati.second_prize') : t('admin.risultati.third_prize'))}</div>
            <div class="font-semibold text-slate-900 mt-1">${escapeHtml(displayName(r.cand))}</div>
            <div class="text-xs text-slate-500">${escapeHtml(r.cand?.strumento || '')}</div>
            <div class="font-mono text-sm text-slate-700 mt-2">${escapeHtml(t('admin.risultati.media_label', { value: r.media.toFixed(2) }))}</div>
          </div>
        `).join('')}
      </div>
      ${rows.length > 3 ? `
        <div class="mt-4">
          <h4 class="text-xs text-slate-500 uppercase tracking-wider">${escapeHtml(t('admin.risultati.menzioni'))}</h4>
          <ul class="mt-1 text-sm text-slate-700 space-y-0.5">
            ${rows.slice(3).map(r => `<li>· ${escapeHtml(displayName(r.cand))} <span class="text-slate-500">(${escapeHtml(r.cand?.strumento || '')}) — ${r.media.toFixed(2)}</span></li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;
}

function exportCsv(concorso) {
  // Helper: quota qualsiasi valore CSV-safe (RFC 4180).
  const csvField = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const fasi = db.fasiByConcorso(concorso.id);
  const lines = ['Fase,Posizione,Numero,Nome,Cognome,Strumento,Nazionalita,Eta,Media,Esito'];
  fasi.forEach(fase => {
    const cfs = db.candidatiFaseList(fase.id);
    const rows = cfs.map(cf => {
      const cand = db.state.candidati.find(c => c.id === cf.candidato_id);
      const vs = db.valutazioniByCandidatoFase(cf.id);
      return { cf, cand, media: mediaCandidato(vs, fase) };
    }).sort((a,b) => b.media - a.media);
    rows.forEach((r, i) => {
      const esito = r.cf.stato !== 'COMPLETATO' ? 'in attesa'
        : r.cf.ammesso_prossima_fase ? 'PROMOSSO' : 'ELIMINATO';
      const eta = ageFromDate(r.cand?.data_nascita) ?? r.cand?.eta ?? '';
      const media = Number.isFinite(r.media) ? r.media.toFixed(2) : '0.00';
      lines.push([
        csvField(fase.nome),
        i + 1,
        r.cand?.numero_candidato ?? '',
        csvField(r.cand?.nome),
        csvField(r.cand?.cognome),
        csvField(r.cand?.strumento),
        csvField(r.cand?.nazionalita),
        eta,
        media,
        esito,
      ].join(','));
    });
  });
  // BOM UTF-8 per Excel + nome file con caratteri pericolosi (slash, NUL, control) sanificati.
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const safeName = (concorso.nome || 'risultati').replace(/[\\/\x00-\x1f]+/g, '_').replaceAll(' ', '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}_risultati.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(t('admin.risultati.csv_done'), 'success');
}

// ---------- Verbale della commissione (template + PDF, per fase) ----------

const VERBALE_TAGS_GENERAL = [
  { tag: 'concorso',       descKey: 'admin.risultati.verbale.tag_concorso' },
  { tag: 'anno',           descKey: 'admin.risultati.verbale.tag_anno' },
  { tag: 'data',           descKey: 'admin.risultati.verbale.tag_data' },
  { tag: 'presidente',     descKey: 'admin.risultati.verbale.tag_presidente' },
  { tag: 'commissione',    descKey: 'admin.risultati.verbale.tag_commissione' },
  { tag: 'commissari',     descKey: 'admin.risultati.verbale.tag_commissari' },
  { tag: 'num_commissari', descKey: 'admin.risultati.verbale.tag_num_commissari' },
  { tag: 'num_candidati',  descKey: 'admin.risultati.verbale.tag_num_candidati' },
  { tag: 'fasi',           descKey: 'admin.risultati.verbale.tag_fasi' },
  { tag: 'vincitore',      descKey: 'admin.risultati.verbale.tag_vincitore' },
  { tag: 'podio',          descKey: 'admin.risultati.verbale.tag_podio' },
  { tag: 'risultati',      descKey: 'admin.risultati.verbale.tag_risultati' },
];

const VERBALE_TAGS_FASE = [
  { tag: 'fase',                descKey: 'admin.risultati.verbale.tag_fase' },
  { tag: 'fase_numero',         descKey: 'admin.risultati.verbale.tag_fase_numero' },
  { tag: 'fase_data',           descKey: 'admin.risultati.verbale.tag_fase_data' },
  { tag: 'fase_stato',          descKey: 'admin.risultati.verbale.tag_fase_stato' },
  { tag: 'fase_scala',          descKey: 'admin.risultati.verbale.tag_fase_scala' },
  { tag: 'fase_modo',           descKey: 'admin.risultati.verbale.tag_fase_modo' },
  { tag: 'fase_metodo',         descKey: 'admin.risultati.verbale.tag_fase_metodo' },
  { tag: 'fase_num_candidati',  descKey: 'admin.risultati.verbale.tag_fase_num_candidati' },
  { tag: 'fase_commissione',    descKey: 'admin.risultati.verbale.tag_fase_commissione' },
  { tag: 'fase_commissari',     descKey: 'admin.risultati.verbale.tag_fase_commissari' },
  { tag: 'fase_classifica',     descKey: 'admin.risultati.verbale.tag_fase_classifica' },
  { tag: 'fase_promossi',       descKey: 'admin.risultati.verbale.tag_fase_promossi' },
  { tag: 'fase_eliminati',      descKey: 'admin.risultati.verbale.tag_fase_eliminati' },
];

function verbaleStorageKey(concorso, fase) {
  return fase ? `verbale_draft_${concorso.id}_${fase.id}` : `verbale_draft_${concorso.id}`;
}

function defaultVerbaleTemplate() {
  return t('admin.risultati.verbale.default_template');
}

function fmtFaseDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return iso; }
}

function buildFaseClassifica(fase, mode = 'all') {
  const cfs = db.candidatiFaseList(fase.id);
  if (cfs.length === 0) return '—';
  const scala = getScala(fase);
  const rows = cfs.map(cf => {
    const cand = db.state.candidati.find(c => c.id === cf.candidato_id);
    const vs = db.valutazioniByCandidatoFase(cf.id);
    return { cf, cand, media: mediaCandidato(vs, fase) };
  }).sort((a,b) => b.media - a.media);
  const filtered = mode === 'promossi'
    ? rows.filter(r => r.cf.stato === 'COMPLETATO' && r.cf.ammesso_prossima_fase)
    : mode === 'eliminati'
    ? rows.filter(r => r.cf.stato === 'COMPLETATO' && !r.cf.ammesso_prossima_fase)
    : rows;
  if (filtered.length === 0) return '—';
  return filtered.map((r, i) => {
    const esito = r.cf.stato !== 'COMPLETATO' ? t('admin.risultati.in_attesa')
      : r.cf.ammesso_prossima_fase ? t('admin.risultati.promosso')
      : t('admin.risultati.eliminato');
    const base = `${i+1}. ${displayName(r.cand)} — ${fmtVoto(r.media, scala)}/${scala}`;
    return mode === 'all' ? `${base} — ${esito}` : base;
  }).join('\n');
}

function buildVerbaleContext(concorso, fase = null) {
  const today = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  const presidente = db.getPresidenteFor(concorso.id);
  const commissari = db.commissariByConcorso(concorso.id);
  const candidati = db.candidatiByConcorso(concorso.id);
  const fasi = db.fasiByConcorso(concorso.id);

  const commissariNoPres = commissari.filter(c => !c.is_presidente);
  const commissariList = commissariNoPres.map(c => `· ${displayName(c)}`).join('\n');
  const commissariInline = commissariNoPres.map(c => displayName(c)).join(', ');
  const fasiList = fasi.map(f => `${f.ordine}. ${f.nome}`).join('\n');

  const finale = fasi.find(f => f.ordine === fasi.length && f.stato === 'CONCLUSA');
  let podio = '—';
  let vincitore = '—';
  if (finale) {
    const cfs = db.candidatiFaseList(finale.id);
    const rows = cfs.map(cf => {
      const cand = db.state.candidati.find(c => c.id === cf.candidato_id);
      const vs = db.valutazioniByCandidatoFase(cf.id);
      return { cand, media: mediaCandidato(vs, finale) };
    }).sort((a,b) => b.media - a.media);
    if (rows.length > 0) {
      vincitore = displayName(rows[0].cand);
      podio = rows.slice(0, 3).map((r, i) => {
        const place = i === 0 ? t('admin.risultati.first_prize') : i === 1 ? t('admin.risultati.second_prize') : t('admin.risultati.third_prize');
        return `${i+1}. ${displayName(r.cand)} — ${place} (${t('admin.risultati.media_label', { value: r.media.toFixed(2) })})`;
      }).join('\n');
    }
  }

  const risultatiBlocks = fasi.map(f => {
    const cfs = db.candidatiFaseList(f.id);
    if (cfs.length === 0) return '';
    return `${f.nome}:\n${buildFaseClassifica(f, 'all').split('\n').map(l => `  ${l}`).join('\n')}`;
  }).filter(Boolean).join('\n\n');

  const ctx = {
    concorso: concorso.nome || '',
    anno: String(concorso.anno || ''),
    data: today,
    presidente: presidente ? displayName(presidente) : t('admin.risultati.verbale.no_president'),
    commissione: commissariList || '—',
    commissari: commissariInline || '—',
    num_commissari: String(commissari.length),
    num_candidati: String(candidati.length),
    fasi: fasiList || '—',
    vincitore,
    podio,
    risultati: risultatiBlocks || '—',
  };

  if (fase) {
    const faseCommIds = db.getFaseCommissariIds(fase) || [];
    const faseCommissari = faseCommIds.map(id => db.state.commissari.find(c => c.id === id)).filter(Boolean);
    const faseCommissariNoPres = faseCommissari.filter(c => !c.is_presidente);
    const faseCommissioneList = faseCommissariNoPres.map(c => `· ${displayName(c)}`).join('\n');
    const faseCommissariInline = faseCommissariNoPres.map(c => displayName(c)).join(', ');
    const cfsCount = db.candidatiFaseList(fase.id).length;
    const metodoKey = getMetodoMedia(fase);
    const metodoLabel = METODI_MEDIA[metodoKey]?.nome || metodoKey;

    Object.assign(ctx, {
      fase: fase.nome || '',
      fase_numero: String(fase.ordine ?? ''),
      fase_data: fmtFaseDate(fase.data_prevista),
      fase_stato: fase.stato || '',
      fase_scala: String(getScala(fase)),
      fase_modo: getModoValutazione(fase) === 'sincrona' ? t('admin.fasi.modo_sincrona_title') : t('admin.fasi.modo_autonoma_title'),
      fase_metodo: metodoLabel,
      fase_num_candidati: String(cfsCount),
      fase_commissione: faseCommissioneList || '—',
      fase_commissari: faseCommissariInline || '—',
      fase_classifica: buildFaseClassifica(fase, 'all'),
      fase_promossi: buildFaseClassifica(fase, 'promossi'),
      fase_eliminati: buildFaseClassifica(fase, 'eliminati'),
    });
  }

  return ctx;
}

function applyVerbaleTags(template, ctx) {
  return String(template || '').replace(/<([a-z_]+)>/gi, (full, name) => {
    const key = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ctx, key) ? ctx[key] : full;
  });
}

function renderVerbaleTagChips(fase) {
  const groups = [];
  groups.push({
    label: t('admin.risultati.verbale.tags_general'),
    tags: VERBALE_TAGS_GENERAL,
  });
  if (fase) {
    groups.push({
      label: t('admin.risultati.verbale.tags_fase'),
      tags: VERBALE_TAGS_FASE,
    });
  }
  return groups.map(g => `
    <div>
      <p class="text-xs uppercase tracking-wider text-slate-500 mb-1.5">${escapeHtml(g.label)}</p>
      <div class="flex flex-wrap gap-1.5">
        ${g.tags.map(td => `<button type="button" data-verbale-tag="${td.tag}" class="text-xs font-mono px-2 py-1 bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 rounded transition" title="${escapeHtml(t(td.descKey))}">&lt;${td.tag}&gt;</button>`).join('')}
      </div>
    </div>
  `).join('');
}

function buildVerbaleBlock(concorso) {
  const fasi = db.fasiByConcorso(concorso.id);
  const faseOptions = fasi.map(f => `<option value="${f.id}">${escapeHtml(`${f.ordine}. ${f.nome}`)}</option>`).join('');
  const initialFase = fasi[0] || null;
  const stored = (() => {
    try { return localStorage.getItem(verbaleStorageKey(concorso, initialFase)); } catch { return null; }
  })();
  const initial = stored != null ? stored : defaultVerbaleTemplate();
  return `
    <div class="bg-white border border-slate-200 rounded-2xl p-5 space-y-4" data-verbale-block>
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 class="font-semibold text-slate-900 text-lg flex items-center gap-2">${icon('document', { size: 18 })} ${escapeHtml(t('admin.risultati.verbale.heading'))}</h3>
          <p class="text-sm text-slate-600 mt-1">${escapeHtml(t('admin.risultati.verbale.help'))}</p>
        </div>
        <div class="flex gap-2">
          <button type="button" data-verbale-action="reset" class="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg">${escapeHtml(t('admin.risultati.verbale.reset'))}</button>
          <button type="button" data-verbale-action="pdf" class="text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 px-3.5 py-2 rounded-lg shadow-soft" ${fasi.length === 0 ? 'disabled' : ''}>${escapeHtml(t('admin.risultati.verbale.export_pdf'))}</button>
        </div>
      </div>

      ${fasi.length === 0
        ? `<p class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">${escapeHtml(t('admin.risultati.verbale.no_fasi'))}</p>`
        : `
          <div class="flex items-center gap-2 flex-wrap">
            <label class="text-xs uppercase tracking-wider text-slate-500">${escapeHtml(t('admin.risultati.verbale.fase_label'))}</label>
            <select data-verbale-fase class="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300">${faseOptions}</select>
            <span class="text-xs text-slate-500">${escapeHtml(t('admin.risultati.verbale.fase_help'))}</span>
          </div>

          <div data-verbale-tags class="space-y-3">${renderVerbaleTagChips(initialFase)}</div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label class="text-xs uppercase tracking-wider text-slate-500 mb-1.5 block">${escapeHtml(t('admin.risultati.verbale.template_label'))}</label>
              <textarea data-verbale-input rows="16" spellcheck="false" class="w-full border border-slate-300 rounded-lg p-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-300">${escapeHtml(initial)}</textarea>
            </div>
            <div>
              <label class="text-xs uppercase tracking-wider text-slate-500 mb-1.5 block">${escapeHtml(t('admin.risultati.verbale.preview_label'))}</label>
              <div data-verbale-preview class="w-full min-h-[400px] border border-slate-200 bg-slate-50 rounded-lg p-3 text-sm whitespace-pre-wrap leading-relaxed text-slate-800"></div>
            </div>
          </div>
        `}
    </div>
  `;
}

function bindVerbaleBlock(root, concorso) {
  const block = root.querySelector('[data-verbale-block]');
  if (!block) return;
  const select = block.querySelector('[data-verbale-fase]');
  if (!select) return; // no fasi
  const input = block.querySelector('[data-verbale-input]');
  const preview = block.querySelector('[data-verbale-preview]');
  const tagsContainer = block.querySelector('[data-verbale-tags]');
  const fasi = db.fasiByConcorso(concorso.id);

  const getCurrentFase = () => fasi.find(f => f.id === select.value) || null;

  const refreshPreview = () => {
    const fase = getCurrentFase();
    const ctx = buildVerbaleContext(concorso, fase);
    preview.textContent = applyVerbaleTags(input.value, ctx);
  };

  const wireTagButtons = () => {
    tagsContainer.querySelectorAll('[data-verbale-tag]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = `<${btn.getAttribute('data-verbale-tag')}>`;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, start) + tag + input.value.slice(end);
        const cursor = start + tag.length;
        input.focus();
        input.setSelectionRange(cursor, cursor);
        refreshPreview();
        const fase = getCurrentFase();
        try { localStorage.setItem(verbaleStorageKey(concorso, fase), input.value); } catch {}
      });
    });
  };

  refreshPreview();
  wireTagButtons();

  input.addEventListener('input', () => {
    refreshPreview();
    const fase = getCurrentFase();
    try { localStorage.setItem(verbaleStorageKey(concorso, fase), input.value); } catch {}
  });

  select.addEventListener('change', () => {
    const fase = getCurrentFase();
    let stored = null;
    try { stored = localStorage.getItem(verbaleStorageKey(concorso, fase)); } catch {}
    input.value = stored != null ? stored : defaultVerbaleTemplate();
    tagsContainer.innerHTML = renderVerbaleTagChips(fase);
    wireTagButtons();
    refreshPreview();
  });

  block.querySelector('[data-verbale-action="reset"]').addEventListener('click', () => {
    const fase = getCurrentFase();
    confirmDialog({
      title: t('admin.risultati.verbale.reset_title'),
      message: t('admin.risultati.verbale.reset_msg'),
      onConfirm: () => {
        input.value = defaultVerbaleTemplate();
        try { localStorage.removeItem(verbaleStorageKey(concorso, fase)); } catch {}
        refreshPreview();
      },
    });
  });

  block.querySelector('[data-verbale-action="pdf"]').addEventListener('click', () => {
    const fase = getCurrentFase();
    if (!fase) { toast(t('admin.risultati.verbale.no_fasi'), 'warn'); return; }
    exportVerbalePdf(concorso, fase, input.value);
  });
}

async function exportVerbalePdf(concorso, fase, template) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast(t('admin.risultati.pdf_not_loaded'), 'warn');
    return;
  }
  const ctx = buildVerbaleContext(concorso, fase);
  const text = applyVerbaleTags(template, ctx);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  const maxW = pageW - margin * 2;

  try {
    const logoSrc = concorso.logo_url || './logo.png';
    const logoData = await loadImageDataURL(logoSrc);
    if (logoData) doc.addImage(logoData, 'PNG', margin, margin - 10, 42, 42);
  } catch { /* logo non bloccante */ }

  const titleSuffix = fase ? ` — ${t('admin.risultati.verbale.pdf_fase_suffix', { ordine: fase.ordine, nome: fase.nome })}` : '';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(46, 38, 61);
  doc.text(`${t('admin.risultati.verbale.pdf_title')}${titleSuffix}`, margin + 52, margin + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(93, 89, 108);
  doc.text(`${concorso.nome} · ${concorso.anno}`, margin + 52, margin + 26);
  doc.setDrawColor(231, 229, 235);
  doc.line(margin, margin + 50, pageW - margin, margin + 50);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(46, 38, 61);

  let cursorY = margin + 80;
  const lineHeight = 16;

  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    const wrapped = para === '' ? [''] : doc.splitTextToSize(para, maxW);
    for (const ln of wrapped) {
      if (cursorY > pageH - margin - 60) {
        doc.addPage();
        cursorY = margin;
      }
      doc.text(ln, margin, cursorY);
      cursorY += lineHeight;
    }
  }

  // ----- Griglia firme di tutti i commissari della fase -----
  const faseCommIds = fase ? (db.getFaseCommissariIds(fase) || []) : [];
  let firmatari = faseCommIds.map(id => db.state.commissari.find(c => c.id === id)).filter(Boolean);
  if (firmatari.length === 0) firmatari = db.commissariByConcorso(concorso.id);
  // Presidente in cima
  firmatari.sort((a, b) => (b.is_presidente ? 1 : 0) - (a.is_presidente ? 1 : 0));

  if (firmatari.length > 0) {
    const cols = 2;
    const gap = 32;
    const colW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
    const rowH = 64;
    const headingH = 26;

    let yCursor = cursorY + 30;
    if (yCursor + headingH + rowH > pageH - margin - 30) {
      doc.addPage();
      yCursor = margin;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(46, 38, 61);
    doc.text(t('admin.risultati.verbale.signatures_heading'), margin, yCursor);
    yCursor += headingH;

    let i = 0;
    while (i < firmatari.length) {
      if (yCursor + rowH > pageH - margin - 30) {
        doc.addPage();
        yCursor = margin;
      }
      for (let col = 0; col < cols && i < firmatari.length; col++) {
        const c = firmatari[i++];
        const x = margin + col * (colW + gap);
        const lineY = yCursor + 24;

        doc.setDrawColor(165, 163, 174);
        doc.line(x, lineY, x + colW - 12, lineY);

        const role = c.is_presidente ? ` (${t('admin.risultati.verbale.role_presidente')})` : '';
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(46, 38, 61);
        doc.text(`${displayName(c)}${role}`, x, lineY + 14);

        if (c.specialita) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(93, 89, 108);
          doc.text(c.specialita, x, lineY + 26);
        }
      }
      yCursor += rowH;
    }
  }

  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(165, 163, 174);
    doc.text(t('admin.risultati.pdf_page', { p, total: totalPages }), pageW - margin, pageH - 20, { align: 'right' });
    doc.text(concorso.nome, margin, pageH - 20);
  }

  const safeName = concorso.nome.replace(/[^\w\-]+/g, '_');
  const safeFase = fase ? `_F${fase.ordine}_${(fase.nome || '').replace(/[^\w\-]+/g, '_')}` : '';
  doc.save(`Verbale_${safeName}${safeFase}_${concorso.anno}.pdf`);
  toast(t('admin.risultati.verbale.pdf_done'), 'success');
}

async function exportProgrammaPdf(concorso, fase) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast(t('admin.fasi.programma_pdf_not_loaded'), 'warn');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 40;
  const pageW = doc.internal.pageSize.getWidth();
  let y = margin;

  const cfs = db.candidatiFaseList(fase.id).sort((a, b) => a.posizione - b.posizione);
  const candById = Object.fromEntries(db.state.candidati.map(c => [c.id, c]));
  const tempoPerCandidato = (Number(fase.tempo_minuti) || 5);

  // Header
  doc.setFontSize(18);
  doc.text(concorso.nome, margin, y); y += 26;
  doc.setFontSize(13);
  doc.text(`Programma di sala — ${fase.nome}`, margin, y); y += 18;
  doc.setFontSize(10);
  doc.text(`Data: ${concorso.data_inizio || '—'} | Ordine di esibizione | ${cfs.length} candidati | ~${tempoPerCandidato} min/cad`, margin, y);
  y += 28;

  // Table header
  const cols = [
    { x: margin, w: 36, label: '#' },
    { x: margin + 36, w: 220, label: 'Candidato' },
    { x: margin + 256, w: 130, label: 'Strumento/Brano' },
    { x: margin + 386, w: 80, label: 'Nazionalità' },
    { x: margin + 466, w: 60, label: 'Tempo' },
  ];

  doc.setFontSize(9);
  doc.setFillColor(65, 105, 225); // brand blue
  doc.setTextColor(255, 255, 255);
  doc.rect(margin, y - 4, cols[4].x + cols[4].w - margin, 24, 'F');
  cols.forEach(c => doc.text(c.label, c.x + 4, y + 12));
  doc.setTextColor(30, 30, 30);
  y += 28;

  // Table rows
  doc.setFontSize(9);
  const rowH = 22;
  cfs.forEach((cf, i) => {
    if (y > doc.internal.pageSize.getHeight() - margin - 30) {
      doc.addPage();
      y = margin;
    }
    const cand = candById[cf.candidato_id];
    const isGruppo = cand?.tipo === 'gruppo';
    const nomeDisplay = isGruppo ? (cand?.nome || '—') : `${cand?.nome || '—'} ${cand?.cognome || ''}`.trim();
    const bg = i % 2 === 0 ? '#F8F9FC' : '#FFFFFF';
    doc.setFillColor(...hexToRgb(bg));
    doc.rect(margin, y, cols[4].x + cols[4].w - margin, rowH, 'F');

    doc.text(String(cf.posizione), cols[0].x + 4, y + 14);
    doc.text(nomeDisplay, cols[1].x + 4, y + 14);
    doc.text(cand?.strumento || '—', cols[2].x + 4, y + 14);
    doc.text(cand?.nazionalita || '—', cols[3].x + 4, y + 14);
    const orario = `${String(i * tempoPerCandidato).padStart(2, '0')}:00`;
    doc.text(orario, cols[4].x + 4, y + 14);

    if (isGruppo) {
      const membri = db.membriGruppo(cand.id);
      if (membri.length > 0) {
        y += 12;
        doc.setFontSize(7);
        doc.text(membri.map(m => `${m.candidato?.nome || ''} ${m.candidato?.cognome || ''}`).join(' | '), cols[1].x + 4, y + 8);
        doc.setFontSize(9);
        y -= 12;
      }
    }
    y += rowH;
  });

  const safeName = concorso.nome.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
  const safeFase = fase.nome.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
  doc.save(`Programma_${safeFase}_${safeName}.pdf`);
  toast(t('admin.fasi.programma_pdf_done'), 'success');
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

// ---------- Importazione massiva (candidati / commissari) ----------

const IMPORT_FIELD_ALIASES = {
  candidati: {
    nome:         ['nome', 'firstname', 'name'],
    cognome:      ['cognome', 'lastname', 'surname'],
    strumento:    ['strumento', 'instrument', 'specialita', 'disciplina'],
    data_nascita: ['datanascita', 'data', 'datadinascita', 'birth', 'birthdate', 'nascita'],
    nazionalita:  ['nazionalita', 'nationality', 'paese'],
    docenti:      ['docenti', 'docentipreparatori', 'docente', 'maestri', 'maestro', 'preparatore', 'preparatori'],
    sezioni:      ['sezione', 'sezioni', 'section', 'sections'],
    categorie:    ['categoria', 'categorie', 'category', 'categories'],
  },
  commissari: {
    nome:         ['nome', 'firstname', 'name'],
    cognome:      ['cognome', 'lastname', 'surname'],
    specialita:   ['specialita', 'strumento', 'discipline', 'disciplina'],
    email:        ['email', 'mail', 'eMail'.toLowerCase()],
    telefono:     ['telefono', 'tel', 'phone', 'cell', 'cellulare'],
    data_nascita: ['datanascita', 'data', 'datadinascita', 'birth', 'birthdate', 'nascita'],
    nazionalita:  ['nazionalita', 'nationality', 'paese'],
    bio:          ['bio', 'biografia', 'note', 'notes'],
  },
};

const IMPORT_REQUIRED = {
  candidati:  ['nome', 'cognome', 'strumento', 'data_nascita', 'nazionalita'],
  commissari: ['nome', 'cognome', 'specialita'],
};

function normKey(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

function detectCsvSeparator(text) {
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (!inQ && ch in counts) counts[ch]++;
  }
  // pick most frequent non-zero, prefer ; over , over \t on tie
  const order = [';', ',', '\t'];
  return order.reduce((best, c) => counts[c] > counts[best] ? c : best, order[0]);
}

function parseCSV(text, sep) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === sep) { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r') { /* skip */ }
      else cur += ch;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function parseImportDate(s) {
  const v = String(s || '').trim();
  if (!v) return '';
  // ISO YYYY-MM-DD
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  // DD/MM/YYYY  DD-MM-YYYY  DD.MM.YYYY
  m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const yy = m[3].length === 2 ? (Number(m[3]) > 30 ? '19' + m[3] : '20' + m[3]) : m[3];
    const day = String(m[1]).padStart(2,'0');
    const mon = String(m[2]).padStart(2,'0');
    if (Number(day) > 31 || Number(mon) > 12) return null;
    return `${yy}-${mon}-${day}`;
  }
  return null; // invalid
}

function splitMulti(s) {
  return String(s || '').split('|').map(x => x.trim()).filter(Boolean);
}

function buildImportRow(kind, headerMap, rawRow, concorso) {
  const get = (logical) => {
    const idx = headerMap[logical];
    return idx == null ? '' : String(rawRow[idx] ?? '').trim();
  };
  const errors = [];
  const out = {
    nome: get('nome'),
    cognome: get('cognome'),
  };
  if (kind === 'candidati') {
    out.strumento = get('strumento');
    out.nazionalita = get('nazionalita');
    const dn = parseImportDate(get('data_nascita'));
    if (dn === null) errors.push(t('admin.import.err.bad_date', { value: get('data_nascita') }));
    out.data_nascita = dn || '';
    const docenti = splitMulti(get('docenti'));
    out.docenti_preparatori = docenti;

    // Resolve sezioni by name (case-insensitive)
    const sezAll = db.sezioniByConcorso(concorso.id);
    const sezNames = splitMulti(get('sezioni'));
    const sezIds = [];
    sezNames.forEach(n => {
      const s = sezAll.find(x => normKey(x.nome) === normKey(n));
      if (s) sezIds.push(s.id);
      else errors.push(t('admin.import.err.sez_not_found', { name: n }));
    });
    out.sezioni_ids = sezIds;

    // Categorie scoped to selected sezioni (or any of the concorso if no sezione given)
    const catAll = db.categorieByConcorso(concorso.id);
    const catNames = splitMulti(get('categorie'));
    const catIds = [];
    catNames.forEach(n => {
      const candidates = catAll.filter(c => normKey(c.nome) === normKey(n) && (sezIds.length === 0 || sezIds.includes(c.sezione_id)));
      if (candidates.length === 1) catIds.push(candidates[0].id);
      else if (candidates.length === 0) errors.push(t('admin.import.err.cat_not_found', { name: n }));
      else errors.push(t('admin.import.err.cat_ambiguous', { name: n }));
    });
    out.categorie_ids = catIds;
  } else {
    out.specialita = get('specialita');
    out.email = get('email');
    out.telefono = get('telefono');
    out.nazionalita = get('nazionalita');
    out.bio = get('bio');
    if (get('data_nascita')) {
      const dn = parseImportDate(get('data_nascita'));
      if (dn === null) errors.push(t('admin.import.err.bad_date', { value: get('data_nascita') }));
      out.data_nascita = dn || null;
    } else {
      out.data_nascita = null;
    }
  }

  IMPORT_REQUIRED[kind].forEach(f => {
    if (!out[f]) errors.push(t('admin.import.err.required_missing', { field: f }));
  });
  return { data: out, errors };
}

function buildHeaderMap(kind, headerCells) {
  const aliases = IMPORT_FIELD_ALIASES[kind];
  const normHeader = headerCells.map(h => normKey(h));
  const map = {};
  Object.entries(aliases).forEach(([logical, alts]) => {
    const idx = normHeader.findIndex(h => alts.includes(h));
    if (idx >= 0) map[logical] = idx;
  });
  return map;
}

function importTemplateText(kind) {
  if (kind === 'candidati') {
    return [
      'nome,cognome,strumento,data_nascita,nazionalita,docenti,sezioni,categorie',
      'Anna,Rossi,Pianoforte,2002-04-15,Italiana,Mario Bianchi|Lucia Verdi,Solisti,Junior',
      'Marco,Bianchi,Violino,15/06/2003,Italiana,Anna Neri,,'
    ].join('\n');
  }
  return [
    'nome,cognome,specialita,email,telefono,data_nascita,nazionalita,bio',
    'Giovanni,Verdi,Pianoforte,g.verdi@esempio.it,+39 333 1234567,1968-09-20,Italiana,Docente al conservatorio',
    'Sara,Conti,Composizione,,,,Italiana,'
  ].join('\n');
}

function openImportModal(concorso, kind, onSaved) {
  const isCand = kind === 'candidati';
  const titleKind = isCand ? t('admin.import.kind.candidati') : t('admin.import.kind.commissari');
  const fieldsHelp = isCand
    ? t('admin.import.cols.candidati')
    : t('admin.import.cols.commissari');

  // Mutable parsed state (filled by parseAndPreview)
  let parsed = []; // [{ data, errors, raw }]

  modal({
    title: t('admin.import.title', { kind: titleKind }),
    width: 'max-w-4xl',
    contentHtml: `
      <div class="space-y-4 text-sm">
        <div class="bg-brand-50 border border-brand-100 rounded-xl p-3 text-brand-900 text-xs leading-relaxed">
          <p>${fieldsHelp}</p>
          <p class="mt-1">${t('admin.import.help1')}</p>
          <p class="mt-1">${escapeHtml(t('admin.import.help2'))}</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <label class="inline-flex items-center px-3 py-2 text-sm font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg cursor-pointer">
            ${escapeHtml(t('admin.import.upload_btn'))}
            <input data-import-file type="file" accept=".csv,.tsv,.txt,text/csv" class="hidden" />
          </label>
          <button type="button" data-import-template class="text-xs text-slate-600 hover:text-slate-900 underline">${escapeHtml(t('admin.import.template_btn'))}</button>
          <span data-import-status class="text-xs text-slate-500"></span>
        </div>

        <label class="block">
          <span class="text-xs font-medium text-slate-700">${escapeHtml(t('admin.import.paste_label'))}</span>
          <textarea data-import-text rows="6" spellcheck="false" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-brand-500 focus:border-brand-500" placeholder="${escapeHtml(importTemplateText(kind))}"></textarea>
        </label>

        <div class="flex items-center gap-2">
          <button type="button" data-import-parse class="text-sm font-semibold text-white bg-slate-700 hover:bg-slate-900 px-3 py-2 rounded-lg">${escapeHtml(t('admin.import.parse_btn'))}</button>
          <span data-import-summary class="text-xs text-slate-600"></span>
        </div>

        <div data-import-preview class="hidden border border-slate-200 rounded-xl overflow-hidden">
          <div class="max-h-[360px] overflow-auto">
            <table class="w-full text-xs">
              <thead class="bg-slate-50 sticky top-0">
                <tr data-preview-head></tr>
              </thead>
              <tbody data-preview-body></tbody>
            </table>
          </div>
        </div>

        <div data-import-progress class="hidden">
          <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div data-progress-bar class="h-full bg-brand-500 transition-all" style="width:0%"></div>
          </div>
          <p data-progress-text class="text-xs text-slate-500 mt-1"></p>
        </div>

        <div data-mapping class="hidden mt-3 bg-brand-50 border border-brand-100 rounded-xl p-4">
          <p class="text-xs font-semibold text-brand-700 mb-2">${escapeHtml(t('admin.import.mapping_title'))}</p>
          <div data-mapping-fields class="grid grid-cols-2 sm:grid-cols-3 gap-2"></div>
        </div>
      </div>
    `,
    primaryLabel: t('admin.import.btn_label', { kind: titleKind }),
    onMount: (body) => {
      const fileInput   = body.querySelector('[data-import-file]');
      const textArea    = body.querySelector('[data-import-text]');
      const statusEl    = body.querySelector('[data-import-status]');
      const summaryEl   = body.querySelector('[data-import-summary]');
      const previewWrap = body.querySelector('[data-import-preview]');
      const headRow     = body.querySelector('[data-preview-head]');
      const bodyRows    = body.querySelector('[data-preview-body]');
      const tplBtn      = body.querySelector('[data-import-template]');
      const parseBtn    = body.querySelector('[data-import-parse]');
      const mappingWrap = body.querySelector('[data-mapping]');
      const mappingFields = body.querySelector('[data-mapping-fields]');
      let csvHeaders = [];

      tplBtn.addEventListener('click', () => {
        const blob = new Blob([importTemplateText(kind)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `template_${kind}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });

      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const txt = await file.text();
          textArea.value = txt;
          statusEl.textContent = t('admin.import.loaded', { name: file.name, size: fmtBytes(file.size) });
          parseBtn.click();
        } catch (err) {
          toast(t('admin.import.read_error', { msg: err.message }), 'error');
        } finally {
          fileInput.value = '';
        }
      });

      parseBtn.addEventListener('click', () => {
        const text = (textArea.value || '').trim();
        if (!text) {
          summaryEl.textContent = t('admin.import.empty_hint');
          previewWrap.classList.add('hidden');
          parsed = [];
          return;
        }
        const sep = detectCsvSeparator(text);
        const rows = parseCSV(text, sep);
        if (rows.length < 2) {
          summaryEl.innerHTML = `<span class="text-rose-600 font-semibold">${escapeHtml(t('admin.import.need_header_data'))}</span>`;
          previewWrap.classList.add('hidden');
          parsed = [];
          return;
        }
        const header = rows[0];
        const headerMap = buildHeaderMap(kind, header);
        const missingReq = IMPORT_REQUIRED[kind].filter(f => !(f in headerMap));
        if (missingReq.length > 0) {
          summaryEl.innerHTML = `<span class="text-rose-600 font-semibold">${escapeHtml(t('admin.import.missing_cols', { cols: missingReq.join(', ') }))}</span>`;
          previewWrap.classList.add('hidden');
          parsed = [];
          return;
        }
        parsed = rows.slice(1).map((r, i) => ({
          ...buildImportRow(kind, headerMap, r, concorso),
          rawIndex: i + 2,
        }));
        const ok = parsed.filter(p => p.errors.length === 0).length;
        const ko = parsed.length - ok;
        const sepLabel = sep === '\t' ? 'tab' : sep;
        summaryEl.innerHTML = t('admin.import.summary', { sep: sepLabel, n: parsed.length, ok }) + (ko ? t('admin.import.summary_errors', { ko }) : '');

        // Build preview
        const cols = isCand
          ? ['nome', 'cognome', 'strumento', 'data_nascita', 'nazionalita', 'sezioni_ids', 'categorie_ids']
          : ['nome', 'cognome', 'specialita', 'email', 'telefono', 'data_nascita'];
        const colLabels = isCand
          ? [t('admin.import.col.nome'), t('admin.import.col.cognome'), t('admin.import.col.strumento'), t('admin.import.col.nascita'), t('admin.import.col.naz'), t('admin.import.col.sezioni'), t('admin.import.col.categorie')]
          : [t('admin.import.col.nome'), t('admin.import.col.cognome'), t('admin.import.col.specialita'), t('admin.import.col.email'), t('admin.import.col.telefono'), t('admin.import.col.nascita')];
        headRow.innerHTML = ['#', ...colLabels, t('admin.import.col_status')].map(h => `<th class="text-left font-semibold text-slate-600 px-2 py-1.5 border-b border-slate-200">${escapeHtml(h)}</th>`).join('');

        const sezById = Object.fromEntries(db.sezioniByConcorso(concorso.id).map(s => [s.id, s.nome]));
        const catById = Object.fromEntries(db.categorieByConcorso(concorso.id).map(c => [c.id, c.nome]));

        bodyRows.innerHTML = parsed.map(p => {
          const cells = cols.map(c => {
            let v = p.data[c];
            if (Array.isArray(v)) {
              if (c === 'sezioni_ids')   v = v.map(id => sezById[id] || id).join(', ');
              else if (c === 'categorie_ids') v = v.map(id => catById[id] || id).join(', ');
              else v = v.join(', ');
            }
            return `<td class="px-2 py-1 border-b border-slate-100 text-slate-700">${escapeHtml(v ?? '')}</td>`;
          }).join('');
          const statusCell = p.errors.length === 0
            ? `<td class="px-2 py-1 border-b border-slate-100 text-emerald-700 font-semibold">✓</td>`
            : `<td class="px-2 py-1 border-b border-slate-100 text-rose-700 font-medium" title="${escapeHtml(p.errors.join(' · '))}">✗ ${escapeHtml(p.errors.join(' · '))}</td>`;
          return `<tr class="${p.errors.length ? 'bg-rose-50/40' : ''}"><td class="px-2 py-1 border-b border-slate-100 font-mono text-slate-400">${p.rawIndex}</td>${cells}${statusCell}</tr>`;
        }).join('');

        // Popola mappatura colonne per override manuale
        csvHeaders = header;
        const fieldNames = isCand
          ? ['nome','cognome','strumento','data_nascita','nazionalita','docenti_preparatori','sezioni_ids','categorie_ids']
          : ['nome','cognome','specialita','email','telefono','data_nascita'];
        const fieldLabels = isCand
          ? [t('admin.candidato.field_nome'), t('admin.candidato.field_cognome'), t('admin.candidato.field_strumento'), t('admin.candidato.field_data_nascita'), t('admin.candidato.field_nazionalita'), t('admin.candidato.field_docenti'), t('admin.candidato.section_iscrizione'), 'Categorie']
          : [t('admin.candidato.field_nome'), t('admin.candidato.field_cognome'), t('admin.commissari.field_specialita'), t('admin.commissari.field_email'), t('admin.commissari.field_telefono'), t('admin.commissari.field_data_nascita')];
        const requiredFields = isCand ? ['nome','cognome','strumento','data_nascita','nazionalita'] : ['nome','cognome'];

        mappingFields.innerHTML = fieldNames.map((f, i) => {
          const detected = headerMap[f] !== undefined ? csvHeaders[headerMap[f]] : '';
          const req = requiredFields.includes(f);
          return `<label class="text-[10px]">
            <span class="text-slate-600">${req ? '• ' : ''}${escapeHtml(fieldLabels[i] || f)}${req ? ' *' : ''}</span>
            <select data-map="${f}" class="mt-0.5 w-full border border-slate-200 rounded-md px-1.5 py-1 text-[10px] bg-white">
              <option value="">${escapeHtml(t('admin.import.skip_col'))}</option>
              ${csvHeaders.map((h, hi) => `<option value="${hi}" ${String(hi) === String(headerMap[f]) ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
            </select>
          </label>`;
        }).join('');
        mappingWrap.classList.remove('hidden');
        previewWrap.classList.remove('hidden');
      });
    },
    onPrimary: async (body) => {
      // Ricostruisci mapping dal form (override manuale)
      const userMap = {};
      body.querySelectorAll('[data-map]').forEach(sel => {
        if (sel.value !== '') userMap[sel.dataset.map] = Number(sel.value);
      });
      if (Object.keys(userMap).length > 0 && csvHeaders.length > 0) {
        const sep = detectCsvSeparator((body.querySelector('[data-import-text]').value || '').trim());
        const allRows = parseCSV((body.querySelector('[data-import-text]').value || '').trim(), sep);
        if (allRows.length > 1) {
          parsed = allRows.slice(1).map((r, i) => ({
            ...buildImportRow(kind, userMap, r, concorso),
            rawIndex: i + 2,
          }));
        }
      }

      const valid = parsed.filter(p => p.errors.length === 0);
      if (valid.length === 0) {
        toast(t('admin.import.no_valid_rows'), 'error');
        return false;
      }
      const progress = body.querySelector('[data-import-progress]');
      const bar      = body.querySelector('[data-progress-bar]');
      const ptext    = body.querySelector('[data-progress-text]');
      progress.classList.remove('hidden');

      let ok = 0, ko = 0;
      for (let i = 0; i < valid.length; i++) {
        const p = valid[i];
        try {
          if (isCand) {
            await db.createCandidato({ concorso_id: concorso.id, ...p.data });
          } else {
            await db.createCommissario({ concorso_id: concorso.id, ...p.data });
          }
          ok++;
        } catch (e) {
          console.error('import row failed', p, e);
          ko++;
        }
        const pct = Math.round(((i + 1) / valid.length) * 100);
        bar.style.width = pct + '%';
        ptext.textContent = ko
          ? t('admin.import.progress_with_errors', { current: i + 1, total: valid.length, ok, ko })
          : t('admin.import.progress', { current: i + 1, total: valid.length, ok });
      }
      if (ko === 0) toast(t('admin.import.done_ok', { n: ok, kind: titleKind }), 'success');
      else toast(t('admin.import.done_partial', { ok, ko }), 'warn');
      if (onSaved) onSaved();
    },
  });
}
