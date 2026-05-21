import { db } from '../db.js';
import { escapeHtml, toast, modal, confirmDialog, ageFromDate, displayName, fmtDate } from '../utils.js';
import {
  pesato, getPesiFor, getScala, voteStep, fmtVoto, getModoValutazione, getCriteri,
} from '../scoring.js';
import { t } from '../i18n.js';

// Local working state for the current candidato (in-memory only, not yet saved)
const draft = {
  voti: {},
  note: '',
};

function defaultVoti(scala, fase) {
  const v = Math.round(scala * 0.7 * 10) / 10; // 70% della scala
  const out = {};
  getCriteri(fase).forEach(c => { out[c.key] = v; });
  return out;
}

function resetDraft(fase) {
  draft.voti = defaultVoti(getScala(fase), fase);
  draft.note = '';
}

function getStarEmoji(level, fase) {
  const active = currentStarLevel(fase);
  return level <= active ? '⭐' : '☆';
}
function getStarClass(level, fase) {
  const active = currentStarLevel(fase);
  return level <= active ? 'bg-white ring-2 ring-sun-400 shadow-sm' : 'bg-white/50 text-slate-300';
}
function getStarLabel(level, fase, scala) {
  const v = Math.round(scala * (level / 5) * 10) / 10;
  return `${v}/${scala}`;
}
function currentStarLevel(fase) {
  const scala = getScala(fase);
  const tot = pesato(draft.voti, fase);
  return Math.round((tot / scala) * 5);
}

