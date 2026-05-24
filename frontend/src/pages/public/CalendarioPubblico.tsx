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

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { publicApi, type CalBlocco, type CalGiorno, type CalendarioPubblicResponse } from '@/api/public';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const hhmm = (s: string | null | undefined) => (s ? String(s).slice(0, 5) : '');

function fmtDay(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(navigator.language, {
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

function slotMinutes(oraPrevista: string | null): number | null {
  if (!oraPrevista) return null;
  return Number(String(oraPrevista).slice(0, 2)) * 60 + Number(String(oraPrevista).slice(3, 5));
}

function markLive(data: CalendarioPubblicResponse): void {
  const { date, minutes } = nowRome();
  for (const g of data.giorni) {
    const isToday = g.data === date;
    const flat: ((typeof g.blocchi)[0]['slot'][0] & { _live?: 'now' | 'next' | null })[] = [];
    for (const b of g.blocchi) {
      for (const s of b.slot) {
        (s as typeof s & { _live?: 'now' | 'next' | null })._live = null;
        if (isToday) flat.push(s);
      }
    }
    if (!isToday) continue;
    const timed = flat.filter((s) => slotMinutes(s.oraPrevista) != null).sort((a, b) => slotMinutes(a.oraPrevista)! - slotMinutes(b.oraPrevista)!);
    let current: typeof flat[0] | null = null;
    for (const s of timed) {
      if (slotMinutes(s.oraPrevista)! <= minutes) current = s;
    }
    if (current) {
      current._live = 'now';
      const idx = timed.indexOf(current);
      if (timed[idx + 1]) (timed[idx + 1])._live = 'next';
    } else if (timed[0]) {
      (timed[0])._live = 'next';
    }
  }
}

// ─── Block card (standard view) ───────────────────────────────────────────────

function BlockCard({ b, mostraCommissione, display }: { b: CalBlocco; mostraCommissione: boolean; display: boolean }) {
  const head = [b.sezione?.nome, b.categoria?.nome, b.fase?.nome].filter(Boolean).join(' · ')
    || b.titolo || (b.tipo === 'EVENTO' ? 'Evento' : 'Esibizione');
  const orario = [hhmm(b.oraInizio), hhmm(b.oraFine)].filter(Boolean).join('–');
  const hasSlots = b.slot && b.slot.length > 0;

  return (
    <article className="bg-white rounded-2xl ring-1 ring-primary/10 shadow-sm overflow-hidden">
      <header className="px-4 py-3 bg-primary/5 border-b border-primary/10 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className={`${display ? 'text-2xl' : 'text-base'} font-bold truncate`}>{head}</h3>
          {orario && <p className="font-mono text-xs text-primary">{orario}</p>}
        </div>
        {b.sala?.nome && (
          <span className="text-sm text-slate-600 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
            {b.sala.nome}
          </span>
        )}
      </header>
      <div className="px-2 py-2">
        {hasSlots ? (
          <ul className="space-y-1">
            {b.slot.map((s, i) => {
              const live = (s as typeof s & { _live?: string })._live;
              const liveCls = live === 'now' ? 'bg-emerald-50 ring-1 ring-emerald-300' : live === 'next' ? 'bg-amber-50 ring-1 ring-amber-200' : '';
              return (
                <li key={i} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg ${liveCls}`}>
                  <span className={`font-mono ${display ? 'text-2xl' : 'text-sm'} text-slate-700 tabular-nums`}>{hhmm(s.oraPrevista) || '—'}</span>
                  <span className={`flex-1 ${display ? 'text-2xl' : 'text-sm'} truncate`}>{s.etichetta || ''}</span>
                  {live === 'now' && <span className="text-[10px] font-bold uppercase text-emerald-700">In corso</span>}
                  {live === 'next' && <span className="text-[10px] font-bold uppercase text-amber-700">Prossimo</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-3 py-2 text-sm text-slate-500 italic">
            {b.tipo === 'EVENTO' ? (b.titolo ?? 'Evento') : 'Nessun candidato pianificato.'}
          </p>
        )}
        {mostraCommissione && Array.isArray(b.commissione) && b.commissione.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-600 px-3">
            <span className="font-semibold">Giuria:</span>{' '}
            {b.commissione.map((m) => [m.nome, m.cognome].filter(Boolean).join(' ')).join(', ')}
          </p>
        )}
      </div>
    </article>
  );
}

// ─── Display (kiosk) board ────────────────────────────────────────────────────

const DISPLAY_CSS = `
  body { background: #f4f5f7; }
  .cal-disp { background: #f4f5f7; min-height: 100vh; padding: 20px 24px 40px; }
  .cal-board { background: #fff; border-radius: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.07); padding: 18px; margin-bottom: 22px; overflow-x: auto; }
  .cal-grid { display: grid; gap: 10px; align-items: stretch; }
  .cal-colhead { font-size: 1.25rem; font-weight: 700; padding: 6px 10px 12px; border-bottom: 2px solid #eceef1; text-align: center; }
  .cal-corner { border-bottom: 2px solid #eceef1; }
  .cal-time { display: flex; flex-direction: column; align-items: flex-end; justify-content: flex-start; padding: 4px 12px 0 0; color: #9aa0aa; }
  .cal-time__h { font-size: 1.05rem; font-weight: 700; color: #3a3f4a; font-variant-numeric: tabular-nums; }
  .cal-time__30 { font-size: .8rem; color: #b3b8c0; margin-top: 2px; }
  .cal-rowline { grid-column: 1 / -1; border-top: 1px solid #f0f1f3; pointer-events: none; }
  .cal-card { border-radius: 18px; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 1px 2px rgba(0,0,0,.05); }
  .cal-card__cat { font-size: 1.4rem; font-weight: 800; line-height: 1.15; }
  .cal-names { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
  .cal-name { display: flex; align-items: center; gap: 10px; }
  .cal-ava { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: .72rem; font-weight: 800; flex: 0 0 auto; }
  .cal-name__t { font-size: .82rem; font-variant-numeric: tabular-nums; opacity: .7; min-width: 42px; }
  .cal-name__n { font-size: 1rem; }
  .cal-name__badge { font-size: .62rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; padding: 1px 7px; border-radius: 999px; }
`;

function colorForIndex(i: number) {
  const hue = Math.round((i * 137.508) % 360);
  return {
    bg: `hsl(${hue} 70% 91%)`, fg: '#23262e',
    sub: `hsl(${hue} 28% 38%)`, ava: `hsl(${hue} 42% 80%)`, avaFg: `hsl(${hue} 45% 26%)`,
  };
}

function initials(name: string): string {
  const p = String(name || '').trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '•';
}

function toMin(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function fmtHM(min: number): string {
  const h = Math.floor(min / 60), mm = min % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function DisplayBoard({ data }: { data: CalendarioPubblicResponse }) {
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    markLive(data);
  }, [data]);

  const giorni = data.giorni;

  function buildSalaBoard(salaNome: string, blocchi: CalBlocco[]): string {
    const sezNames = [...new Set(blocchi.map((b) => b.sezione?.nome ?? '—'))].sort();
    const starts = blocchi.map((b) => toMin(b.oraInizio)).filter((x): x is number => x != null);
    const ends = blocchi.map((b) => toMin(b.oraFine) ?? (toMin(b.oraInizio) != null ? toMin(b.oraInizio)! + 60 : null)).filter((x): x is number => x != null);
    const minStart = starts.length ? Math.floor(Math.min(...starts) / 30) * 30 : 9 * 60;
    const maxEnd = ends.length ? Math.ceil(Math.max(...ends) / 30) * 30 : minStart + 60;
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
      const group = items.filter((it) => it.sez === sez).sort((a, b) => a.sTick - b.sTick);
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
      for (let j = 0; j < maxLanes[sez]; j++) colDefs.push('minmax(220px, 1fr)');
      colCursor += maxLanes[sez];
    }
    const cols = `96px ${colDefs.join(' ')}`;
    const rows = `auto repeat(${T}, 72px)`;

    let cells = `<div class="cal-corner" style="grid-column:1;grid-row:1"></div>`;
    cells += sezNames.map((n) => `<div class="cal-colhead" style="grid-column:${sezColStart[n]} / ${sezColStart[n] + maxLanes[n]};grid-row:1">${n}</div>`).join('');
    for (let k = 0; k < T; k++) {
      const min = minStart + k * 30;
      const onHour = min % 60 === 0;
      cells += `<div class="cal-rowline" style="grid-column:1 / -1;grid-row:${k + 2}"></div>`;
      cells += `<div class="cal-time" style="grid-column:1;grid-row:${k + 2}">${onHour ? `<span class="cal-time__h">${fmtHM(min)}</span>` : `<span class="cal-time__30">30</span>`}</div>`;
    }
    for (const it of items) {
      const c = colorForIndex(it.i);
      const col = sezColStart[it.sez] + it.lane;
      const cat = it.b.categoria?.nome ?? it.b.sezione?.nome ?? it.b.fase?.nome ?? it.b.titolo ?? 'Blocco';
      const slots = it.b.slot.map((s) => {
        const live = (s as typeof s & { _live?: string })._live;
        const badge = live === 'now'
          ? `<span class="cal-name__badge" style="background:rgba(16,185,129,.9);color:#fff">In corso</span>`
          : live === 'next' ? `<span class="cal-name__badge" style="background:rgba(245,158,11,.9);color:#fff">Prossimo</span>` : '';
        return `<div class="cal-name${live === 'now' ? ' cal-name--now' : ''}">
          <span class="cal-ava" style="background:${c.ava};color:${c.avaFg}">${initials(s.etichetta)}</span>
          <span class="cal-name__t">${hhmm(s.oraPrevista) || ''}</span>
          <span class="cal-name__n">${s.etichetta ?? ''}</span>
          ${badge}
        </div>`;
      }).join('');
      cells += `<article class="cal-card" style="grid-row:${it.sTick + 2} / ${it.eTick + 2};grid-column:${col};background:${c.bg};color:${c.fg}">
        <div class="cal-card__cat">${cat}</div>
        ${slots ? `<div class="cal-names">${slots}</div>` : ''}
      </article>`;
    }

    return `<div class="cal-board">
      <div style="font-size:1.6rem;font-weight:800;color:#1d2026;padding:4px 6px 14px;">${salaNome}</div>
      <div class="cal-grid" style="grid-template-columns:${cols};grid-template-rows:${rows}">${cells}</div>
    </div>`;
  }

  const html = giorni.map((g) => {
    const bySala = new Map<string, CalBlocco[]>();
    for (const b of g.blocchi) {
      const k = b.sala?.nome ?? '—';
      const arr = bySala.get(k) ?? [];
      arr.push(b);
      bySala.set(k, arr);
    }
    const sale = [...bySala.keys()].sort();
    return `<section>
      <div style="font-size:1.15rem;font-weight:700;color:#374151;text-transform:capitalize;margin:18px 0 10px;">${fmtDay(g.data)}</div>
      ${sale.map((s) => buildSalaBoard(s, bySala.get(s)!)).join('')}
    </section>`;
  }).join('');

  const head = `<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">
    ${data.concorso.logo ? `<img src="${data.concorso.logo}" alt="" style="height:56px;width:56px;object-fit:contain;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.08);" />` : ''}
    <div>
      <div style="font-size:2rem;font-weight:800;color:#1d2026;line-height:1.1;">${data.concorso.nome ?? ''}</div>
      ${data.pubblicazione?.etichetta ? `<div style="font-size:.95rem;color:#6b7280;">${data.pubblicazione.etichetta}</div>` : ''}
    </div>
  </div>`;

  const fullHtml = `${head}${giorni.length === 0 ? '<div style="color:#9aa0aa;font-style:italic;padding:24px;text-align:center;">Nessun evento pianificato.</div>' : html}`;

  return (
    <>
      <style>{DISPLAY_CSS}</style>
      <div className="cal-disp" ref={boardRef} dangerouslySetInnerHTML={{ __html: fullHtml }} />
    </>
  );
}

// ─── Standard content view ────────────────────────────────────────────────────

function ContentView({ data, display }: { data: CalendarioPubblicResponse; display: boolean }) {
  const mostraCommissione = data.pubblicazione?.mostraCommissione ?? false;

  if (display) return <DisplayBoard data={data} />;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {data.concorso.logo && (
            <img src={data.concorso.logo} alt="" className="h-12 w-12 object-contain rounded-xl bg-white ring-1 ring-primary/10" />
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">{data.concorso.nome}</h1>
            {data.pubblicazione?.etichetta && <p className="text-sm text-muted-foreground">{data.pubblicazione.etichetta}</p>}
          </div>
        </div>
      </header>

      {data.giorni.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-primary/20 rounded-2xl py-16 text-center">
          <p className="text-muted-foreground italic">Nessun evento pianificato.</p>
        </div>
      ) : (
        data.giorni.map((g: CalGiorno) => (
          <section key={g.data} className="mb-8">
            <h2 className="text-lg font-bold capitalize mb-3">{fmtDay(g.data)}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {g.blocchi.map((b: CalBlocco) => (
                <BlockCard key={b.id} b={b} mostraCommissione={mostraCommissione} display={false} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CalendarioPubblico() {
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

  // Kiosk: remove padding/chrome
  useEffect(() => {
    if (display) {
      document.body.classList.add('display-mode');
      return () => document.body.classList.remove('display-mode');
    }
  }, [display]);

  if (!token) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <p className="text-muted-foreground">Calendario non disponibile o link non valido.</p>
      </div>
    );
  }

  if (calQ.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-muted-foreground">Caricamento calendario…</p>
      </div>
    );
  }

  if (calQ.isError || !calQ.data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-2xl ring-1 ring-rose-200 p-8 text-center">
          <p className="text-rose-700">Calendario non disponibile o link non valido.</p>
        </div>
      </div>
    );
  }

  return <ContentView data={calQ.data} display={display} />;
}
