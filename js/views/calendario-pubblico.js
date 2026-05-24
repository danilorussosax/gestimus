// Pagina pubblica del calendario (no auth). Renderizzata anche pre-login dalla
// rotta #/calendario?token=…[&display=1]. Fetch standalone (non passa dallo
// state autenticato). Modalità tabellone con polling + evidenziazione live.

import { fetchCalendarioPubblico, db } from '../db.js';
import { escapeHtml, toast } from '../utils.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { exportCalendarioPdf } from '../calendario-pdf.js';

let pollTimer = /** @type {any} */ (null);

// R15: il poll del display-mode è module-level. renderCalendarioPubblico lo
// azzera/riarma solo quando si naviga DI NUOVO sul calendario; navigando verso
// un'altra vista il timer continuava a girare e ogni 45s sovrascriveva l'HTML
// della vista corrente. app.js chiama questo cleanup a ogni render.
export function unmountCalendarioPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function parseParams() {
  const q = new URLSearchParams((location.hash.split('?')[1]) || '');
  return { token: q.get('token') || '', display: q.get('display') === '1' };
}

const hhmm = (/** @type {any} */ s) => (s ? String(s).slice(0, 5) : '');
function fmtDay(/** @type {any} */ iso) {
  if (!iso) return '';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return iso; }
}

// Ora/data correnti nel fuso della piattaforma (Europe/Rome) per l'evidenziazione.
function nowRome() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const get = (/** @type {any} */ type) => parts.find((p) => p.type === type)?.value || '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function slotMinutes(/** @type {any} */ s) {
  if (!s.oraPrevista) return null;
  return Number(String(s.oraPrevista).slice(0, 2)) * 60 + Number(String(s.oraPrevista).slice(3, 5));
}

// Marca "in corso" / "prossimo" sugli slot del giorno corrente (solo display).
function markLive(/** @type {any} */ data) {
  const { date, minutes } = nowRome();
  for (const g of (data.giorni || [])) {
    const isToday = g.data === date;
    const flat = [];
    for (const b of g.blocchi) for (const s of (b.slot || [])) { s._live = null; if (isToday) flat.push(s); }
    if (!isToday) continue;
    const timed = flat.filter((s) => slotMinutes(s) != null).sort((a, b) => /** @type {number} */ (slotMinutes(a)) - /** @type {number} */ (slotMinutes(b)));
    let current = /** @type {any} */ (null);
    for (const s of timed) { if (/** @type {number} */ (slotMinutes(s)) <= minutes) current = s; }
    if (current) {
      current._live = 'now';
      const idx = timed.indexOf(current);
      if (timed[idx + 1]) timed[idx + 1]._live = 'next';
    } else if (timed[0]) {
      timed[0]._live = 'next';
    }
  }
}

function brandingLogo() {
  const ep = db.getEntePublic?.();
  return ep?.logo_url || './logo.png';
}

function slotRow(/** @type {any} */ s, /** @type {any} */ display) {
  const liveCls = s._live === 'now'
    ? 'bg-emerald-50 ring-1 ring-emerald-300'
    : s._live === 'next' ? 'bg-amber-50 ring-1 ring-amber-200' : '';
  const badge = s._live === 'now'
    ? `<span class="text-[10px] font-bold uppercase text-emerald-700">${escapeHtml(t('cal.pub.now'))}</span>`
    : s._live === 'next' ? `<span class="text-[10px] font-bold uppercase text-amber-700">${escapeHtml(t('cal.pub.next'))}</span>` : '';
  const sz = display ? 'text-2xl' : 'text-sm';
  return `
    <li class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg ${liveCls}">
      <span class="font-mono ${display ? 'text-2xl' : 'text-sm'} text-ink-700 tabular-nums">${escapeHtml(hhmm(s.oraPrevista) || '—')}</span>
      <span class="flex-1 ${sz} text-ink-900 truncate">${escapeHtml(s.etichetta || '')}</span>
      ${badge}
    </li>`;
}

