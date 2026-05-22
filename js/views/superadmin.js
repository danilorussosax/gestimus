// Super-admin dashboard: KPI strip, ricerca/filtri/toggle vista, lista tenant
// (grid/table), action menu per-tenant, drawer dettaglio, configurazione globale.
//
// Backend: /api/platform/* (vedi server/src/routes/platform.ts).

import { api, ApiError } from '../api.js';
import { icon } from '../icons.js';
import { escapeHtml, fmtDate, fmtBytes, toast, modal, confirmDialog } from '../utils.js';
import { PIANI, PIANO_KEYS, getPianoOrDefault, pianoPriceLabel } from '../piani.js';

const state = {
  view: 'dashboard', // 'dashboard' | 'config'
  enti: [],
  enteStats: new Map(),
  enteSmtp: new Map(),
  filter: { stato: 'all', piano: 'all', search: '' },
  layout: 'grid', // 'grid' | 'table'
  sort: { col: 'nome', dir: 'asc' },
  config: null,
};

// ============================================================================
// Entry point
// ============================================================================

export function renderSuperadmin(root) {
  root.innerHTML = `
    <div class="bg-slate-50 min-h-screen view-fade">
      <!-- Top bar -->
      <header class="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-brand-600 text-white inline-flex items-center justify-center">
              ${icon('shield', { size: 16 })}
            </div>
            <div>
              <p class="text-[11px] uppercase tracking-wider text-ink-500 font-medium leading-none">Gestimus · Super-admin</p>
              <h1 class="text-base font-semibold text-ink-900 leading-tight">Piattaforma</h1>
            </div>
          </div>
          <nav class="flex items-center gap-1" id="sa-nav">
            ${navTab('dashboard', 'Dashboard', 'dashboard')}
            ${navTab('config', 'Configurazione', 'settings')}
          </nav>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-4 sm:px-6 py-6" id="sa-main">
        <div class="text-center py-20 text-ink-700 text-sm">Caricamento…</div>
      </main>
    </div>
  `;
  root.querySelectorAll('#sa-nav [data-tab]').forEach((b) => {
    b.addEventListener('click', () => switchView(root, b.dataset.tab));
  });
  switchView(root, state.view);
}

function navTab(key, label, iconName) {
  return `
    <button data-tab="${key}" class="sa-nav-btn inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md text-ink-700 hover:bg-slate-100 transition-colors">
      ${icon(iconName, { size: 14 })}<span>${label}</span>
    </button>
  `;
}

function switchView(root, view) {
  state.view = view;
  root.querySelectorAll('#sa-nav [data-tab]').forEach((b) => {
    const active = b.dataset.tab === view;
    b.classList.toggle('bg-brand-50', active);
    b.classList.toggle('text-brand-700', active);
    b.classList.toggle('text-ink-700', !active);
  });
  const main = root.querySelector('#sa-main');
  if (view === 'dashboard') return renderDashboard(main);
  if (view === 'config') return renderConfigPanel(main);
}

// ============================================================================
// DASHBOARD
// ============================================================================

async function renderDashboard(main) {
  main.innerHTML = `
    <div class="space-y-6">
      <!-- KPI strip placeholder -->
      <div id="sa-kpi" class="grid grid-cols-2 md:grid-cols-5 gap-3"></div>

      <!-- Toolbar -->
      <div class="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-3" id="sa-toolbar">
        <div class="relative flex-1 min-w-[200px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500">${icon('search', { size: 14 })}</span>
          <input id="sa-search" type="search" placeholder="Cerca per nome o slug…" class="c-input c-input--sm pl-9 w-full">
        </div>
        <select id="sa-stato-filter" class="c-input c-input--sm" title="Filtra per stato">
          <option value="all">Tutti gli stati</option>
          <option value="attivo">Attivi</option>
          <option value="sospeso">Sospesi</option>
          <option value="archiviato">Archiviati</option>
        </select>
        <select id="sa-piano-filter" class="c-input c-input--sm" title="Filtra per piano">
          <option value="all">Tutti i piani</option>
          ${PIANO_KEYS.map((k) => `<option value="${k}">${PIANI[k].nome}</option>`).join('')}
        </select>
        <div class="inline-flex border border-slate-200 rounded-md p-0.5 bg-slate-50" role="tablist">
          <button data-layout="grid" class="sa-layout-btn px-2.5 py-1 text-xs font-medium rounded inline-flex items-center gap-1.5 transition-colors" title="Vista griglia">
            ${icon('grid', { size: 12 })}<span>Grid</span>
          </button>
          <button data-layout="table" class="sa-layout-btn px-2.5 py-1 text-xs font-medium rounded inline-flex items-center gap-1.5 transition-colors" title="Vista tabella">
            ${icon('list', { size: 12 })}<span>Table</span>
          </button>
        </div>
        <button data-action="refresh" class="c-btn c-btn--ghost c-btn--sm" title="Ricarica">${icon('refresh', { size: 13 })}</button>
        <button data-action="new-ente" class="c-btn c-btn--primary c-btn--sm">
          ${icon('plus', { size: 13 })}<span>Nuovo ente</span>
        </button>
      </div>

      <!-- Lista -->
      <div id="sa-list"><div class="text-center py-10 text-ink-700 text-sm">Caricamento…</div></div>
    </div>
  `;

  // Wire toolbar
  const search = main.querySelector('#sa-search');
  search.value = state.filter.search;
  search.addEventListener('input', debounce((e) => { state.filter.search = e.target.value; renderList(main); }, 200));
  const stato = main.querySelector('#sa-stato-filter');
  stato.value = state.filter.stato;
  stato.addEventListener('change', (e) => { state.filter.stato = e.target.value; renderList(main); });
  const piano = main.querySelector('#sa-piano-filter');
  piano.value = state.filter.piano;
  piano.addEventListener('change', (e) => { state.filter.piano = e.target.value; renderList(main); });
  main.querySelectorAll('[data-layout]').forEach((b) => {
    b.addEventListener('click', () => { state.layout = b.dataset.layout; updateLayoutToggle(main); renderList(main); });
  });
  main.querySelector('[data-action="refresh"]').addEventListener('click', () => loadAll(main));
  main.querySelector('[data-action="new-ente"]').addEventListener('click', () => showNewEnteModal(main));
  updateLayoutToggle(main);

  await loadAll(main);
}

function updateLayoutToggle(main) {
  main.querySelectorAll('[data-layout]').forEach((b) => {
    const active = b.dataset.layout === state.layout;
    b.classList.toggle('bg-white', active);
    b.classList.toggle('shadow-sm', active);
    b.classList.toggle('text-ink-900', active);
    b.classList.toggle('text-ink-500', !active);
  });
}

async function loadAll(main) {
  try {
    state.enti = await api.get('/api/platform/tenants');
  } catch (err) {
    main.querySelector('#sa-list').innerHTML = errorBox('Caricamento enti fallito', err);
    return;
  }
  await Promise.all(state.enti.map(async (t) => {
    try {
      const [stats, smtp] = await Promise.all([
        api.get(`/api/platform/tenants/${t.id}/stats`),
        api.get(`/api/platform/tenants/${t.id}/smtp`),
      ]);
      state.enteStats.set(t.id, stats);
      state.enteSmtp.set(t.id, smtp);
    } catch { /* ignore */ }
  }));
  renderKPI(main);
  renderList(main);
}

