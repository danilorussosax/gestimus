import { db } from '../db.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../utils.js';

export function renderStats(root) {
  const s = db.state;
  const concorsi = s.concorsi;

  const buildStats = () => {
    if (concorsi.length === 0) {
      return `
        <div class="bg-white border border-dashed border-brand-200 rounded-2xl p-10 text-center">
          <h3 class="text-lg font-bold text-ink-900">${escapeHtml(t('stats.empty'))}</h3>
          <p class="text-sm text-ink-700 mt-1">${escapeHtml(t('stats.empty_desc'))}</p>
        </div>`;
    }

    const concorso = concorsi.find(c => c.id === s.meta.activeConcorsoId) || concorsi[0];
    const fasi = db.fasiByConcorso(concorso.id);
    const candidati = db.candidatiByConcorso(concorso.id);
    const commissari = db.commissariByConcorso(concorso.id);
    const valutazioni = s.valutazioni.filter(v => {
      const cf = s.candidati_fase.find(x => x.id === v.candidato_fase_id);
      return cf && fasi.some(f => f.id === cf.fase_id);
    });

    // Strumenti distribution
    const strumentiMap = {};
    candidati.forEach(c => {
      const strum = c.strumento || 'Altro';
      strumentiMap[strum] = (strumentiMap[strum] || 0) + 1;
    });
    const strumentiSorted = Object.entries(strumentiMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const maxStrumenti = Math.max(1, ...strumentiSorted.map(p => p[1]));

    // Nazionalità
    const nazMap = {};
    candidati.forEach(c => {
      const n = c.nazionalita || '—';
      nazMap[n] = (nazMap[n] || 0) + 1;
    });
    const nazSorted = Object.entries(nazMap).sort((a, b) => b[1] - a[1]);
    const maxNaz = Math.max(1, ...nazSorted.map(p => p[1]));

    // Fasi stats
    const fasiStats = fasi.map(f => {
      const cfs = s.candidati_fase.filter(cf => cf.fase_id === f.id);
      const valCount = valutazioni.filter(v => {
        const cf = cfs.find(x => x.id === v.candidato_fase_id);
        return !!cf;
      }).length;
      const passed = cfs.filter(cf => cf.ammesso_prossima_fase).length;
      return { nome: f.nome, ordine: f.ordine, totale: cfs.length, valutazioni: valCount, ammessi: passed };
    });

    return `
      <div class="mb-6">
        <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-700 font-medium mb-2">
          ${escapeHtml(t('stats.concorso'))}: ${escapeHtml(concorso.nome)} (${concorso.anno})
        </p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <!-- Strumenti -->
        <div class="bg-white border border-brand-100 rounded-2xl p-5">
          <h3 class="font-semibold text-ink-900 mb-4">${escapeHtml(t('stats.instruments'))}</h3>
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
        </div>

        <!-- Nazionalità -->
        <div class="bg-white border border-brand-100 rounded-2xl p-5">
          <h3 class="font-semibold text-ink-900 mb-4">${escapeHtml(t('stats.nationalities'))}</h3>
          <div class="space-y-2">
            ${nazSorted.map(([naz, count]) => `
              <div class="flex items-center gap-3">
                <span class="w-24 text-xs text-ink-700 truncate">${escapeHtml(naz)}</span>
                <div class="flex-1 h-5 bg-accent-50 rounded-full overflow-hidden">
                  <div class="h-full bg-accent-500 rounded-full transition-all" style="width:${(count / maxNaz * 100).toFixed(0)}%"></div>
                </div>
                <span class="text-xs font-mono font-medium text-ink-900 w-8 text-right">${count}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Riepilogo per fase -->
        <div class="lg:col-span-2 bg-white border border-brand-100 rounded-2xl p-5">
          <h3 class="font-semibold text-ink-900 mb-4">${escapeHtml(t('stats.phases'))}</h3>
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-brand-100">
                <th class="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('stats.phases_col'))}</th>
                <th class="text-center px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('stats.candidates_col'))}</th>
                <th class="text-center px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('stats.evaluations_col'))}</th>
                <th class="text-center px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('stats.passed_col'))}</th>
                <th class="text-center px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('stats.rate_col'))}</th>
              </tr>
            </thead>
            <tbody>
              ${fasiStats.map(fs => `
                <tr class="border-b border-brand-50 hover:bg-brand-50/30 transition-colors">
                  <td class="px-3 py-2.5 font-medium text-ink-900">${escapeHtml(fs.nome)}</td>
                  <td class="px-3 py-2.5 text-center font-mono text-ink-700">${fs.totale}</td>
                  <td class="px-3 py-2.5 text-center font-mono text-ink-700">${fs.valutazioni}</td>
                  <td class="px-3 py-2.5 text-center font-mono ${fs.ammessi > 0 ? 'text-emerald-700 font-medium' : 'text-ink-700'}">${fs.ammessi}</td>
                  <td class="px-3 py-2.5 text-center font-mono text-ink-700">${fs.totale > 0 ? (fs.ammessi / fs.totale * 100).toFixed(0) + '%' : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  };

  root.innerHTML = `
    <section class="view-fade c-page">
      <header class="c-page-header">
        <p class="c-page-header__eyebrow">${escapeHtml(t('stats.eyebrow'))}</p>
        <h1 class="c-page-header__title">${escapeHtml(t('stats.title'))}</h1>
        <p class="c-page-header__sub">${escapeHtml(t('stats.subtitle'))}</p>
      </header>
      <div class="c-page">${buildStats()}</div>
    </section>
  `;
}