export function renderCommissario(root) {
  const meta = db.state.meta;
  const com = db.state.commissari.find(c => c.id === meta.currentCommissarioId);
  if (!com) {
    location.hash = '#/';
    return;
  }
  const concorso = db.state.concorsi.find(c => c.id === com.concorso_id);
  if (!concorso) {
    db.setRole(null);
    location.hash = '#/';
    return;
  }

  const fasi = db.fasiByConcorso(concorso.id);
  const faseAttiva = fasi.find(f => f.stato === 'IN_CORSO');

  if (!faseAttiva) {
    unmountFloatingTimer();
    root.innerHTML = `
      <section class="view-fade c-page max-w-5xl mx-auto">
        ${com.is_presidente ? presidentePanelHtml(concorso, fasi) : `
          <div class="bg-card border border-border rounded-lg shadow-soft p-10 text-center">
            <div class="text-6xl mb-4">⏸️</div>
            <h2 class="text-2xl font-bold">${escapeHtml(t('com.no_phase.title'))}</h2>
            <p class="text-muted-foreground mt-2 text-base">${escapeHtml(t('com.no_phase.desc'))}</p>
            <p class="text-sm text-muted-foreground mt-4">${escapeHtml(t('com.no_phase.concorso_label'))}: <span class="font-medium text-foreground">${escapeHtml(concorso.nome)}</span></p>
          </div>
        `}
        <div class="mt-5 flex items-center justify-center gap-2">
          <a href="#/" class="c-btn c-btn--outline c-btn--sm">${escapeHtml(t('app.dashboard'))}</a>
        </div>
      </section>
    `;
    if (com.is_presidente) bindPresidentePanel(root, concorso);
    return;
  }

  const scala = getScala(faseAttiva);
  const modo = getModoValutazione(faseAttiva);
  const faseCriteri = getCriteri(faseAttiva);
  // Initialize draft if missing or stale (criteri set may have changed)
  const draftKeys = Object.keys(draft.voti).sort().join(',');
  const expectedKeys = faseCriteri.map(c => c.key).sort().join(',');
  if (draftKeys !== expectedKeys) draft.voti = defaultVoti(scala, faseAttiva);

  // Determine commissari assigned to this fase (preset all or subset).
  const assignedIds = db.getFaseCommissariIds(faseAttiva);
  if (!assignedIds.includes(com.id)) {
    return renderNotAssigned(root, concorso, faseAttiva, com);
  }

  // Find next candidato to evaluate by THIS commissario for this fase.
  const cfs = db.candidatiFaseList(faseAttiva.id);
  const allCommissariIds = assignedIds.filter(id => {
    const c = db.state.commissari.find(x => x.id === id);
    return c && c.stato !== 'INATTIVO';
  });
  const myVotedCfIds = new Set(
    db.state.valutazioni
      .filter(v => v.commissario_id === com.id)
      .map(v => v.candidato_fase_id)
  );
  const cfHasAllVotes = (cfId) => allCommissariIds.every(cid =>
    db.state.valutazioni.some(v => v.candidato_fase_id === cfId && v.commissario_id === cid)
  );

  // History: my last 2 already evaluated cfs in this fase (by posizione)
  const myEvaluated = cfs.filter(cf => myVotedCfIds.has(cf.id));
  const last2 = myEvaluated.slice(-2);

  // Synchronous: stop on the first cf not fully voted.
  // Autonomous: just first cf I haven't voted yet.
  let current = null;
  let waitingFor = null;
  if (modo === 'sincrona') {
    for (const cf of cfs) {
      if (cfHasAllVotes(cf.id)) continue;
      if (myVotedCfIds.has(cf.id)) waitingFor = cf;
      else current = cf;
      break;
    }
  } else {
    current = cfs.find(cf => !myVotedCfIds.has(cf.id));
  }

  if (waitingFor) {
    unmountFloatingTimer();
    return renderWaiting(root, concorso, faseAttiva, com, waitingFor, allCommissariIds);
  }
  if (!current) {
    unmountFloatingTimer();
    return renderAllDone(root, concorso, faseAttiva, com, myEvaluated);
  }

  const cand = db.state.candidati.find(c => c.id === current.candidato_id);
  const eta = ageFromDate(cand?.data_nascita) ?? cand?.eta;
  const totale = pesato(draft.voti, faseAttiva);
  const totaleCls = (() => {
    const norm = totale / scala;
    return norm >= 0.8 ? 'text-emerald-600' : norm >= 0.65 ? 'text-slate-900' : 'text-rose-600';
  })();
  const docenti = cand?.docenti_preparatori || [];

  root.innerHTML = `
    <section class="view-fade c-page">
      ${com.is_presidente ? presidentePanelHtml(concorso, fasi) : ''}
      <header class="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <div class="text-xs font-semibold text-amber-700 uppercase tracking-wider">${escapeHtml(faseAttiva.nome)} <span class="text-slate-400">· ${escapeHtml(t('com.scale_suffix', { scala }))}</span> ${modo === 'sincrona' ? `<span class="inline-flex items-center gap-1 ml-1 text-[10px] font-medium px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded normal-case">${escapeHtml(t('com.sincrona_tag'))}</span>` : ''}</div>
          <h2 class="text-xl sm:text-2xl font-bold text-slate-900 mt-1">${escapeHtml(concorso.nome)}</h2>
          <p class="text-sm text-slate-600 mt-0.5">${com.is_presidente ? `<span class="text-amber-700 font-semibold">${escapeHtml(t('com.presidente_label'))}</span> · ` : `${escapeHtml(t('com.commissario_label'))}: `}<span class="font-medium">${escapeHtml(displayName(com))}</span> · ${escapeHtml(com.specialita || '')}</p>
        </div>
        <div class="text-right">
          <div class="text-xs text-slate-500">${escapeHtml(t('com.progress_phase'))}</div>
          <div class="text-lg font-bold text-slate-900">${myEvaluated.length} / ${cfs.length}</div>
          <div class="w-32 h-1.5 bg-slate-200 rounded-full mt-1 overflow-hidden">
            <div class="h-full bg-amber-500" style="width: ${cfs.length ? (myEvaluated.length / cfs.length * 100) : 0}%"></div>
          </div>
        </div>
      </header>

      <div class="grid grid-cols-1 lg:grid-cols-4 gap-5">
        <!-- 25% history sidebar -->
        <aside class="lg:col-span-1">
          <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">${escapeHtml(t('com.history_title'))}</h3>
          <div class="space-y-3">
            ${last2.length === 0 ? `<div class="text-xs text-slate-400 italic bg-white border border-dashed border-slate-200 rounded-xl p-4 text-center">${escapeHtml(t('com.history_empty'))}</div>` : last2.map(cf => historyCardHtml(cf, faseAttiva, com.id, !!concorso.anonimo)).join('')}
          </div>
        </aside>

        <!-- 75% main evaluation -->
        <div class="lg:col-span-3">
          <div class="bg-white border border-slate-200 rounded-2xl p-6 shadow-soft">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex items-center gap-4">
                <div class="text-5xl sm:text-6xl font-black tabular-nums text-brand-700 leading-none">
                  ${String(cand?.numero_candidato || '').padStart(3,'0')}
                </div>
                ${concorso.anonimo ? '' : `
                <div class="w-16 h-16 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center text-3xl text-slate-400 shrink-0 ring-2 ring-white shadow-soft">
                  ${cand?.foto ? `<img src="${cand.foto}" alt="" class="w-full h-full object-cover" />` : '👤'}
                </div>`}
                <div>
                  ${concorso.anonimo
                    ? `<div class="font-semibold text-slate-900 text-lg">${escapeHtml(t('com.candidate_anonymous'))}</div>
                       <div class="text-sm text-slate-600">${escapeHtml(cand?.strumento || '')}</div>`
                    : `<div class="font-semibold text-slate-900 text-lg">${escapeHtml(displayName(cand))}</div>
                       <div class="text-sm text-slate-600">
                         ${escapeHtml(cand?.strumento || '')}${eta ? ` · ${escapeHtml(t('com.candidate_age', { eta }))}` : ''}${cand?.nazionalita ? ` · ${escapeHtml(cand.nazionalita)}` : ''}
                       </div>`}
                  <div class="text-xs text-slate-500 mt-0.5">${escapeHtml(t('com.position_in_phase', { pos: current.posizione, stato: current.stato }))}</div>
                  ${(!concorso.anonimo && docenti.length) ? `<div class="text-[11px] text-slate-500 mt-1 truncate" title="${escapeHtml(docenti.join(' · '))}">${escapeHtml(t('com.teachers_prefix', { names: docenti.join(' · ') }))}</div>` : ''}
                </div>
              </div>

              <div class="text-right">
                <div class="text-xs text-slate-500 uppercase tracking-wider">${escapeHtml(t('com.weighted_total'))}</div>
                <div id="totale" class="text-3xl font-bold ${totaleCls}">${fmtVoto(totale, scala)}<span class="text-base font-medium text-slate-400">/${scala}</span></div>
                <div class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(t('com.weights', { label: pesiLabel(faseAttiva) }))}</div>
              </div>
            </div>

            <div class="mt-6 bg-sun-50/50 border border-sun-100 rounded-xl px-4 py-3">
              <div class="flex items-center justify-between gap-4">
                <span class="text-xs font-semibold text-sun-700 uppercase tracking-wider">${escapeHtml(t('com.quick_score'))}</span>
                <div class="flex items-center gap-1" data-pictogram>
                  ${[1,2,3,4,5].map(n => `
                    <button type="button" data-star="${n}" class="w-9 h-9 rounded-xl flex items-center justify-center text-xl transition-all hover:scale-110 ${getStarClass(n, faseAttiva)}"
                      title="${escapeHtml(getStarLabel(n, faseAttiva, scala))}">${getStarEmoji(n, faseAttiva)}</button>
                  `).join('')}
                </div>
              </div>
            </div>

            <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              ${faseCriteri.map(c => sliderHtml(c, draft.voti[c.key], faseAttiva)).join('')}
            </div>

            <div class="mt-5">
              <label class="text-xs font-semibold text-slate-600 uppercase tracking-wider">${escapeHtml(t('com.notes_label'))}</label>
              <textarea id="note" rows="3" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500" placeholder="${escapeHtml(t('com.notes_placeholder'))}">${escapeHtml(draft.note)}</textarea>
            </div>

            <div class="mt-6 flex items-center gap-3 flex-wrap">
              <button data-action="skip" class="text-sm font-medium text-slate-600 hover:bg-slate-100 px-4 py-2.5 rounded-lg">${escapeHtml(t('com.reset_values'))}</button>
              <button data-action="conferma-salva" class="ml-auto inline-flex items-center justify-center gap-2 text-base font-bold text-white bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 px-7 py-3.5 rounded-2xl shadow-glow transition">
                ${escapeHtml(t('com.save_next'))}
              </button>
            </div>
          </div>

          <div class="mt-3 text-xs text-slate-500">
            ${escapeHtml(t('com.auto_promote_help'))}
          </div>
        </div>
      </div>
    </section>
  `;

  bindSliders(root, faseAttiva);
  bindPictogram(root, faseAttiva, scala);

  root.querySelector('[data-action="skip"]').addEventListener('click', () => {
    resetDraft(faseAttiva);
    renderCommissario(root);
  });

  const note = root.querySelector('#note');
  note.addEventListener('input', () => { draft.note = note.value; });

  root.querySelector('[data-action="conferma-salva"]').addEventListener('click', () => {
    const tot = pesato(draft.voti, faseAttiva);
    const norm = scala ? tot / scala : 0;
    const ammesso = faseAttiva.ordine === 1 ? norm >= 0.65 : norm >= 0.70;
    showCountdownAlert({
      cand,
      anonimo: !!concorso.anonimo,
      ammesso,
      totale: tot,
      scala,
      onConfirm: () => doSave(root, current, com, faseAttiva, ammesso),
    });
  });

  if (com.is_presidente) bindPresidentePanel(root, concorso);

  // Floating timer (sincronizzato): visibile a tutti i commissari quando la fase
  // ha tempo_minuti > 0. Solo il presidente ha i controlli.
  if ((Number(faseAttiva.tempo_minuti) || 0) > 0) {
    mountFloatingTimer(faseAttiva, current.id, !!com.is_presidente);
  } else {
    unmountFloatingTimer();
  }
}

