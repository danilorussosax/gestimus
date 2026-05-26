/**
 * CalendarioPubblico.tsx — Calendario pubblico (no auth).
 *
 * Port di js/views/calendario-pubblico.js.
 * Legge:
 *   ?token=  — token pubblicazione (obbligatorio)
 *   ?display=1 — modalità kiosk/tabellone (nascondi chrome, polling 45s)
 *
 * Se ?token manca → mostra un <p> senza heading ("non trovato" notice).
 * Pagina pubblica — NON usa AppLayout.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Calendar } from 'lucide-react';
import { publicApi, type CalBlocco, type CalGiorno, type CalendarioPubblicResponse } from '@/api/public';
import i18n from '@/i18n';
import { exportCalendarioPdf } from '@/lib/calendario-pdf';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const hhmm = (s: string | null | undefined) => (s ? s.slice(0, 5) : '');

/**
 * Escape HTML per le interpolazioni nei template-string renderizzati via
 * dangerouslySetInnerHTML (DisplayBoard). I valori — nomi concorso/sala/
 * sezione/categoria, etichette candidati, URL logo — arrivano dal backend e
 * sono mostrati su una pagina PUBBLICA senza auth: senza escape un nome tipo
 * `<img src=x onerror=...>` sarebbe XSS stored. Copre testo e attributi "...".
 */
