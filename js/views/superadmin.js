// Super-admin: gestione enti + audit + backup + config piattaforma.
// Backend Postgres+Fastify: tutto via /api/platform/* (vedi server/src/routes/platform.ts).

import { api, ApiError } from '../api.js';
import { icon } from '../icons.js';
import { escapeHtml, fmtDate, fmtBytes, toast, modal, confirmDialog } from '../utils.js';
import { PIANO_KEYS, pianoPriceLabel } from '../piani.js';

const STATI = ['attivo', 'sospeso', 'archiviato'];

const state = {
  tab: 'enti', // 'enti' | 'audit' | 'backups' | 'config'
  enti: [],
  enteFilter: 'all',
  audit: [],
  backups: [],
  config: null,
};

export function renderSuperadmin(root) {
  root.innerHTML = `
    <section class="view-fade c-page">
      <header class="c-page-header">
        <p class="c-page-header__eyebrow">Super admin</p>
        <h1 class="c-page-header__title">Pannello piattaforma</h1>
        <p class="c-page-header__sub">Gestione enti, audit globale, backup pre-cancellazione e configurazione di sistema.</p>
      </header>
      <div class="c-page max-w-6xl mx-auto">
        <nav class="flex flex-wrap gap-2 border-b border-slate-200 mb-6" role="tablist" id="sa-tabs">
          ${tabButton('enti', 'Enti', 'building')}
          ${tabButton('audit', 'Audit log', 'list')}
          ${tabButton('backups', 'Backup', 'download')}
          ${tabButton('config', 'Configurazione', 'settings')}
        </nav>
        <div id="sa-panel"></div>
      </div>
    </section>
  `;
  root.querySelectorAll('#sa-tabs [data-tab]').forEach((b) => {
    b.addEventListener('click', () => switchTab(root, b.dataset.tab));
  });
  switchTab(root, state.tab);
}

function tabButton(key, label, iconName) {
  return `
    <button data-tab="${key}" class="sa-tab inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 border-transparent text-ink-700 hover:text-ink-900 hover:border-slate-300 transition-colors">
      ${icon(iconName, { size: 16 })}<span>${label}</span>
    </button>
  `;
}

function switchTab(root, tab) {
  state.tab = tab;
  root.querySelectorAll('#sa-tabs [data-tab]').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('text-brand-700', active);
    b.classList.toggle('border-brand-600', active);
    b.classList.toggle('text-ink-700', !active);
  });
  const panel = root.querySelector('#sa-panel');
  if (tab === 'enti') return renderEntiPanel(panel);
  if (tab === 'audit') return renderAuditPanel(panel);
  if (tab === 'backups') return renderBackupsPanel(panel);
  if (tab === 'config') return renderConfigPanel(panel);
}

// ============================================================================
// ENTI
// ============================================================================

