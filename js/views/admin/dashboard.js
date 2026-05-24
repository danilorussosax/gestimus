// Tab "Dashboard" del pannello Admin: panoramica del concorso + accesso
// rapido alle voci della sidebar (cards cliccabili che replicano la nav).

import { db } from '../../db.js';
import { escapeHtml, displayName } from '../../utils.js';
import { icon } from '../../icons.js';
import { t } from '../../i18n.js';
import { setAdminTab } from '../admin.js';

// Definizione "single source of truth" delle sezioni del concorso. Usata
// sia dalla sidebar di admin.js, sia dalla dashboard qui sotto come griglia
// di cards riassuntive. Modificando questa lista, entrambe si aggiornano.
export const SIDEBAR_TABS = [
  { id: 'sezioni',     iconName: 'folder',     labelKey: 'admin.nav.sezioni',     descKey: 'admin.dashboard.card.sezioni_desc',     count: (c) => db.sezioniByConcorso(c.id).length },
  { id: 'commissari',  iconName: 'judge',      labelKey: 'admin.nav.commissari',  descKey: 'admin.dashboard.card.commissari_desc',  count: (c) => db.commissariByConcorso(c.id).length },
  { id: 'commissioni', iconName: 'scale',      labelKey: 'admin.nav.commissioni', descKey: 'admin.dashboard.card.commissioni_desc', count: (c) => db.commissioniByConcorso(c.id).length },
  { id: 'fasi',        iconName: 'flag',       labelKey: 'admin.nav.fasi',        descKey: 'admin.dashboard.card.fasi_desc',        count: (c) => db.fasiByConcorso(c.id).length },
  { id: 'calendario',  iconName: 'calendar',   labelKey: 'admin.nav.calendario',  descKey: 'admin.dashboard.card.calendario_desc',  count: (c) => db.eventiByConcorso(c.id).length },
  { id: 'iscrizioni',  iconName: 'user',       labelKey: 'admin.nav.iscrizioni',  descKey: 'admin.dashboard.card.iscrizioni_desc',  count: () => null },
  { id: 'candidati',   iconName: 'graduation', labelKey: 'admin.nav.candidati',   descKey: 'admin.dashboard.card.candidati_desc',   count: (c) => db.candidatiByConcorso(c.id).length },
  { id: 'risultati',   iconName: 'trophy',     labelKey: 'admin.nav.risultati',   descKey: 'admin.dashboard.card.risultati_desc',   count: () => null },
  { id: 'audit',       iconName: 'shield',     labelKey: 'admin.nav.audit',       descKey: 'admin.dashboard.card.audit_desc',       count: () => null },
  { id: 'impostazioni-concorso', iconName: 'settings', labelKey: 'admin.nav.impostazioni_concorso', descKey: 'admin.dashboard.card.impostazioni_concorso_desc', count: () => null },
];

