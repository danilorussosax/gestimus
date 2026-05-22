import { db } from '../db.js';
import { escapeHtml, displayName, toast } from '../utils.js';
import { pb, PB_URL } from '../pb.js';
import { runMigration, legacyTotal, clearLegacy } from '../migrate.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';

export function renderHome(root) {
  const meta = db.state.meta;
  // Anti-escalation: la fonte di verità è l'account autenticato, non meta.role
  // (che è uno stato client persistito in localStorage e può essere stato
  // resettato a null dal "Cambia ruolo"). Un account `commissario` finisce
  // SEMPRE sulla dashboard commissario e non vede mai il tile Admin.
  const authRole = pb.authStore.isValid ? (pb.authStore.model?.role || null) : null;
  if (authRole === 'commissario') {
    // Se meta.role è stato resettato, ripristiniamo il legame con il commissario
    // dell'account così renderCommissarioHome non fa redirect alla login.
    if (meta.role !== 'commissario') {
      const com = db.state.commissari.find(c => c.id === pb.authStore.model?.commissario);
      if (com) db.setRole('commissario', com.id);
    }
    return renderCommissarioHome(root);
  }
  if (meta.role === 'commissario') {
    return renderCommissarioHome(root);
  }
  const concorsi = db.state.concorsi;
  const commissari = db.state.commissari;
  const candidati = db.state.candidati;
  const fasi = db.state.fasi;
  const valutazioni = db.state.valutazioni;

  const concorsiAttivi = concorsi.filter(c => c.stato === 'ATTIVO').length;
  const fasiInCorso   = fasi.filter(f => f.stato === 'IN_CORSO').length;

  root.innerHTML = `
    <section class="view-fade">

      <!-- Carbon page header (white "layer-01" surface) -->
      <header class="c-page-header">
        <p class="c-page-header__eyebrow">${escapeHtml(t('home.eyebrow'))}</p>
        <h1 class="c-page-header__title">${escapeHtml(t('home.title'))}</h1>
        <p class="c-page-header__sub">
          ${escapeHtml(t('home.subtitle'))}
        </p>
      </header>

      <div class="c-page max-w-7xl mx-auto">

        <!-- KPI strip — separate cards w/ regular gap (shadcn idiom) -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          ${kpi(t('home.kpi.concorsi_attivi'), concorsiAttivi, t('home.kpi.concorsi_total', { n: concorsi.length }), '', 'trophy')}
          ${kpi(t('home.kpi.fasi_in_corso'), fasiInCorso, t('home.kpi.fasi_total', { n: fasi.length }), 'teal', 'flag')}
          ${kpi(t('home.kpi.candidati'), candidati.length, t('home.kpi.candidati_sub'), 'amber', 'graduation')}
          ${kpi(t('home.kpi.valutazioni'), valutazioni.length, t('home.kpi.valutazioni_sub'), 'gray', 'list')}
        </div>

        <!-- Role selector — separate clickable cards -->
        <h2 class="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-muted-foreground mb-3">${escapeHtml(t('home.role.select'))}</h2>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">

          <button data-action="role-admin" class="c-tile c-tile--padded c-tile--clickable text-left" style="min-height: 12rem;">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <p class="c-tile__eyebrow">${escapeHtml(t('home.role.admin.eyebrow'))}</p>
                <h3 class="c-tile__title flex items-center gap-2">
                  <span class="text-muted-foreground">${icon('tools', { size: 20 })}</span>
                  ${escapeHtml(t('home.role.admin.title'))}
                </h3>
                <p class="text-sm text-muted-foreground mt-3 leading-relaxed max-w-sm">
                  ${escapeHtml(t('home.role.admin.desc'))}
                </p>
              </div>
              <span class="text-muted-foreground leading-none mt-1" aria-hidden="true">${icon('arrowRight', { size: 24 })}</span>
            </div>
            <div class="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary">
              ${escapeHtml(t('home.role.admin.cta'))} ${icon('arrowRight', { size: 14 })}
            </div>
          </button>

          <div class="c-tile c-tile--padded flex flex-col" style="min-height: 12rem;">
            <p class="c-tile__eyebrow">${escapeHtml(t('home.role.com.eyebrow'))}</p>
            <h3 class="c-tile__title flex items-center gap-2">
              <span class="text-muted-foreground">${icon('music', { size: 20 })}</span>
              ${escapeHtml(t('home.role.com.title'))}
            </h3>
            <p class="text-sm text-muted-foreground mt-3 leading-relaxed">
              ${escapeHtml(t('home.role.com.desc1'))}
              <span class="font-medium text-foreground">${escapeHtml(t('home.role.com.desc_pres'))}</span>
              <span class="inline-block align-text-bottom text-amber-600" aria-hidden="true">${icon('star', { size: 14 })}</span>
              ${escapeHtml(t('home.role.com.desc2'))}
            </p>
            <div class="mt-auto pt-4">
              ${commissari.length === 0 ? `
                <p class="text-sm text-muted-foreground italic">
                  ${escapeHtml(t('home.role.com.empty'))}
                </p>
              ` : `
                <label class="c-field">
                  <span class="sr-only">${escapeHtml(t('home.role.com.label'))}</span>
                  <select id="commissario-select" class="c-select">
                    <option value="">${escapeHtml(t('home.role.com.placeholder'))}</option>
                    ${commissari.map(c => {
                      const concorso = db.state.concorsi.find(x => x.id === c.concorso_id);
                      const isPres = db.isPresidenteDiQualcheCommissione(c.id);
                      const star = isPres ? '🎯 ' : '';
                      const ruolo = isPres ? ' ' + t('home.role.com.presidente_tag') : '';
                      return `<option value="${c.id}">${star}${escapeHtml(displayName(c))} · ${escapeHtml(c.specialita || '—')} (${escapeHtml(concorso?.nome || t('home.role.com.option_default_concorso'))})${escapeHtml(ruolo)}</option>`;
                    }).join('')}
                  </select>
                </label>
                <button id="commissario-enter" class="c-btn c-btn--primary mt-3 w-full" disabled>
                  <span>${escapeHtml(t('home.role.com.cta'))}</span>
                  <span class="c-btn__icon" aria-hidden="true">${icon('arrowRight', { size: 16 })}</span>
                </button>
              `}
            </div>
          </div>

        </div>

        <!-- PocketBase / migrazione -->
        <div id="pb-card" class="mb-6"></div>

        ${concorsi.length > 0 ? `
          <h2 class="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-muted-foreground mb-3">${escapeHtml(t('home.concorsi.heading'))}</h2>
          <div class="c-tile" style="padding:0; overflow:hidden;">
            <table class="c-table">
              <thead>
                <tr>
                  <th>${escapeHtml(t('home.concorsi.col_nome'))}</th>
                  <th class="hidden md:table-cell">${escapeHtml(t('home.concorsi.col_anno'))}</th>
                  <th class="hidden md:table-cell">${escapeHtml(t('home.concorsi.col_candidati'))}</th>
                  <th>${escapeHtml(t('home.concorsi.col_fasi'))}</th>
                  <th>${escapeHtml(t('home.concorsi.col_stato'))}</th>
                </tr>
              </thead>
              <tbody>
                ${concorsi.map(c => {
                  const fs = db.fasiByConcorso(c.id);
                  const cs = db.candidatiByConcorso(c.id);
                  return `
                    <tr data-open-concorso="${escapeHtml(c.id)}" class="cursor-pointer hover:bg-brand-50/50 transition-colors" title="Apri l'amministrazione di questo concorso">
                      <td><span class="font-medium">${escapeHtml(c.nome)}</span></td>
                      <td class="hidden md:table-cell">${escapeHtml(String(c.anno))}</td>
                      <td class="hidden md:table-cell">${cs.length}</td>
                      <td>
                        <div class="flex flex-wrap gap-1.5">
                          ${fs.map(f => {
                            const cls = f.stato === 'IN_CORSO' ? 'c-tag c-tag--blue'
                                      : f.stato === 'CONCLUSA' ? 'c-tag c-tag--gray c-tag--no-dot'
                                      : 'c-tag c-tag--yellow';
                            return `<span class="${cls}">${escapeHtml(f.nome)}</span>`;
                          }).join('') || '<span class="text-xs text-muted-foreground">—</span>'}
                        </div>
                      </td>
                      <td>
                        <span class="c-tag ${c.stato === 'ATTIVO' ? 'c-tag--green' : 'c-tag--gray c-tag--no-dot'}">${escapeHtml(c.stato)}</span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}

      </div>
    </section>
  `;

  renderPbCard(root.querySelector('#pb-card'));

  // Card "Configurazione admin": porta DIRETTAMENTE al selettore concorso
  // (renderConcorsoSelector), da cui l'admin sceglie un concorso esistente o
  // ne crea uno nuovo / lo elimina. Non auto-seleziona il primo.
  // Guard: solo account admin/superadmin possono usare questo handler. Il tile
  // viene comunque nascosto a un commissario dal gate iniziale, ma duplichiamo
  // qui per chiudere il path "click via DevTools / vecchio handler in cache".
  root.querySelector('[data-action="role-admin"]')?.addEventListener('click', () => {
    const r = pb.authStore.model?.role;
    if (r !== 'admin' && r !== 'superadmin') {
      toast(t('home.role.forbidden') || 'Operazione non consentita.', 'error');
      return;
    }
    db.setRole('admin');
    db.setActiveConcorso(null);
    location.hash = '#/admin';
  });

  // Click su qualsiasi riga della tabella concorsi in basso → apre l'amministrazione
  // di quel concorso (setActiveConcorso + role=admin + #/admin).
  root.querySelectorAll('[data-open-concorso]').forEach(tr => {
    tr.addEventListener('click', () => {
      const r = pb.authStore.model?.role;
      if (r !== 'admin' && r !== 'superadmin') {
        toast(t('home.role.forbidden') || 'Operazione non consentita.', 'error');
        return;
      }
      db.setRole('admin');
      db.setActiveConcorso(tr.dataset.openConcorso);
      location.hash = '#/admin';
    });
  });

  const sel = root.querySelector('#commissario-select');
  const btn = root.querySelector('#commissario-enter');
  if (sel && btn) {
    sel.addEventListener('change', () => { btn.disabled = !sel.value; });
    btn.addEventListener('click', () => {
      if (!sel.value) return;
      const com = db.state.commissari.find(c => c.id === sel.value);
      if (!com) return;
      // Con l'anagrafica multi-concorso (migration 1700000042): se è assegnato a
      // un solo concorso entra direttamente; altrimenti attiva il primo come
      // fallback e la home commissario lo lascerà scegliere.
      const firstId = Array.isArray(com.concorsi_ids) ? com.concorsi_ids[0] : null;
      if (firstId) db.setActiveConcorso(firstId);
      db.setRole('commissario', sel.value);
      location.hash = '#/commissario';
    });
  }
}

// ---------- KPI tile helper ----------

function kpi(label, value, sub, accent = '', iconName = '') {
  const cls = accent ? `c-stat c-stat--${accent}` : 'c-stat';
  const iconHtml = iconName ? `<span class="absolute right-4 top-4 text-muted-foreground">${icon(iconName, { size: 20 })}</span>` : '';
  return `
    <div class="${cls}">
      ${iconHtml}
      <p class="c-stat__label">${escapeHtml(label)}</p>
      <p class="c-stat__value">${escapeHtml(String(value))}</p>
      <p class="c-stat__sub">${escapeHtml(sub)}</p>
    </div>
  `;
}

// ---------- PocketBase status / legacy migration card ----------

async function renderPbCard(host) {
  if (!host) return;
  const totalLegacy = legacyTotal();
  const s = db.state;
  const totalPb = s.concorsi.length + s.commissari.length + s.candidati.length + s.fasi.length + s.candidati_fase.length + s.valutazioni.length;
  // L'admin UI di PocketBase è una funzione di sistema riservata al super admin.
  // Gli admin di tenant gestiscono i loro dati dalla UI dell'app.
  const isSuperAdmin = db.state.meta.role === 'superadmin';

  if (totalLegacy === 0) {
    host.innerHTML = `
      <div class="c-tile flex items-center gap-3" style="padding: 0.75rem 1rem;">
        <span class="text-[#198038]" aria-hidden="true">${icon('database', { size: 18 })}</span>
        <span class="c-tag c-tag--green">PocketBase</span>
        <div class="flex-1 min-w-0 text-sm text-ink-700">
          ${t('home.pb.connected', { n: totalPb }).replace('<strong>', '<span class="text-ink-900 font-medium">').replace('</strong>', '</span>')}
        </div>
        ${isSuperAdmin ? `<a href="${escapeHtml(PB_URL)}/_/" target="_blank" class="c-link text-sm inline-flex items-center gap-1.5">${escapeHtml(t('home.pb.admin_ui'))} ${icon('externalLink', { size: 12 })}</a>` : ''}
      </div>
    `;
    return;
  }

  host.innerHTML = `
    <div class="c-tile c-tile--padded" style="border-left: 3px solid #f1c21b;">
      <p class="c-tile__eyebrow" style="color:#684e00">${escapeHtml(t('home.pb.legacy.eyebrow'))}</p>
      <h3 class="c-tile__title">${escapeHtml(t('home.pb.legacy.title'))}</h3>
      <p class="text-sm text-ink-700 mt-2">
        ${t('home.pb.legacy.desc', { n: totalLegacy })}
      </p>
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <button id="pb-migrate-btn" class="c-btn c-btn--primary">
          <span>${escapeHtml(t('home.pb.legacy.migrate'))}</span><span class="c-btn__icon" aria-hidden="true">${icon('play', { size: 14 })}</span>
        </button>
        <button id="pb-discard-btn" class="c-btn c-btn--ghost" style="color:#525252">
          <span>${escapeHtml(t('home.pb.legacy.discard'))}</span>
        </button>
        ${isSuperAdmin ? `<a href="${escapeHtml(PB_URL)}/_/" target="_blank" class="c-link text-sm ml-auto inline-flex items-center gap-1.5">${escapeHtml(t('home.pb.legacy.open_admin'))} ${icon('externalLink', { size: 12 })}</a>` : ''}
      </div>
      <div id="pb-progress" class="mt-4 hidden">
        <div class="text-xs text-ink-700 font-mono uppercase tracking-[0.06em]" id="pb-progress-text">…</div>
        <div class="h-1 bg-brand-100 mt-1.5 overflow-hidden">
          <div id="pb-progress-bar" class="h-full bg-brand-500 transition-all" style="width:0%"></div>
        </div>
      </div>
    </div>
  `;

  host.querySelector('#pb-discard-btn').addEventListener('click', () => {
    if (!confirm(t('home.pb.legacy.discard_confirm'))) return;
    clearLegacy();
    renderPbCard(host);
    toast(t('home.pb.legacy.discard_done'), 'info');
  });

  host.querySelector('#pb-migrate-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.firstElementChild.textContent = t('home.pb.legacy.migrating');
    const progress = host.querySelector('#pb-progress');
    const progText = host.querySelector('#pb-progress-text');
    const progBar  = host.querySelector('#pb-progress-bar');
    progress.classList.remove('hidden');
    const stages = ['concorsi','commissari','candidati','fasi','candidati_fase','valutazioni','done'];
    try {
      const report = await runMigration({
        onProgress: ({ stage, message }) => {
          progText.textContent = message;
          const i = stages.indexOf(stage);
          if (i >= 0) progBar.style.width = `${Math.round((i+1)/stages.length*100)}%`;
        }
      });
      progBar.style.width = '100%';
      progText.textContent = t('home.pb.legacy.migrate_done');
      const total = report.concorsi + report.commissari + report.candidati + report.fasi + report.candidati_fase + report.valutazioni;
      toast(t('home.pb.legacy.migrate_count', { n: total }), 'success');
      if (report.errors.length) console.warn('Errori durante migrazione:', report.errors);
      await db.reload();
      clearLegacy();
      location.hash = '#/';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) {
      console.error('Migration failed:', err);
      toast(t('home.pb.legacy.migrate_failed', { msg: err.message }), 'error');
      btn.disabled = false;
      btn.firstElementChild.textContent = t('home.pb.legacy.retry');
    }
  });
}

// ---------- Commissario landing dashboard ----------

function renderCommissarioHome(root) {
  const meta = db.state.meta;
  const currentCom = db.state.commissari.find(c => c.id === meta.currentCommissarioId);
  if (!currentCom) {
    location.hash = '#/';
    return;
  }
  // Con l'archivio per-tenant (migration 1700000042) un commissario fisico ha
  // un singolo record e un array `concorsi_ids`. Iteriamo i concorsi su cui è
  // assegnato per mostrare una card per ciascuno. `rec` resta lo STESSO record
  // (currentCom) ad ogni iterazione, ma `concorso` cambia.
  const rec = currentCom;
  const myConcorsi = (rec.concorsi_ids || [])
    .map(id => db.state.concorsi.find(x => x.id === id))
    .filter(Boolean);
  const concorsoCardsHtml = myConcorsi.map(concorso => {
    if (!concorso) return '';
    const fasi = db.fasiByConcorso(concorso.id);
    const fasiInCorso = fasi.filter(f => f.stato === 'IN_CORSO').length;
    const fasiConcluse = fasi.filter(f => f.stato === 'CONCLUSA').length;
    const candidati = db.candidatiByConcorso(concorso.id);
    // Presidente SCOPED al concorso corrente (non globale): in questo concorso
    // questo commissario è presidente di almeno una commissione?
    const recIsPres = db.state.commissioni.some(cm =>
      cm.concorso_id === concorso.id && cm.presidente_id === rec.id);
    const role = recIsPres ? t('com_home.role_presidente') : t('com_home.role_commissario');
    const roleIcon = recIsPres ? icon('star', { size: 14 }) : icon('music', { size: 14 });
    const statusClass = concorso.stato === 'ATTIVO' ? 'c-tag--green' : 'c-tag--gray c-tag--no-dot';

    // Progresso valutazioni per questo commissario nelle fasi attive
    let totalCand = 0, evaluatedCand = 0;
    fasi.forEach(f => {
      const cfs = db.state.candidati_fase.filter(cf => cf.fase_id === f.id);
      const assigned = db.getFaseCommissariIds(f).includes(rec.id);
      if (assigned && f.stato !== 'PIANIFICATA') {
        totalCand += cfs.length;
        evaluatedCand += cfs.filter(cf =>
          db.state.valutazioni.some(v => v.candidato_fase_id === cf.id && v.commissario_id === rec.id)
        ).length;
      }
    });
    const evalPct = totalCand > 0 ? Math.round(evaluatedCand / totalCand * 100) : null;

    const fasiBadge = fasiInCorso > 0
      ? `<span class="c-tag c-tag--blue">${fasiInCorso} ${escapeHtml(t('com_home.tag_in_corso'))}</span>`
      : `<span class="c-tag c-tag--gray c-tag--no-dot">${escapeHtml(t('com_home.tag_no_active'))}</span>`;
    return `
      <button data-pick-concorso="${concorso.id}" class="c-tile c-tile--padded c-tile--clickable text-left flex flex-col" style="min-height:11rem">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="c-tile__eyebrow">${escapeHtml(t('com_home.tile_eyebrow'))}</p>
            <h3 class="c-tile__title truncate">${escapeHtml(concorso.nome)}</h3>
          </div>
          <span class="c-tag ${statusClass}">${escapeHtml(concorso.stato)}</span>
        </div>
        <div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span class="inline-flex items-center gap-1">${roleIcon}<span class="font-medium">${escapeHtml(role)}</span></span>
          <span aria-hidden="true">·</span>
          <span>${escapeHtml(t('com_home.tile_year', { anno: concorso.anno }))}</span>
        </div>
        ${evalPct !== null ? `
        <div class="mt-2 bg-brand-50 border border-brand-100 rounded-lg px-3 py-1.5">
          <div class="flex items-center justify-between text-[10px] mb-1">
            <span class="font-medium text-brand-700 uppercase tracking-wider">${escapeHtml(t('com_home.progress_title'))}</span>
            <span class="font-bold text-brand-800">${evaluatedCand}/${totalCand}</span>
          </div>
          <div class="w-full h-1.5 bg-brand-100 rounded-full overflow-hidden">
            <div class="h-full bg-brand-500 rounded-full transition-all" style="width:${evalPct}%"></div>
          </div>
        </div>
        ` : ''}
        <div class="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div class="rounded-md bg-muted/40 px-2.5 py-2">
            <p class="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">${escapeHtml(t('com_home.metric_fasi'))}</p>
            <p class="text-foreground text-base font-semibold leading-tight">${fasi.length}</p>
          </div>
          <div class="rounded-md bg-muted/40 px-2.5 py-2">
            <p class="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">${escapeHtml(t('com_home.metric_candidati'))}</p>
            <p class="text-foreground text-base font-semibold leading-tight">${candidati.length}</p>
          </div>
          <div class="rounded-md bg-muted/40 px-2.5 py-2">
            <p class="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">${escapeHtml(t('com_home.metric_concluse'))}</p>
            <p class="text-foreground text-base font-semibold leading-tight">${fasiConcluse}</p>
          </div>
        </div>
        <div class="mt-auto pt-3 flex items-center justify-between">
          ${fasiBadge}
          <span class="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary">
            ${escapeHtml(t('com_home.cta_open'))} ${icon('arrowRight', { size: 14 })}
          </span>
        </div>
      </button>
    `;
  }).join('');

  const total = myConcorsi.length;
  // Quanti concorsi vedono questo commissario come presidente di almeno una commissione.
  const presCount = myConcorsi.filter(c =>
    db.state.commissioni.some(cm => cm.concorso_id === c.id && cm.presidente_id === rec.id)
  ).length;
  const greeting = t('com_home.greeting', { name: displayName(currentCom) });

  root.innerHTML = `
    <section class="view-fade">
      <header class="c-page-header">
        <p class="c-page-header__eyebrow">${escapeHtml(t('com_home.eyebrow'))}</p>
        <h1 class="c-page-header__title">${escapeHtml(greeting)}</h1>
        <p class="c-page-header__sub">${escapeHtml(t('com_home.subtitle'))}</p>
      </header>

      <div class="c-page max-w-7xl mx-auto">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          ${kpi(t('com_home.kpi.concorsi'), total, t('com_home.kpi.concorsi_sub'), '', 'trophy')}
          ${kpi(t('com_home.kpi.presidente'), presCount, t('com_home.kpi.presidente_sub'), 'amber', 'star')}
          ${kpi(t('com_home.kpi.commissario'), total - presCount, t('com_home.kpi.commissario_sub'), 'teal', 'music')}
          ${kpi(t('com_home.kpi.specialita'), currentCom.specialita || '—', t('com_home.kpi.specialita_sub'), 'gray', 'graduation')}
        </div>

        ${total === 0 ? `
          <div class="c-tile c-tile--padded text-center py-10">
            <p class="text-muted-foreground">${escapeHtml(t('com_home.empty'))}</p>
          </div>
        ` : `
          <h2 class="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-muted-foreground mb-3">${escapeHtml(t('com_home.list_heading'))}</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${concorsoCardsHtml}
          </div>
        `}
      </div>
    </section>
  `;

  root.querySelectorAll('[data-pick-concorso]').forEach(btn => {
    btn.addEventListener('click', () => {
      const concorsoId = btn.dataset.pickConcorso;
      if (!concorsoId) return;
      db.setActiveConcorso(concorsoId);
      // Il currentCom è l'anagrafica: resta invariato, cambia solo il concorso attivo.
      db.setRole('commissario', currentCom.id);
      location.hash = '#/commissario';
    });
  });
}
