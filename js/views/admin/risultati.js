// Tab "Risultati" + export PDF/CSV + protocollo.
// Estratto da js/views/admin.js (refactoring).

import { db } from '../../db.js';
import { escapeHtml, toast, displayName, ageFromDate } from '../../utils.js';
import { getScala, fmtVoto } from '../../scoring.js';
import { t } from '../../i18n.js';
import { iconaPerSezione, rankFase } from './common.js';
import { buildVerbaleBlock, bindVerbaleBlock } from './verbale.js';

export function renderRisultati(/** @type {any} */ root, /** @type {any} */ concorso) {
  const fasi = db.fasiByConcorso(concorso.id);

  // Calcola la dimensione del gruppo (signature sezioni_ids) per ogni fase:
  // se il gruppo ha una sola sotto-fase la colonna "Esito" perde di
  // significato e viene nascosta. Passa la mappa a buildFaseSummary.
  const groupSize = computeGroupSizes(fasi);
  root.innerHTML = `
    <div class="space-y-6">
      ${fasi.map((/** @type {any} */ f) => buildFaseSummary(f, (groupSize.get(f.id) || 1) > 1)).join('')}
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

async function exportProtocolloPdf(/** @type {any} */ concorso) {
  // Verifica che jsPDF + autoTable siano caricati (defer, possono non essere ancora pronti).
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast(t('admin.risultati.pdf_not_loaded'), 'warn');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = /** @type {any} */ (new jsPDF({ unit: 'pt', format: 'a4' }));
  // jspdf-autotable estende il prototype: se il CDN non l'ha caricato, doc.autoTable è undefined.
  if (typeof doc.autoTable !== 'function') {
    toast(t('admin.risultati.pdf_not_loaded') || 'Plugin autoTable non caricato. Ricarica la pagina.', 'warn');
    return;
  }
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  // Firma in calce al protocollo: il presidente della commissione assegnata
  // alla fase finale (non un "presidente di concorso" globale che non esiste
  // nel modello). Se la finale non ha commissione, niente firma.
  const presidente = db.getPresidenteForFinale(concorso.id);

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
  // Conta quante fasi condividono la "signature" sezioni_ids: se il gruppo ha
  // più di una sotto-fase, mostriamo la colonna esito; altrimenti solo la
  // classifica (per fasi uniche, l'esito è sempre PROMOSSO o non rilevante).
  const groupSize = computeGroupSizes(fasi);

  for (const fase of fasi) {
    const cfs = db.candidatiFaseList(fase.id);
    if (cfs.length === 0) continue;
    const scala = getScala(fase);
    // N124: ranking con risoluzione pareggi (anche nel PDF protocollo).
    const rows = rankFase(fase, cfs);

    // Header fase
    if (cursorY > 720) { doc.addPage(); cursorY = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(46, 38, 61);
    const nomeFaseConScope = `${fase.nome}${faseScopeLabel(fase)}`;
    doc.text(t('admin.risultati.pdf_phase', { ordine: fase.ordine, nome: nomeFaseConScope }), margin, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(93, 89, 108);
    doc.text(t('admin.risultati.pdf_phase_meta', { stato: fase.stato, scala, n: cfs.length }), margin, cursorY + 14);
    cursorY += 22;

    // Etichette esito: custom dal form fase, fallback ai default.
    const PROMOSSO_LABEL = (fase.testo_esito_promosso || t('admin.risultati.pdf_promosso')).toUpperCase();
    const ELIMINATO_LABEL = (fase.testo_esito_eliminato || t('admin.risultati.pdf_eliminato')).toUpperCase();
    // Mostra colonna esito SOLO se la fase appartiene a un gruppo (sezione)
    // con più di una sotto-fase. Singola sotto-fase = sequenza lineare senza
    // promozione, l'esito perde significato.
    const showEsito = (groupSize.get(fase.id) || 1) > 1;

    const head = showEsito
      ? [[t('admin.risultati.pdf_col_pos'), t('admin.risultati.pdf_col_num'), t('admin.risultati.pdf_col_cand'), t('admin.risultati.pdf_col_strumento'), t('admin.risultati.pdf_col_media'), t('admin.risultati.pdf_col_esito')]]
      : [[t('admin.risultati.pdf_col_pos'), t('admin.risultati.pdf_col_num'), t('admin.risultati.pdf_col_cand'), t('admin.risultati.pdf_col_strumento'), t('admin.risultati.pdf_col_media')]];
    const body = rows.map((r, i) => {
      const baseRow = [
        r.posizione_finale ?? (i + 1), // N186: posizione con tiebreak/ex aequo, non l'indice di riga
        String(r.cand?.numero_candidato || '').padStart(3, '0'),
        r.cand ? displayName(r.cand) : '—',
        r.cand?.strumento || '',
        fmtVoto(r.media, scala),
      ];
      if (showEsito) {
        baseRow.push(
          r.cf.stato !== 'COMPLETATO' ? '—'
            : r.cf.ammesso_prossima_fase ? PROMOSSO_LABEL : ELIMINATO_LABEL,
        );
      }
      return baseRow;
    });

    doc.autoTable({
      startY: cursorY,
      margin: { left: margin, right: margin },
      head,
      body,
      styles: { fontSize: 9, cellPadding: 5, lineColor: [231, 229, 235], textColor: [46, 38, 61] },
      headStyles: { fillColor: [115, 103, 240], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 247, 250] },
      didParseCell: (/** @type {any} */ d) => {
        // Solo i candidati AMMESSI sono evidenziati col verde emerald (#10b981).
        // I non ammessi restano nel colore default (slate-700) — no rosso.
        if (showEsito && d.section === 'body' && d.column.index === 5 && d.cell.raw === PROMOSSO_LABEL) {
          d.cell.styles.textColor = [5, 150, 105];
          d.cell.styles.fontStyle = 'bold';
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

function loadImageDataURL(/** @type {any} */ src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).drawImage(img, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Etichetta "scope sezione" da accodare al nome di una fase nel riepilogo /
// verbale / PDF, per distinguere "Eliminatoria fiati" da "Eliminatoria archi".
// Ritorna '' per fasi globali (sezioni_ids vuoto), '· <nome>' per singola
// sezione, '· <nome1> + <nome2>' per multi.
// Mappa { faseId → quanti gemelli (incluso self) condividono la stessa
// signature `sezioni_ids` nello stesso concorso }. Usata per decidere se la
// colonna esito ha senso: per gruppi con una sola fase l'esito è ridondante.
function computeGroupSizes(/** @type {any} */ fasi) {
  const counts = new Map();
  const signatures = new Map(); // faseId → sig
  for (const f of fasi) {
    const ids = Array.isArray(f.sezioni_ids) ? [...f.sezioni_ids].sort() : [];
    const sig = ids.length === 0 ? '__shared__' : ids.join(',');
    signatures.set(f.id, sig);
    counts.set(sig, (counts.get(sig) || 0) + 1);
  }
  const result = new Map();
  for (const f of fasi) result.set(f.id, counts.get(signatures.get(f.id)) || 1);
  return result;
}

function faseScopeLabel(/** @type {any} */ fase) {
  const ids = Array.isArray(fase?.sezioni_ids) ? fase.sezioni_ids : [];
  if (ids.length === 0) return '';
  const nomi = ids.map((/** @type {any} */ id) => db.state.sezioni.find((/** @type {any} */ s) => s.id === id)?.nome).filter(Boolean);
  if (nomi.length === 0) return '';
  return ' · ' + nomi.join(' + ');
}

// Riepilogo classifica fase. Se la fase è CONCLUSA e abbiamo posizione_finale
// congelata (campo presente da migration 1700000041_tiebreak_strategy.js),
// usiamo la classifica congelata + badge spareggio + gestione ex aequo.
// Altrimenti (fase IN_CORSO o legacy) calcoliamo live ordinando per media.
function buildFaseSummary(/** @type {any} */ fase, showEsito = true) {
  const cfs = db.candidatiFaseList(fase.id);
  // Etichette esito custom (default "PROMOSSO"/"ELIMINATO" se vuoti)
  const PROMOSSO_LABEL = fase.testo_esito_promosso || t('admin.risultati.promosso');
  const ELIMINATO_LABEL = fase.testo_esito_eliminato || t('admin.risultati.eliminato');
  const scope = faseScopeLabel(fase);
  const ic = scope ? iconaPerSezione(fase.sezioni_ids?.[0] ? db.state.sezioni.find((/** @type {any} */ s) => s.id === fase.sezioni_ids[0])?.nome : '') : '';
  const titleHtml = `<span class="text-slate-400 font-mono mr-1">#${fase.ordine}</span>${ic ? ic + ' ' : ''}${escapeHtml(fase.nome)}${scope ? `<span class="text-slate-500 font-normal">${escapeHtml(scope)}</span>` : `<span class="text-xs text-slate-400 italic ml-2">${escapeHtml(t('admin.risultati.fase_scope_all') || 'tutte le sezioni')}</span>`}`;
  if (cfs.length === 0) return `
    <div class="bg-white border border-slate-200 rounded-2xl p-5">
      <h3 class="font-semibold text-slate-900">${titleHtml}</h3>
      <p class="text-sm text-slate-500 italic mt-1">${escapeHtml(t('admin.risultati.fase_not_started'))}</p>
    </div>
  `;
  // N124: ranking con risoluzione pareggi, calcolato on-the-fly per ogni fase
  // (le fasi CONCLUSA hanno voti congelati → risultato stabile).
  const rows = rankFase(fase, cfs);
  // Conteggio spareggi e ex aequo per il sub-header informativo.
  const tiebreakCount = rows.filter(r => Array.isArray(r.tiebreak_log) && r.tiebreak_log.length > 1).length;
  const exAequoGroups = new Set(rows.filter(r => r.ex_aequo_group).map(r => r.ex_aequo_group));

  return `
    <div class="bg-white border border-slate-200 rounded-2xl p-5">
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 class="font-semibold text-slate-900">${titleHtml}</h3>
        <div class="flex items-center gap-2 flex-wrap">
          ${tiebreakCount > 0 ? `<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200" title="${escapeHtml(t('admin.risultati.tiebreak_badge_title') || 'Spareggi applicati per risolvere parità di punteggio')}">⚖ ${escapeHtml((t('admin.risultati.tiebreak_badge') || '{n} spareggi').replace('{n}', String(tiebreakCount)))}</span>` : ''}
          ${exAequoGroups.size > 0 ? `<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 border border-violet-200">🤝 ${escapeHtml((t('admin.risultati.ex_aequo_badge') || '{n} ex aequo').replace('{n}', String(exAequoGroups.size)))}</span>` : ''}
          <span class="text-xs px-2 py-0.5 rounded-full ${fase.stato === 'CONCLUSA' ? 'bg-slate-200 text-slate-700' : 'bg-brand-100 text-brand-800'}">${escapeHtml(String(fase.stato || 'PIANIFICATA').replace(/_/g, ' '))}</span>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="text-xs text-slate-500 uppercase tracking-wider">
            <tr>
              <th class="text-left py-2 pr-3">${escapeHtml(t('admin.risultati.col_pos'))}</th>
              <th class="text-left py-2 pr-3">${escapeHtml(t('admin.risultati.col_cand'))}</th>
              <th class="text-right py-2 pr-3">${escapeHtml(t('admin.risultati.col_media'))}</th>
              ${showEsito ? `<th class="text-center py-2 pr-3">${escapeHtml(t('admin.risultati.col_esito'))}</th>` : ''}
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${rows.map((r, i) => {
              const pos = r.posizione_finale ?? (i + 1);
              const isExAequo = !!r.ex_aequo_group;
              const hadTiebreak = Array.isArray(r.tiebreak_log) && r.tiebreak_log.length > 1;
              const tbTooltip = hadTiebreak
                ? r.tiebreak_log.map((/** @type {any} */ s) => `• ${s.motivazione || s.step}`).join('\n')
                : '';
              return `
              <tr ${isExAequo ? 'class="bg-violet-50/40"' : ''}>
                <td class="py-2 pr-3 text-slate-500">${pos}${isExAequo ? '°' : ''} ${isExAequo ? `<span class="text-[10px] text-violet-700 font-bold ml-1">ex aequo</span>` : ''}</td>
                <td class="py-2 pr-3"><span class="font-medium text-slate-900">#${String(r.cand?.numero_candidato||'').padStart(3,'0')}</span> · ${escapeHtml(displayName(r.cand))} <span class="text-slate-500 text-xs">(${escapeHtml(r.cand?.strumento || '')})</span>${hadTiebreak ? ` <span class="ml-1 text-[10px] font-bold text-amber-700" title="${escapeHtml(tbTooltip)}">⚖</span>` : ''}</td>
                <td class="py-2 pr-3 text-right font-mono">${fmtVoto(r.media, getScala(fase))} <span class="text-[10px] text-slate-400">/${getScala(fase)}</span></td>
                ${showEsito ? `<td class="py-2 pr-3 text-center">
                  ${r.cf.stato !== 'COMPLETATO' ? `<span class="text-xs text-slate-500">—</span>`
                    : r.cf.ammesso_prossima_fase ? `<span class="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-medium">${escapeHtml(PROMOSSO_LABEL)}</span>`
                    : `<span class="text-xs text-slate-600">${escapeHtml(ELIMINATO_LABEL)}</span>`}
                </td>` : ''}
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${exAequoGroups.size > 0 ? `
        <div class="mt-3 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-xs text-violet-900">
          <strong>${escapeHtml(t('admin.risultati.ex_aequo_note_title') || 'Nota ex aequo')}:</strong> ${escapeHtml(t('admin.risultati.ex_aequo_note_body') || 'Le posizioni indicate sono condivise tra i candidati ex aequo; la posizione immediatamente successiva non viene assegnata. I premi previsti dal regolamento per le posizioni interessate si sommano e dividono in parti uguali tra i vincitori.')}
        </div>
      ` : ''}
      ${tiebreakCount > 0 ? `
        <div class="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-900">
          <details>
            <summary class="cursor-pointer font-semibold">${escapeHtml(t('admin.risultati.tiebreak_details_title') || 'Dettaglio spareggi applicati')}</summary>
            <ul class="mt-2 space-y-1.5">
              ${rows.filter(r => Array.isArray(r.tiebreak_log) && r.tiebreak_log.length > 1).map(r => `
                <li>
                  <span class="font-semibold">#${String(r.cand?.numero_candidato||'').padStart(3,'0')} ${escapeHtml(displayName(r.cand))}</span> →
                  <span>${r.tiebreak_log.map((/** @type {any} */ s) => escapeHtml(s.motivazione || s.step)).join(' → ')}</span>
                </li>
              `).join('')}
            </ul>
          </details>
        </div>
      ` : ''}
    </div>
  `;
}

function exportCsv(/** @type {any} */ concorso) {
  // Helper: quota qualsiasi valore CSV-safe (RFC 4180) + protezione formula injection.
  const csvField = (/** @type {any} */ v) => {
    let s = String(v ?? '');
    if (s.length && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const fasi = db.fasiByConcorso(concorso.id);
  const lines = ['Fase,Posizione,Numero,Nome,Cognome,Strumento,Nazionalita,Eta,Media,Esito'];
  fasi.forEach((/** @type {any} */ fase) => {
    const cfs = db.candidatiFaseList(fase.id);
    // N124/M163: export CSV con la stessa risoluzione pareggi della UI.
    const rows = rankFase(fase, cfs);
    rows.forEach((r, i) => {
      const esito = r.cf.stato !== 'COMPLETATO' ? 'in attesa'
        : r.cf.ammesso_prossima_fase ? 'PROMOSSO' : 'ELIMINATO';
      const eta = ageFromDate(r.cand?.data_nascita) ?? r.cand?.eta ?? '';
      const media = Number.isFinite(r.media) ? r.media.toFixed(2) : '0.00';
      lines.push([
        csvField(fase.nome),
        r.posizione_finale ?? (i + 1),
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
  { tag: 'spareggi',       descKey: 'admin.risultati.verbale.tag_spareggi' },
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
  { tag: 'fase_spareggi',       descKey: 'admin.risultati.verbale.tag_fase_spareggi' },
];

