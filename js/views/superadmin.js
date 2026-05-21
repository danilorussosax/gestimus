// Super-admin: gestione enti (ex "tenants") + impostazioni piattaforma.
// L'interfaccia è stata rinominata "Tenant" → "Ente" su richiesta utente.
// Il modello DB conserva il nome `tenants` per compatibilità con le migration esistenti.
//
// Funzionalità:
//   1. Lista enti con stato/salute/statistiche
//   2. Create/Edit ente
//   3. Delete ente (con avviso: la delete non ferma il PB; servono comandi server)
//   4. Configurazione SMTP centralizzata (memorizzata in platform_settings)
//      + propagazione opzionale ai singoli enti

import { db } from '../db.js';
import { pb, PB_URL } from '../pb.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { escapeHtml, toast, modal, confirmDialog } from '../utils.js';

const _state = { enti: [], settings: null, loading: false };

export function renderSuperadmin(root) {
  root.innerHTML = `
    <section class="view-fade c-page">
      <header class="c-page-header">
        <p class="c-page-header__eyebrow">Super admin</p>
        <h1 class="c-page-header__title">Gestione Enti</h1>
        <p class="c-page-header__sub">Configura gli enti della piattaforma e le impostazioni SMTP condivise.</p>
      </header>

      <div class="c-page max-w-6xl mx-auto">

        <!-- Toolbar -->
        <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
          <p class="text-sm text-ink-700" id="ente-count">Caricamento…</p>
          <div class="flex items-center gap-2">
            <button data-action="settings" class="c-btn c-btn--ghost c-btn--sm !gap-1" title="URL applicazione globale">${icon('settings', { size: 14 })} <span>Impostazioni globali</span></button>
            <button data-action="refresh-stats" class="c-btn c-btn--ghost c-btn--sm !gap-1">${icon('refresh', { size: 14 })} <span>Aggiorna statistiche</span></button>
            <button data-action="add-ente" class="c-btn c-btn--primary c-btn--sm">
              <span>Nuovo ente</span><span class="c-btn__icon" aria-hidden="true">${icon('plus', { size: 14 })}</span>
            </button>
          </div>
        </div>

        <div id="ente-list">
          <div class="text-center py-10 text-ink-700 text-sm">Caricamento…</div>
        </div>
      </div>
    </section>
  `;

  root.querySelector('[data-action="add-ente"]').addEventListener('click', () => showEnteModal());
  root.querySelector('[data-action="refresh-stats"]').addEventListener('click', () => refreshAllStats(root));
  root.querySelector('[data-action="settings"]').addEventListener('click', () => showSettingsModal());

  // Carica enti + settings in parallelo
  loadEnti(root);
  loadSettings();
}

// ============================================================================
// Lista enti
// ============================================================================

