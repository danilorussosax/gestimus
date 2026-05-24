// Pagina pubblica del calendario (no auth). Renderizzata anche pre-login dalla
// rotta #/calendario?token=…[&display=1]. Fetch standalone (non passa dallo
// state autenticato). Modalità tabellone con polling + evidenziazione live.

import { fetchCalendarioPubblico, db } from '../db.js';
import { escapeHtml, toast } from '../utils.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { exportCalendarioPdf } from '../calendario-pdf.js';

let pollTimer = null;

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

const hhmm = (s) => (s ? String(s).slice(0, 5) : '');
function fmtDay(iso) {
  if (!iso) return '';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return iso; }
}

// Ora/data correnti nel fuso della piattaforma (Europe/Rome) per l'evidenziazione.
function nowRome() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function slotMinutes(s) {
  if (!s.oraPrevista) return null;
  return Number(String(s.oraPrevista).slice(0, 2)) * 60 + Number(String(s.oraPrevista).slice(3, 5));
}

// Marca "in corso" / "prossimo" sugli slot del giorno corrente (solo display).
function markLive(data) {
  const { date, minutes } = nowRome();
  for (const g of (data.giorni || [])) {
    const isToday = g.data === date;
    const flat = [];
    for (const b of g.blocchi) for (const s of (b.slot || [])) { s._live = null; if (isToday) flat.push(s); }
    if (!isToday) continue;
    const timed = flat.filter((s) => slotMinutes(s) != null).sort((a, b) => slotMinutes(a) - slotMinutes(b));
    let current = null;
    for (const s of timed) { if (slotMinutes(s) <= minutes) current = s; }
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

function slotRow(s, display) {
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

function blockCard(b, data, display) {
  const head = [b.sezione?.nome, b.categoria?.nome, b.fase?.nome].filter(Boolean).join(' · ')
    || b.titolo || (b.tipo === 'EVENTO' ? t('cal.block.tipo.evento') : t('cal.block.tipo.esibizione'));
  const orario = [hhmm(b.oraInizio), hhmm(b.oraFine)].filter(Boolean).join('–');
  const sala = b.sala?.nome ? `<span class="inline-flex items-center gap-1 text-ink-700">${icon('calendar', { size: 13 })}${escapeHtml(b.sala.nome)}</span>` : '';
  const giuria = (data.pubblicazione?.mostraCommissione && Array.isArray(b.commissione) && b.commissione.length)
    ? `<p class="mt-2 text-[11px] text-ink-700"><span class="font-semibold">${escapeHtml(t('cal.pub.giuria'))}:</span> ${escapeHtml(b.commissione.map((m) => [m.nome, m.cognome].filter(Boolean).join(' ')).join(', '))}</p>`
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
          ? `<ul class="space-y-1">${b.slot.map((s) => slotRow(s, display)).join('')}</ul>`
          : `<p class="px-3 py-2 text-sm text-ink-500 italic">${escapeHtml(b.tipo === 'EVENTO' ? (b.titolo || t('cal.block.tipo.evento')) : t('cal.pub.empty'))}</p>`}
        ${giuria}
      </div>
    </article>`;
}

function buildPdfOpts(data) {
  return {
    titolo: data.concorso?.nome || t('cal.pdf.title'),
    sottotitolo: data.pubblicazione?.etichetta || '',
    logoUrl: data.concorso?.logo || brandingLogo(),
    mostraCommissione: !!data.pubblicazione?.mostraCommissione,
    giorni: data.giorni || [],
  };
}

function renderContent(root, data, params) {
  const { display } = params;
  if (display) markLive(data);
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
        </div>` : giorni.map((g) => `
        <section class="mb-8">
          <h2 class="${display ? 'text-2xl' : 'text-lg'} font-bold text-ink-900 capitalize mb-3">${escapeHtml(fmtDay(g.data))}</h2>
          <div class="${display ? 'flex gap-4 overflow-x-auto pb-2' : 'grid gap-4 md:grid-cols-2'}">
            ${g.blocchi.map((b) => blockCard(b, data, display)).join('')}
          </div>
        </section>`).join('')}

      <footer class="mt-10 text-center text-[11px] text-ink-500">${escapeHtml(t('app.footer.runtime'))}</footer>
    </div>`;

  const pdfBtn = root.querySelector('[data-action="pdf"]');
  if (pdfBtn) pdfBtn.addEventListener('click', () => exportCalendarioPdf(buildPdfOpts(data)));
}

export async function renderCalendarioPubblico(root) {
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
      if (e?.status && e.status !== 404) toast(e.message || 'Errore', 'error');
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