export function renderDashboard(root, concorso) {
  // Il "presidente del concorso" non esiste più come concetto unitario nel
  // nuovo modello (ogni commissione ha il suo). Manteniamo solo il banner di
  // warning quando NESSUNA commissione del concorso ha un presidente: la card
  // KPI dedicata è stata rimossa.
  const presidentiInfo = db.presidentiFor(concorso.id);
  const hasAnyPresidente = presidentiInfo.length > 0;
  const fasi = db.fasiByConcorso(concorso.id);
  const fasiConcluse = fasi.filter((f) => f.stato === 'CONCLUSA').length;
  const fasiInCorso = fasi.filter((f) => f.stato === 'IN_CORSO').length;
  const candidati = db.candidatiByConcorso(concorso.id);
  const commissari = db.commissariByConcorso(concorso.id);
  const s = db.state;

  // Distribuzione strumenti (top 8)
  const strumentiMap = {};
  candidati.forEach((c) => {
    const k = c.strumento || 'Altro';
    strumentiMap[k] = (strumentiMap[k] || 0) + 1;
  });
  const strumentiSorted = Object.entries(strumentiMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxStrumenti = Math.max(1, ...strumentiSorted.map(([, n]) => n));

  // Distribuzione nazionalità
  const nazMap = {};
  candidati.forEach((c) => {
    const n = c.nazionalita || '—';
    nazMap[n] = (nazMap[n] || 0) + 1;
  });
  const nazSorted = Object.entries(nazMap).sort((a, b) => b[1] - a[1]);
  const maxNaz = Math.max(1, ...nazSorted.map(([, n]) => n));

  // Riepilogo per fase
  const valutazioniConcorso = s.valutazioni.filter((v) => {
    const cf = s.candidati_fase.find((x) => x.id === v.candidato_fase_id);
    return cf && fasi.some((f) => f.id === cf.fase_id);
  });
  const fasiStats = fasi.map((f) => {
    const cfs = s.candidati_fase.filter((cf) => cf.fase_id === f.id);
    const valCount = valutazioniConcorso.filter((v) => cfs.some((cf) => cf.id === v.candidato_fase_id)).length;
    const passed = cfs.filter((cf) => cf.ammesso_prossima_fase).length;
    return { nome: f.nome, ordine: f.ordine, totale: cfs.length, valutazioni: valCount, ammessi: passed };
  });

  root.innerHTML = `
    <div class="space-y-6">
      <!-- KPI strip (3 card: presidente rimosso, ora per-commissione) -->
      <section class="grid grid-cols-1 md:grid-cols-3 gap-3">
        ${kpiCard(icon('graduation', { size: 18 }), candidati.length, t('admin.dashboard.card.candidati_label') || 'Candidati', 'brand')}
        ${kpiCard(icon('judge',      { size: 18 }), commissari.length, t('admin.dashboard.card.commissari_label') || 'Commissari', 'sky')}
        ${kpiCard(icon('flag',       { size: 18 }), `${fasiConcluse}/${fasi.length}`, t('admin.dashboard.card.fasi_label') || 'Fasi concluse', fasiInCorso ? 'amber' : 'emerald')}
      </section>

      <!-- Sezioni della sidebar come griglia di cards cliccabili -->
      <section>
        <header class="mb-3">
          <h3 class="text-sm font-semibold text-ink-900">${escapeHtml(t('admin.dashboard.sections_title') || 'Sezioni del concorso')}</h3>
          <p class="text-xs text-ink-700">${escapeHtml(t('admin.dashboard.sections_help') || 'Le stesse voci della sidebar a sinistra, in forma di accesso rapido.')}</p>
        </header>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" id="dashboard-cards">
          ${SIDEBAR_TABS.map((tab) => sectionCard(tab, concorso)).join('')}
        </div>
      </section>

      <!-- Banner se nessuna commissione ha un presidente assegnato -->
      ${!hasAnyPresidente ? `
        <div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          ${icon('warning', { size: 18 })}
          <div>
            <strong>${escapeHtml(t('admin.header.no_president') || 'Nessun presidente designato')}.</strong>
            ${escapeHtml(t('admin.dashboard.no_president_help') || 'Apri il tab Commissioni per assegnare un presidente ad almeno una commissione.')}
          </div>
        </div>` : ''}

      <!-- Statistiche del concorso -->
      ${candidati.length === 0 && fasi.length === 0 ? '' : `
        <section>
          <header class="mb-3">
            <h3 class="text-sm font-semibold text-ink-900">${escapeHtml(t('admin.dashboard.stats_title') || 'Statistiche del concorso')}</h3>
            <p class="text-xs text-ink-700">${escapeHtml(t('admin.dashboard.stats_help') || 'Distribuzione candidati e riepilogo per fase.')}</p>
          </header>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            ${strumentiSorted.length > 0 ? `
              <div class="bg-white border border-slate-200 rounded-xl p-5">
                <h4 class="font-semibold text-ink-900 mb-4 text-sm">${escapeHtml(t('stats.instruments') || 'Candidati per strumento')}</h4>
                <div class="space-y-2">
                  ${strumentiSorted.map(([strum, count]) => `
                    <div class="flex items-center gap-3">
                      <span class="w-24 text-xs text-ink-700 truncate">${escapeHtml(strum)}</span>
                      <div class="flex-1 h-5 bg-brand-50 rounded-full overflow-hidden">
                        <div class="h-full bg-brand-500 rounded-full transition-all" style="width:${(count / maxStrumenti * 100).toFixed(0)}%"></div>
                      </div>
                      <span class="text-xs font-mono font-medium text-ink-900 w-8 text-right">${count}</span>
                    </div>
                  `).join('')}
                </div>
              </div>` : ''}
            ${nazSorted.length > 0 ? `
              <div class="bg-white border border-slate-200 rounded-xl p-5">
                <h4 class="font-semibold text-ink-900 mb-4 text-sm">${escapeHtml(t('stats.nationalities') || 'Candidati per nazionalità')}</h4>
                <div class="space-y-2">
                  ${nazSorted.map(([naz, count]) => `
                    <div class="flex items-center gap-3">
                      <span class="w-24 text-xs text-ink-700 truncate">${escapeHtml(naz)}</span>
                      <div class="flex-1 h-5 bg-amber-50 rounded-full overflow-hidden">
                        <div class="h-full bg-amber-500 rounded-full transition-all" style="width:${(count / maxNaz * 100).toFixed(0)}%"></div>
                      </div>
                      <span class="text-xs font-mono font-medium text-ink-900 w-8 text-right">${count}</span>
                    </div>
                  `).join('')}
                </div>
              </div>` : ''}
            ${fasiStats.length > 0 ? `
              <div class="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
                <h4 class="font-semibold text-ink-900 mb-4 text-sm">${escapeHtml(t('stats.phases') || 'Riepilogo fasi')}</h4>
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-slate-100">
                      <th class="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('stats.phases_col') || 'Fase')}</th>
                      <th class="text-center px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('stats.candidates_col') || 'Candidati')}</th>
                      <th class="text-center px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('stats.evaluations_col') || 'Valutazioni')}</th>
                      <th class="text-center px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('stats.passed_col') || 'Ammessi')}</th>
                      <th class="text-center px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('stats.rate_col') || '% ammessi')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${fasiStats.map((fs) => `
                      <tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td class="px-3 py-2.5 font-medium text-ink-900">#${fs.ordine} ${escapeHtml(fs.nome)}</td>
                        <td class="px-3 py-2.5 text-center font-mono text-ink-700">${fs.totale}</td>
                        <td class="px-3 py-2.5 text-center font-mono text-ink-700">${fs.valutazioni}</td>
                        <td class="px-3 py-2.5 text-center font-mono ${fs.ammessi > 0 ? 'text-emerald-700 font-medium' : 'text-ink-700'}">${fs.ammessi}</td>
                        <td class="px-3 py-2.5 text-center font-mono text-ink-700">${fs.totale > 0 ? (fs.ammessi / fs.totale * 100).toFixed(0) + '%' : '—'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>` : ''}
          </div>
        </section>`}
    </div>
  `;

  // Cards cliccabili → cambio tab + re-render
  root.querySelectorAll('[data-tab-link]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.tabLink;
      setAdminTab(id);
      // Aggiorna hash per coerenza con la sidebar (la sidebar usa #/admin?tab=<id>)
      try {
        history.replaceState(null, '', `#/admin?tab=${id}`);
      } catch { /* niente */ }
      // Trigger render aggiornando il routing manualmente — usa hashchange
      // per attivare il router dell'app.
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  });
}