// ---------- Presidente: pannello controllo sessione ----------
function expectedCandidatiForFase(fase) {
  const myScope = Array.isArray(fase.sezioni_ids) ? fase.sezioni_ids : [];
  const filterByScope = (cands) => myScope.length === 0
    ? cands
    : cands.filter(c => Array.isArray(c.sezioni_ids) && c.sezioni_ids.some(s => myScope.includes(s)));
  const prev = db.findPreviousFaseInChain(fase);
  if (!prev) return filterByScope(db.candidatiByConcorso(fase.concorso_id));
  const prevCfs = db.state.candidati_fase
    .filter(cf => cf.fase_id === prev.id && cf.ammesso_prossima_fase);
  return filterByScope(
    prevCfs.map(cf => db.state.candidati.find(c => c.id === cf.candidato_id)).filter(Boolean)
  );
}

function preflightCheck(fase, prevFase) {
  const checks = [];
  // Commissione
  const com = fase.commissione_id ? db.state.commissioni.find(c => c.id === fase.commissione_id) : null;
  const commissariIds = db.getFaseCommissariIds(fase);
  const numCommissari = commissariIds.length;
  if (fase.commissione_id && com) {
    checks.push({ ok: numCommissari > 0, severity: numCommissari > 0 ? 'ok' : 'block', label: t('com.pres.pf.commissione_assigned', { name: com.nome, n: numCommissari }) });
  } else if (numCommissari > 0) {
    checks.push({ ok: true, severity: 'warn', label: t('com.pres.pf.commissione_default', { n: numCommissari }) });
  } else {
    checks.push({ ok: false, severity: 'block', label: t('com.pres.pf.commissione_missing') });
  }
  // Criteri
  const numCriteri = getCriteri(fase).length;
  checks.push({ ok: numCriteri > 0, severity: numCriteri > 0 ? 'ok' : 'block', label: t('com.pres.pf.criteri', { n: numCriteri }) });
  // Previous fase
  if (prevFase && prevFase.stato !== 'CONCLUSA') {
    checks.push({ ok: false, severity: 'block', label: t('com.pres.pf.prev_open', { name: prevFase.nome }) });
  } else {
    checks.push({ ok: true, severity: 'ok', label: prevFase ? t('com.pres.pf.prev_done', { name: prevFase.nome }) : t('com.pres.pf.prev_first') });
  }
  // Candidates
  const expected = expectedCandidatiForFase(fase).length;
  if (expected === 0) {
    checks.push({ ok: false, severity: 'block', label: t('com.pres.pf.cand_zero') });
  } else if (fase.ammessi && expected > fase.ammessi) {
    checks.push({ ok: true, severity: 'warn', label: t('com.pres.pf.cand_over_cap', { n: expected, cap: fase.ammessi }) });
  } else {
    checks.push({ ok: true, severity: 'ok', label: t('com.pres.pf.cand_ok', { n: expected }) });
  }
  return { checks, expected, numCommissari, numCriteri, commissione: com };
}

function fasePresStats(fase) {
  // For IN_CORSO/CONCLUSA: candidates evaluated vs total, pass count
  const cfs = db.candidatiFaseList(fase.id);
  const total = cfs.length;
  const commissariIds = db.getFaseCommissariIds(fase);
  const fullyVoted = cfs.filter(cf => commissariIds.every(cid =>
    db.state.valutazioni.some(v => v.candidato_fase_id === cf.id && v.commissario_id === cid)
  )).length;
  const partial = cfs.filter(cf => db.state.valutazioni.some(v => v.candidato_fase_id === cf.id)).length - fullyVoted;
  const passed = cfs.filter(cf => cf.ammesso_prossima_fase).length;
  return { total, fullyVoted, partial, passed };
}

function presidentePanelHtml(concorso, fasi) {
  const totConc = fasi.filter(f => f.stato === 'CONCLUSA').length;
  const totPian = fasi.filter(f => f.stato === 'PIANIFICATA').length;
  const totCorso = fasi.filter(f => f.stato === 'IN_CORSO').length;
  return `
    <section class="bg-gradient-to-br from-amber-50 via-white to-orange-50 border border-amber-200/80 rounded-2xl p-5 mb-5 shadow-soft">
      <header class="flex items-start justify-between gap-4 flex-wrap pb-4 border-b border-amber-200/60">
        <div class="flex items-start gap-3 min-w-0">
          <div class="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-md shrink-0 text-xl">🎯</div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-bold text-slate-900">${escapeHtml(t('com.pres.session_title'))}</h3>
              <span class="text-[10px] font-bold px-2 py-0.5 bg-amber-500 text-white rounded-full uppercase tracking-wider">${escapeHtml(t('com.pres.tag'))}</span>
            </div>
            <p class="text-xs text-slate-600 mt-1 leading-relaxed">${escapeHtml(t('com.pres.session_desc'))}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-700 font-medium">
            <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>${totPian} ${escapeHtml(t('com.pres.kpi_pianificate'))}
          </span>
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>${totCorso} ${escapeHtml(t('com.pres.kpi_in_corso'))}
          </span>
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-600 font-medium">
            <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>${totConc} ${escapeHtml(t('com.pres.kpi_concluse'))}
          </span>
        </div>
      </header>
      <div class="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
        ${fasi.map(f => fasePresCardHtml(f, concorso)).join('')}
      </div>
    </section>
  `;
}