// ============================================================================
// KPI strip
// ============================================================================

function renderKPI(main) {
  const tot = state.enti.length;
  const attivi = state.enti.filter((t) => t.stato === 'attivo').length;
  const sospesi = state.enti.filter((t) => t.stato === 'sospeso').length;
  const archiviati = state.enti.filter((t) => t.stato === 'archiviato').length;

  let totConcorsi = 0;
  let totIscrizioni = 0;
  let totDisk = 0;
  let revenue = 0;
  for (const t of state.enti) {
    const s = state.enteStats.get(t.id);
    if (s) {
      totConcorsi += s.concorsi || 0;
      totIscrizioni += s.iscrizioni || 0;
      totDisk += s.diskUsageBytes || 0;
    }
    if (t.stato === 'attivo' && !PIANI[t.piano]?.is_ppe) {
      revenue += PIANI[t.piano]?.prezzo_eur || 0;
    }
  }

  const kpi = main.querySelector('#sa-kpi');
  kpi.innerHTML = `
    ${kpiCard('Enti totali', tot, `${attivi} attivi · ${sospesi} sospesi · ${archiviati} archiviati`, 'building', 'brand')}
    ${kpiCard('Concorsi gestiti', totConcorsi, 'somma su tutti i tenant', 'trophy', 'amber')}
    ${kpiCard('Iscrizioni totali', totIscrizioni, 'tutte le edizioni', 'users', 'sky')}
    ${kpiCard('Storage uploads', fmtBytes(totDisk), 'allegati iscrizioni/foto', 'folder', 'slate')}
    ${kpiCard('Revenue stimato', '€' + revenue.toLocaleString('it-IT'), 'piani attivi/anno', 'star', 'emerald')}
  `;
}

function kpiCard(label, value, sub, iconName, accent) {
  const accents = {
    brand:   { iconBg: 'bg-brand-50',   iconText: 'text-brand-700',   border: 'border-brand-100' },
    amber:   { iconBg: 'bg-amber-50',   iconText: 'text-amber-700',   border: 'border-amber-100' },
    sky:     { iconBg: 'bg-sky-50',     iconText: 'text-sky-700',     border: 'border-sky-100' },
    slate:   { iconBg: 'bg-slate-100',  iconText: 'text-slate-700',   border: 'border-slate-200' },
    emerald: { iconBg: 'bg-emerald-50', iconText: 'text-emerald-700', border: 'border-emerald-100' },
  }[accent] ?? { iconBg: 'bg-slate-100', iconText: 'text-slate-700', border: 'border-slate-200' };
  return `
    <div class="bg-white border ${accents.border} rounded-xl p-3.5">
      <div class="flex items-start justify-between gap-2 mb-2">
        <p class="text-[11px] uppercase tracking-wide text-ink-500 font-medium">${escapeHtml(label)}</p>
        <div class="w-7 h-7 rounded-lg ${accents.iconBg} ${accents.iconText} inline-flex items-center justify-center">
          ${icon(iconName, { size: 14 })}
        </div>
      </div>
      <div class="text-xl font-bold text-ink-900 leading-tight">${escapeHtml(String(value))}</div>
      <p class="text-[11px] text-ink-500 mt-1 leading-tight">${escapeHtml(sub)}</p>
    </div>
  `;
}

// ============================================================================
// Filter + sort + render
// ============================================================================