function blockCard(/** @type {any} */ b, /** @type {any} */ data, /** @type {any} */ display) {
  const head = [b.sezione?.nome, b.categoria?.nome, b.fase?.nome].filter(Boolean).join(' · ')
    || b.titolo || (b.tipo === 'EVENTO' ? t('cal.block.tipo.evento') : t('cal.block.tipo.esibizione'));
  const orario = [hhmm(b.oraInizio), hhmm(b.oraFine)].filter(Boolean).join('–');
  const sala = b.sala?.nome ? `<span class="inline-flex items-center gap-1 text-ink-700">${icon('calendar', { size: 13 })}${escapeHtml(b.sala.nome)}</span>` : '';
  const giuria = (data.pubblicazione?.mostraCommissione && Array.isArray(b.commissione) && b.commissione.length)
    ? `<p class="mt-2 text-[11px] text-ink-700"><span class="font-semibold">${escapeHtml(t('cal.pub.giuria'))}:</span> ${escapeHtml(b.commissione.map((/** @type {any} */ m) => [m.nome, m.cognome].filter(Boolean).join(' ')).join(', '))}</p>`
    : '';
  return `
    <article class="bg-white rounded-2xl ring-1 ring-brand-100 shadow-soft overflow-hidden ${display ? 'min-w-[340px]' : ''}">
      <header class="px-4 py-3 bg-brand-50/60 border-b border-brand-100 flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <h3 class="${display ? 'text-2xl' : 'text-base'} font-bold text-ink-900 truncate">${escapeHtml(head)}</h3>
          ${orario ? `<p class="font-mono text-xs text-brand-700">${escapeHtml(orario)}</p>` : ''}
        </div>
        ${sala}
      </header>
      <div class="px-2 py-2">
        ${(b.slot && b.slot.length)
          ? `<ul class="space-y-1">${b.slot.map((/** @type {any} */ s) => slotRow(s, display)).join('')}</ul>`
          : `<p class="px-3 py-2 text-sm text-ink-500 italic">${escapeHtml(b.tipo === 'EVENTO' ? (b.titolo || t('cal.block.tipo.evento')) : t('cal.pub.empty'))}</p>`}
        ${giuria}
      </div>
    </article>`;
}

function buildPdfOpts(/** @type {any} */ data) {
  return {
    titolo: data.concorso?.nome || t('cal.pdf.title'),
    sottotitolo: data.pubblicazione?.etichetta || '',
    logoUrl: data.concorso?.logo || brandingLogo(),
    mostraCommissione: !!data.pubblicazione?.mostraCommissione,
    giorni: data.giorni || [],
  };
}

// ───────────────────────── Display / tabellone (stile reference) ─────────────
// Un tabellone per SALA: colonne = sezioni, riga sinistra = orario, celle = card
// per categoria con dentro i nominativi. Stile copiato dallo screenshot di
// riferimento (card colorate, font grande, avatar con iniziali).