function fasePresCardHtml(fase, concorso) {
  const stato = fase.stato;
  const isPlanned = stato === 'PIANIFICATA';
  const isRunning = stato === 'IN_CORSO';
  const isDone = stato === 'CONCLUSA';
  const palette = isRunning ? { ring: 'ring-emerald-300', bg: 'bg-white', tag: 'bg-emerald-100 text-emerald-800 border-emerald-200', label: t('com.pres.state_in_corso') }
                : isDone ? { ring: 'ring-slate-200', bg: 'bg-slate-50', tag: 'bg-slate-200 text-slate-700 border-slate-300', label: t('com.pres.state_conclusa') }
                : { ring: 'ring-slate-200', bg: 'bg-white', tag: 'bg-slate-100 text-slate-700 border-slate-200', label: t('com.pres.state_pianificata') };

  const sezioniNames = (() => {
    const ids = Array.isArray(fase.sezioni_ids) ? fase.sezioni_ids : [];
    if (ids.length === 0) return t('com.pres.scope_all');
    const sez = db.sezioniByConcorso(fase.concorso_id);
    return ids.map(id => sez.find(s => s.id === id)?.nome).filter(Boolean).join(', ') || t('com.pres.scope_all');
  })();

  const modo = getModoValutazione(fase);
  const scala = getScala(fase);
  const tempo = Number(fase.tempo_minuti) || 0;
  const numCriteri = getCriteri(fase).length;
  const dataPrev = fase.data_prevista ? fmtDate(fase.data_prevista) : t('com.pres.no_date');

  const prev = db.findPreviousFaseInChain(fase);

  let actionAreaHtml = '';
  let bodyExtraHtml = '';
  if (isPlanned) {
    const pf = preflightCheck(fase, prev);
    const blockers = pf.checks.filter(c => c.severity === 'block').length;
    const warnings = pf.checks.filter(c => c.severity === 'warn').length;
    const canStart = blockers === 0;
    bodyExtraHtml = `
      <div class="mt-3 pt-3 border-t border-slate-200/80">
        <div class="flex items-center justify-between mb-2">
          <p class="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">${escapeHtml(t('com.pres.preflight_title'))}</p>
          <span class="text-[10px] ${canStart ? (warnings > 0 ? 'text-amber-700' : 'text-emerald-700') : 'text-rose-700'} font-semibold">
            ${canStart ? (warnings > 0 ? `⚠ ${warnings} ${escapeHtml(t('com.pres.warnings'))}` : `✓ ${escapeHtml(t('com.pres.all_ok'))}`) : `✗ ${blockers} ${escapeHtml(t('com.pres.blockers'))}`}
          </span>
        </div>
        <ul class="space-y-1">
          ${pf.checks.map(c => {
            const icon = c.severity === 'ok' ? '<span class="text-emerald-600">✓</span>'
                       : c.severity === 'warn' ? '<span class="text-amber-600">⚠</span>'
                       : '<span class="text-rose-600">✗</span>';
            const cls = c.severity === 'ok' ? 'text-slate-700'
                       : c.severity === 'warn' ? 'text-amber-800'
                       : 'text-rose-800 font-medium';
            return `<li class="flex items-start gap-2 text-xs ${cls}"><span class="shrink-0 mt-px">${icon}</span><span>${escapeHtml(c.label)}</span></li>`;
          }).join('')}
        </ul>
      </div>
    `;
    actionAreaHtml = `
      <div class="mt-3 pt-3 border-t border-slate-200/80 flex items-center justify-end gap-2">
        ${canStart
          ? `<button data-pres-action="start" data-id="${fase.id}" class="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-lg shadow-sm transition">${escapeHtml(t('com.pres.start'))}</button>`
          : `<button disabled class="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 bg-slate-100 cursor-not-allowed px-4 py-2 rounded-lg" title="${escapeHtml(t('com.pres.cant_start_hint'))}">${escapeHtml(t('com.pres.start'))}</button>`}
      </div>
    `;
  } else if (isRunning) {
    const stats = fasePresStats(fase);
    const pct = stats.total ? Math.round(stats.fullyVoted / stats.total * 100) : 0;
    bodyExtraHtml = `
      <div class="mt-3 pt-3 border-t border-slate-200/80">
        <div class="flex items-center justify-between mb-1.5">
          <p class="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">${escapeHtml(t('com.pres.progress_title'))}</p>
          <span class="text-xs font-bold text-emerald-700">${stats.fullyVoted} / ${stats.total} <span class="text-slate-500 font-normal">(${pct}%)</span></span>
        </div>
        <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
          <div class="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all" style="width:${pct}%"></div>
        </div>
        <div class="mt-2 flex items-center gap-3 text-[11px] text-slate-600">
          <span class="inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>${stats.fullyVoted} ${escapeHtml(t('com.pres.cand_full'))}</span>
          <span class="inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>${stats.partial} ${escapeHtml(t('com.pres.cand_partial'))}</span>
          <span class="inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-slate-300"></span>${Math.max(0, stats.total - stats.fullyVoted - stats.partial)} ${escapeHtml(t('com.pres.cand_pending'))}</span>
        </div>
      </div>
    `;
    actionAreaHtml = `
      <div class="mt-3 pt-3 border-t border-slate-200/80 flex items-center justify-end gap-2">
        <button data-pres-action="end" data-id="${fase.id}" class="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 px-4 py-2 rounded-lg shadow-sm transition">${escapeHtml(t('com.pres.end'))}</button>
      </div>
    `;
  } else if (isDone) {
    const stats = fasePresStats(fase);
    bodyExtraHtml = `
      <div class="mt-3 pt-3 border-t border-slate-200/80">
        <p class="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold mb-2">${escapeHtml(t('com.pres.outcome_title'))}</p>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="rounded-lg bg-white border border-slate-200 px-2 py-2">
            <div class="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">${escapeHtml(t('com.pres.outcome_total'))}</div>
            <div class="text-lg font-bold text-slate-800 leading-tight">${stats.total}</div>
          </div>
          <div class="rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-2">
            <div class="text-[9px] uppercase tracking-wider text-emerald-700 font-semibold">${escapeHtml(t('com.pres.outcome_passed'))}</div>
            <div class="text-lg font-bold text-emerald-800 leading-tight">${stats.passed}</div>
          </div>
          <div class="rounded-lg bg-rose-50 border border-rose-200 px-2 py-2">
            <div class="text-[9px] uppercase tracking-wider text-rose-700 font-semibold">${escapeHtml(t('com.pres.outcome_eliminated'))}</div>
            <div class="text-lg font-bold text-rose-800 leading-tight">${Math.max(0, stats.total - stats.passed)}</div>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <article class="${palette.bg} rounded-xl border border-slate-200 ${palette.ring} ring-1 p-4 transition hover:shadow-sm">
      <header class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-[10px] font-mono uppercase tracking-wider text-slate-500">${escapeHtml(t('com.pres.phase_label', { ordine: fase.ordine }))}</div>
          <h4 class="font-bold text-slate-900 text-base leading-tight truncate">${escapeHtml(fase.nome)}</h4>
        </div>
        <span class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${palette.tag}">${escapeHtml(palette.label)}</span>
      </header>
      <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <div class="flex items-center gap-1.5 text-slate-600 min-w-0"><span aria-hidden="true">📅</span><span class="truncate">${escapeHtml(dataPrev)}</span></div>
        <div class="flex items-center gap-1.5 text-slate-600 min-w-0"><span aria-hidden="true">⏱</span><span class="truncate">${tempo > 0 ? escapeHtml(t('com.pres.tempo_value', { min: tempo })) : escapeHtml(t('com.pres.tempo_off'))}</span></div>
        <div class="flex items-center gap-1.5 text-slate-600 min-w-0 col-span-2"><span aria-hidden="true">🎻</span><span class="truncate" title="${escapeHtml(sezioniNames)}">${escapeHtml(sezioniNames)}</span></div>
        <div class="flex items-center gap-1.5 text-slate-600 min-w-0"><span aria-hidden="true">⚖️</span><span class="truncate">${modo === 'sincrona' ? escapeHtml(t('com.pres.modo_sync')) : escapeHtml(t('com.pres.modo_async'))} · ${escapeHtml(t('com.pres.scala', { scala }))}</span></div>
        <div class="flex items-center gap-1.5 text-slate-600 min-w-0"><span aria-hidden="true">📋</span><span class="truncate">${escapeHtml(t('com.pres.criteri_count', { n: numCriteri }))}</span></div>
      </dl>
      ${bodyExtraHtml}
      ${actionAreaHtml}
    </article>
  `;
}

// ---------- Floating timer overlay (sincronizzato via PocketBase) ----------
// Pinned bottom-right. Tutti i commissari vedono lo stesso countdown.
// Solo il presidente ha controlli (pausa, +1 min, reset). Auto-start su cambio candidato.

const FLOATING_TIMER_ID = 'floating-timer';

const timerCtx = {
  faseId: null,
  candidateId: null,        // candidato corrente atteso (lato presidente)
  isPresidente: false,
  tickInterval: null,       // requestInterval per ridisegnare ogni 250ms
  unsub: null,              // unsub realtime
  runtime: null,            // ultimo record fase_runtime
  lastBeepAt: null,         // evita beep ripetuti
};

function formatTime(ms) {
  const tot = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(tot / 60);
  const s = tot % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// Calcola lo stato derivato dal record runtime + clock client.
function computeTimer() {
  const r = timerCtx.runtime;
  if (!r || !r.started_at) {
    return { remainingMs: 0, durationMs: 0, paused: false, expired: false, hasState: false };
  }
  const startedMs = new Date(r.started_at).getTime();
  const durMs = (Number(r.duration_seconds) || 0) * 1000;
  const paused = !!r.paused_at;
  const elapsedMs = paused
    ? new Date(r.paused_at).getTime() - startedMs
    : Date.now() - startedMs;
  const remainingMs = Math.max(0, durMs - elapsedMs);
  return { remainingMs, durationMs: durMs, paused, expired: remainingMs === 0, hasState: true };
}

function floatingTimerHtml() {
  const s = computeTimer();
  const isPres = timerCtx.isPresidente;
  const borderCls = s.expired ? 'border-rose-400 animate-pulse'
    : s.paused ? 'border-amber-300'
    : 'border-emerald-400';
  const numCls = s.expired ? 'text-rose-600'
    : s.remainingMs < 30_000 ? 'text-rose-600'
    : s.remainingMs < 60_000 ? 'text-amber-600'
    : 'text-emerald-600';
  const icon = s.expired ? '🚨' : (s.paused ? '⏸️' : '⏱');
  const status = s.expired ? t('com.timer.expired_status') : (s.paused ? t('com.timer.paused_status') : t('com.timer.running_status'));
  return `
    <div id="${FLOATING_TIMER_ID}" class="fixed bottom-6 right-6 z-40 bg-white/95 backdrop-blur-md border-2 ${borderCls} rounded-2xl px-4 py-3 shadow-pop flex items-center gap-3 transition-all" data-timer-panel role="timer" aria-live="off" aria-label="${escapeHtml(t('com.timer.aria_label'))}">
      <div class="text-3xl leading-none" aria-hidden="true">${icon}</div>
      <div class="min-w-[88px]">
        <div class="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">${escapeHtml(status)}</div>
        <div class="text-3xl font-black tabular-nums leading-none mt-0.5 ${numCls}" data-timer-display>${formatTime(s.remainingMs)}</div>
      </div>
      ${isPres ? `
        <div class="flex flex-col gap-1">
          ${s.paused
            ? `<button data-timer-action="resume" class="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 rounded-lg shadow-sm">${escapeHtml(t('com.timer.resume'))}</button>`
            : `<button data-timer-action="pause" class="text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-2.5 py-1 rounded-lg shadow-sm">${escapeHtml(t('com.timer.pause'))}</button>`}
          <button data-timer-action="bonus" class="text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1 rounded-lg" title="${escapeHtml(t('com.timer.bonus_title'))}">${escapeHtml(t('com.timer.bonus'))}</button>
          <button data-timer-action="reset" class="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg">${escapeHtml(t('com.timer.reset'))}</button>
        </div>
      ` : ''}
    </div>
  `;
}

function rerenderTimer() {
  const old = document.getElementById(FLOATING_TIMER_ID);
  if (!old) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = floatingTimerHtml();
  const fresh = wrapper.firstElementChild;
  old.replaceWith(fresh);
  bindTimerEvents();
}

function tickDisplay() {
  const s = computeTimer();
  const panel = document.getElementById(FLOATING_TIMER_ID);
  if (!panel) return;
  const disp = panel.querySelector('[data-timer-display]');
  if (disp) disp.textContent = formatTime(s.remainingMs);
  // Beep allo zero (una volta sola per record)
  if (s.expired && timerCtx.runtime && timerCtx.lastBeepAt !== timerCtx.runtime.id + ':' + timerCtx.runtime.duration_seconds) {
    timerCtx.lastBeepAt = timerCtx.runtime.id + ':' + timerCtx.runtime.duration_seconds;
    beep();
    rerenderTimer(); // bordo rosso lampeggia
  }
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain); gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.stop(ctx.currentTime + 0.6);
  } catch { /* fallback silenzioso */ }
}