async function renderEntiPanel(panel) {
  panel.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div class="flex items-center gap-2">
        <label class="text-sm text-ink-700">Stato:</label>
        <select id="sa-stato-filter" class="c-input c-input--sm">
          <option value="all">Tutti</option>
          <option value="attivo">Attivi</option>
          <option value="sospeso">Sospesi</option>
          <option value="archiviato">Archiviati</option>
        </select>
        <span class="text-sm text-ink-700 ml-2" id="sa-enti-count"></span>
      </div>
      <button data-action="new-ente" class="c-btn c-btn--primary c-btn--sm">
        ${icon('plus', { size: 14 })}<span>Nuovo ente</span>
      </button>
    </div>
    <div id="sa-enti-list"><div class="text-center py-10 text-ink-700 text-sm">Caricamento…</div></div>
  `;
  panel.querySelector('#sa-stato-filter').value = state.enteFilter;
  panel.querySelector('#sa-stato-filter').addEventListener('change', (e) => {
    state.enteFilter = e.target.value;
    loadEnti(panel);
  });
  panel.querySelector('[data-action="new-ente"]').addEventListener('click', () => showNewEnteModal(panel));
  await loadEnti(panel);
}

async function loadEnti(panel) {
  const listEl = panel.querySelector('#sa-enti-list');
  try {
    const query = state.enteFilter === 'all' ? null : { stato: state.enteFilter };
    state.enti = await api.get('/api/platform/tenants', query);
  } catch (err) {
    listEl.innerHTML = errorBox('Caricamento enti fallito', err);
    return;
  }
  panel.querySelector('#sa-enti-count').textContent = `${state.enti.length} ente${state.enti.length === 1 ? '' : 'i'}`;
  if (state.enti.length === 0) {
    listEl.innerHTML = emptyBox('Nessun ente in questo stato.');
    return;
  }
  listEl.innerHTML = `
    <div class="grid gap-3">
      ${state.enti.map(enteCard).join('')}
    </div>
  `;
  listEl.querySelectorAll('[data-ente-id]').forEach((card) => {
    card.querySelector('[data-action="detail"]').addEventListener('click', () => {
      showEnteDetail(card.dataset.enteId, panel);
    });
  });
}

function enteCard(t) {
  const statoBadge = badge(t.stato, statoColor(t.stato));
  const pianoBadge = badge(t.piano, 'bg-slate-100 text-slate-800');
  const archInfo = t.stato === 'archiviato'
    ? `<span class="text-xs text-amber-700">Cleanup ${cleanupCountdown(t)}</span>`
    : '';
  const protectedFlag = t.slug === 'platform' ? `<span class="text-xs text-slate-500 italic">(super-admin)</span>` : '';
  return `
    <div class="c-card p-4 flex flex-wrap items-center justify-between gap-3" data-ente-id="${t.id}">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <strong class="text-ink-900">${escapeHtml(t.nome)}</strong>
          ${statoBadge}
          ${pianoBadge}
          ${protectedFlag}
        </div>
        <div class="text-xs text-ink-700 mt-1">
          <code>${escapeHtml(t.slug)}</code> · creato il ${fmtDate(t.createdAt)}
          ${t.pianoScadenza ? ` · scadenza piano ${fmtDate(t.pianoScadenza)}` : ''}
          ${archInfo ? ` · ${archInfo}` : ''}
        </div>
      </div>
      <div class="flex gap-2">
        <button data-action="detail" class="c-btn c-btn--ghost c-btn--sm">
          ${icon('arrowRight', { size: 14 })}<span>Dettaglio</span>
        </button>
      </div>
    </div>
  `;
}

function statoColor(s) {
  if (s === 'attivo') return 'bg-emerald-100 text-emerald-800';
  if (s === 'sospeso') return 'bg-amber-100 text-amber-800';
  if (s === 'archiviato') return 'bg-rose-100 text-rose-800';
  return 'bg-slate-100 text-slate-800';
}

function cleanupCountdown(t) {
  if (!t.cleanupScheduledAt) return 'mai';
  const ms = new Date(t.cleanupScheduledAt).getTime() - Date.now();
  if (ms <= 0) return 'scaduto (in attesa job)';
  const days = Math.ceil(ms / 86400_000);
  return `${days} ${days === 1 ? 'giorno' : 'giorni'}`;
}

// ============================================================================
// Dettaglio ente (modal)
// ============================================================================

async function showEnteDetail(id, panel) {
  let ente, stats, smtp;
  try {
    [ente, stats, smtp] = await Promise.all([
      api.get(`/api/platform/tenants/${id}`),
      api.get(`/api/platform/tenants/${id}/stats`),
      api.get(`/api/platform/tenants/${id}/smtp`),
    ]);
  } catch (err) {
    toast(`Errore caricamento dettaglio: ${err.message}`, 'error');
    return;
  }
  modal({
    title: `Ente: ${ente.nome}`,
    wide: true,
    contentHtml: enteDetailHtml(ente, stats, smtp),
    onMount: (modalRoot) => wireDetailActions(modalRoot, ente, panel),
    primaryLabel: null,
  });
}

function enteDetailHtml(t, stats, smtp) {
  return `
    <div class="space-y-5">
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 class="text-sm font-semibold text-ink-900 mb-2">Anagrafica</h3>
          <dl class="text-sm space-y-1">
            <div class="flex justify-between"><dt class="text-ink-700">Slug:</dt><dd><code>${escapeHtml(t.slug)}</code></dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">Stato:</dt><dd>${badge(t.stato, statoColor(t.stato))}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">Piano:</dt><dd>${escapeHtml(t.piano)} <span class="text-xs text-ink-700">(${pianoPriceLabel(t.piano)})</span></dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">Dominio:</dt><dd>${t.dominio ? escapeHtml(t.dominio) : '<span class="text-ink-500 italic">—</span>'}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">Cleanup days:</dt><dd>${t.cleanupAfterDays === 0 ? 'mai' : t.cleanupAfterDays}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">2FA admin:</dt><dd>${t.require2faAdmin ? 'richiesto' : 'opzionale'}</dd></div>
            ${t.stato === 'archiviato' ? `<div class="flex justify-between"><dt class="text-ink-700">Archiviato il:</dt><dd>${fmtDate(t.archiviatoAt)}</dd></div>` : ''}
            ${t.stato === 'archiviato' ? `<div class="flex justify-between"><dt class="text-ink-700">Cleanup tra:</dt><dd class="text-amber-700">${cleanupCountdown(t)}</dd></div>` : ''}
          </dl>
        </div>
        <div>
          <h3 class="text-sm font-semibold text-ink-900 mb-2">Statistiche</h3>
          <dl class="text-sm space-y-1">
            <div class="flex justify-between"><dt class="text-ink-700">Concorsi:</dt><dd>${stats.concorsi}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">Commissari:</dt><dd>${stats.commissari}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">Candidati:</dt><dd>${stats.candidati}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">Iscrizioni:</dt><dd>${stats.iscrizioni}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-700">Account:</dt><dd>${stats.accounts}</dd></div>
          </dl>
        </div>
      </div>

      <div>
        <h3 class="text-sm font-semibold text-ink-900 mb-2">SMTP</h3>
        <p class="text-sm text-ink-700">
          ${smtp.configured ? `Configurato${smtp.encrypted ? ' (password cifrata at-rest)' : ''}` : 'Non configurato (verrà usato il fallback platform).'}
        </p>
        <div class="flex gap-2 mt-2">
          <button data-action="smtp-edit" class="c-btn c-btn--ghost c-btn--sm">${icon('settings', { size: 14 })}<span>Configura SMTP</span></button>
          ${smtp.configured ? `<button data-action="smtp-delete" class="c-btn c-btn--ghost c-btn--sm text-rose-700">${icon('x', { size: 14 })}<span>Rimuovi</span></button>` : ''}
        </div>
      </div>

      ${t.note ? `<div><h3 class="text-sm font-semibold text-ink-900 mb-1">Note</h3><p class="text-sm text-ink-700 whitespace-pre-wrap">${escapeHtml(t.note)}</p></div>` : ''}

      <div>
        <h3 class="text-sm font-semibold text-ink-900 mb-2">Azioni</h3>
        <div class="flex flex-wrap gap-2">
          <button data-action="edit-meta" class="c-btn c-btn--ghost c-btn--sm">${icon('edit', { size: 14 })}<span>Modifica meta</span></button>
          ${lifecycleButtons(t)}
        </div>
      </div>
    </div>
  `;
}

function lifecycleButtons(t) {
  if (t.slug === 'platform') return '<p class="text-xs text-slate-500 italic">Tenant platform protetto.</p>';
  const btns = [];
  if (t.stato === 'attivo') {
    btns.push(actionBtn('suspend', 'Sospendi', 'pause', 'amber'));
    btns.push(actionBtn('archive', 'Archivia', 'folder', 'rose'));
  } else if (t.stato === 'sospeso') {
    btns.push(actionBtn('reactivate', 'Riattiva', 'play', 'emerald'));
    btns.push(actionBtn('archive', 'Archivia', 'folder', 'rose'));
  } else if (t.stato === 'archiviato') {
    btns.push(actionBtn('restore', 'Ripristina', 'arrowLeft', 'emerald'));
    btns.push(actionBtn('hard-delete', 'Cancella subito', 'trash', 'rose'));
  }
  return btns.join('');
}

function actionBtn(action, label, iconName, color) {
  const colorCls = color === 'rose' ? 'text-rose-700 hover:bg-rose-50'
    : color === 'amber' ? 'text-amber-700 hover:bg-amber-50'
    : color === 'emerald' ? 'text-emerald-700 hover:bg-emerald-50'
    : '';
  return `<button data-action="${action}" class="c-btn c-btn--ghost c-btn--sm ${colorCls}">${icon(iconName, { size: 14 })}<span>${label}</span></button>`;
}

function wireDetailActions(modalRoot, t, panel) {
  const handlers = {
    'edit-meta': () => showEditMetaModal(t, panel),
    'smtp-edit': () => showSmtpModal(t, panel),
    'smtp-delete': () => deleteTenantSmtp(t, panel),
    'suspend': () => lifecycleAction(t, 'suspend', 'Sospendere', panel),
    'reactivate': () => lifecycleAction(t, 'reactivate', 'Riattivare', panel),
    'archive': () => showArchiveModal(t, panel),
    'restore': () => lifecycleAction(t, 'restore', 'Ripristinare', panel),
    'hard-delete': () => showHardDeleteModal(t, panel),
  };
  for (const [name, fn] of Object.entries(handlers)) {
    const btn = modalRoot.querySelector(`[data-action="${name}"]`);
    if (btn) btn.addEventListener('click', fn);
  }
}

async function lifecycleAction(t, op, verb, panel) {
  if (!confirm(`${verb} ente "${t.nome}"?`)) return;
  try {
    await api.post(`/api/platform/tenants/${t.id}/${op}`);
    toast(`${verb}: operazione eseguita`, 'success');
    closeAllModals();
    await loadEnti(panel);
  } catch (err) {
    toast(`Errore: ${err.message}`, 'error');
  }
}

function showArchiveModal(t, panel) {
  modal({
    title: `Archivia ${t.nome}`,
    contentHtml: `
      <p class="text-sm text-ink-700 mb-3">L'ente verrà disattivato. Il cleanup automatico cancellerà definitivamente i dati dopo i giorni indicati. <strong>0 = mai</strong>.</p>
      <label class="text-sm font-medium block mb-1">Giorni prima del cleanup:</label>
      <input type="number" id="archive-days" class="c-input" min="0" max="3650" value="${t.cleanupAfterDays}">
    `,
    primaryLabel: 'Archivia',
    onPrimary: async () => {
      const days = Number(document.getElementById('archive-days').value);
      try {
        await api.post(`/api/platform/tenants/${t.id}/archive`, { cleanupAfterDays: days });
        toast('Ente archiviato', 'success');
        closeAllModals();
        await loadEnti(panel);
      } catch (err) {
        toast(`Errore: ${err.message}`, 'error');
      }
    },
  });
}

function showHardDeleteModal(t, panel) {
  confirmDialog({
    title: `Cancella definitivamente ${t.nome}`,
    message: `<strong>Operazione irreversibile.</strong> Verranno cancellati tutti i dati del tenant (concorsi, valutazioni, iscrizioni, account, audit log).<br><br>Digita lo slug <code>${escapeHtml(t.slug)}</code> per confermare.`,
    danger: true,
    onConfirm: async () => {
      const input = prompt(`Digita lo slug per confermare: ${t.slug}`);
      if (input !== t.slug) {
        toast('Annullato', 'info');
        return;
      }
      try {
        await api.delete(`/api/platform/tenants/${t.id}`);
        toast('Ente cancellato', 'success');
        closeAllModals();
        await loadEnti(panel);
      } catch (err) {
        toast(`Errore: ${err.message}`, 'error');
      }
    },
  });
}

function showEditMetaModal(t, panel) {
  const planOpts = PIANO_KEYS.map((k) => `<option value="${k}" ${t.piano === k ? 'selected' : ''}>${k}</option>`).join('');
  modal({
    title: `Modifica ${t.nome}`,
    contentHtml: `
      <div class="space-y-3">
        <div>
          <label class="text-sm font-medium">Nome</label>
          <input id="em-nome" class="c-input" value="${escapeHtml(t.nome)}">
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div>
            <label class="text-sm font-medium">Piano</label>
            <select id="em-piano" class="c-input">${planOpts}</select>
          </div>
          <div>
            <label class="text-sm font-medium">Scadenza piano</label>
            <input id="em-piano-scadenza" type="date" class="c-input" value="${t.pianoScadenza ?? ''}">
          </div>
        </div>
        <div>
          <label class="text-sm font-medium">Dominio custom</label>
          <input id="em-dominio" class="c-input" value="${escapeHtml(t.dominio ?? '')}" placeholder="es. ente1.gestimus.it">
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div>
            <label class="text-sm font-medium">Cleanup days (0 = mai)</label>
            <input id="em-cleanup-days" type="number" class="c-input" min="0" max="3650" value="${t.cleanupAfterDays}">
          </div>
          <div>
            <label class="text-sm font-medium block">2FA admin</label>
            <label class="inline-flex items-center gap-2 mt-2">
              <input id="em-2fa" type="checkbox" ${t.require2faAdmin ? 'checked' : ''}>
              <span class="text-sm">Richiesto per gli admin</span>
            </label>
          </div>
        </div>
        <div>
          <label class="text-sm font-medium">Note</label>
          <textarea id="em-note" class="c-input" rows="3">${escapeHtml(t.note ?? '')}</textarea>
        </div>
      </div>
    `,
    primaryLabel: 'Salva',
    onPrimary: async () => {
      const body = {
        nome: document.getElementById('em-nome').value.trim(),
        piano: document.getElementById('em-piano').value,
        pianoScadenza: document.getElementById('em-piano-scadenza').value || null,
        dominio: document.getElementById('em-dominio').value.trim() || null,
        cleanupAfterDays: Number(document.getElementById('em-cleanup-days').value),
        require2faAdmin: document.getElementById('em-2fa').checked,
        note: document.getElementById('em-note').value.trim() || null,
      };
      try {
        await api.patch(`/api/platform/tenants/${t.id}`, body);
        toast('Modifiche salvate', 'success');
        closeAllModals();
        await loadEnti(panel);
      } catch (err) {
        toast(`Errore: ${err.message}`, 'error');
      }
    },
  });
}

// ============================================================================
// Nuovo ente
// ============================================================================

function showNewEnteModal(panel) {
  const planOpts = PIANO_KEYS.map((k) => `<option value="${k}" ${k === 'trial' ? 'selected' : ''}>${k}</option>`).join('');
  modal({
    title: 'Nuovo ente',
    contentHtml: `
      <div class="space-y-3">
        <div class="grid gap-2 sm:grid-cols-2">
          <div>
            <label class="text-sm font-medium">Slug (sottodominio)</label>
            <input id="ne-slug" class="c-input" placeholder="es. conservatorio-milano" pattern="[a-z0-9][a-z0-9-]*[a-z0-9]">
            <p class="text-xs text-ink-700 mt-1">kebab-case, 2-63 caratteri</p>
          </div>
          <div>
            <label class="text-sm font-medium">Nome ente</label>
            <input id="ne-nome" class="c-input" placeholder="es. Conservatorio Verdi">
          </div>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div>
            <label class="text-sm font-medium">Piano</label>
            <select id="ne-piano" class="c-input">${planOpts}</select>
          </div>
          <div>
            <label class="text-sm font-medium">Cleanup days (post-archiviazione)</label>
            <input id="ne-cleanup" type="number" class="c-input" min="0" max="3650" value="30">
          </div>
        </div>
        <hr class="border-slate-200">
        <p class="text-sm font-semibold text-ink-900">Primo amministratore</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <div>
            <label class="text-sm font-medium">Email admin</label>
            <input id="ne-admin-email" type="email" class="c-input">
          </div>
          <div>
            <label class="text-sm font-medium">Password</label>
            <input id="ne-admin-pass" type="text" class="c-input" value="${escapeHtml(genPassword())}">
            <p class="text-xs text-ink-700 mt-1">Min 8 caratteri. Comunica all'utente in modo sicuro.</p>
          </div>
        </div>
      </div>
    `,
    primaryLabel: 'Crea ente',
    onPrimary: async () => {
      const body = {
        slug: document.getElementById('ne-slug').value.trim().toLowerCase(),
        nome: document.getElementById('ne-nome').value.trim(),
        piano: document.getElementById('ne-piano').value,
        cleanupAfterDays: Number(document.getElementById('ne-cleanup').value),
        adminEmail: document.getElementById('ne-admin-email').value.trim().toLowerCase(),
        adminPassword: document.getElementById('ne-admin-pass').value,
      };
      if (!body.slug || !body.nome || !body.adminEmail || !body.adminPassword) {
        toast('Compila tutti i campi obbligatori', 'error');
        return;
      }
      try {
        await api.post('/api/platform/tenants', body);
        toast(`Ente "${body.slug}" creato`, 'success');
        closeAllModals();
        await loadEnti(panel);
      } catch (err) {
        toast(`Errore: ${err.message}`, 'error');
      }
    },
  });
}

function genPassword(len = 14) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@$%&*';
  let out = '';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}

// ============================================================================
// SMTP
// ============================================================================

function showSmtpModal(t, panel) {
  modal({
    title: `SMTP per ${t.nome}`,
    contentHtml: `
      <p class="text-sm text-ink-700 mb-3">La password viene cifrata at-rest (AES-GCM) prima del salvataggio. Il backend invalida la cache del transporter immediatamente.</p>
      <div class="space-y-2">
        <div class="grid gap-2 sm:grid-cols-2">
          <div>
            <label class="text-sm font-medium">Host</label>
            <input id="smtp-host" class="c-input" placeholder="smtp.example.com">
          </div>
          <div>
            <label class="text-sm font-medium">Port</label>
            <input id="smtp-port" type="number" class="c-input" value="587">
          </div>
        </div>
        <div>
          <label class="text-sm font-medium">User</label>
          <input id="smtp-user" class="c-input">
        </div>
        <div>
          <label class="text-sm font-medium">Password</label>
          <input id="smtp-pass" type="password" class="c-input">
        </div>
        <div>
          <label class="text-sm font-medium">From</label>
          <input id="smtp-from" class="c-input" placeholder='es. "Gestimus Ente" <noreply@ente.it>'>
        </div>
        <label class="inline-flex items-center gap-2 text-sm mt-1">
          <input id="smtp-secure" type="checkbox">
          <span>Connessione SSL/TLS implicita (porta 465)</span>
        </label>
      </div>
    `,
    primaryLabel: 'Salva',
    onPrimary: async () => {
      const body = {
        host: document.getElementById('smtp-host').value.trim(),
        port: Number(document.getElementById('smtp-port').value),
        user: document.getElementById('smtp-user').value.trim(),
        password: document.getElementById('smtp-pass').value,
        from: document.getElementById('smtp-from').value.trim(),
        secure: document.getElementById('smtp-secure').checked,
      };
      if (!body.host || !body.user || !body.password || !body.from) {
        toast('Compila tutti i campi', 'error');
        return;
      }
      try {
        await api.put(`/api/platform/tenants/${t.id}/smtp`, body);
        toast('SMTP salvato', 'success');
        closeAllModals();
      } catch (err) {
        toast(`Errore: ${err.message}`, 'error');
      }
    },
  });
}

async function deleteTenantSmtp(t, _panel) {
  if (!confirm(`Rimuovere la configurazione SMTP di ${t.nome}?`)) return;
  try {
    await api.delete(`/api/platform/tenants/${t.id}/smtp`);
    toast('SMTP rimosso', 'success');
    closeAllModals();
  } catch (err) {
    toast(`Errore: ${err.message}`, 'error');
  }
}

// ============================================================================
// AUDIT
// ============================================================================

async function renderAuditPanel(panel) {
  panel.innerHTML = `
    <div class="flex flex-wrap gap-2 items-end mb-4">
      <div>
        <label class="text-sm font-medium block">Action</label>
        <input id="au-action" class="c-input c-input--sm" placeholder="es. platform.tenant.archive">
      </div>
      <div>
        <label class="text-sm font-medium block">Tenant ID</label>
        <input id="au-tenant" class="c-input c-input--sm" placeholder="UUID (opzionale)">
      </div>
      <div>
        <label class="text-sm font-medium block">Limit</label>
        <input id="au-limit" type="number" class="c-input c-input--sm" value="100" min="1" max="500">
      </div>
      <button data-action="au-load" class="c-btn c-btn--primary c-btn--sm">${icon('search', { size: 14 })}<span>Carica</span></button>
    </div>
    <div id="sa-audit-list"><div class="text-center py-10 text-ink-700 text-sm">Caricamento…</div></div>
  `;
  panel.querySelector('[data-action="au-load"]').addEventListener('click', () => loadAudit(panel));
  await loadAudit(panel);
}

async function loadAudit(panel) {
  const listEl = panel.querySelector('#sa-audit-list');
  const action = panel.querySelector('#au-action').value.trim();
  const tenantId = panel.querySelector('#au-tenant').value.trim();
  const limit = panel.querySelector('#au-limit').value;
  const query = { limit };
  if (action) query.action = action;
  if (tenantId) query.tenantId = tenantId;
  try {
    state.audit = await api.get('/api/platform/audit', query);
  } catch (err) {
    listEl.innerHTML = errorBox('Caricamento audit fallito', err);
    return;
  }
  if (state.audit.length === 0) {
    listEl.innerHTML = emptyBox('Nessuna riga di audit nei filtri selezionati.');
    return;
  }
  listEl.innerHTML = `
    <div class="overflow-x-auto">
      <table class="min-w-full text-xs">
        <thead class="bg-slate-50 text-left">
          <tr>
            <th class="px-3 py-2">Quando</th>
            <th class="px-3 py-2">Action</th>
            <th class="px-3 py-2">Tenant</th>
            <th class="px-3 py-2">Actor</th>
            <th class="px-3 py-2">Payload</th>
            <th class="px-3 py-2">IP</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${state.audit.map(auditRow).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function auditRow(r) {
  return `
    <tr>
      <td class="px-3 py-2 whitespace-nowrap text-ink-700">${fmtDate(r.createdAt)}</td>
      <td class="px-3 py-2"><code>${escapeHtml(r.action)}</code></td>
      <td class="px-3 py-2">${r.targetTenantSlug ? `<code>${escapeHtml(r.targetTenantSlug)}</code>` : '<span class="text-ink-500 italic">—</span>'}</td>
      <td class="px-3 py-2 text-ink-700">${r.actorAccountId ?? '—'}</td>
      <td class="px-3 py-2"><pre class="text-xs whitespace-pre-wrap max-w-xs overflow-hidden">${r.payload ? escapeHtml(JSON.stringify(r.payload)) : ''}</pre></td>
      <td class="px-3 py-2 text-ink-700">${escapeHtml(r.ip ?? '—')}</td>
    </tr>
  `;
}

// ============================================================================
// BACKUP
// ============================================================================

async function renderBackupsPanel(panel) {
  panel.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <p class="text-sm text-ink-700">Backup JSON gzipped dei tenant cancellati. Retention: vedi <code>BACKUP_RETENTION_DAYS</code> nelle env (default 90gg).</p>
      <button data-action="run-cleanup" class="c-btn c-btn--ghost c-btn--sm">${icon('refresh', { size: 14 })}<span>Esegui cleanup ora</span></button>
    </div>
    <div id="sa-backups-list"><div class="text-center py-10 text-ink-700 text-sm">Caricamento…</div></div>
  `;
  panel.querySelector('[data-action="run-cleanup"]').addEventListener('click', () => runCleanupManual(panel));
  await loadBackups(panel);
}

async function loadBackups(panel) {
  const listEl = panel.querySelector('#sa-backups-list');
  try {
    state.backups = await api.get('/api/platform/backups');
  } catch (err) {
    listEl.innerHTML = errorBox('Caricamento backup fallito', err);
    return;
  }
  if (state.backups.length === 0) {
    listEl.innerHTML = emptyBox('Nessun backup presente.');
    return;
  }
  listEl.innerHTML = `
    <div class="overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead class="bg-slate-50 text-left">
          <tr>
            <th class="px-3 py-2">File</th>
            <th class="px-3 py-2">Tenant</th>
            <th class="px-3 py-2">Size</th>
            <th class="px-3 py-2">Modificato</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${state.backups.map((b) => `
            <tr>
              <td class="px-3 py-2"><code class="text-xs">${escapeHtml(b.filename)}</code></td>
              <td class="px-3 py-2"><code>${escapeHtml(b.tenantSlug)}</code></td>
              <td class="px-3 py-2 text-ink-700">${fmtBytes(b.sizeBytes)}</td>
              <td class="px-3 py-2 text-ink-700">${fmtDate(b.modifiedAt)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function runCleanupManual(panel) {
  if (!confirm("Eseguire ora il job di cleanup? Verranno hard-deletati i tenant archiviati con cleanup_scheduled_at scaduto.")) return;
  try {
    const r = await api.post('/api/platform/jobs/cleanup-tenants');
    toast(`Job: candidati=${r.candidatesFound}, eliminati=${r.deleted}, backup=${r.backedUp}, errori=${r.errors.length}`, 'success', 6000);
    await loadBackups(panel);
  } catch (err) {
    toast(`Errore: ${err.message}`, 'error');
  }
}

// ============================================================================
// CONFIG PIATTAFORMA
// ============================================================================

async function renderConfigPanel(panel) {
  panel.innerHTML = `<div class="text-center py-10 text-ink-700 text-sm">Caricamento…</div>`;
  try {
    state.config = await api.get('/api/platform/config');
  } catch (err) {
    panel.innerHTML = errorBox('Caricamento config fallito', err);
    return;
  }
  const c = state.config ?? { defaultCleanupDays: 30, require2faSuperadmin: false };
  panel.innerHTML = `
    <div class="c-card p-5 max-w-xl">
      <h3 class="text-sm font-semibold text-ink-900 mb-3">Configurazione piattaforma</h3>
      <div class="space-y-3">
        <div>
          <label class="text-sm font-medium">Default cleanup days</label>
          <input id="cfg-cleanup" type="number" class="c-input" min="0" max="3650" value="${c.defaultCleanupDays}">
          <p class="text-xs text-ink-700 mt-1">Giorni di default tra archiviazione e hard-delete (0 = mai). Override per-tenant disponibile.</p>
        </div>
        <label class="inline-flex items-center gap-2 text-sm">
          <input id="cfg-2fa" type="checkbox" ${c.require2faSuperadmin ? 'checked' : ''}>
          <span>Richiedi 2FA TOTP a tutti i super-admin</span>
        </label>
        <div class="pt-3">
          <button data-action="cfg-save" class="c-btn c-btn--primary c-btn--sm">${icon('check', { size: 14 })}<span>Salva</span></button>
        </div>
      </div>
    </div>
  `;
  panel.querySelector('[data-action="cfg-save"]').addEventListener('click', async () => {
    const body = {
      defaultCleanupDays: Number(document.getElementById('cfg-cleanup').value),
      require2faSuperadmin: document.getElementById('cfg-2fa').checked,
    };
    try {
      await api.patch('/api/platform/config', body);
      toast('Configurazione salvata', 'success');
    } catch (err) {
      toast(`Errore: ${err.message}`, 'error');
    }
  });
}

// ============================================================================
// Helpers
// ============================================================================

function badge(text, classes) {
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${classes}">${escapeHtml(text)}</span>`;
}

function emptyBox(msg) {
  return `<div class="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center"><p class="text-sm text-slate-500 italic">${escapeHtml(msg)}</p></div>`;
}

function errorBox(title, err) {
  const detail = err instanceof ApiError ? `${err.status} — ${err.body?.error || err.message}` : err.message || String(err);
  return `<div class="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-rose-900"><h3 class="font-bold">${escapeHtml(title)}</h3><p class="text-sm mt-1">${escapeHtml(detail)}</p></div>`;
}

function closeAllModals() {
  document.querySelectorAll('.c-modal-backdrop, [data-modal-backdrop]').forEach((el) => el.remove());
  document.body.classList.remove('overflow-hidden');
}