async function loadEnti(root) {
  let enti;
  try {
    const token = pb.authStore.token;
    const res = await fetch(`${PB_URL}/api/collections/tenants/records?perPage=500&sort=created`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || res.status);
    enti = data.items || [];
    _state.enti = enti;
  } catch (e) {
    const el = root?.querySelector('#ente-list');
    if (el) el.innerHTML = `
      <div class="bg-white border border-dashed border-brand-200 rounded-2xl p-10 text-center">
        <h3 class="text-lg font-bold text-ink-900">Errore caricamento enti</h3>
        <p class="text-sm text-ink-700 mt-1">${escapeHtml(e.message || String(e))}</p>
      </div>`;
    return;
  }

  const countEl = root.querySelector('#ente-count');
  if (countEl) countEl.textContent = enti.length === 0 ? 'Nessun ente registrato' : `${enti.length} ente${enti.length === 1 ? '' : 'i'} registrat${enti.length === 1 ? 'o' : 'i'}`;

  const listEl = root.querySelector('#ente-list');
  if (!listEl) return;
  if (enti.length === 0) {
    listEl.innerHTML = `
      <div class="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
        <div class="text-4xl mb-2">🏛</div>
        <p class="text-sm text-slate-500 italic">Nessun ente ancora registrato. Clicca su "Nuovo ente" per iniziare.</p>
      </div>`;
    return;
  }

  // Health check + has-admin probe paralleli per ogni ente.
  const healthMap = {};
  const hasAdminMap = {};
  await Promise.all(enti.map(async (e) => {
    const base = `http://127.0.0.1:${e.porta_pb}`;
    try {
      const h = await fetch(`${base}/api/health`, { cache: 'no-store' });
      healthMap[e.id] = h.ok;
    } catch { healthMap[e.id] = false; }
    if (healthMap[e.id]) {
      try {
        const r = await fetch(`${base}/api/setup/has-admin`, { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          hasAdminMap[e.id] = j.hasAdmin !== false;
        } else {
          hasAdminMap[e.id] = true; // conservativo
        }
      } catch { hasAdminMap[e.id] = true; }
    } else {
      hasAdminMap[e.id] = null; // sconosciuto se PB offline
    }
  }));

  try {
    listEl.innerHTML = `<div class="space-y-3">${enti.map(e => enteCardHtml(e, healthMap[e.id], hasAdminMap[e.id])).join('')}</div>`;
  } catch (e) {
    listEl.innerHTML = `<div class="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-800">Errore rendering: ${escapeHtml(e.message || String(e))}</div>`;
    return;
  }

  // Bind azioni delle card
  listEl.querySelectorAll('[data-action="edit-ente"]').forEach(btn => btn.addEventListener('click', () => {
    const e = enti.find(x => x.id === btn.dataset.id);
    if (e) showEnteModal(e);
  }));
  listEl.querySelectorAll('[data-action="smtp-ente"]').forEach(btn => btn.addEventListener('click', () => {
    const e = enti.find(x => x.id === btn.dataset.id);
    if (e) showEnteSmtpModal(e, root);
  }));
  listEl.querySelectorAll('[data-action="create-admin"]').forEach(btn => btn.addEventListener('click', () => {
    const e = enti.find(x => x.id === btn.dataset.id);
    if (e) showCreateAdminModal(e, root);
  }));
  listEl.querySelectorAll('[data-action="delete-ente"]').forEach(btn => btn.addEventListener('click', () => {
    const e = enti.find(x => x.id === btn.dataset.id);
    if (e) confirmDeleteEnte(e, root);
  }));
}

function enteCardHtml(ente, healthy = null, hasAdmin = null) {
  const stato = ente.stato || 'attivo';
  const statoColors = {
    attivo: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    sospeso: 'bg-amber-50 text-amber-700 border-amber-200',
    archiviato: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  const statoIcons = {
    attivo: icon('checkCircle', { size: 12 }),
    sospeso: icon('warning', { size: 12 }),
    archiviato: icon('package', { size: 12 }),
  };
  // Costruisco l'URL dell'app del tenant inferendo proto/porta dal SUO stesso
  // ambiente (la piattaforma corrente): in dev locale `platform.test:8000` →
  // tenant gira a `<dominio>:8000`. In produzione `platform.gestimus.it` →
  // tenant gira a `https://<dominio>` (porta 443 default, no parametro `?pb=`).
  // Il reverse-proxy (Caddy locale o nginx prod) si occupa di mappare /api/* al PB.
  const proto = window.location.protocol;            // 'http:' | 'https:'
  const platformHost = window.location.host;          // 'platform.test:8000' o 'platform.gestimus.it'
  const platformPort = platformHost.split(':')[1] || '';
  const portSuffix = platformPort && platformPort !== '80' && platformPort !== '443'
    ? `:${platformPort}` : '';
  const adminUrl = ente.dominio
    ? `${proto}//${ente.dominio}${portSuffix}/`
    : `http://127.0.0.1:${ente.porta_pb}/`;
  // L'admin UI di PB resta sempre sulla porta interna (utile in dev; in prod
  // passa per nginx come /_/ via subdomain → meglio usare anche qui il dominio).
  const adminUiUrl = ente.dominio
    ? `${proto}//${ente.dominio}${portSuffix}/_/`
    : `http://127.0.0.1:${ente.porta_pb}/_/`;
  const hasStats = ente.num_concorsi != null;
  const lastRefresh = ente.ultimo_refresh
    ? new Date(ente.ultimo_refresh).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : null;
  return `
    <div class="bg-white border border-brand-100 rounded-2xl p-5 hover:shadow-soft transition-shadow group">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="font-semibold text-ink-900 text-lg">${escapeHtml(ente.nome)}</h3>
            <span class="font-mono text-xs text-ink-500">${escapeHtml(ente.slug)}</span>
            <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statoColors[stato] || statoColors.attivo}">
              ${statoIcons[stato] || ''} ${escapeHtml(stato)}
            </span>
            ${healthy !== null ? `<span class="inline-flex items-center gap-1 text-[10px] ${healthy ? 'text-emerald-700' : 'text-rose-700'}"><span class="w-1.5 h-1.5 rounded-full ${healthy ? 'bg-emerald-500' : 'bg-rose-500'}"></span>${healthy ? 'Online' : 'Offline'}</span>` : ''}
            ${ente.smtp_enabled ? `<span class="inline-flex items-center gap-1 text-[10px] text-brand-700" title="${escapeHtml((ente.smtp_host || '') + (ente.smtp_last_propagated_at ? ' · propagato ' + new Date(ente.smtp_last_propagated_at).toLocaleString('it-IT') : ''))}">${icon('mail', { size: 12 })} SMTP</span>` : ''}
            ${hasAdmin === false ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full" title="L'ente non ha ancora un account admin. Cliccare il pulsante con la chiave per crearne uno.">⚠ Admin mancante</span>` : ''}
          </div>
          <div class="text-xs text-ink-700 mt-1">
            ${ente.dominio ? `${escapeHtml(ente.dominio)} · ` : ''}PB porta ${ente.porta_pb}
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <a href="${adminUrl}" target="_blank" class="text-brand-600 hover:text-brand-800 hover:bg-brand-50 w-9 h-9 inline-flex items-center justify-center rounded-lg border border-brand-100 transition-colors" title="Apri app dell'ente">${icon('externalLink', { size: 18 })}</a>
          <a href="${adminUiUrl}" target="_blank" class="text-brand-600 hover:text-brand-800 hover:bg-brand-50 w-9 h-9 inline-flex items-center justify-center rounded-lg border border-brand-100 transition-colors" title="Apri admin UI">${icon('settings', { size: 18 })}</a>
          <button data-action="smtp-ente" data-id="${ente.id}" class="text-brand-600 hover:text-brand-800 hover:bg-brand-50 w-9 h-9 inline-flex items-center justify-center rounded-lg border border-brand-100 transition-colors" title="Configura SMTP">${icon('mail', { size: 18 })}</button>
          ${hasAdmin === false ? `<button data-action="create-admin" data-id="${ente.id}" class="text-amber-700 hover:text-amber-900 hover:bg-amber-50 w-9 h-9 inline-flex items-center justify-center rounded-lg border-2 border-amber-300 transition-colors animate-pulse" title="Crea admin (l'ente non ne ha uno)">${icon('lock', { size: 18 })}</button>` : ''}
          <button data-action="edit-ente" data-id="${ente.id}" class="text-brand-600 hover:text-brand-800 hover:bg-brand-50 w-9 h-9 inline-flex items-center justify-center rounded-lg border border-brand-100 transition-colors" title="Modifica">${icon('edit', { size: 18 })}</button>
          <button data-action="delete-ente" data-id="${ente.id}" class="text-rose-600 hover:text-rose-800 hover:bg-rose-50 w-9 h-9 inline-flex items-center justify-center rounded-lg border border-rose-100 transition-colors" title="Elimina">${icon('trash', { size: 18 })}</button>
        </div>
      </div>
      ${hasStats ? `
        <div class="grid grid-cols-3 gap-3 mb-3">
          <div class="bg-brand-50/50 border border-brand-100 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <span class="text-brand-600 shrink-0">${icon('trophy', { size: 16 })}</span>
            <div><div class="text-lg font-black text-ink-900 leading-none">${ente.num_concorsi}</div><div class="text-[10px] text-ink-700 uppercase tracking-wider">Concorsi</div></div>
          </div>
          <div class="bg-accent-50/50 border border-accent-100 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <span class="text-accent-500 shrink-0">${icon('judge', { size: 16 })}</span>
            <div><div class="text-lg font-black text-ink-900 leading-none">${ente.num_commissari}</div><div class="text-[10px] text-ink-700 uppercase tracking-wider">Commissari</div></div>
          </div>
          <div class="bg-sun-50/50 border border-sun-100 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <span class="text-sun-600 shrink-0">${icon('graduation', { size: 16 })}</span>
            <div><div class="text-lg font-black text-ink-900 leading-none">${ente.num_candidati}</div><div class="text-[10px] text-ink-700 uppercase tracking-wider">Candidati</div></div>
          </div>
        </div>
      ` : `
        <div class="bg-brand-50/50 border border-dashed border-brand-100 rounded-xl px-3 py-3 mb-3">
          <p class="text-xs text-ink-700 flex items-center gap-1.5">${icon('info', { size: 12 })} Statistiche non ancora rilevate. Clicca "Aggiorna statistiche".</p>
        </div>
      `}
      <div class="flex items-center gap-3 text-[11px] text-ink-700">
        <span class="inline-flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full ${lastRefresh ? 'bg-emerald-500' : 'bg-slate-400'}"></span>
          ${lastRefresh ? `Ultimo aggiornamento: ${lastRefresh}` : 'Mai aggiornato'}
        </span>
      </div>
      ${ente.note ? `<p class="text-xs text-ink-700 mt-2 italic">${escapeHtml(ente.note)}</p>` : ''}
    </div>
  `;
}

// ============================================================================
// Delete ente — con avviso che NON ferma il PB
// ============================================================================

function confirmDeleteEnte(ente, root) {
  modal({
    title: `Elimina ente "${ente.nome}"`,
    width: 'max-w-lg',
    contentHtml: `
      <div class="space-y-4 text-sm">
        <div class="bg-rose-50 border border-rose-200 rounded-xl p-4">
          <p class="font-bold text-rose-900 mb-1">⚠ Attenzione: questa azione NON ferma il PocketBase dell'ente.</p>
          <p class="text-rose-800 text-xs leading-relaxed">Eliminando questo record dalla piattaforma rimuovi solo il <strong>riferimento</strong>. Il processo PB (porta ${ente.porta_pb}) e i dati su filesystem restano attivi. Se vuoi una rimozione completa, esegui dopo questo passo:</p>
          <pre class="mt-2 bg-white border border-rose-200 rounded p-2 text-[11px] font-mono text-rose-900 overflow-x-auto">./scripts/remove-tenant.sh ${escapeHtml(ente.slug)}
./scripts/remove-tenant.sh ${escapeHtml(ente.slug)} --purge -y    # cancella i dati senza prompt</pre>
          <p class="text-[11px] text-rose-700 mt-2">Senza flag = archivia i dati in <code>pocketbase/_archive/</code> (locale) o <code>/srv/pb/archive/</code> (prod). Con <code>--purge</code> = cancella definitivamente.</p>
        </div>
        <p class="text-ink-700">Vuoi procedere con la rimozione del record di registro?</p>
        <label class="flex items-start gap-2 text-xs text-ink-700">
          <input type="checkbox" data-confirm-ck class="mt-0.5 rounded border-slate-300" />
          <span>Ho compreso che dovrò fermare manualmente il servizio PB tramite lo script <code>remove-tenant.sh</code> sul server.</span>
        </label>
      </div>
    `,
    primaryLabel: 'Elimina record',
    onPrimary: async (body) => {
      const ack = body.querySelector('[data-confirm-ck]').checked;
      if (!ack) { toast('Conferma la checkbox per procedere', 'warn'); return false; }
      try {
        const token = pb.authStore.token;
        const res = await fetch(`${PB_URL}/api/collections/tenants/records/${ente.id}`, {
          method: 'DELETE',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
        if (!res.ok && res.status !== 204) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.message || String(res.status));
        }
        toast(`Ente "${ente.nome}" rimosso dal registro. Ricordati di eseguire remove-tenant.sh sul server.`, 'success');
        // Cleanup ottimistico locale: rimuovi dal cache anche se il refresh remoto fallisse.
        _state.enti = _state.enti.filter(x => x.id !== ente.id);
        loadEnti(root);
      } catch (e) {
        toast(e.message || 'Errore', 'error');
        return false;
      }
    },
  });
}

// ============================================================================
// Refresh statistiche (riusa logica precedente)
// ============================================================================

async function refreshAllStats(root) {
  const btn = root.querySelector('[data-action="refresh-stats"]');
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Aggiornamento…'; }
  const token = pb.authStore.token;
  const res = await fetch(`${PB_URL}/api/collections/tenants/records?perPage=500&sort=created`, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  });
  const data = await res.json();
  if (!res.ok) { if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Aggiorna statistiche'; } return; }

  const enti = data.items || [];
  for (const e of enti) {
    const pbUrl = `http://127.0.0.1:${e.porta_pb}`;
    const stats = { concorsi: 0, commissari: 0, candidati: 0, healthy: false };
    try {
      const h = await fetch(`${pbUrl}/api/health`, { cache: 'no-store' });
      stats.healthy = h.ok;
    } catch {}
    if (e.email_admin && stats.healthy) {
      try {
        const authRes = await fetch(`${pbUrl}/api/collections/accounts/auth-with-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identity: e.email_admin, password: 'admin123' }),
        });
        if (authRes.ok) {
          const authData = await authRes.json();
          const headers = { 'Authorization': `Bearer ${authData.token}` };
          const [concorsiR, commissariR, candidatiR] = await Promise.all([
            fetch(`${pbUrl}/api/collections/concorsi/records?perPage=1`, { headers }).then(r => r.json()).catch(() => ({})),
            fetch(`${pbUrl}/api/collections/commissari/records?perPage=1`, { headers }).then(r => r.json()).catch(() => ({})),
            fetch(`${pbUrl}/api/collections/candidati/records?perPage=1`, { headers }).then(r => r.json()).catch(() => ({})),
          ]);
          stats.concorsi    = concorsiR?.totalItems    || 0;
          stats.commissari  = commissariR?.totalItems  || 0;
          stats.candidati   = candidatiR?.totalItems   || 0;
        }
      } catch {}
    }
    try {
      await fetch(`${PB_URL}/api/collections/tenants/records/${e.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          num_concorsi: stats.concorsi,
          num_commissari: stats.commissari,
          num_candidati: stats.candidati,
          ultimo_refresh: new Date().toISOString(),
        }),
      });
    } catch {}
  }
  if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Aggiorna statistiche'; }
  loadEnti(root);
}