function bindTimerEvents() {
  const panel = document.getElementById(FLOATING_TIMER_ID);
  if (!panel) return;
  panel.querySelectorAll('[data-timer-action]').forEach(b => b.addEventListener('click', async () => {
    const a = b.dataset.timerAction;
    const fId = timerCtx.faseId;
    try {
      if (a === 'pause')   await db.pauseFaseTimer(fId);
      else if (a === 'resume') await db.resumeFaseTimer(fId);
      else if (a === 'bonus')  await db.addFaseTimerBonus(fId, 60);
      else if (a === 'reset')  await db.resetFaseTimer(fId);
    } catch (e) {
      toast(e?.message || t('com.timer.error'), 'error');
    }
  }));
}

// Mount/refresh the floating timer.
// - presidente: assicura che il record runtime esista e sia allineato sul candidato corrente (auto-start).
// - tutti: subscribe realtime e disegna lo stato condiviso.
async function mountFloatingTimer(fase, candidateId, isPresidente) {
  const totMs = (Number(fase.tempo_minuti) || 0) * 60 * 1000;
  if (totMs <= 0) { unmountFloatingTimer(); return; }

  const faseChanged = timerCtx.faseId !== fase.id;
  timerCtx.isPresidente = !!isPresidente;
  timerCtx.candidateId = candidateId;

  if (faseChanged) {
    // Cambia fase → unsubscribe vecchia, nuovo subscribe
    if (timerCtx.unsub) { try { await timerCtx.unsub(); } catch {} timerCtx.unsub = null; }
    timerCtx.faseId = fase.id;
    timerCtx.runtime = null;
    timerCtx.lastBeepAt = null;
    timerCtx.unsub = await db.subscribeFaseRuntime(fase.id, (record) => {
      timerCtx.runtime = record;
      // Se il presidente legge un runtime con candidato_fase != quello atteso, lo riallinea.
      if (timerCtx.isPresidente
          && timerCtx.candidateId
          && (!record || record.candidato_fase !== timerCtx.candidateId)) {
        db.startFaseTimer(timerCtx.faseId, timerCtx.candidateId).catch(() => {});
      }
      rerenderTimer();
    });
  }

  // Mount DOM se non c'è
  let el = document.getElementById(FLOATING_TIMER_ID);
  if (!el) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = floatingTimerHtml();
    el = wrapper.firstElementChild;
    document.body.appendChild(el);
    bindTimerEvents();
  }

  // Tick interval (1 solo, condiviso)
  if (!timerCtx.tickInterval) {
    timerCtx.tickInterval = setInterval(tickDisplay, 250);
  }

  // Presidente: se il candidato corrente è cambiato rispetto al runtime, fa partire il timer per il nuovo
  if (timerCtx.isPresidente && candidateId) {
    const r = timerCtx.runtime;
    const needsStart = !r || r.candidato_fase !== candidateId;
    if (needsStart) {
      try { await db.startFaseTimer(fase.id, candidateId); }
      catch (e) { console.warn('startFaseTimer:', e?.message); }
    }
  }
}

