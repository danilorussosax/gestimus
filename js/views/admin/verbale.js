// Generazione verbale + template + tag dinamici + export PDF (verbale,
// programma) + spareggi.
// Estratto da js/views/admin.js (refactoring).

import { db } from '../../db.js';
import { escapeHtml, toast, confirmDialog, displayName } from '../../utils.js';
import { fmtVoto, getScala, getMetodoMedia, getModoValutazione, mediaCandidato, METODI_MEDIA } from '../../scoring.js';
import { icon } from '../../icons.js';
import { t } from '../../i18n.js';

// Tag dinamici disponibili nel template verbale: il blocco "general" si
// applica all'intero concorso (header), il blocco "fase" è disponibile solo
// quando si genera un verbale di singola fase.
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

export function verbaleStorageKey(concorso, fase) {
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

// Costruisce il testo "spareggi applicati" per una singola fase. Usa i campi
// congelati (posizione_finale, tiebreak_log, ex_aequo_group) scritti al
// concludiFase. Per fasi non CONCLUSE o legacy senza dati congelati ritorna
// la stringa "—".
function buildFaseSpareggi(fase) {
  const cfs = db.candidatiFaseList(fase.id);
  if (cfs.length === 0) return '—';
  const hasFrozen = cfs.some(cf => cf.posizione_finale != null);
  if (!hasFrozen) return '—';
  // Filtro: solo i cf che sono stati toccati da uno spareggio (tiebreak_log
  // ha più di un'entry — la prima è sempre "pari_su_media" — oppure è ex aequo).
  const involved = cfs
    .map(cf => {
      const cand = db.state.candidati.find(c => c.id === cf.candidato_id);
      return { cf, cand };
    })
    .filter(x => x.cand && ((Array.isArray(x.cf.tiebreak_log) && x.cf.tiebreak_log.length > 1) || x.cf.ex_aequo_group))
    .sort((a, b) => (a.cf.posizione_finale ?? 999) - (b.cf.posizione_finale ?? 999));
  if (involved.length === 0) return t('admin.risultati.verbale.spareggi_none_fase') || 'Nessuno spareggio applicato.';
  return involved.map(({ cf, cand }) => {
    const motivazioni = (cf.tiebreak_log || [])
      .filter(s => s && s.motivazione)
      .map(s => s.motivazione)
      .join(' → ');
    const exa = cf.ex_aequo_group ? ' [EX AEQUO]' : '';
    return `${cf.posizione_finale}° — #${String(cand.numero_candidato || '').padStart(3, '0')} ${displayName(cand)}${exa}: ${motivazioni}`;
  }).join('\n');
}

// Testo "spareggi" a livello concorso: itera le fasi CONCLUSE e per ognuna
// che ha avuto spareggi inserisce un blocco con scope (es. " · Pianoforte").
function buildConcorsoSpareggi(concorso) {
  const fasi = db.fasiByConcorso(concorso.id);
  const blocks = [];
  for (const f of fasi) {
    const text = buildFaseSpareggi(f);
    if (!text || text === '—' || text === (t('admin.risultati.verbale.spareggi_none_fase') || 'Nessuno spareggio applicato.')) continue;
    const scope = faseScopeLabel(f);
    blocks.push(`Fase ${f.ordine}: ${f.nome}${scope}\n${text.split('\n').map(l => '  ' + l).join('\n')}`);
  }
  if (blocks.length === 0) return t('admin.risultati.verbale.spareggi_none') || 'Nessuno spareggio applicato nel concorso.';
  return blocks.join('\n\n');
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
    spareggi: buildConcorsoSpareggi(concorso),
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
      fase_spareggi: buildFaseSpareggi(fase),
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

export function buildVerbaleBlock(concorso) {
  const fasi = db.fasiByConcorso(concorso.id);
  // Includiamo lo scope di sezione nel nome (es. "1. Eliminatoria · Pianoforte")
  // così non si confondono fasi con stesso nome su sezioni diverse.
  const faseOptions = fasi.map(f => {
    const scope = faseScopeLabel(f) || ' · ' + (t('admin.risultati.fase_scope_all') || 'tutte le sezioni');
    return `<option value="${f.id}">${escapeHtml(`${f.ordine}. ${f.nome}${scope}`)}</option>`;
  }).join('');
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

export function bindVerbaleBlock(root, concorso) {
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