// ============================================================================
// Modal Crea/Modifica ente (rinominato in UI da "Tenant")
// ============================================================================

function showEnteModal(existing = null) {
  const isEdit = !!existing;
  const title = isEdit ? `Modifica ente "${existing.nome}"` : 'Nuovo ente';
  const contentHtml = `
    <div class="space-y-4">
      <label class="c-field">
        <span class="c-field__label">Slug *</span>
        <input name="slug" type="text" required class="c-input font-mono" value="${escapeHtml(existing?.slug || '')}" placeholder="es. ente3" ${isEdit ? 'readonly' : ''} />
        <p class="text-xs text-ink-700 mt-1">Identificativo univoco — solo lettere minuscole, numeri e trattini. Usato per cartella dati e sottodominio.</p>
      </label>
      <label class="c-field">
        <span class="c-field__label">Nome dell'ente *</span>
        <input name="nome" type="text" required class="c-input" value="${escapeHtml(existing?.nome || '')}" placeholder="es. Conservatorio di Milano" />
      </label>
      <div class="grid grid-cols-2 gap-4">
        <label class="c-field">
          <span class="c-field__label">Dominio</span>
          <input name="dominio" type="text" class="c-input" value="${escapeHtml(existing?.dominio || '')}" placeholder="es. ente3.test" />
        </label>
        <label class="c-field">
          <span class="c-field__label">Porta PocketBase *</span>
          <input name="porta_pb" type="number" required class="c-input" value="${existing?.porta_pb || ''}" placeholder="es. 8094" />
        </label>
      </div>
      <label class="c-field">
        <span class="c-field__label">Email admin di riferimento</span>
        <input name="email_admin" type="email" class="c-input" value="${escapeHtml(existing?.email_admin || '')}" placeholder="admin@ente3.test" />
        <p class="text-xs text-ink-700 mt-1">Usata dal super admin per recuperare statistiche e propagare configurazioni.</p>
      </label>
      <label class="c-field">
        <span class="c-field__label">Stato</span>
        <select name="stato" class="c-input">
          <option value="attivo" ${existing?.stato === 'attivo' ? 'selected' : ''}>Attivo</option>
          <option value="sospeso" ${existing?.stato === 'sospeso' ? 'selected' : ''}>Sospeso</option>
          <option value="archiviato" ${existing?.stato === 'archiviato' ? 'selected' : ''}>Archiviato</option>
        </select>
      </label>
      <label class="c-field">
        <span class="c-field__label">Note</span>
        <textarea name="note" rows="2" class="c-input">${escapeHtml(existing?.note || '')}</textarea>
      </label>
    </div>
  `;
  modal({
    title,
    contentHtml,
    primaryLabel: isEdit ? 'Salva' : 'Crea',
    onPrimary: async (body) => {
      const slug = body.querySelector('[name="slug"]').value.trim();
      const nome = body.querySelector('[name="nome"]').value.trim();
      const dominio = body.querySelector('[name="dominio"]').value.trim();
      const porta_pb = body.querySelector('[name="porta_pb"]').value;
      const stato = body.querySelector('[name="stato"]').value;
      const note = body.querySelector('[name="note"]').value.trim();
      const email_admin = body.querySelector('[name="email_admin"]').value.trim();
      if (!slug || !nome || !porta_pb) { toast('Slug, nome e porta sono obbligatori', 'error'); return false; }
      const data = { slug, nome, dominio, porta_pb: Number(porta_pb), stato, note, email_admin };
      try {
        const token = pb.authStore.token;
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (isEdit) {
          const res = await fetch(`${PB_URL}/api/collections/tenants/records/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify(data) });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || res.status);
          toast(`Ente "${nome}" aggiornato`, 'success');
        } else {
          const res = await fetch(`${PB_URL}/api/collections/tenants/records`, { method: 'POST', headers, body: JSON.stringify(data) });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || res.status);
          toast(`Ente "${nome}" creato`, 'success');
        }
        renderSuperadmin(document.getElementById('app-root'));
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// ============================================================================
// Impostazioni globali — SOLO app_url (URL pubblico della piattaforma).
// L'SMTP è per ente, vedi `showEnteSmtpModal` più sotto.
// ============================================================================

async function loadSettings() {
  try {
    const token = pb.authStore.token;
    const res = await fetch(`${PB_URL}/api/collections/platform_settings/records?perPage=1`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const data = await res.json();
    _state.settings = data.items?.[0] || null;
  } catch {}
}

function showSettingsModal() {
  const s = _state.settings || {};
  modal({
    title: 'Impostazioni globali',
    width: 'max-w-lg',
    contentHtml: `
      <div class="space-y-4">
        <p class="text-sm text-ink-700">Impostazioni valide per tutta la piattaforma. L'SMTP è invece configurato per <strong>ogni singolo ente</strong> — clicca l'icona ✉ sulla card di un ente per gestirlo.</p>
        <label class="c-field">
          <span class="c-field__label">URL applicazione</span>
          <input name="app_url" class="c-input font-mono" value="${escapeHtml(s.app_url || '')}" placeholder="https://app.miodominio.it" />
          <p class="text-[11px] text-slate-500 mt-1">Usato come base per costruire i link nelle email (es. conferma iscrizione, reset password). Esempio: <code>https://${escapeHtml('${tenantSlug}')}.miodominio.it</code></p>
        </label>
      </div>
    `,
    primaryLabel: 'Salva',
    onPrimary: async (body) => {
      const data = { app_url: body.querySelector('[name="app_url"]').value.trim() };
      try {
        const token = pb.authStore.token;
        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
        if (_state.settings?.id) {
          const res = await fetch(`${PB_URL}/api/collections/platform_settings/records/${_state.settings.id}`, { method: 'PATCH', headers, body: JSON.stringify(data) });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || res.status);
        } else {
          const res = await fetch(`${PB_URL}/api/collections/platform_settings/records`, { method: 'POST', headers, body: JSON.stringify(data) });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || res.status);
          _state.settings = await res.json();
        }
        toast('Impostazioni salvate', 'success');
        loadSettings();
      } catch (e) { toast(e.message || 'Errore', 'error'); return false; }
    },
  });
}

// ============================================================================
// SMTP per singolo ente — apri dalla card con icona ✉.
// I dati vengono salvati nel record `tenants` corrispondente.
// La propagazione al PocketBase del singolo ente è manuale via
// `scripts/apply-ente-smtp.sh <slug>` (legge i settings da platform e applica
// via admin API al PB dell'ente).
// ============================================================================

function showEnteSmtpModal(ente, root) {
  const lastProp = ente.smtp_last_propagated_at
    ? new Date(ente.smtp_last_propagated_at).toLocaleString('it-IT')
    : null;
  modal({
    title: `SMTP per "${ente.nome}"`,
    width: 'max-w-2xl',
    contentHtml: `
      <div class="space-y-5">
        <section class="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900">
          <p>Le credenziali SMTP qui impostate sono <strong>specifiche di questo ente</strong>: enti diversi possono usare provider diversi (SendGrid, Postmark, Gmail, …). PocketBase del singolo ente userà queste credenziali per inviare email transazionali (conferma iscrizioni, ecc.).</p>
        </section>

        <section>
          <label class="flex items-center gap-2 text-sm text-ink-800 mb-4">
            <input name="smtp_enabled" type="checkbox" class="rounded border-slate-300" ${ente.smtp_enabled ? 'checked' : ''} />
            <span class="font-semibold">Abilita SMTP per questo ente</span>
          </label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="c-field">
              <span class="c-field__label">Host *</span>
              <input name="smtp_host" class="c-input font-mono" value="${escapeHtml(ente.smtp_host || '')}" placeholder="smtp.gmail.com" />
            </label>
            <label class="c-field">
              <span class="c-field__label">Porta *</span>
              <input name="smtp_port" type="number" min="1" max="65535" class="c-input" value="${ente.smtp_port || 587}" />
            </label>
            <label class="c-field">
              <span class="c-field__label">Username</span>
              <input name="smtp_username" class="c-input" value="${escapeHtml(ente.smtp_username || '')}" placeholder="apikey · user · email" />
            </label>
            <label class="c-field">
              <span class="c-field__label">Password / API key</span>
              <input name="smtp_password" type="password" class="c-input" value="${escapeHtml(ente.smtp_password || '')}" placeholder="••••••••" />
            </label>
            <label class="c-field">
              <span class="c-field__label">Cifratura</span>
              <select name="smtp_tls" class="c-input">
                <option value="starttls" ${ente.smtp_tls === 'starttls' || !ente.smtp_tls ? 'selected' : ''}>STARTTLS (porta 587)</option>
                <option value="tls" ${ente.smtp_tls === 'tls' ? 'selected' : ''}>TLS implicito (porta 465)</option>
                <option value="none" ${ente.smtp_tls === 'none' ? 'selected' : ''}>Nessuna (porta 25, sconsigliato)</option>
              </select>
            </label>
            <label class="c-field">
              <span class="c-field__label">Indirizzo mittente *</span>
              <input name="sender_address" type="email" class="c-input" value="${escapeHtml(ente.sender_address || '')}" placeholder="noreply@${escapeHtml(ente.dominio || 'esempio.it')}" />
            </label>
            <label class="c-field sm:col-span-2">
              <span class="c-field__label">Nome mittente</span>
              <input name="sender_name" class="c-input" value="${escapeHtml(ente.sender_name || ente.nome || '')}" placeholder="es. ${escapeHtml(ente.nome || 'Concorso Musicale')}" />
            </label>
          </div>
        </section>

        <section class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
          <p class="font-semibold mb-1">⚠ Propagazione manuale al PB dell'ente</p>
          <p>Dopo aver salvato qui, applica le impostazioni al PocketBase dell'ente con:</p>
          <pre class="mt-2 bg-white border border-amber-200 rounded p-2 font-mono text-[11px]">./scripts/apply-ente-smtp.sh ${escapeHtml(ente.slug)}</pre>
          <p class="mt-1">(In assenza di propagazione, le impostazioni sono solo memorizzate nella piattaforma ma il PB dell'ente non sa come inviare email.)</p>
        </section>

        ${lastProp ? `<p class="text-[11px] text-slate-500">Ultima propagazione: ${lastProp}${ente.smtp_last_propagation_result ? ` · ${escapeHtml(ente.smtp_last_propagation_result)}` : ''}</p>` : ''}
      </div>
    `,
    primaryLabel: 'Salva configurazione SMTP',
    onPrimary: async (body) => {
      const data = {
        smtp_enabled:   body.querySelector('[name="smtp_enabled"]').checked,
        smtp_host:      body.querySelector('[name="smtp_host"]').value.trim(),
        smtp_port:      Number(body.querySelector('[name="smtp_port"]').value) || 587,
        smtp_username:  body.querySelector('[name="smtp_username"]').value.trim(),
        smtp_password:  body.querySelector('[name="smtp_password"]').value,
        smtp_tls:       body.querySelector('[name="smtp_tls"]').value,
        sender_address: body.querySelector('[name="sender_address"]').value.trim(),
        sender_name:    body.querySelector('[name="sender_name"]').value.trim(),
      };
      // Validazione minima se abilitato
      if (data.smtp_enabled) {
        if (!data.smtp_host || !data.sender_address) {
          toast('Host e indirizzo mittente sono obbligatori quando SMTP è abilitato', 'error');
          return false;
        }
      }
      try {
        const token = pb.authStore.token;
        const res = await fetch(`${PB_URL}/api/collections/tenants/records/${ente.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || res.status);
        toast(`SMTP di "${ente.nome}" salvato. Ricordati di propagare con apply-ente-smtp.sh.`, 'success');
        loadEnti(root);
      } catch (e) { toast(e.message || 'Errore', 'error'); return false; }
    },
  });
}

// ============================================================================
// Crea admin per un ente — solo se l'ente non ne ha già uno.
// Chiama l'endpoint pubblico /api/setup/create-admin del PocketBase dell'ente
// (definito in pb_hooks/setup.pb.js). L'endpoint rifiuta se un admin esiste già.
// ============================================================================
function showCreateAdminModal(ente, root) {
  const defaultEmail = ente.email_admin || `admin@${ente.dominio || ente.slug + '.test'}`;
  // Password generata: 4 parole casuali + numeri (memorabile ma robusta)
  const generated = generatePassword(12);
  const enteUrl = `http://127.0.0.1:${ente.porta_pb}`;

  modal({
    title: `Crea admin per "${ente.nome}"`,
    width: 'max-w-lg',
    contentHtml: `
      <div class="space-y-4">
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
          <p><strong>Quando usare:</strong> al primo avvio dell'ente, quando ancora non esiste un account amministrativo.</p>
          <p class="mt-1">L'endpoint server rifiuta la creazione se un admin esiste già — quindi è sicuro chiamarlo più volte.</p>
        </div>

        <label class="c-field">
          <span class="c-field__label">Email admin *</span>
          <input name="email" type="email" required class="c-input" value="${escapeHtml(defaultEmail)}" />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="c-field"><span class="c-field__label">Nome</span>
            <input name="nome" class="c-input" placeholder="es. Mario" />
          </label>
          <label class="c-field"><span class="c-field__label">Cognome</span>
            <input name="cognome" class="c-input" placeholder="es. Rossi" />
          </label>
        </div>
        <label class="c-field">
          <span class="c-field__label">Password * (min 6)</span>
          <div class="flex items-center gap-2">
            <input name="password" type="text" required minlength="6" class="c-input font-mono" value="${escapeHtml(generated)}" />
            <button type="button" data-rerand class="c-btn c-btn--outline c-btn--sm shrink-0" title="Rigenera">🎲</button>
            <button type="button" data-copy-pwd class="c-btn c-btn--outline c-btn--sm shrink-0" title="Copia">📋</button>
          </div>
          <span class="text-[11px] text-slate-500 mt-1 block">La password viene mostrata in chiaro: copiala e comunicala in modo sicuro all'admin dell'ente. Potrà cambiarla al primo login.</span>
        </label>

        <p class="text-[11px] text-slate-500">Endpoint: <code class="font-mono bg-slate-100 px-1 rounded">${escapeHtml(enteUrl)}/api/setup/create-admin</code></p>
      </div>
    `,
    primaryLabel: 'Crea admin',
    onMount: (body) => {
      const pwd = body.querySelector('[name="password"]');
      body.querySelector('[data-rerand]').addEventListener('click', () => { pwd.value = generatePassword(12); });
      body.querySelector('[data-copy-pwd]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(pwd.value); toast('Password copiata', 'info'); } catch {}
      });
    },
    onPrimary: async (body) => {
      const email = body.querySelector('[name="email"]').value.trim().toLowerCase();
      const password = body.querySelector('[name="password"]').value;
      const nome = body.querySelector('[name="nome"]').value.trim();
      const cognome = body.querySelector('[name="cognome"]').value.trim();
      if (!email || !email.includes('@')) { toast('Email non valida', 'error'); return false; }
      if (!password || password.length < 6) { toast('Password troppo corta (min 6)', 'error'); return false; }
      try {
        const res = await fetch(`${enteUrl}/api/setup/create-admin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, nome, cognome, role: 'admin' }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMap = {
            invalid_email: 'Email non valida',
            password_too_short: 'Password troppo corta',
            admin_already_exists: 'Esiste già un admin per questo ente. Apri la UI admin per gestirlo.',
            email_taken: 'Email già usata su questo ente',
            check_failed: 'Errore di verifica admin esistenti',
            create_failed: d.message || 'Errore di creazione',
            invalid_body: 'Richiesta non valida',
          };
          throw new Error(errMap[d.error] || d.error || `HTTP ${res.status}`);
        }
        toast(`Admin "${email}" creato su "${ente.nome}"`, 'success');
        // Salva l'email come email_admin sul record tenant (se non già impostata)
        if (!ente.email_admin) {
          try {
            const token = pb.authStore.token;
            await fetch(`${PB_URL}/api/collections/tenants/records/${ente.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ email_admin: email }),
            });
          } catch {}
        }
        loadEnti(root);
      } catch (e) { toast(e.message || 'Errore', 'error'); return false; }
    },
  });
}

// Genera una password "facile da pronunciare" di lunghezza ~N: 4 sillabe + 2 cifre.
function generatePassword(len = 12) {
  const cons = 'bcdfghjklmnpqrstvwxz';
  const voc  = 'aeiou';
  let out = '';
  while (out.length < len - 2) {
    out += cons[Math.floor(Math.random() * cons.length)] + voc[Math.floor(Math.random() * voc.length)];
  }
  // Capitalizza prima lettera
  out = out[0].toUpperCase() + out.slice(1);
  // Aggiungi 2 cifre
  out += String(Math.floor(Math.random() * 100)).padStart(2, '0');
  return out.slice(0, len);
}