// Ogni blocco ha un colore DIVERSO: hue ruotato di golden-angle (137.5°) per
// indice → tinte pastello sempre distinte e ben separate, testo scuro leggibile.
function colorForIndex(/** @type {any} */ i) {
  const hue = Math.round((i * 137.508) % 360);
  return {
    bg: `hsl(${hue} 70% 91%)`,
    fg: '#23262e',
    sub: `hsl(${hue} 28% 38%)`,
    ava: `hsl(${hue} 42% 80%)`,
    avaFg: `hsl(${hue} 45% 26%)`,
  };
}
function initials(/** @type {any} */ name) {
  const p = String(name || '').trim().split(/\s+/);
  return (((p[0]?.[0]) || '') + ((p[1]?.[0]) || '')).toUpperCase() || '•';
}
function toMin(/** @type {any} */ hhmm) {
  if (!hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function fmtHM(/** @type {any} */ min) {
  const h = Math.floor(min / 60), mm = min % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const DISPLAY_STYLE = `
<style id="cal-display-style">
  body.display-mode { background:#f4f5f7; }
  .cal-disp { background:#f4f5f7; min-height:100vh; padding:20px 24px 40px; }
  .cal-disp__head { display:flex; align-items:center; gap:16px; margin-bottom:20px; }
  .cal-disp__logo { height:56px; width:56px; object-fit:contain; border-radius:14px; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.08); }
  .cal-disp__title { font-size:2rem; font-weight:800; color:#1d2026; line-height:1.1; }
  .cal-disp__sub { font-size:.95rem; color:#6b7280; }
  .cal-day__date { font-size:1.15rem; font-weight:700; color:#374151; text-transform:capitalize; margin:18px 0 10px; }
  .cal-board { background:#fff; border-radius:20px; box-shadow:0 1px 3px rgba(0,0,0,.07); padding:18px 18px 22px; margin-bottom:22px; overflow-x:auto; }
  .cal-board__sala { font-size:1.6rem; font-weight:800; color:#1d2026; padding:4px 6px 14px; }
  .cal-grid { display:grid; gap:10px; align-items:stretch; position:relative; }
  .cal-colhead { font-size:1.25rem; font-weight:700; color:#1d2026; padding:6px 10px 12px; border-bottom:2px solid #eceef1; text-align:center; align-self:end; }
  .cal-corner { border-bottom:2px solid #eceef1; }
  .cal-time { display:flex; flex-direction:column; align-items:flex-end; justify-content:flex-start; padding:4px 12px 0 0; color:#9aa0aa; }
  .cal-time__h { font-size:1.05rem; font-weight:700; color:#3a3f4a; font-variant-numeric:tabular-nums; }
  .cal-time__30 { font-size:.8rem; color:#b3b8c0; margin-top:2px; }
  .cal-rowline { grid-column:1 / -1; border-top:1px solid #f0f1f3; pointer-events:none; }
  .cal-card { border-radius:18px; padding:16px 18px; display:flex; flex-direction:column; gap:10px; overflow:auto; box-shadow:0 1px 2px rgba(0,0,0,.05); position:relative; z-index:1; }
  .cal-card__cat { font-size:1.4rem; font-weight:800; line-height:1.15; }
  .cal-card__time { font-size:.9rem; font-variant-numeric:tabular-nums; opacity:.85; }
  .cal-card__fase { font-size:.85rem; opacity:.8; }
  .cal-names { display:flex; flex-direction:column; gap:6px; margin-top:2px; }
  .cal-name { display:flex; align-items:center; gap:10px; }
  .cal-name--now { font-weight:800; }
  .cal-ava { width:30px; height:30px; border-radius:50%; display:grid; place-items:center; font-size:.72rem; font-weight:800; flex:0 0 auto; }
  .cal-name__t { font-size:.82rem; font-variant-numeric:tabular-nums; opacity:.7; min-width:42px; }
  .cal-name__n { font-size:1rem; }
  .cal-name__badge { font-size:.62rem; font-weight:800; text-transform:uppercase; letter-spacing:.04em; padding:1px 7px; border-radius:999px; }
  .cal-empty { color:#9aa0aa; font-style:italic; padding:24px; text-align:center; }
</style>`;

function dispCard(/** @type {any} */ b, /** @type {any} */ c) {
  const cat = b.categoria?.nome || b.sezione?.nome || b.fase?.nome || b.titolo || t('cal.block.tipo.evento');
  const orario = [hhmm(b.oraInizio), hhmm(b.oraFine)].filter(Boolean).join(' – ');
  const slots = Array.isArray(b.slot) ? b.slot : [];
  const names = slots.length
    ? `<div class="cal-names">${slots.map((/** @type {any} */ s) => {
        const live = s._live === 'now' ? ' cal-name--now' : '';
        const badge = s._live === 'now'
          ? `<span class="cal-name__badge" style="background:rgba(16,185,129,.9);color:#fff">${escapeHtml(t('cal.pub.now'))}</span>`
          : s._live === 'next'
            ? `<span class="cal-name__badge" style="background:rgba(245,158,11,.9);color:#fff">${escapeHtml(t('cal.pub.next'))}</span>` : '';
        return `<div class="cal-name${live}">
            <span class="cal-ava" style="background:${c.ava};color:${c.avaFg}">${escapeHtml(initials(s.etichetta))}</span>
            <span class="cal-name__t">${escapeHtml(hhmm(s.oraPrevista) || '')}</span>
            <span class="cal-name__n">${escapeHtml(s.etichetta || '')}</span>
            ${badge}
          </div>`;
      }).join('')}</div>`
    : `<div class="cal-card__fase">${escapeHtml(b.tipo === 'EVENTO' ? (b.titolo || t('cal.block.tipo.evento')) : t('cal.pub.empty'))}</div>`;
  return { c, html: (/** @type {any} */ gridRow, /** @type {any} */ gridCol) => `
    <article class="cal-card" style="grid-row:${gridRow};grid-column:${gridCol};background:${c.bg};color:${c.fg}">
      <div class="cal-card__cat">${escapeHtml(cat)}</div>
      ${orario ? `<div class="cal-card__time" style="color:${c.sub}">${escapeHtml(orario)}</div>` : ''}
      ${names}
    </article>` };
}

function salaBoard(/** @type {any} */ salaNome, /** @type {any} */ blocchi) {
  // Colonne = sezioni presenti (ordinate). Righe = tick da 30 min tra min/max orario.
  const sezNames = [...new Set(blocchi.map((/** @type {any} */ b) => b.sezione?.nome || '—'))].sort((a, b) => a.localeCompare(b));
  const starts = blocchi.map((/** @type {any} */ b) => toMin(b.oraInizio)).filter((/** @type {any} */ x) => x != null);
  const ends = blocchi.map((/** @type {any} */ b) => toMin(b.oraFine) ?? (toMin(b.oraInizio) != null ? /** @type {number} */ (toMin(b.oraInizio)) + 60 : null)).filter((/** @type {any} */ x) => x != null);
  const minStart = starts.length ? Math.floor(Math.min(...starts) / 30) * 30 : 9 * 60;
  const maxEnd = ends.length ? Math.ceil(Math.max(...ends) / 30) * 30 : minStart + 60;
  const T = Math.max(1, (maxEnd - minStart) / 30);

  // Pre-calcola tick + sezione per ogni blocco (mantiene l'indice per il colore).
  const items = blocchi.map((/** @type {any} */ b, /** @type {any} */ i) => {
    const start = toMin(b.oraInizio) ?? minStart;
    let end = toMin(b.oraFine) ?? start + 60;
    if (end <= start) end = start + 30;
    const sTick = Math.round((start - minStart) / 30);
    const eTick = Math.max(sTick + 1, Math.ceil((end - minStart) / 30));
    return /** @type {any} */ ({ b, i, sez: b.sezione?.nome || '—', sTick, eTick, lane: 0 });
  });

  // Assegna le "lane" (sotto-colonne) ai blocchi che si SOVRAPPONGONO nel tempo
  // dentro la stessa sezione → niente più card una sopra l'altra: si affiancano.
  // Greedy interval partitioning: ogni blocco va nella prima lane libera.
  /** @type {Record<string, number>} */
  const maxLanes = {};
  for (const sez of sezNames) {
    const group = items.filter((/** @type {any} */ it) => it.sez === sez).sort((/** @type {any} */ a, /** @type {any} */ b) => a.sTick - b.sTick || a.eTick - b.eTick);
    /** @type {number[]} */
    const laneEnds = [];
    for (const it of group) {
      let lane = laneEnds.findIndex((e) => e <= it.sTick);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.eTick); }
      else laneEnds[lane] = it.eTick;
      it.lane = lane;
    }
    maxLanes[sez] = Math.max(1, laneEnds.length);
  }

  // Layout colonne: 96px (orario) + per ogni sezione `maxLanes` sotto-colonne.
  /** @type {Record<string, number>} */
  const sezColStart = {};
  const colDefs = [];
  let colCursor = 2; // colonna 1 = orario
  for (const sez of sezNames) {
    sezColStart[sez] = colCursor;
    for (let j = 0; j < maxLanes[sez]; j++) colDefs.push('minmax(220px, 1fr)');
    colCursor += maxLanes[sez];
  }
  const cols = `96px ${colDefs.join(' ')}`;
  const rows = `auto repeat(${T}, 72px)`;

  // Header colonne (ogni sezione copre le sue lane) + corner. Posizionamento esplicito.
  let cells = `<div class="cal-corner" style="grid-column:1;grid-row:1"></div>`;
  cells += sezNames.map((n) => `<div class="cal-colhead" style="grid-column:${sezColStart[n]} / ${sezColStart[n] + maxLanes[n]};grid-row:1">${escapeHtml(n)}</div>`).join('');
  // Linee orizzontali + etichette orario nella colonna sinistra
  for (let k = 0; k < T; k++) {
    const min = minStart + k * 30;
    const onHour = min % 60 === 0;
    cells += `<div class="cal-rowline" style="grid-column:1 / -1;grid-row:${k + 2}"></div>`;
    cells += `<div class="cal-time" style="grid-column:1;grid-row:${k + 2}">${
      onHour ? `<span class="cal-time__h">${fmtHM(min)}</span>` : `<span class="cal-time__30">30</span>`
    }</div>`;
  }
  // Card per blocco — colore per indice di render, colonna = sezione + lane.
  for (const it of items) {
    const col = sezColStart[it.sez] + it.lane;
    cells += dispCard(it.b, colorForIndex(it.i)).html(`${it.sTick + 2} / ${it.eTick + 2}`, `${col}`);
  }

  return `
    <div class="cal-board">
      <div class="cal-board__sala">${escapeHtml(salaNome)}</div>
      <div class="cal-grid" style="grid-template-columns:${cols};grid-template-rows:${rows}">
        ${cells}
      </div>
    </div>`;
}

function renderDisplayBoards(/** @type {any} */ root, /** @type {any} */ data) {
  markLive(data);
  const giorni = data.giorni || [];
  const head = `
    <div class="cal-disp__head">
      <img src="${escapeHtml(data.concorso?.logo || brandingLogo())}" alt="" class="cal-disp__logo" onerror="this.style.display='none'">
      <div>
        <div class="cal-disp__title">${escapeHtml(data.concorso?.nome || t('cal.title'))}</div>
        ${data.pubblicazione?.etichetta ? `<div class="cal-disp__sub">${escapeHtml(data.pubblicazione.etichetta)}</div>` : ''}
      </div>
    </div>`;

  const body = giorni.length === 0
    ? `<div class="cal-board"><div class="cal-empty">${escapeHtml(t('cal.pub.empty'))}</div></div>`
    : giorni.map((/** @type {any} */ g) => {
        // Raggruppa i blocchi del giorno per sala (un tabellone ciascuna).
        const bySala = new Map();
        for (const b of g.blocchi) {
          const k = b.sala?.nome || '—';
          if (!bySala.has(k)) bySala.set(k, []);
          bySala.get(k).push(b);
        }
        const sale = [...bySala.keys()].sort((a, b) => a.localeCompare(b));
        return `
          <section>
            <div class="cal-day__date">${escapeHtml(fmtDay(g.data))}</div>
            ${sale.map((s) => salaBoard(s, bySala.get(s))).join('')}
          </section>`;
      }).join('');

  root.innerHTML = `${DISPLAY_STYLE}<div class="cal-disp">${head}${body}</div>`;
}

function renderContent(/** @type {any} */ root, /** @type {any} */ data, /** @type {any} */ params) {
  const { display } = params;
  if (display) { renderDisplayBoards(root, data); return; }
  const giorni = data.giorni || [];
  const wrap = display ? 'max-w-none px-6 py-6 bg-canvas min-h-screen' : 'c-page max-w-5xl mx-auto';

  root.innerHTML = `
    <div class="${wrap}">
      <header class="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div class="flex items-center gap-3 min-w-0">
          <img src="${escapeHtml(data.concorso?.logo || brandingLogo())}" alt="" class="h-12 w-12 object-contain rounded-xl bg-white ring-1 ring-brand-100" onerror="this.style.display='none'">
          <div class="min-w-0">
            <h1 class="${display ? 'text-4xl' : 'text-2xl'} font-bold text-ink-900 truncate">${escapeHtml(data.concorso?.nome || t('cal.title'))}</h1>
            ${data.pubblicazione?.etichetta ? `<p class="text-sm text-ink-700">${escapeHtml(data.pubblicazione.etichetta)}</p>` : ''}
          </div>
        </div>
        ${display ? '' : `
          <div class="flex items-center gap-2">
            <button data-action="pdf" class="c-btn c-btn--outline c-btn--sm">${icon('download', { size: 15 })}<span>${escapeHtml(t('cal.pdf.export'))}</span></button>
          </div>`}
      </header>

      ${giorni.length === 0 ? `
        <div class="bg-white border-2 border-dashed border-brand-100 rounded-2xl py-16 text-center">
          <p class="text-ink-500 italic">${escapeHtml(t('cal.pub.empty'))}</p>
        </div>` : giorni.map((/** @type {any} */ g) => `
        <section class="mb-8">
          <h2 class="${display ? 'text-2xl' : 'text-lg'} font-bold text-ink-900 capitalize mb-3">${escapeHtml(fmtDay(g.data))}</h2>
          <div class="${display ? 'flex gap-4 overflow-x-auto pb-2' : 'grid gap-4 md:grid-cols-2'}">
            ${g.blocchi.map((/** @type {any} */ b) => blockCard(b, data, display)).join('')}
          </div>
        </section>`).join('')}

      <footer class="mt-10 text-center text-[11px] text-ink-500">${escapeHtml(t('app.footer.runtime'))}</footer>
    </div>`;

  const pdfBtn = root.querySelector('[data-action="pdf"]');
  if (pdfBtn) pdfBtn.addEventListener('click', () => exportCalendarioPdf(buildPdfOpts(data)));
}

export async function renderCalendarioPubblico(/** @type {any} */ root) {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  const params = parseParams();
  if (!params.token) {
    root.innerHTML = `<div class="c-page max-w-2xl mx-auto"><div class="bg-white rounded-2xl ring-1 ring-rose-200 p-8 text-center"><p class="text-rose-700">${escapeHtml(t('cal.pub.not_found'))}</p></div></div>`;
    return;
  }
  root.innerHTML = `<div class="c-page text-center py-20"><p class="text-ink-700">${escapeHtml(t('cal.pub.loading'))}</p></div>`;

  const load = async () => {
    try {
      const data = await fetchCalendarioPubblico(params.token);
      renderContent(root, data, params);
    } catch (e) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      root.innerHTML = `<div class="c-page max-w-2xl mx-auto"><div class="bg-white rounded-2xl ring-1 ring-rose-200 p-8 text-center"><p class="text-rose-700">${escapeHtml(t('cal.pub.not_found'))}</p></div></div>`;
      if (/** @type {any} */ (e)?.status && /** @type {any} */ (e).status !== 404) toast(/** @type {any} */ (e).message || 'Errore', 'error');
    }
  };

  await load();

  // Modalità tabellone: refresh in polling per riflettere modifiche e aggiornare
  // l'evidenziazione "in corso/prossimo". Interrotto al cambio rotta (renderCalendarioPubblico
  // ri-eseguito da app.js su hashchange azzera il timer all'inizio).
  if (params.display) {
    pollTimer = setInterval(load, 45_000);
  }
}