export function unmountFloatingTimer() {
  const el = document.getElementById(FLOATING_TIMER_ID);
  if (el) el.remove();
  if (timerCtx.tickInterval) { clearInterval(timerCtx.tickInterval); timerCtx.tickInterval = null; }
  if (timerCtx.unsub) { timerCtx.unsub().catch(() => {}); timerCtx.unsub = null; }
  timerCtx.faseId = null;
  timerCtx.candidateId = null;
  timerCtx.runtime = null;
  timerCtx.lastBeepAt = null;
}

function bindPresidentePanel(root, concorso) {
  root.querySelectorAll('[data-pres-action="start"]').forEach(b => b.addEventListener('click', async () => {
    try {
      await db.startFase(b.dataset.id);
      toast(t('com.pres.phase_started'), 'success');
      renderCommissario(root);
    } catch (e) { toast(e.message, 'error'); }
  }));
  root.querySelectorAll('[data-pres-action="end"]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.id;
    const faseObj = db.state.fasi.find(f => f.id === id);
    if (!faseObj) return;
    // Verifica conteggio valutazioni prima di chiudere
    const cfs = db.candidatiFaseList(id);
    const commissariIds = db.getFaseCommissariIds(faseObj);
    const fullyVoted = cfs.filter(cf => commissariIds.every(cid =>
      db.state.valutazioni.some(v => v.candidato_fase_id === cf.id && v.commissario_id === cid)
    )).length;
    const total = cfs.length;
    const pct = total > 0 ? Math.round(fullyVoted / total * 100) : 0;
    modal({
      title: t('com.pres.end_confirm_title', { nome: faseObj.nome }),
      width: 'max-w-md',
      contentHtml: `
        <div class="space-y-4 text-sm">
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p class="font-semibold text-amber-900">${t('com.pres.end_warning')}</p>
            <p class="text-amber-800 mt-2 text-xs">${t('com.pres.end_stats', { n: fullyVoted, total })}</p>
            <div class="w-full h-2 bg-amber-200 rounded-full mt-2 overflow-hidden">
              <div class="h-full bg-amber-500" style="width:${pct}%"></div>
            </div>
            ${fullyVoted < total ? `<p class="text-rose-700 text-xs mt-2 font-bold">${t('com.pres.end_incomplete', { missing: total - fullyVoted })}</p>` : ''}
          </div>
          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" name="confirm_verbale" class="mt-1 w-4 h-4 rounded border-slate-300 text-brand-600" />
            <span class="text-xs text-slate-700">${t('com.pres.end_checkbox')}</span>
          </label>
        </div>
      `,
      primaryLabel: t('com.pres.end_btn'),
      onPrimary: async (body) => {
        if (!body.querySelector('[name="confirm_verbale"]').checked) {
          toast(t('com.pres.end_checkbox_required'), 'warn');
          return false;
        }
        try {
          await db.concludiFase(id);
          toast(t('com.pres.phase_ended'), 'success');
          renderCommissario(root);
        } catch (e) { toast(e.message, 'error'); return false; }
      },
    });
  }));
}