function esc(v: unknown): string {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmtDay(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function nowRome(): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function slotMinutes(oraPrevista: string | null | undefined): number | null {
  if (!oraPrevista) return null;
  return Number(oraPrevista.slice(0, 2)) * 60 + Number(oraPrevista.slice(3, 5));
}

type SlotWithLive = CalBlocco['slot'][0] & { _live?: 'now' | 'next' | null };

function markLive(data: CalendarioPubblicResponse): void {
  const { date, minutes } = nowRome();
  for (const g of data.giorni) {
    const isToday = g.data === date;
    const flat: SlotWithLive[] = [];
    for (const b of g.blocchi) {
      for (const s of b.slot) {
        (s as SlotWithLive)._live = null;
        if (isToday) flat.push(s);
      }
    }
    if (!isToday) continue;
    const timed = flat
      .filter((s) => slotMinutes(s.oraPrevista) != null)
      .sort((a, b) => (slotMinutes(a.oraPrevista) ?? 0) - (slotMinutes(b.oraPrevista) ?? 0));
    let current: SlotWithLive | null = null;
    for (const s of timed) {
      if ((slotMinutes(s.oraPrevista) ?? 0) <= minutes) current = s;
    }
    if (current) {
      current._live = 'now';
      const idx = timed.indexOf(current);
      if (timed[idx + 1]) timed[idx + 1]._live = 'next';
    } else if (timed[0]) {
      timed[0]._live = 'next';
    }
  }
}

// ─── Display-mode helpers ─────────────────────────────────────────────────────

function colorForIndex(i: number) {
  const hue = Math.round((i * 137.508) % 360);
  return {
    bg: `hsl(${hue} 70% 91%)`,
    fg: '#23262e',
    sub: `hsl(${hue} 28% 38%)`,
    ava: `hsl(${hue} 42% 80%)`,
    avaFg: `hsl(${hue} 45% 26%)`,
  };
}

function initials(name: string): string {
  const p = (name ?? '').trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '•';
}

function toMin(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function fmtHM(min: number): string {
  const h = Math.floor(min / 60), mm = min % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ─── CSS for display (kiosk) mode ─────────────────────────────────────────────

const DISPLAY_CSS = `
body.display-mode { background:#f4f5f7; }
.cal-disp { background:#f4f5f7; min-height:100vh; padding:20px 24px 40px; }
.cal-disp__head { display:flex; align-items:center; gap:16px; margin-bottom:20px; }
.cal-disp__logo { height:56px; width:56px; object-fit:contain; border-radius:14px; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.08); }
.cal-disp__title { font-size:2rem; font-weight:800; color:#1d2026; line-height:1.1; }
.cal-disp__sub { font-size:.95rem; color:#6b7280; }
.cal-day__date { font-size:1.15rem; font-weight:700; color:#374151; text-transform:capitalize; margin:18px 0 10px; }
/* Griglia delle sale: almeno 4 sale per riga (più su schermi larghi). Il min
   track (100% − 3·gap)/4 tiene conto dei 3 gap fra 4 colonne, così 4 board ci
   stanno SEMPRE; sopra ~1250px il cap a 300px ne fa entrare di più. */
.cal-sale-grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill, minmax(min(calc((100% - 3 * 16px) / 4), 300px), 1fr)); align-items:start; }
.cal-board { background:#fff; border-radius:20px; box-shadow:0 1px 3px rgba(0,0,0,.07); padding:14px 14px 18px; margin:0; overflow:hidden; min-width:0; }
.cal-board__sala { font-size:1.25rem; font-weight:800; color:#1d2026; padding:2px 4px 10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cal-grid { display:grid; gap:8px; align-items:stretch; position:relative; }
.cal-colhead { font-size:.95rem; font-weight:700; color:#1d2026; padding:6px 6px 10px; border-bottom:2px solid #eceef1; text-align:center; align-self:end; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cal-corner { border-bottom:2px solid #eceef1; }
.cal-time { display:flex; flex-direction:column; align-items:flex-end; justify-content:flex-start; padding:4px 6px 0 0; color:#9aa0aa; }
.cal-time__h { font-size:.85rem; font-weight:700; color:#3a3f4a; font-variant-numeric:tabular-nums; }
.cal-time__30 { font-size:.72rem; color:#b3b8c0; margin-top:2px; }
.cal-rowline { grid-column:1 / -1; border-top:1px solid #f0f1f3; pointer-events:none; }
.cal-card { border-radius:14px; padding:10px 12px; display:flex; flex-direction:column; gap:8px; overflow:hidden; box-shadow:0 1px 2px rgba(0,0,0,.05); position:relative; z-index:1; min-width:0; }
.cal-card__cat { font-size:1.05rem; font-weight:800; line-height:1.15; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cal-card__time { font-size:.82rem; font-variant-numeric:tabular-nums; opacity:.85; }
.cal-card__fase { font-size:.82rem; opacity:.8; }
.cal-names { display:flex; flex-direction:column; gap:5px; margin-top:2px; }
.cal-name { display:flex; align-items:center; gap:8px; min-width:0; }
.cal-name--now { font-weight:800; }
.cal-ava { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; font-size:.68rem; font-weight:800; flex:0 0 auto; }
.cal-name__t { font-size:.78rem; font-variant-numeric:tabular-nums; opacity:.7; min-width:38px; flex:0 0 auto; }
.cal-name__n { font-size:.9rem; flex:1 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cal-name__badge { font-size:.62rem; font-weight:800; text-transform:uppercase; letter-spacing:.04em; padding:1px 7px; border-radius:999px; }
.cal-empty { color:#9aa0aa; font-style:italic; padding:24px; text-align:center; }
`;

// ─── PDF export (PDF A4 strutturato via jsPDF, come il vanilla) ────────────────

async function handlePdfExport(
  data: CalendarioPubblicResponse,
  logoFallback: string | null,
): Promise<void> {
  const giorni = data.giorni.map((g) => ({
    data: g.data,
    blocchi: g.blocchi.map((b) => ({
      oraInizio: b.oraInizio ?? null,
      oraFine: b.oraFine ?? null,
      tipo: b.tipo,
      titolo: b.titolo ?? null,
      sala: b.sala ? { nome: b.sala.nome } : null,
      sezione: b.sezione ? { nome: b.sezione.nome } : null,
      categoria: b.categoria ? { nome: b.categoria.nome } : null,
      fase: b.fase ? { nome: b.fase.nome } : null,
      commissione: Array.isArray(b.commissione)
        ? b.commissione.map((m) => ({
            nome: m.nome ?? '',
            cognome: m.cognome ?? '',
            specialita: (m as { specialita?: string }).specialita ?? '',
          }))
        : [],
      slot: Array.isArray(b.slot)
        ? b.slot.map((s) => ({ oraPrevista: s.oraPrevista ?? null, etichetta: s.etichetta ?? '' }))
        : [],
    })),
  }));
  await exportCalendarioPdf({
    titolo: data.concorso.nome || i18n.t('cal.title'),
    sottotitolo: data.pubblicazione?.etichetta ?? undefined,
    logoUrl: data.concorso.logo || logoFallback,
    mostraCommissione: data.pubblicazione?.mostraCommissione ?? false,
    giorni,
  });
}

// ─── Block card (standard view) ───────────────────────────────────────────────

function BlockCard({
  b,
  mostraCommissione,
  display,
}: {
  b: CalBlocco;
  mostraCommissione: boolean;
  display: boolean;
}) {
  const { t } = useTranslation();
  const head =
    [b.sezione?.nome, b.categoria?.nome, b.fase?.nome].filter(Boolean).join(' · ') ||
    b.titolo ||
    (b.tipo === 'EVENTO' ? 'Evento' : 'Esibizione');
  const orario = [hhmm(b.oraInizio), hhmm(b.oraFine)].filter(Boolean).join('–');
  const hasSlots = b.slot && b.slot.length > 0;

  return (
    <article
      className={`bg-white rounded-2xl ring-1 ring-brand-100 shadow-soft overflow-hidden${display ? ' min-w-[340px]' : ''}`}
    >
      <header className="px-4 py-3 bg-brand-50/60 border-b border-brand-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3
            className={`${display ? 'text-2xl' : 'text-base'} font-bold text-ink-900 truncate`}
          >
            {head}
          </h3>
          {orario && <p className="font-mono text-xs text-brand-700">{orario}</p>}
        </div>
        {b.sala?.nome && (
          <span className="inline-flex items-center gap-1 text-ink-700 text-sm">
            <Calendar size={13} />
            {b.sala.nome}
          </span>
        )}
      </header>
      <div className="px-2 py-2">
        {hasSlots ? (
          <ul className="space-y-1">
            {b.slot.map((s, i) => {
              const live = (s as SlotWithLive)._live;
              const liveCls =
                live === 'now'
                  ? 'bg-emerald-50 ring-1 ring-emerald-300'
                  : live === 'next'
                  ? 'bg-amber-50 ring-1 ring-amber-200'
                  : '';
              return (
                <li
                  key={i}
                  className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg ${liveCls}`}
                >
                  <span
                    className={`font-mono ${display ? 'text-2xl' : 'text-sm'} text-ink-700 tabular-nums`}
                  >
                    {hhmm(s.oraPrevista) || '—'}
                  </span>
                  <span
                    className={`flex-1 ${display ? 'text-2xl' : 'text-sm'} text-ink-900 truncate`}
                  >
                    {s.etichetta || ''}
                  </span>
                  {live === 'now' && (
                    <span className="text-[10px] font-bold uppercase text-emerald-700">
                      {t('cal.pub.now')}
                    </span>
                  )}
                  {live === 'next' && (
                    <span className="text-[10px] font-bold uppercase text-amber-700">
                      {t('cal.pub.next')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-3 py-2 text-sm text-ink-500 italic">
            {b.tipo === 'EVENTO' ? (b.titolo ?? 'Evento') : t('cal.pub.empty')}
          </p>
        )}
        {mostraCommissione &&
          Array.isArray(b.commissione) &&
          b.commissione.length > 0 && (
            <p className="mt-2 text-[11px] text-ink-700 px-3">
              <span className="font-semibold">{t('cal.pub.giuria')}:</span>{' '}
              {b.commissione
                .map((m) => [m.nome, m.cognome].filter(Boolean).join(' '))
                .join(', ')}
            </p>
          )}
      </div>
    </article>
  );
}

// ─── Display (kiosk) board — sala timetable grid ──────────────────────────────

function buildSalaBoardHtml(salaNome: string, blocchi: CalBlocco[]): string {
  const sezNames = [...new Set(blocchi.map((b) => b.sezione?.nome ?? '—'))].sort((a, b) =>
    a.localeCompare(b),
  );
  const starts = blocchi
    .map((b) => toMin(b.oraInizio))
    .filter((x): x is number => x != null);
  const ends = blocchi
    .map((b) => {
      const start = toMin(b.oraInizio);
      return toMin(b.oraFine) ?? (start != null ? start + 60 : null);
    })
    .filter((x): x is number => x != null);
  const minStart = starts.length ? Math.floor(Math.min(...starts) / 30) * 30 : 9 * 60;
  const maxEnd = ends.length
    ? Math.ceil(Math.max(...ends) / 30) * 30
    : minStart + 60;
  const T = Math.max(1, (maxEnd - minStart) / 30);

  const items = blocchi.map((b, i) => {
    const start = toMin(b.oraInizio) ?? minStart;
    let end = toMin(b.oraFine) ?? start + 60;
    if (end <= start) end = start + 30;
    const sTick = Math.round((start - minStart) / 30);
    const eTick = Math.max(sTick + 1, Math.ceil((end - minStart) / 30));
    return { b, i, sez: b.sezione?.nome ?? '—', sTick, eTick, lane: 0 };
  });

  const maxLanes: Record<string, number> = {};
  for (const sez of sezNames) {
    const group = items
      .filter((it) => it.sez === sez)
      .sort((a, b) => a.sTick - b.sTick || a.eTick - b.eTick);
    const laneEnds: number[] = [];
    for (const it of group) {
      let lane = laneEnds.findIndex((e) => e <= it.sTick);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.eTick); }
      else laneEnds[lane] = it.eTick;
      it.lane = lane;
    }
    maxLanes[sez] = Math.max(1, laneEnds.length);
  }

  const sezColStart: Record<string, number> = {};
  const colDefs: string[] = [];
  let colCursor = 2;
  for (const sez of sezNames) {
    sezColStart[sez] = colCursor;
    // minmax(0, 1fr): le lane si comprimono per stare nella board a 1/4 di riga
    // (i nomi troncano con ellipsis) invece di forzare scroll orizzontale.
    for (let j = 0; j < maxLanes[sez]; j++) colDefs.push('minmax(0, 1fr)');
    colCursor += maxLanes[sez];
  }
  const cols = `56px ${colDefs.join(' ')}`;
  const rows = `auto repeat(${T}, 58px)`;

  let cells = `<div class="cal-corner" style="grid-column:1;grid-row:1"></div>`;
  cells += sezNames
    .map(
      (n) =>
        `<div class="cal-colhead" style="grid-column:${sezColStart[n]} / ${sezColStart[n] + maxLanes[n]};grid-row:1">${esc(n)}</div>`,
    )
    .join('');
  for (let k = 0; k < T; k++) {
    const min = minStart + k * 30;
    const onHour = min % 60 === 0;
    cells += `<div class="cal-rowline" style="grid-column:1 / -1;grid-row:${k + 2}"></div>`;
    cells += `<div class="cal-time" style="grid-column:1;grid-row:${k + 2}">${
      onHour
        ? `<span class="cal-time__h">${fmtHM(min)}</span>`
        : `<span class="cal-time__30">30</span>`
    }</div>`;
  }

  for (const it of items) {
    const c = colorForIndex(it.i);
    const col = sezColStart[it.sez] + it.lane;
    const cat =
      it.b.categoria?.nome ??
      it.b.sezione?.nome ??
      it.b.fase?.nome ??
      it.b.titolo ??
      'Blocco';
    const orario = [hhmm(it.b.oraInizio), hhmm(it.b.oraFine)].filter(Boolean).join(' – ');
    const slots = (it.b.slot as SlotWithLive[])
      .map((s) => {
        const live = s._live;
        const badge =
          live === 'now'
            ? `<span class="cal-name__badge" style="background:rgba(16,185,129,.9);color:#fff">${esc(i18n.t('cal.pub.now'))}</span>`
            : live === 'next'
            ? `<span class="cal-name__badge" style="background:rgba(245,158,11,.9);color:#fff">${esc(i18n.t('cal.pub.next'))}</span>`
            : '';
        return `<div class="cal-name${live === 'now' ? ' cal-name--now' : ''}">
          <span class="cal-ava" style="background:${c.ava};color:${c.avaFg}">${esc(initials(s.etichetta))}</span>
          <span class="cal-name__t">${esc(hhmm(s.oraPrevista) || '')}</span>
          <span class="cal-name__n">${esc(s.etichetta ?? '')}</span>
          ${badge}
        </div>`;
      })
      .join('');
    const namesHtml = slots
      ? `<div class="cal-names">${slots}</div>`
      : `<div class="cal-card__fase">${esc(it.b.tipo === 'EVENTO' ? (it.b.titolo ?? 'Evento') : i18n.t('cal.pub.empty'))}</div>`;
    cells += `<article class="cal-card" style="grid-row:${it.sTick + 2} / ${it.eTick + 2};grid-column:${col};background:${c.bg};color:${c.fg}">
      <div class="cal-card__cat">${esc(cat)}</div>
      ${orario ? `<div class="cal-card__time" style="color:${c.sub}">${esc(orario)}</div>` : ''}
      ${namesHtml}
    </article>`;
  }

  return `<div class="cal-board">
    <div class="cal-board__sala">${esc(salaNome)}</div>
    <div class="cal-grid" style="grid-template-columns:${cols};grid-template-rows:${rows}">${cells}</div>
  </div>`;
}

function DisplayBoard({ data }: { data: CalendarioPubblicResponse }) {
  markLive(data);

  const giorni = data.giorni;

  const bodyHtml =
    giorni.length === 0
      ? `<div class="cal-board"><div class="cal-empty">${esc(i18n.t('cal.pub.empty'))}</div></div>`
      : giorni
          .map((g: CalGiorno) => {
            const bySala = new Map<string, CalBlocco[]>();
            for (const b of g.blocchi) {
              const k = b.sala?.nome ?? '—';
              const arr = bySala.get(k) ?? [];
              arr.push(b);
              bySala.set(k, arr);
            }
            const sale = [...bySala.keys()].sort((a, b) => a.localeCompare(b));
            return `<section>
              <div class="cal-day__date">${esc(fmtDay(g.data))}</div>
              <div class="cal-sale-grid">${sale.map((s) => buildSalaBoardHtml(s, bySala.get(s) ?? [])).join('')}</div>
            </section>`;
          })
          .join('');

  const headHtml = `<div class="cal-disp__head">
    ${data.concorso.logo ? `<img src="${esc(data.concorso.logo)}" alt="" class="cal-disp__logo" onerror="this.style.display='none'" />` : ''}
    <div>
      <div class="cal-disp__title">${esc(data.concorso.nome ?? '')}</div>
      ${data.pubblicazione?.etichetta ? `<div class="cal-disp__sub">${esc(data.pubblicazione.etichetta)}</div>` : ''}
    </div>
  </div>`;

  return (
    <>
      <style>{DISPLAY_CSS}</style>
      <div
        className="cal-disp"
        dangerouslySetInnerHTML={{ __html: headHtml + bodyHtml }}
      />
    </>
  );
}

// ─── Standard content view ────────────────────────────────────────────────────

function ContentView({
  data,
  display,
  logoFallback,
}: {
  data: CalendarioPubblicResponse;
  display: boolean;
  logoFallback: string | null;
}) {
  const { t } = useTranslation();
  const mostraCommissione = data.pubblicazione?.mostraCommissione ?? false;
  const logoSrc = data.concorso.logo ?? logoFallback;
  const titolo = data.concorso.nome ?? t('cal.title');

  if (display) return <DisplayBoard data={data} />;

  markLive(data);

  return (
    <div className="c-page max-w-5xl mx-auto view-fade">
      <header className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {logoSrc && (
            <img
              src={logoSrc}
              alt=""
              className="h-12 w-12 object-contain rounded-xl bg-white ring-1 ring-brand-100"
              onError={(e) => ((e.currentTarget).style.display = 'none')}
            />
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink-900 truncate">
              {titolo}
            </h1>
            {data.pubblicazione?.etichetta && (
              <p className="text-sm text-ink-700">{data.pubblicazione.etichetta}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="c-btn c-btn--outline c-btn--sm"
            onClick={() => void handlePdfExport(data, logoFallback)}
          >
            <Download size={15} />
            <span>{t('common.export_pdf', { defaultValue: 'Esporta PDF' })}</span>
          </button>
        </div>
      </header>

      {data.giorni.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-brand-100 rounded-2xl py-16 text-center">
          <p className="text-ink-500 italic">{t('cal.pub.empty')}</p>
        </div>
      ) : (
        data.giorni.map((g: CalGiorno) => (
          <section key={g.data} className="mb-8">
            <h2 className="text-lg font-bold text-ink-900 capitalize mb-3">
              {fmtDay(g.data)}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {g.blocchi.map((b: CalBlocco) => (
                <BlockCard
                  key={b.id}
                  b={b}
                  mostraCommissione={mostraCommissione}
                  display={false}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <footer className="mt-10 text-center text-[11px] text-ink-500">
        {t('app.footer.runtime')}
      </footer>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CalendarioPubblico() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const display = searchParams.get('display') === '1';

  const calQ = useQuery({
    queryKey: ['cal-pub', token],
    queryFn: () => publicApi.getCalendario(token),
    enabled: !!token,
    refetchInterval: display ? 45_000 : false,
    staleTime: 30_000,
    retry: 1,
  });

  // Logo di fallback dell'ente quando il concorso non ne ha uno proprio.
  const brandingQ = useQuery({
    queryKey: ['ente-branding-public'],
    queryFn: () => publicApi.getEnteBranding(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const logoFallback = brandingQ.data?.brandingPublic?.logoUrl ?? null;

  // Kiosk: add body class to hide chrome
  useEffect(() => {
    if (display) {
      document.body.classList.add('display-mode');
      return () => document.body.classList.remove('display-mode');
    }
  }, [display]);

  // No token → graceful notice (plain <p>, no heading, as in vanilla)
  if (!token) {
    return (
      <div className="c-page max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl ring-1 ring-rose-200 p-8 text-center">
          <p className="text-rose-700">{t('cal.pub.unavailable', { defaultValue: 'Calendario non disponibile o link non valido.' })}</p>
        </div>
      </div>
    );
  }

  if (calQ.isLoading) {
    return (
      <div className="c-page text-center py-20">
        <p className="text-ink-700">{t('cal.pub.loading', { defaultValue: 'Caricamento calendario…' })}</p>
      </div>
    );
  }

  if (calQ.isError || !calQ.data) {
    return (
      <div className="c-page max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl ring-1 ring-rose-200 p-8 text-center">
          <p className="text-rose-700">{t('cal.pub.unavailable', { defaultValue: 'Calendario non disponibile o link non valido.' })}</p>
        </div>
      </div>
    );
  }

  return <ContentView data={calQ.data} display={display} logoFallback={logoFallback} />;
}