function kpiCard(iconHtml, value, label, accent, large = false) {
  const accents = {
    brand:   { bg: 'bg-brand-50',   text: 'text-brand-700',   border: 'border-brand-100' },
    sky:     { bg: 'bg-sky-50',     text: 'text-sky-700',     border: 'border-sky-100' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-100' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100' },
    slate:   { bg: 'bg-slate-100',  text: 'text-slate-700',   border: 'border-slate-200' },
  }[accent] ?? { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' };
  const valueClass = large ? 'text-base font-semibold' : 'text-2xl font-bold';
  return `
    <div class="bg-white border ${accents.border} rounded-xl p-3.5">
      <div class="flex items-start justify-between gap-2 mb-2">
        <p class="text-[11px] uppercase tracking-wide text-ink-500 font-medium">${escapeHtml(label)}</p>
        <span class="w-7 h-7 rounded-lg ${accents.bg} ${accents.text} inline-flex items-center justify-center">${iconHtml}</span>
      </div>
      <div class="${valueClass} text-ink-900 leading-tight truncate">${value}</div>
    </div>
  `;
}

function sectionCard(tab, concorso) {
  const n = typeof tab.count === 'function' ? tab.count(concorso) : null;
  const countBadge = n != null
    ? `<span class="text-xs font-mono bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">${n}</span>`
    : '';
  return `
    <button type="button" data-tab-link="${tab.id}" class="text-left bg-white border border-slate-200 hover:border-brand-300 hover:shadow-md rounded-xl p-4 transition-all group">
      <div class="flex items-center justify-between mb-2">
        <span class="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 inline-flex items-center justify-center group-hover:bg-brand-100 transition-colors">${icon(tab.iconName, { size: 18 })}</span>
        ${countBadge}
      </div>
      <h4 class="text-sm font-semibold text-ink-900">${escapeHtml(t(tab.labelKey))}</h4>
      <p class="text-xs text-ink-700 mt-1 line-clamp-2">${escapeHtml(t(tab.descKey) || '')}</p>
      <p class="text-[11px] text-brand-600 mt-2 inline-flex items-center gap-1 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
        ${escapeHtml(t('admin.dashboard.open') || 'Apri')} ${icon('arrowRight', { size: 12 })}
      </p>
    </button>
  `;
}