// 5-second cancelable countdown before saving the evaluation.
function showCountdownAlert({ cand, anonimo = false, ammesso, totale, scala, onConfirm }) {
  const verdictText = ammesso ? t('com.confirm.approved') : t('com.confirm.rejected');
  const headerCls = ammesso
    ? 'bg-gradient-to-br from-emerald-500 to-emerald-700'
    : 'bg-gradient-to-br from-rose-500 to-rose-700';
  const numCls = ammesso ? 'text-emerald-600' : 'text-rose-600';
  const barCls = ammesso ? 'bg-emerald-500' : 'bg-rose-500';
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm flex items-center justify-center p-4 view-fade';
  const initialSecondsLabel = t('com.confirm.seconds_other', { n: 5 });
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden">
      <div class="${headerCls} text-white px-6 py-5 text-center">
        <div class="text-4xl mb-1">⏳</div>
        <div class="text-[10px] uppercase tracking-widest font-bold opacity-90">${escapeHtml(t('com.confirm.title'))}</div>
        <h3 class="text-lg font-bold mt-1 leading-tight">#${String(cand?.numero_candidato || '').padStart(3,'0')}${anonimo ? '' : ' ' + escapeHtml(displayName(cand))}</h3>
        <div class="mt-3 inline-flex items-center gap-2 bg-white/20 rounded-full px-3 py-1 text-xs font-bold">
          ${ammesso ? '✓' : '✕'} ${escapeHtml(verdictText)} · ${fmtVoto(totale, scala)}/${scala}
        </div>
      </div>
      <div class="p-6 text-center">
        <div class="text-7xl font-black ${numCls} tabular-nums" data-cd-num>5</div>
        <p class="text-sm text-slate-600 mt-3">${t('com.confirm.autosave', { seconds: escapeHtml(initialSecondsLabel) })}</p>
        <div class="w-full h-2 bg-slate-200 rounded-full mt-4 overflow-hidden">
          <div data-cd-bar class="h-full ${barCls} transition-all" style="width:100%"></div>
        </div>
        <button data-cd-cancel class="mt-5 w-full inline-flex items-center justify-center gap-2 text-base font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-6 py-3 rounded-2xl transition">
          ${escapeHtml(t('com.confirm.cancel'))}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const totalSec = 5;
  const start = Date.now();
  let cancelled = false;
  const numEl = overlay.querySelector('[data-cd-num]');
  const txtEl = overlay.querySelector('[data-cd-text]');
  const barEl = overlay.querySelector('[data-cd-bar]');

  const cleanup = () => {
    clearInterval(intervalId);
    overlay.remove();
  };
  const tick = () => {
    if (cancelled) return;
    const elapsedMs = Date.now() - start;
    const remainingMs = Math.max(0, totalSec * 1000 - elapsedMs);
    const remainingSec = Math.ceil(remainingMs / 1000);
    numEl.textContent = remainingSec;
    txtEl.textContent = remainingSec === 1
      ? t('com.confirm.seconds_one', { n: remainingSec })
      : t('com.confirm.seconds_other', { n: remainingSec });
    barEl.style.width = `${(remainingMs / (totalSec * 1000)) * 100}%`;
    if (remainingMs <= 0) {
      cleanup();
      onConfirm();
    }
  };
  const intervalId = setInterval(tick, 100);

  overlay.querySelector('[data-cd-cancel]').addEventListener('click', () => {
    cancelled = true;
    cleanup();
  });
  // Esc to cancel
  const onKey = (e) => {
    if (e.key === 'Escape') {
      cancelled = true;
      cleanup();
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);
  tick();
}

function pesiLabel(fase) {
  return getCriteri(fase).map(c => {
    const initial = (c.label || c.key || '?').charAt(0).toUpperCase();
    return `${initial}${Math.round((c.peso || 0) * 100)}`;
  }).join('/');
}

function sliderHtml(criterio, value, fase) {
  const peso = Math.round((criterio.peso || 0) * 100);
  const scala = getScala(fase);
  const step = voteStep(scala);
  const min = scala >= 30 ? 0 : 1;
  const mid = scala / 2;
  return `
    <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
      <div class="flex items-center justify-between">
        <div class="min-w-0">
          <div class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(criterio.label)}</div>
          <div class="text-[10px] text-slate-500 uppercase tracking-wider">peso ${peso}%</div>
        </div>
        <div data-display="${escapeHtml(criterio.key)}" class="text-2xl font-bold tabular-nums text-brand-700 ml-2">${fmtVoto(value, scala)}</div>
      </div>
      <input type="range" min="${min}" max="${scala}" step="${step}" value="${value}" data-criterio="${escapeHtml(criterio.key)}"
             class="vote-range mt-2 w-full appearance-none h-1.5 bg-slate-300 rounded-full cursor-pointer" />
      <div class="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>${min}</span><span>${fmtVoto(mid, scala)}</span><span>${scala}</span>
      </div>
    </div>
  `;
}

function bindSliders(root, fase) {
  const scala = getScala(fase);
  root.querySelectorAll('input[data-criterio]').forEach(input => {
    input.addEventListener('input', () => {
      const k = input.dataset.criterio;
      const v = Number(input.value);
      draft.voti[k] = v;
      const display = root.querySelector(`[data-display="${k}"]`);
      if (display) display.textContent = fmtVoto(v, scala);
      const tot = pesato(draft.voti, fase);
      const totEl = root.querySelector('#totale');
      if (totEl) {
        totEl.innerHTML = `${fmtVoto(tot, scala)}<span class="text-base font-medium text-slate-400">/${scala}</span>`;
        totEl.classList.remove('text-emerald-600','text-slate-900','text-rose-600');
        const norm = scala ? tot / scala : 0;
        totEl.classList.add(norm >= 0.8 ? 'text-emerald-600' : norm >= 0.65 ? 'text-slate-900' : 'text-rose-600');
      }
    });
  });
}

function bindPictogram(root, fase, scala) {
  root.querySelectorAll('[data-star]').forEach(btn => {
    btn.addEventListener('click', () => {
      const level = Number(btn.dataset.star);
      const target = Math.round(scala * (level / 5) * 10) / 10;
      // Imposta TUTTI gli sliders allo stesso valore proporzionale
      getCriteri(fase).forEach(c => {
        draft.voti[c.key] = target;
        const display = root.querySelector(`[data-display="${c.key}"]`);
        if (display) display.textContent = fmtVoto(target, scala);
        const input = root.querySelector(`[data-criterio="${c.key}"]`);
        if (input) input.value = target;
      });
      // Aggiorna totale
      const tot = pesato(draft.voti, fase);
      const totEl = root.querySelector('#totale');
      if (totEl) {
        totEl.innerHTML = `${fmtVoto(tot, scala)}<span class="text-base font-medium text-slate-400">/${scala}</span>`;
        totEl.classList.remove('text-emerald-600','text-slate-900','text-rose-600');
        const norm = scala ? tot / scala : 0;
        totEl.classList.add(norm >= 0.8 ? 'text-emerald-600' : norm >= 0.65 ? 'text-slate-900' : 'text-rose-600');
      }
      // Aggiorna stelle
      updateStarUI(root, fase);
    });
  });
}

function updateStarUI(root, fase) {
  const level = currentStarLevel(fase);
  root.querySelectorAll('[data-star]').forEach(btn => {
    const n = Number(btn.dataset.star);
    btn.textContent = n <= level ? '⭐' : '☆';
    btn.className = `w-9 h-9 rounded-xl flex items-center justify-center text-xl transition-all hover:scale-110 ${n <= level ? 'bg-white ring-2 ring-sun-400 shadow-sm' : 'bg-white/50 text-slate-300'}`;
  });
}

async function doSave(root, cf, com, fase, ammesso) {
  try {
    await db.saveValutazione({
      candidato_fase_id: cf.id,
      commissario_id: com.id,
      voti: draft.voti,
      note: draft.note,
      ammesso,
    });
    const verdict = ammesso ? t('com.confirm.approved') : t('com.confirm.rejected');
    toast(t('com.save.success', { verdict }), ammesso ? 'success' : 'warn');
    resetDraft(fase);
    renderCommissario(root);
  } catch (e) {
    console.error(e);
    toast(t('com.save.error', { msg: e.message }), 'error');
  }
}

function historyCardHtml(cf, fase, commissarioId, anonimo = false) {
  const cand = db.state.candidati.find(c => c.id === cf.candidato_id);
  const myVotes = db.state.valutazioni.filter(v => v.candidato_fase_id === cf.id && v.commissario_id === commissarioId);
  const voti = {};
  myVotes.forEach(v => { voti[v.criterio] = v.voto; });
  const scala = getScala(fase);
  const totale = pesato(voti, fase);
  const norm = scala ? totale / scala : 0;
  const ammesso = cf.ammesso_prossima_fase;
  return `
    <div class="bg-white border ${ammesso ? 'border-emerald-200' : 'border-rose-200'} rounded-xl p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          ${anonimo ? '' : `<div class="w-7 h-7 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center text-sm text-slate-400 shrink-0">
            ${cand?.foto ? `<img src="${cand.foto}" alt="" class="w-full h-full object-cover" />` : '👤'}
          </div>`}
          <div class="font-mono text-xs text-slate-500">#${String(cand?.numero_candidato || '').padStart(3,'0')}</div>
        </div>
        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${ammesso ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">${escapeHtml(ammesso ? t('com.confirm.approved') : t('com.confirm.rejected'))}</span>
      </div>
      ${anonimo ? '' : `<div class="font-medium text-sm text-slate-900 truncate mt-1">${escapeHtml(displayName(cand))}</div>`}
      <div class="text-xs text-slate-500 truncate">${escapeHtml(cand?.strumento || '')}</div>
      <div class="mt-2 grid grid-cols-2 gap-1 text-[11px]">
        ${getCriteri(fase).map(c => `
          <div class="flex justify-between bg-slate-50 px-1.5 py-0.5 rounded" title="${escapeHtml(c.label)}">
            <span class="text-slate-500">${escapeHtml((c.label||'?').charAt(0).toUpperCase())}</span>
            <span class="font-mono font-medium">${fmtVoto(voti[c.key] ?? 0, scala)}</span>
          </div>
        `).join('')}
      </div>
      <div class="mt-2 text-right">
        <span class="text-[10px] text-slate-400">${escapeHtml(t('com.tot_short'))}</span>
        <span class="text-sm font-bold ${norm >= 0.65 ? 'text-slate-900' : 'text-rose-600'}">${fmtVoto(totale, scala)}<span class="text-[10px] text-slate-400">/${scala}</span></span>
      </div>
    </div>
  `;
}

function renderNotAssigned(root, concorso, fase, com) {
  unmountFloatingTimer();
  root.innerHTML = `
    <section class="view-fade max-w-2xl mx-auto text-center py-16">
      <div class="text-6xl mb-4">🚫</div>
      <h2 class="text-xl font-bold text-slate-900">${escapeHtml(t('com.not_assigned.title'))}</h2>
      <p class="text-slate-600 mt-2">${t('com.not_assigned.desc', { fase: escapeHtml(fase.nome) })}</p>
      <p class="text-sm text-slate-500 mt-1">${escapeHtml(t('com.not_assigned.concorso_label'))}: <span class="font-medium">${escapeHtml(concorso.nome)}</span></p>
      <div class="mt-6">
        <button data-action="back" class="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-lg">${escapeHtml(t('com.back_to_menu'))}</button>
      </div>
    </section>
  `;
  root.querySelector('[data-action="back"]').addEventListener('click', () => {
    db.setRole(null);
    location.hash = '#/';
  });
}

function renderWaiting(root, concorso, fase, com, cf, allCommissariIds) {
  const cand = db.state.candidati.find(c => c.id === cf.candidato_id);
  const commissari = db.commissariByConcorso(concorso.id).filter(c => allCommissariIds.includes(c.id));
  const votedSet = new Set(
    db.state.valutazioni
      .filter(v => v.candidato_fase_id === cf.id)
      .map(v => v.commissario_id)
  );
  const votedCount = commissari.filter(c => votedSet.has(c.id)).length;
  const totalCount = commissari.length;
  const eta = ageFromDate(cand?.data_nascita) ?? cand?.eta;

  root.innerHTML = `
    <section class="view-fade max-w-2xl mx-auto py-8">
      <div class="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-soft">
        <div class="text-center">
          <div class="text-5xl mb-3">⏳</div>
          <div class="text-xs font-semibold text-amber-700 uppercase tracking-wider">${escapeHtml(fase.nome)} <span class="inline-flex items-center gap-1 ml-1 text-[10px] font-medium px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded normal-case">${escapeHtml(t('com.sincrona_tag'))}</span></div>
          <h2 class="text-xl sm:text-2xl font-bold text-slate-900 mt-2">${escapeHtml(t('com.waiting.title'))}</h2>
          <p class="text-sm text-slate-600 mt-2">${escapeHtml(t('com.waiting.subtitle'))}</p>
        </div>

        <div class="mt-6 flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
          <div class="text-3xl font-black tabular-nums text-brand-700 leading-none">
            ${String(cand?.numero_candidato || '').padStart(3,'0')}
          </div>
          ${concorso.anonimo ? '' : `<div class="w-12 h-12 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center text-2xl text-slate-400 shrink-0 ring-2 ring-white">
            ${cand?.foto ? `<img src="${cand.foto}" alt="" class="w-full h-full object-cover" />` : '👤'}
          </div>`}
          <div class="min-w-0 flex-1">
            ${concorso.anonimo
              ? `<div class="font-semibold text-slate-900 truncate">${escapeHtml(t('com.candidate_anonymous'))}</div>
                 <div class="text-xs text-slate-600 truncate">${escapeHtml(cand?.strumento || '')}</div>`
              : `<div class="font-semibold text-slate-900 truncate">${escapeHtml(displayName(cand))}</div>
                 <div class="text-xs text-slate-600 truncate">${escapeHtml(cand?.strumento || '')}${eta ? ` · ${escapeHtml(t('com.candidate_age', { eta }))}` : ''}${cand?.nazionalita ? ` · ${escapeHtml(cand.nazionalita)}` : ''}</div>`}
          </div>
        </div>

        <div class="mt-6">
          <div class="flex items-center justify-between text-xs uppercase tracking-wider text-slate-500 mb-2">
            <span>${escapeHtml(t('com.waiting.committee_progress'))}</span>
            <span class="font-mono font-semibold text-slate-700">${votedCount} / ${totalCount}</span>
          </div>
          <div class="h-2 bg-slate-200 rounded-full overflow-hidden mb-3">
            <div class="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all" style="width: ${totalCount ? votedCount / totalCount * 100 : 0}%"></div>
          </div>
          <div class="space-y-2">
            ${commissari.map(c => {
              const v = votedSet.has(c.id);
              const isMe = c.id === com.id;
              return `
                <div class="flex items-center justify-between bg-white border ${v ? 'border-emerald-200' : 'border-slate-200'} rounded-lg px-3 py-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <div class="w-7 h-7 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center text-sm shrink-0">
                      ${c.foto ? `<img src="${c.foto}" alt="" class="w-full h-full object-cover" />` : '🧑‍⚖️'}
                    </div>
                    <span class="text-sm truncate ${isMe ? 'font-semibold text-slate-900' : 'text-slate-700'}">${escapeHtml(displayName(c))}${isMe ? escapeHtml(t('com.you_suffix')) : ''}</span>
                  </div>
                  <span class="text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${v ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                    ${escapeHtml(v ? t('com.voted') : t('com.waiting_dot'))}
                  </span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="mt-6 flex items-center justify-center gap-2">
          <button data-action="refresh" class="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-lg shadow-sm">↻ ${escapeHtml(t('com.waiting.refresh'))}</button>
          <button data-action="logout" class="text-sm font-medium text-slate-700 hover:bg-slate-100 px-4 py-2 rounded-lg">${escapeHtml(t('com.change_role'))}</button>
        </div>
      </div>
    </section>
  `;

  root.querySelector('[data-action="refresh"]').addEventListener('click', () => renderCommissario(root));
  root.querySelector('[data-action="logout"]').addEventListener('click', () => {
    db.setRole(null);
    location.hash = '#/';
  });
}

function renderAllDone(root, concorso, fase, com, evaluated) {
  root.innerHTML = `
    <section class="view-fade max-w-2xl mx-auto text-center py-16">
      <div class="text-6xl mb-4">✅</div>
      <h2 class="text-xl font-bold text-slate-900">${escapeHtml(t('com.all_done.title'))}</h2>
      <p class="text-slate-600 mt-2">${t('com.all_done.desc', { count: evaluated.length, fase: escapeHtml(fase.nome) })}</p>
      <p class="text-sm text-slate-500 mt-1">${escapeHtml(t('com.all_done.help'))}</p>
      <div class="mt-6">
        <button data-action="back" class="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-lg">${escapeHtml(t('com.back_to_menu'))}</button>
      </div>
    </section>
  `;
  root.querySelector('[data-action="back"]').addEventListener('click', () => {
    db.setRole(null);
    location.hash = '#/';
  });
}