function filterAndSort() {
  const q = state.filter.search.trim().toLowerCase();
  let list = state.enti.filter((t) => {
    if (state.filter.stato !== 'all' && t.stato !== state.filter.stato) return false;
    if (state.filter.piano !== 'all' && t.piano !== state.filter.piano) return false;
    if (q && !`${t.nome} ${t.slug}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const { col, dir } = state.sort;
  list.sort((a, b) => {
    const va = sortValue(a, col);
    const vb = sortValue(b, col);
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
  return list;
}

function sortValue(t, col) {
  switch (col) {
    case 'nome': return t.nome.toLowerCase();
    case 'slug': return t.slug;
    case 'stato': return t.stato;
    case 'piano': return t.piano;
    case 'concorsi': return state.enteStats.get(t.id)?.concorsi ?? 0;
    case 'iscrizioni': return state.enteStats.get(t.id)?.iscrizioni ?? 0;
    case 'storage': return state.enteStats.get(t.id)?.diskUsageBytes ?? 0;
    case 'createdAt': return new Date(t.createdAt).getTime();
    default: return '';
  }
}

function renderList(main) {
  const list = filterAndSort();
  const el = main.querySelector('#sa-list');
  if (list.length === 0) {
    el.innerHTML = emptyState();
    return;
  }
  el.innerHTML = state.layout === 'grid' ? gridLayout(list) : tableLayout(list);
  wireListActions(el, main);
}

function emptyState() {
  return `
    <div class="bg-white border-2 border-dashed border-slate-200 rounded-xl py-16 text-center">
      <div class="inline-flex w-12 h-12 rounded-full bg-slate-100 text-slate-500 items-center justify-center mb-3">${icon('search', { size: 20 })}</div>
      <p class="text-sm text-ink-700 font-medium">Nessun ente corrisponde ai filtri.</p>
      <p class="text-xs text-ink-500 mt-1">Prova a cambiare stato, piano o ricerca testuale.</p>
    </div>
  `;
}

// ============================================================================
// LAYOUT 1: Grid (cards ricche)
// ============================================================================

function gridLayout(list) {
  return `<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">${list.map(enteCard).join('')}</div>`;
}

function enteCard(t) {
  const piano = getPianoOrDefault(t.piano);
  const stats = state.enteStats.get(t.id);
  const smtp = state.enteSmtp.get(t.id);
  const isPlatform = t.slug === 'platform';

  const concorsiUsed = stats?.concorsi ?? 0;
  const iscrUsed = stats?.iscrizioni ?? 0;

  return `
    <article class="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow" data-ente-id="${t.id}">
      <header class="px-4 pt-4 pb-3 border-b border-slate-100">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <h3 class="text-[15px] font-semibold text-ink-900 truncate leading-tight">${escapeHtml(t.nome)}</h3>
            <p class="text-xs text-ink-500 mt-1 flex items-center gap-1.5">
              <code class="font-mono">${escapeHtml(t.slug)}</code>
              ${isPlatform ? '<span class="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-700 px-1.5 rounded">super-admin</span>' : ''}
            </p>
          </div>
          <div class="relative flex-shrink-0">
            <button data-action="menu" class="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" aria-label="Azioni" title="Azioni">${icon('more', { size: 16 })}</button>
            <div data-menu class="hidden absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1"></div>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-1.5 mt-3">
          ${statoBadge(t.stato)}
          ${pianoBadge(t.piano)}
          ${t.pianoScadenza ? `<span class="text-[11px] text-ink-500">scade ${fmtDate(t.pianoScadenza)}</span>` : ''}
        </div>
      </header>

      <div class="px-4 py-3 space-y-3">
        ${usageBar('Concorsi', concorsiUsed, piano.limit_concorsi)}
        ${usageBar('Iscrizioni / anno', iscrUsed, piano.limit_iscritti_annui)}
      </div>

      <div class="px-4 py-3 border-t border-slate-100 grid grid-cols-3 gap-2">
        ${statTile(stats?.commissari ?? '·', 'commissari')}
        ${statTile(stats?.candidati ?? '·', 'candidati')}
        ${statTile(stats?.accounts ?? '·', 'account')}
      </div>

      <footer class="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs">
        <span class="text-ink-700 inline-flex items-center gap-1.5">${icon('folder', { size: 12 })}<strong>${stats ? fmtBytes(stats.diskUsageBytes ?? 0) : '·'}</strong></span>
        <span class="text-ink-700 inline-flex items-center gap-1.5">
          ${smtp?.configured ? `<span class="inline-flex items-center gap-1 text-emerald-700">${icon('mail', { size: 12 })}SMTP</span>` : `<span class="text-ink-500">no SMTP</span>`}
          ${t.require2faAdmin ? `<span class="inline-flex items-center gap-1 text-indigo-700 ml-2">${icon('lock', { size: 12 })}2FA</span>` : ''}
        </span>
      </footer>

      ${t.stato === 'archiviato' ? `
        <div class="px-4 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-800 flex items-center gap-1.5">
          ${icon('clock', { size: 12 })} Cleanup ${cleanupCountdown(t)}
        </div>` : ''}
    </article>
  `;
}

// ============================================================================
// LAYOUT 2: Table (denser, sortable)
// ============================================================================

function tableLayout(list) {
  return `
    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-slate-50 border-b border-slate-200">
            <tr>
              ${sortHeader('nome', 'Ente')}
              ${sortHeader('stato', 'Stato')}
              ${sortHeader('piano', 'Piano')}
              ${sortHeader('concorsi', 'Concorsi', 'right')}
              ${sortHeader('iscrizioni', 'Iscrizioni', 'right')}
              ${sortHeader('storage', 'Storage', 'right')}
              ${sortHeader('createdAt', 'Creato', 'right')}
              <th class="px-3 py-2.5 text-right text-[11px] uppercase tracking-wide font-semibold text-ink-700">Azioni</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${list.map(tableRow).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function sortHeader(col, label, align = 'left') {
  const active = state.sort.col === col;
  const dir = active ? state.sort.dir : null;
  const arrow = dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '';
  return `
    <th class="px-3 py-2.5 text-${align} text-[11px] uppercase tracking-wide font-semibold text-ink-700 cursor-pointer select-none hover:bg-slate-100" data-sort="${col}">
      <span class="inline-flex items-center gap-1">${escapeHtml(label)} <span class="text-brand-600">${arrow}</span></span>
    </th>
  `;
}

function tableRow(t) {
  const piano = getPianoOrDefault(t.piano);
  const stats = state.enteStats.get(t.id);
  const concorsiUsed = stats?.concorsi ?? 0;
  return `
    <tr class="hover:bg-slate-50" data-ente-id="${t.id}">
      <td class="px-3 py-2.5">
        <div class="flex items-center gap-2 min-w-0">
          <div class="min-w-0">
            <div class="font-medium text-ink-900 truncate">${escapeHtml(t.nome)}</div>
            <code class="text-xs text-ink-500">${escapeHtml(t.slug)}</code>
          </div>
        </div>
      </td>
      <td class="px-3 py-2.5">${statoBadge(t.stato)}</td>
      <td class="px-3 py-2.5">${pianoBadge(t.piano)}</td>
      <td class="px-3 py-2.5 text-right">
        <div class="text-ink-900 font-medium">${concorsiUsed}${piano.limit_concorsi != null ? `<span class="text-ink-500 font-normal"> / ${piano.limit_concorsi}</span>` : ''}</div>
        ${miniBar(concorsiUsed, piano.limit_concorsi)}
      </td>
      <td class="px-3 py-2.5 text-right text-ink-900">${stats?.iscrizioni ?? '·'}</td>
      <td class="px-3 py-2.5 text-right text-ink-700">${stats ? fmtBytes(stats.diskUsageBytes ?? 0) : '·'}</td>
      <td class="px-3 py-2.5 text-right text-ink-700 text-xs">${fmtDate(t.createdAt)}</td>
      <td class="px-3 py-2.5 text-right">
        <div class="relative inline-block">
          <button data-action="menu" class="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" aria-label="Azioni" title="Azioni">${icon('more', { size: 16 })}</button>
          <div data-menu class="hidden absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1"></div>
        </div>
      </td>
    </tr>
  `;
}

function miniBar(used, limit) {
  if (limit == null) return '';
  const pct = limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const color = used > limit ? 'bg-rose-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return `<div class="h-1 bg-slate-200 rounded-full overflow-hidden mt-1 w-20 ml-auto"><div class="h-full ${color}" style="width:${pct}%"></div></div>`;
}

// ============================================================================
// Wire-up listeners (delegato a livello container)
// ============================================================================

function wireListActions(container, main) {
  // Sort headers (solo table)
  container.querySelectorAll('[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sort.col === col) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else state.sort = { col, dir: 'asc' };
      renderList(main);
    });
  });

  // Click su row/card → drawer dettaglio
  container.querySelectorAll('[data-ente-id]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      // Ignora se click su menu o suo dropdown
      if (ev.target.closest('[data-action="menu"]') || ev.target.closest('[data-menu]')) return;
      const id = el.dataset.enteId;
      const t = state.enti.find((x) => x.id === id);
      if (t) openDetailDrawer(t, main);
    });
  });

  // Action menu
  container.querySelectorAll('[data-action="menu"]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const wrapper = btn.parentElement;
      const menu = wrapper.querySelector('[data-menu]');
      const row = btn.closest('[data-ente-id]');
      const id = row.dataset.enteId;
      const t = state.enti.find((x) => x.id === id);
      // Chiudi altri menu aperti
      document.querySelectorAll('[data-menu]').forEach((m) => { if (m !== menu) m.classList.add('hidden'); });
      if (menu.classList.contains('hidden')) {
        menu.innerHTML = buildActionMenu(t);
        wireMenuItems(menu, t, main);
        menu.classList.remove('hidden');
      } else {
        menu.classList.add('hidden');
      }
    });
  });

  // Click outside chiude menu
  if (!container._docClickWired) {
    document.addEventListener('click', () => {
      document.querySelectorAll('[data-menu]:not(.hidden)').forEach((m) => m.classList.add('hidden'));
    });
    container._docClickWired = true;
  }
}

function buildActionMenu(t) {
  const items = [
    menuItem('detail', 'Dettaglio', 'eye'),
    menuItem('change-plan', 'Cambia piano', 'star'),
    menuItem('audit', 'Audit log', 'list'),
    menuItem('backup', 'Backup', 'download'),
    menuItem('smtp', 'Configurazione SMTP', 'mail'),
    menuItem('edit', 'Modifica meta', 'edit'),
  ];
  const isPlatform = t.slug === 'platform';
  if (!isPlatform) {
    items.push('<div class="border-t border-slate-100 my-1"></div>');
    if (t.stato === 'attivo') {
      items.push(menuItem('suspend', 'Sospendi', 'pause', 'amber'));
      items.push(menuItem('archive', 'Archivia', 'folder', 'rose'));
    } else if (t.stato === 'sospeso') {
      items.push(menuItem('reactivate', 'Riattiva', 'play', 'emerald'));
      items.push(menuItem('archive', 'Archivia', 'folder', 'rose'));
    } else if (t.stato === 'archiviato') {
      items.push(menuItem('restore', 'Ripristina', 'arrowLeft', 'emerald'));
      items.push(menuItem('hard-delete', 'Cancella subito', 'trash', 'rose'));
    }
  }
  return items.join('');
}

function menuItem(action, label, iconName, color) {
  const cls = color === 'rose' ? 'text-rose-700'
    : color === 'amber' ? 'text-amber-700'
    : color === 'emerald' ? 'text-emerald-700'
    : 'text-ink-900';
  return `<button data-menu-action="${action}" class="w-full px-3 py-1.5 text-sm text-left hover:bg-slate-50 inline-flex items-center gap-2 ${cls}">${icon(iconName, { size: 14 })}<span>${label}</span></button>`;
}

function wireMenuItems(menu, t, main) {
  const handlers = {
    'detail': () => openDetailDrawer(t, main),
    'change-plan': () => showChangePlanModal(t, main),
    'audit': () => showAuditForTenant(t),
    'backup': () => showBackupsForTenant(t, main),
    'smtp': () => showSmtpModal(t, main),
    'edit': () => showEditMetaModal(t, main),
    'suspend': () => lifecycleAction(t, 'suspend', 'Sospendere', main),
    'reactivate': () => lifecycleAction(t, 'reactivate', 'Riattivare', main),
    'archive': () => showArchiveModal(t, main),
    'restore': () => lifecycleAction(t, 'restore', 'Ripristinare', main),
    'hard-delete': () => showHardDeleteModal(t, main),
  };
  menu.querySelectorAll('[data-menu-action]').forEach((b) => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      menu.classList.add('hidden');
      handlers[b.dataset.menuAction]?.();
    });
  });
}

// ============================================================================
// Detail drawer (sliding panel a destra)
// ============================================================================

function openDetailDrawer(t, main) {
  closeDrawer();
  const piano = getPianoOrDefault(t.piano);
  const stats = state.enteStats.get(t.id);
  const smtp = state.enteSmtp.get(t.id);

  const drawer = document.createElement('div');
  drawer.id = 'sa-drawer';
  drawer.className = 'fixed inset-0 z-40 flex justify-end';
  drawer.innerHTML = `
    <div class="absolute inset-0 bg-slate-900/30" data-drawer-close></div>
    <aside class="relative w-full sm:max-w-md bg-white shadow-xl flex flex-col h-full">
      <header class="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-ink-500 mb-1">Dettaglio ente</p>
          <h2 class="text-lg font-semibold text-ink-900 truncate">${escapeHtml(t.nome)}</h2>
          <p class="text-xs text-ink-500 mt-0.5"><code>${escapeHtml(t.slug)}</code></p>
          <div class="flex flex-wrap gap-1.5 mt-2">
            ${statoBadge(t.stato)}
            ${pianoBadge(t.piano)}
            ${t.pianoScadenza ? `<span class="text-[11px] text-ink-700">scade ${fmtDate(t.pianoScadenza)}</span>` : ''}
          </div>
        </div>
        <button class="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" data-drawer-close aria-label="Chiudi">${icon('close', { size: 16 })}</button>
      </header>

      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <section>
          <h3 class="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Risorse</h3>
          <div class="space-y-3">
            ${usageBar('Concorsi', stats?.concorsi ?? 0, piano.limit_concorsi)}
            ${usageBar('Iscrizioni / anno', stats?.iscrizioni ?? 0, piano.limit_iscritti_annui)}
          </div>
          <div class="grid grid-cols-3 gap-2 mt-3">
            ${statTile(stats?.commissari ?? '·', 'commissari')}
            ${statTile(stats?.candidati ?? '·', 'candidati')}
            ${statTile(stats?.accounts ?? '·', 'account')}
          </div>
          <div class="flex items-center justify-between text-xs text-ink-700 mt-3 pt-3 border-t border-slate-100">
            <span class="inline-flex items-center gap-1.5">${icon('folder', { size: 12 })}Storage uploads</span>
            <strong class="text-ink-900">${stats ? fmtBytes(stats.diskUsageBytes ?? 0) : '·'}</strong>
          </div>
        </section>

        <section>
          <h3 class="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Configurazione</h3>
          <dl class="text-sm space-y-1.5">
            <div class="flex justify-between"><dt class="text-ink-700">Dominio custom</dt><dd>${t.dominio ? escapeHtml(t.dominio) : '<span class="text-ink-500 italic">—</span>'}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">Cleanup days</dt><dd>${t.cleanupAfterDays === 0 ? '<span class="italic">mai</span>' : t.cleanupAfterDays}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">2FA admin</dt><dd>${t.require2faAdmin ? 'richiesto' : 'opzionale'}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">SMTP</dt><dd>${smtp?.configured ? 'configurato' + (smtp.encrypted ? ' (cifrato)' : '') : '<span class="text-ink-500 italic">non configurato</span>'}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">Creato il</dt><dd>${fmtDate(t.createdAt)}</dd></div>
            ${t.stato === 'archiviato' ? `<div class="flex justify-between"><dt class="text-ink-700">Cleanup</dt><dd class="text-amber-700">${cleanupCountdown(t)}</dd></div>` : ''}
          </dl>
        </section>

        ${t.note ? `<section>
          <h3 class="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Note</h3>
          <p class="text-sm text-ink-700 whitespace-pre-wrap">${escapeHtml(t.note)}</p>
        </section>` : ''}
      </div>

      <footer class="border-t border-slate-200 px-5 py-3 bg-slate-50 flex flex-wrap gap-2">
        <button data-drawer-act="audit" class="c-btn c-btn--ghost c-btn--sm">${icon('list', { size: 13 })}<span>Audit</span></button>
        <button data-drawer-act="backup" class="c-btn c-btn--ghost c-btn--sm">${icon('download', { size: 13 })}<span>Backup</span></button>
        <button data-drawer-act="smtp" class="c-btn c-btn--ghost c-btn--sm">${icon('mail', { size: 13 })}<span>SMTP</span></button>
        <button data-drawer-act="edit" class="c-btn c-btn--primary c-btn--sm ml-auto">${icon('edit', { size: 13 })}<span>Modifica</span></button>
      </footer>
    </aside>
  `;
  document.body.appendChild(drawer);
  document.body.classList.add('overflow-hidden');

  drawer.querySelectorAll('[data-drawer-close]').forEach((el) => el.addEventListener('click', closeDrawer));
  drawer.querySelector('[data-drawer-act="audit"]').addEventListener('click', () => { closeDrawer(); showAuditForTenant(t); });
  drawer.querySelector('[data-drawer-act="backup"]').addEventListener('click', () => { closeDrawer(); showBackupsForTenant(t, main); });
  drawer.querySelector('[data-drawer-act="smtp"]').addEventListener('click', () => { closeDrawer(); showSmtpModal(t, main); });
  drawer.querySelector('[data-drawer-act="edit"]').addEventListener('click', () => { closeDrawer(); showEditMetaModal(t, main); });
}

function closeDrawer() {
  const el = document.getElementById('sa-drawer');
  if (el) el.remove();
  document.body.classList.remove('overflow-hidden');
}

// ============================================================================
// Helpers UI: badge, usage bar, stat tile, countdown
// ============================================================================

function statoBadge(s) {
  const map = {
    attivo: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    sospeso: 'bg-amber-50 text-amber-700 ring-amber-200',
    archiviato: 'bg-rose-50 text-rose-700 ring-rose-200',
  };
  const dot = s === 'attivo' ? 'bg-emerald-500' : s === 'sospeso' ? 'bg-amber-500' : 'bg-rose-500';
  return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${map[s] ?? 'bg-slate-50 text-slate-700 ring-slate-200'}"><span class="w-1.5 h-1.5 rounded-full ${dot}"></span>${escapeHtml(s)}</span>`;
}

function pianoBadge(key) {
  const p = getPianoOrDefault(key);
  const colors = {
    sky: 'bg-sky-50 text-sky-700 ring-sky-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    brand: 'bg-brand-50 text-brand-700 ring-brand-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  };
  const cls = colors[p.badge_color] ?? 'bg-slate-100 text-slate-700 ring-slate-200';
  return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ring-1 ${cls}" title="${escapeHtml(p.nome)} — ${escapeHtml(pianoPriceLabel(key))}">${escapeHtml(p.nome)}</span>`;
}

function usageBar(label, used, limit) {
  const pct = limit == null ? null : limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const overLimit = limit != null && used > limit;
  const barColor = overLimit ? 'bg-rose-500' : pct != null && pct > 80 ? 'bg-amber-500' : 'bg-emerald-500';
  const text = limit == null
    ? `<strong>${used}</strong> <span class="text-ink-500 font-normal">illimitato</span>`
    : `<strong class="${overLimit ? 'text-rose-700' : ''}">${used}</strong><span class="text-ink-500 font-normal"> / ${limit}</span>`;
  return `
    <div>
      <div class="flex items-center justify-between text-xs mb-1">
        <span class="text-ink-700">${escapeHtml(label)}</span>
        <span class="font-medium">${text}</span>
      </div>
      <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div class="h-full ${barColor} transition-all duration-300" style="width:${pct == null ? 0 : pct}%"></div>
      </div>
    </div>
  `;
}

function statTile(value, label) {
  return `
    <div class="text-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-2">
      <div class="text-sm font-semibold text-ink-900 leading-none">${value}</div>
      <div class="text-[10px] text-ink-500 uppercase tracking-wide mt-1">${label}</div>
    </div>
  `;
}

function cleanupCountdown(t) {
  if (!t.cleanupScheduledAt) return 'mai';
  const ms = new Date(t.cleanupScheduledAt).getTime() - Date.now();
  if (ms <= 0) return 'scaduto (in attesa job)';
  const days = Math.ceil(ms / 86400_000);
  return `tra ${days} ${days === 1 ? 'giorno' : 'giorni'}`;
}

function debounce(fn, ms) {
  let h;
  return (...args) => { clearTimeout(h); h = setTimeout(() => fn(...args), ms); };
}

// ============================================================================
// AUDIT, BACKUP, SMTP, LIFECYCLE, EDIT, NEW (modali)
// ============================================================================

async function showAuditForTenant(t) {
  let rows = [];
  try {
    rows = await api.get('/api/platform/audit', { tenantId: t.id, limit: 100 });
  } catch (err) {
    toast(`Errore audit: ${err.message}`, 'error');
    return;
  }
  modal({
    title: `Audit log — ${t.nome}`,
    wide: true,
    primaryLabel: null,
    contentHtml: rows.length === 0 ? '<p class="text-sm text-ink-700 italic">Nessuna riga di audit per questo tenant.</p>' : `
      <div class="overflow-x-auto max-h-[60vh]">
        <table class="min-w-full text-xs">
          <thead class="bg-slate-50 text-left sticky top-0">
            <tr>
              <th class="px-3 py-2">Quando</th>
              <th class="px-3 py-2">Action</th>
              <th class="px-3 py-2">Payload</th>
              <th class="px-3 py-2">IP</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${rows.map((r) => `
              <tr>
                <td class="px-3 py-2 whitespace-nowrap text-ink-700">${fmtDate(r.createdAt)}</td>
                <td class="px-3 py-2"><code>${escapeHtml(r.action)}</code></td>
                <td class="px-3 py-2"><pre class="text-xs whitespace-pre-wrap max-w-md overflow-hidden">${r.payload ? escapeHtml(JSON.stringify(r.payload)) : ''}</pre></td>
                <td class="px-3 py-2 text-ink-700">${escapeHtml(r.ip ?? '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `,
  });
}

async function showBackupsForTenant(t, main) {
  let all = [];
  try {
    all = await api.get('/api/platform/backups');
  } catch (err) {
    toast(`Errore backup: ${err.message}`, 'error');
    return;
  }
  const rows = all.filter((b) => b.tenantSlug === t.slug);
  modal({
    title: `Backup — ${t.nome}`,
    wide: true,
    primaryLabel: null,
    contentHtml: `
      <div class="mb-3 flex items-center justify-between">
        <p class="text-sm text-ink-700">Dump pre-cancellazione (JSON gzipped). Retention: <code>BACKUP_RETENTION_DAYS</code> (default 90gg).</p>
        ${t.stato === 'archiviato' ? `<button data-action="run-cleanup" class="c-btn c-btn--ghost c-btn--sm">${icon('refresh', { size: 13 })}<span>Esegui cleanup ora</span></button>` : ''}
      </div>
      ${rows.length === 0 ? '<p class="text-sm text-ink-700 italic">Nessun backup per questo tenant.</p>' : `
        <div class="overflow-x-auto max-h-[60vh]">
          <table class="min-w-full text-sm">
            <thead class="bg-slate-50 text-left sticky top-0">
              <tr>
                <th class="px-3 py-2">File</th>
                <th class="px-3 py-2">Size</th>
                <th class="px-3 py-2">Modificato</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${rows.map((b) => `
                <tr>
                  <td class="px-3 py-2"><code class="text-xs">${escapeHtml(b.filename)}</code></td>
                  <td class="px-3 py-2 text-ink-700">${fmtBytes(b.sizeBytes)}</td>
                  <td class="px-3 py-2 text-ink-700">${fmtDate(b.modifiedAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `,
    onMount: (modalRoot) => {
      const btn = modalRoot.querySelector('[data-action="run-cleanup"]');
      if (btn) btn.addEventListener('click', () => runCleanupManual(main));
    },
  });
}

async function runCleanupManual(main) {
  if (!confirm("Eseguire ora il job di cleanup? Verranno hard-deletati i tenant archiviati con cleanup_scheduled_at scaduto.")) return;
  try {
    const r = await api.post('/api/platform/jobs/cleanup-tenants');
    toast(`Job: candidati=${r.candidatesFound}, eliminati=${r.deleted}, backup=${r.backedUp}, errori=${r.errors.length}`, 'success', 6000);
    closeAllModals();
    await loadAll(main);
  } catch (err) {
    toast(`Errore: ${err.message}`, 'error');
  }
}

function showSmtpModal(t, main) {
  const current = state.enteSmtp.get(t.id);
  modal({
    title: `SMTP — ${t.nome}`,
    contentHtml: `
      <p class="text-sm text-ink-700 mb-3">Stato: <strong>${current?.configured ? 'configurato' + (current.encrypted ? ' (cifrato)' : '') : 'non configurato'}</strong>. La password è cifrata AES-GCM at-rest.</p>
      <div class="space-y-2">
        <div class="grid gap-2 sm:grid-cols-2">
          <div>
            <label class="text-sm font-medium">Host</label>
            <input id="smtp-host" class="c-input" placeholder="smtp.example.com">
          </div>
          <div>
            <label class="text-sm font-medium">Port</label>
            <input id="smtp-port" type="number" class="c-input" value="587">
          </div>
        </div>
        <div><label class="text-sm font-medium">User</label><input id="smtp-user" class="c-input"></div>
        <div><label class="text-sm font-medium">Password</label><input id="smtp-pass" type="password" class="c-input"></div>
        <div><label class="text-sm font-medium">From</label><input id="smtp-from" class="c-input" placeholder='es. "Gestimus" <noreply@ente.it>'></div>
        <label class="inline-flex items-center gap-2 text-sm mt-1">
          <input id="smtp-secure" type="checkbox"><span>Connessione SSL/TLS implicita (porta 465)</span>
        </label>
        ${current?.configured ? `
          <div class="pt-2 border-t border-slate-200">
            <button data-action="smtp-clear" class="c-btn c-btn--ghost c-btn--sm text-rose-700">${icon('trash', { size: 13 })}<span>Rimuovi configurazione attuale</span></button>
          </div>` : ''}
      </div>
    `,
    primaryLabel: 'Salva',
    onMount: (modalRoot) => {
      const clear = modalRoot.querySelector('[data-action="smtp-clear"]');
      if (clear) clear.addEventListener('click', () => deleteTenantSmtp(t, main));
    },
    onPrimary: async () => {
      const body = {
        host: document.getElementById('smtp-host').value.trim(),
        port: Number(document.getElementById('smtp-port').value),
        user: document.getElementById('smtp-user').value.trim(),
        password: document.getElementById('smtp-pass').value,
        from: document.getElementById('smtp-from').value.trim(),
        secure: document.getElementById('smtp-secure').checked,
      };
      if (!body.host || !body.user || !body.password || !body.from) {
        toast('Compila host, user, password e from', 'error');
        return;
      }
      try {
        await api.put(`/api/platform/tenants/${t.id}/smtp`, body);
        toast('SMTP salvato', 'success');
        closeAllModals();
        await loadAll(main);
      } catch (err) {
        toast(`Errore: ${err.message}`, 'error');
      }
    },
  });
}

async function deleteTenantSmtp(t, main) {
  if (!confirm(`Rimuovere la configurazione SMTP di ${t.nome}?`)) return;
  try {
    await api.delete(`/api/platform/tenants/${t.id}/smtp`);
    toast('SMTP rimosso', 'success');
    closeAllModals();
    await loadAll(main);
  } catch (err) {
    toast(`Errore: ${err.message}`, 'error');
  }
}

async function lifecycleAction(t, op, verb, main) {
  if (!confirm(`${verb} ente "${t.nome}"?`)) return;
  try {
    await api.post(`/api/platform/tenants/${t.id}/${op}`);
    toast(`${verb}: operazione eseguita`, 'success');
    await loadAll(main);
  } catch (err) {
    toast(`Errore: ${err.message}`, 'error');
  }
}

function showArchiveModal(t, main) {
  modal({
    title: `Archivia ${t.nome}`,
    contentHtml: `
      <p class="text-sm text-ink-700 mb-3">L'ente verrà disattivato. Il cleanup automatico cancellerà i dati dopo i giorni indicati. <strong>0 = mai</strong>.</p>
      <label class="text-sm font-medium block mb-1">Giorni prima del cleanup:</label>
      <input type="number" id="archive-days" class="c-input" min="0" max="3650" value="${t.cleanupAfterDays}">
    `,
    primaryLabel: 'Archivia',
    onPrimary: async () => {
      const days = Number(document.getElementById('archive-days').value);
      try {
        await api.post(`/api/platform/tenants/${t.id}/archive`, { cleanupAfterDays: days });
        toast('Ente archiviato', 'success');
        closeAllModals();
        await loadAll(main);
      } catch (err) {
        toast(`Errore: ${err.message}`, 'error');
      }
    },
  });
}

function showHardDeleteModal(t, main) {
  confirmDialog({
    title: `Cancella definitivamente ${t.nome}`,
    message: `<strong>Operazione irreversibile.</strong> Verranno cancellati tutti i dati del tenant (concorsi, valutazioni, iscrizioni, account, audit log).`,
    danger: true,
    onConfirm: async () => {
      const input = prompt(`Per sicurezza, digita lo slug: ${t.slug}`);
      if (input !== t.slug) {
        toast('Slug non corretto: annullato', 'info');
        return;
      }
      try {
        await api.delete(`/api/platform/tenants/${t.id}`);
        toast('Ente eliminato', 'success');
        closeAllModals();
        await loadAll(main);
      } catch (err) {
        toast(`Errore: ${err.message}`, 'error');
      }
    },
  });
}

// ============================================================================
// CAMBIA PIANO (modale dedicata)
// ============================================================================

async function showChangePlanModal(t, main) {
  let override = null;
  try {
    override = await api.get(`/api/platform/tenants/${t.id}/config`);
  } catch { /* nessun override esistente, ok */ }

  const planOpts = PIANO_KEYS.map((k) => `<option value="${k}" ${t.piano === k ? 'selected' : ''}>${PIANI[k].nome}${k === t.piano ? ' (attuale)' : ''}</option>`).join('');
  const currentPiano = getPianoOrDefault(t.piano);

  modal({
    title: `Cambia piano — ${t.nome}`,
    wide: true,
    primaryLabel: 'Conferma cambio piano',
    contentHtml: `
      <div class="space-y-5">
        <!-- Piano attuale -->
        <section class="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-[11px] uppercase tracking-wide font-semibold text-ink-500">Piano attualmente attivo</h3>
            ${pianoBadge(t.piano)}
          </div>
          <div class="grid sm:grid-cols-2 gap-3 text-sm">
            <div><span class="text-ink-700">Prezzo:</span> <strong>${escapeHtml(pianoPriceLabel(t.piano))}</strong></div>
            <div><span class="text-ink-700">Scadenza:</span> <strong>${t.pianoScadenza ? escapeHtml(fmtDate(t.pianoScadenza)) : '<em class="font-normal text-ink-500">non impostata</em>'}</strong></div>
            <div><span class="text-ink-700">Limite concorsi:</span> <strong>${planLimitDisplay(currentPiano.limit_concorsi)}</strong></div>
            <div><span class="text-ink-700">Limite iscrizioni/anno:</span> <strong>${planLimitDisplay(currentPiano.limit_iscritti_annui)}</strong></div>
          </div>
          ${override && (override.maxConcorsi != null || override.maxCommissari != null || override.maxCandidatiPerConcorso != null) ? `
            <div class="mt-3 pt-3 border-t border-slate-200">
              <p class="text-xs font-semibold text-amber-700 mb-1">Override per-tenant attivi:</p>
              <ul class="text-xs text-ink-700 space-y-0.5">
                ${override.maxConcorsi != null ? `<li>maxConcorsi = ${override.maxConcorsi}</li>` : ''}
                ${override.maxCommissari != null ? `<li>maxCommissari = ${override.maxCommissari}</li>` : ''}
                ${override.maxCandidatiPerConcorso != null ? `<li>maxCandidatiPerConcorso = ${override.maxCandidatiPerConcorso}</li>` : ''}
              </ul>
            </div>` : ''}
        </section>

        <!-- Nuovo piano -->
        <section>
          <h3 class="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Nuovo piano</h3>
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="text-sm font-medium block mb-1">Piano</label>
              <select id="cp-piano" class="c-input">${planOpts}</select>
            </div>
            <div>
              <label class="text-sm font-medium block mb-1">Scadenza piano</label>
              <input id="cp-scadenza" type="date" class="c-input" value="${t.pianoScadenza ?? ''}">
              <p class="text-xs text-ink-500 mt-1">Lascia vuoto se non scade.</p>
            </div>
          </div>
          <div id="cp-preview" class="mt-3 bg-brand-50 border border-brand-100 rounded-lg p-3 text-sm"></div>
        </section>

        <!-- Override limiti -->
        <section>
          <h3 class="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Override limiti per-tenant (opzionale)</h3>
          <p class="text-xs text-ink-700 mb-3">Imposta un override solo se vuoi forzare un limite diverso da quello di default del piano. Lascia vuoto per ereditare il piano.</p>
          <div class="grid gap-3 sm:grid-cols-3">
            <div>
              <label class="text-xs font-medium block mb-1">maxConcorsi</label>
              <input id="cp-max-concorsi" type="number" min="0" class="c-input c-input--sm" placeholder="usa piano" value="${override?.maxConcorsi ?? ''}">
            </div>
            <div>
              <label class="text-xs font-medium block mb-1">maxCommissari</label>
              <input id="cp-max-commissari" type="number" min="0" class="c-input c-input--sm" placeholder="usa piano" value="${override?.maxCommissari ?? ''}">
            </div>
            <div>
              <label class="text-xs font-medium block mb-1">maxCandidatiPerConcorso</label>
              <input id="cp-max-candidati" type="number" min="0" class="c-input c-input--sm" placeholder="usa piano" value="${override?.maxCandidatiPerConcorso ?? ''}">
            </div>
          </div>
        </section>
      </div>
    `,
    onMount: (modalRoot) => {
      const sel = modalRoot.querySelector('#cp-piano');
      const preview = modalRoot.querySelector('#cp-preview');
      const refreshPreview = () => {
        const p = getPianoOrDefault(sel.value);
        const changed = sel.value !== t.piano;
        preview.innerHTML = `
          <div class="flex items-center gap-2 mb-2">
            <strong>${escapeHtml(p.nome)}</strong>
            <span class="text-ink-700">·</span>
            <span>${escapeHtml(pianoPriceLabel(sel.value))}</span>
            ${changed ? '<span class="ml-auto text-xs text-emerald-700 font-medium">↑ cambio</span>' : '<span class="ml-auto text-xs text-ink-500">nessun cambio</span>'}
          </div>
          <p class="text-xs text-ink-700 mb-2">${escapeHtml(p.descrizione)}</p>
          <ul class="text-xs text-ink-900 grid sm:grid-cols-2 gap-1">
            <li>📊 Concorsi: <strong>${planLimitDisplay(p.limit_concorsi)}</strong></li>
            <li>👥 Iscrizioni/anno: <strong>${planLimitDisplay(p.limit_iscritti_annui)}</strong></li>
            <li>⏱ Durata: <strong>${p.durata_giorni == null ? 'pay-as-you-go' : p.durata_giorni + ' giorni'}</strong></li>
            ${p.is_ppe ? `<li>💶 PPE: €${p.ppe_setup_per_concorso}/concorso + €${p.ppe_per_iscritto}/iscritto</li>` : ''}
          </ul>
        `;
      };
      sel.addEventListener('change', refreshPreview);
      refreshPreview();
    },
    onPrimary: async () => {
      const piano = document.getElementById('cp-piano').value;
      const scadenza = document.getElementById('cp-scadenza').value || null;
      const parseOpt = (id) => {
        const v = document.getElementById(id).value.trim();
        return v === '' ? null : Number(v);
      };
      const body = {
        piano,
        pianoScadenza: scadenza,
        overrides: {
          maxConcorsi: parseOpt('cp-max-concorsi'),
          maxCommissari: parseOpt('cp-max-commissari'),
          maxCandidatiPerConcorso: parseOpt('cp-max-candidati'),
        },
      };
      try {
        await api.post(`/api/platform/tenants/${t.id}/change-plan`, body);
        toast(`Piano aggiornato: ${piano}`, 'success');
        closeAllModals();
        await loadAll(main);
      } catch (err) {
        toast(`Errore: ${err.message}`, 'error');
      }
    },
  });
}

function planLimitDisplay(v) {
  if (v == null) return '<em class="font-normal text-ink-500">illimitato</em>';
  return v;
}

function showEditMetaModal(t, main) {
  const planOpts = PIANO_KEYS.map((k) => `<option value="${k}" ${t.piano === k ? 'selected' : ''}>${PIANI[k].nome} (${pianoPriceLabel(k)})</option>`).join('');
  modal({
    title: `Modifica ${t.nome}`,
    contentHtml: `
      <div class="space-y-3">
        <div><label class="text-sm font-medium">Nome ente</label><input id="em-nome" class="c-input" value="${escapeHtml(t.nome)}"></div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div><label class="text-sm font-medium">Piano</label><select id="em-piano" class="c-input">${planOpts}</select></div>
          <div><label class="text-sm font-medium">Scadenza piano</label><input id="em-piano-scadenza" type="date" class="c-input" value="${t.pianoScadenza ?? ''}"></div>
        </div>
        <div><label class="text-sm font-medium">Dominio custom</label><input id="em-dominio" class="c-input" value="${escapeHtml(t.dominio ?? '')}" placeholder="es. ente1.gestimus.it"></div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div><label class="text-sm font-medium">Cleanup days (0 = mai)</label><input id="em-cleanup-days" type="number" class="c-input" min="0" max="3650" value="${t.cleanupAfterDays}"></div>
          <div>
            <label class="text-sm font-medium block">2FA admin</label>
            <label class="inline-flex items-center gap-2 mt-2">
              <input id="em-2fa" type="checkbox" ${t.require2faAdmin ? 'checked' : ''}><span class="text-sm">Richiesto per gli admin</span>
            </label>
          </div>
        </div>
        <div><label class="text-sm font-medium">Note</label><textarea id="em-note" class="c-input" rows="3">${escapeHtml(t.note ?? '')}</textarea></div>
      </div>
    `,
    primaryLabel: 'Salva',
    onPrimary: async () => {
      const body = {
        nome: document.getElementById('em-nome').value.trim(),
        piano: document.getElementById('em-piano').value,
        pianoScadenza: document.getElementById('em-piano-scadenza').value || null,
        dominio: document.getElementById('em-dominio').value.trim() || null,
        cleanupAfterDays: Number(document.getElementById('em-cleanup-days').value),
        require2faAdmin: document.getElementById('em-2fa').checked,
        note: document.getElementById('em-note').value.trim() || null,
      };
      try {
        await api.patch(`/api/platform/tenants/${t.id}`, body);
        toast('Modifiche salvate', 'success');
        closeAllModals();
        await loadAll(main);
      } catch (err) {
        toast(`Errore: ${err.message}`, 'error');
      }
    },
  });
}

function showNewEnteModal(main) {
  const planOpts = PIANO_KEYS.map((k) => `<option value="${k}" ${k === 'trial' ? 'selected' : ''}>${PIANI[k].nome} (${pianoPriceLabel(k)})</option>`).join('');
  modal({
    title: 'Nuovo ente',
    contentHtml: `
      <div class="space-y-3">
        <div class="grid gap-2 sm:grid-cols-2">
          <div>
            <label class="text-sm font-medium">Slug (sottodominio)</label>
            <input id="ne-slug" class="c-input" placeholder="es. conservatorio-milano">
            <p class="text-xs text-ink-700 mt-1">kebab-case, 2-63 caratteri</p>
          </div>
          <div>
            <label class="text-sm font-medium">Nome ente</label>
            <input id="ne-nome" class="c-input" placeholder="es. Conservatorio Verdi">
          </div>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div><label class="text-sm font-medium">Piano</label><select id="ne-piano" class="c-input">${planOpts}</select></div>
          <div><label class="text-sm font-medium">Cleanup days post-archiviazione</label><input id="ne-cleanup" type="number" class="c-input" min="0" max="3650" value="30"></div>
        </div>
        <hr class="border-slate-200">
        <p class="text-sm font-semibold text-ink-900">Primo amministratore</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <div><label class="text-sm font-medium">Email admin</label><input id="ne-admin-email" type="email" class="c-input"></div>
          <div>
            <label class="text-sm font-medium">Password (≥ 8 caratteri)</label>
            <input id="ne-admin-pass" type="text" class="c-input" value="${escapeHtml(genPassword())}">
          </div>
        </div>
      </div>
    `,
    primaryLabel: 'Crea ente',
    onPrimary: async () => {
      const body = {
        slug: document.getElementById('ne-slug').value.trim().toLowerCase(),
        nome: document.getElementById('ne-nome').value.trim(),
        piano: document.getElementById('ne-piano').value,
        cleanupAfterDays: Number(document.getElementById('ne-cleanup').value),
        adminEmail: document.getElementById('ne-admin-email').value.trim().toLowerCase(),
        adminPassword: document.getElementById('ne-admin-pass').value,
      };
      if (!body.slug || !body.nome || !body.adminEmail || !body.adminPassword) {
        toast('Compila tutti i campi obbligatori', 'error');
        return;
      }
      try {
        await api.post('/api/platform/tenants', body);
        toast(`Ente "${body.slug}" creato`, 'success');
        closeAllModals();
        await loadAll(main);
      } catch (err) {
        toast(`Errore: ${err.message}`, 'error');
      }
    },
  });
}

function genPassword(len = 14) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@$%&*';
  let out = '';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}

// ============================================================================
// CONFIG PIATTAFORMA
// ============================================================================

async function renderConfigPanel(main) {
  main.innerHTML = `<div class="text-center py-10 text-ink-700 text-sm">Caricamento…</div>`;
  try {
    state.config = await api.get('/api/platform/config');
  } catch (err) {
    main.innerHTML = errorBox('Caricamento config fallito', err);
    return;
  }
  const c = state.config ?? { defaultCleanupDays: 30, require2faSuperadmin: false };
  main.innerHTML = `
    <div class="max-w-2xl">
      <h2 class="text-lg font-semibold text-ink-900 mb-1">Configurazione piattaforma</h2>
      <p class="text-sm text-ink-700 mb-5">Impostazioni globali applicate a tutti i tenant.</p>
      <div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <label class="text-sm font-medium text-ink-900">Default cleanup days</label>
          <input id="cfg-cleanup" type="number" class="c-input mt-1" min="0" max="3650" value="${c.defaultCleanupDays}">
          <p class="text-xs text-ink-700 mt-1.5">Giorni di default tra archiviazione e hard-delete (0 = mai). Override per-tenant disponibile da "Modifica ente".</p>
        </div>
        <div class="pt-3 border-t border-slate-100">
          <label class="inline-flex items-center gap-2 text-sm font-medium text-ink-900">
            <input id="cfg-2fa" type="checkbox" ${c.require2faSuperadmin ? 'checked' : ''}>
            <span>Richiedi 2FA TOTP a tutti i super-admin</span>
          </label>
          <p class="text-xs text-ink-700 mt-1 ml-6">Al prossimo login gli account super-admin saranno forzati al setup TOTP.</p>
        </div>
        <div class="pt-3 border-t border-slate-100">
          <button data-action="cfg-save" class="c-btn c-btn--primary c-btn--sm">${icon('check', { size: 14 })}<span>Salva configurazione</span></button>
        </div>
      </div>
    </div>
  `;
  main.querySelector('[data-action="cfg-save"]').addEventListener('click', async () => {
    const body = {
      defaultCleanupDays: Number(document.getElementById('cfg-cleanup').value),
      require2faSuperadmin: document.getElementById('cfg-2fa').checked,
    };
    try {
      await api.patch('/api/platform/config', body);
      toast('Configurazione salvata', 'success');
    } catch (err) {
      toast(`Errore: ${err.message}`, 'error');
    }
  });
}

// ============================================================================
// Helpers comuni
// ============================================================================

function errorBox(title, err) {
  const detail = err instanceof ApiError ? `${err.status} — ${err.body?.error || err.message}` : err.message || String(err);
  return `<div class="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900"><h3 class="font-bold">${escapeHtml(title)}</h3><p class="text-sm mt-1">${escapeHtml(detail)}</p></div>`;
}

function closeAllModals() {
  document.querySelectorAll('.c-modal-backdrop, [data-modal-backdrop]').forEach((el) => el.remove());
  document.body.classList.remove('overflow-hidden');
}
