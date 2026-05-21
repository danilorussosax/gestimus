// Main app router and state wiring (PocketBase-backed runtime).
import { db, subscribe } from './db.js';
import { $, $$, toast, displayName, escapeHtml } from './utils.js';
import { pb, PB_URL } from './pb.js';
import { renderHome } from './views/home.js';
import { renderAdmin } from './views/admin.js';
import { renderCommissario, unmountFloatingTimer } from './views/commissario.js';
import { renderLogin } from './views/login.js';
import { renderIscrizione } from './views/iscrizione.js';
import { renderPrivacy } from './views/privacy.js';
import { renderDashboard } from './views/admin-dashboard.js';
import { renderImpostazioni } from './views/admin-impostazioni.js';
import { renderUsers } from './views/admin-users.js';
import { renderStats } from './views/admin-stats.js';
import { renderSuperadmin } from './views/superadmin.js';
import { registerPaletteShortcut } from './palette.js';
import { icon } from './icons.js';
import { t, getLang, setLang, SUPPORTED_LANGS, LANG_LABELS, LANG_FLAGS } from './i18n.js';

const root = $('#app-root');

function currentRoute() {
  const h = location.hash || '#/';
  if (h.startsWith('#/privacy')) return 'privacy';
  if (h.startsWith('#/iscrizione')) return 'iscrizione';
  if (h.startsWith('#/superadmin')) return 'superadmin';
  if (h.startsWith('#/admin')) {
    const q = new URLSearchParams(h.split('?')[1] || '');
    const tab = q.get('tab') || '';
    const adminTabs = ['dashboard','statistiche','impostazioni','utenti'];
    if (adminTabs.includes(tab)) return 'admin-' + tab;
    return 'admin';
  }
  if (h.startsWith('#/commissario')) return 'commissario';
  return 'home';
}

function render() {
  if (!db.initialized) return;

  const ente = db.getEnte() || db.getEntePublic();
  document.title = ente?.nome ? `${ente.nome} — Gestimus` : 'Gestimus — Gestionale Concorso Musicale';

  if (!pb.authStore.isValid) {
    unmountFloatingTimer();
    updateHeader();
    // Pagine pubbliche (no login richiesto): form iscrizione + informativa privacy.
    if (currentRoute() === 'iscrizione') { renderIscrizione(root); return; }
    if (currentRoute() === 'privacy')    { renderPrivacy(root); return; }
    renderLogin(root, () => render());
    return;
  }

  const route = currentRoute();
  const meta = db.state.meta;

  // Guard: se il ruolo route richiede non corrisponde a meta.role, redirect a home.
  // Se siamo già su home il setting di hash non triggera hashchange — riprendiamo
  // esplicitamente con un nuovo render() per non lasciare root vuoto.
  const wantsRoute = (cond) => {
    if (cond) return false;
    if (location.hash === '#/' || location.hash === '') { /* già su home, evita loop */ }
    else { location.hash = '#/'; return true; }
    return false;
  };
  if (route === 'superadmin' && wantsRoute(meta.role === 'superadmin')) return;
  if (route.startsWith('admin') && wantsRoute(meta.role === 'admin')) return;
  if (route === 'commissario' && wantsRoute(meta.role === 'commissario')) return;

  updateHeader();

  // Snapshot per detection del "render-no-op": se nessun renderer ha riempito root
  // (es. early-return interno), mostriamo un fallback diagnostico al posto del vuoto.
  const before = root.innerHTML;

  let effectiveRoute = (location.hash === '#/' || location.hash === '') ? 'home' : route;
  // Per il super admin la "home" è sempre la dashboard Gestione Enti.
  // Questo guard è indipendente dalla hash → resiste a service worker cached
  // o session restore in cui `history.replaceState` non si propaga in tempo.
  // Allineiamo anche la hash così i futuri reload sono consistenti.
  if (effectiveRoute === 'home' && meta.role === 'superadmin') {
    effectiveRoute = 'superadmin';
    if (!location.hash.startsWith('#/superadmin')) {
      try { history.replaceState(null, '', '#/superadmin'); } catch {}
    }
  }
  let renderErr = null;
  try {
    if (effectiveRoute === 'privacy') { unmountFloatingTimer(); renderPrivacy(root); }
    else if (effectiveRoute === 'iscrizione') { unmountFloatingTimer(); renderIscrizione(root); }
    else if (effectiveRoute === 'home') { unmountFloatingTimer(); renderHome(root); }
    else if (effectiveRoute === 'superadmin') { unmountFloatingTimer(); renderSuperadmin(root); }
    else if (effectiveRoute === 'admin-dashboard') { unmountFloatingTimer(); renderDashboard(root); }
    else if (effectiveRoute === 'admin-statistiche') { unmountFloatingTimer(); renderStats(root); }
    else if (effectiveRoute === 'admin-impostazioni') { unmountFloatingTimer(); renderImpostazioni(root); }
    else if (effectiveRoute === 'admin-utenti') { unmountFloatingTimer(); renderUsers(root); }
    else if (effectiveRoute === 'admin') { unmountFloatingTimer(); renderAdmin(root); }
    else if (effectiveRoute === 'commissario') renderCommissario(root);
  } catch (e) {
    renderErr = e;
    console.error(`render: ${effectiveRoute} threw:`, e);
  }

  // Fallback: se la view è uscita early/ha lanciato senza scrivere root, mostriamo
  // un messaggio diagnostico invece di lasciare l'utente con l'app shell vuota.
  // Tipico caso: meta.role stale (es. commissario id non più presente in
  // state.commissari dopo un cambio account) → renderCommissario ritorna early
  // ma location.hash era già '#/' e nessun hashchange parte.
  if (root.innerHTML === before && effectiveRoute !== 'home') {
    console.warn('render: view returned without updating DOM, falling back to home', { route, effectiveRoute, role: meta.role, error: renderErr?.message });
    if (renderErr) {
      // Errore esplicito durante il render: mostralo invece di nascondere.
      root.innerHTML = `
        <section class="c-page max-w-3xl mx-auto">
          <div class="bg-rose-50 border border-rose-200 rounded-2xl p-5 mt-6">
            <p class="text-[11px] font-mono uppercase tracking-[0.12em] text-rose-700 font-bold">Errore di rendering</p>
            <h2 class="text-lg font-bold text-rose-900 mt-1">Vista \`${effectiveRoute}\`</h2>
            <pre class="mt-3 bg-white border border-rose-200 rounded-xl p-3 text-xs text-rose-900 overflow-x-auto">${(renderErr.stack || renderErr.message || String(renderErr)).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>
            <a href="#/" class="c-btn c-btn--outline c-btn--sm mt-4">Torna alla home</a>
          </div>
        </section>`;
      return;
    }
    db.setRole(null);
    renderHome(root);
  }
}

function updateHeader() {
  const meta = db.state.meta;
  const sub = $('#header-subtitle');
  const badge = $('#role-badge');
  const logoutBtn = $('#logout-btn');
  const headerLogo = $('#header-logo');
  const seedBtn = $('#seed-btn');
  // Funzionalità riservata al superadmin: caricamento dati di esempio.
  // Gli admin di tenant non devono poter wipe-and-reseed il loro DB dal footer.
  if (seedBtn) seedBtn.classList.toggle('hidden', meta.role !== 'superadmin');
  // Pre-login l'utente non ha accesso a `enti` ma `enti_public` espone branding.
  const ente = db.getEnte();
  const entePublic = db.getEntePublic();

  // Logo: priority: concorso attivo → ente (privato) → ente_public (pre-login) → default
  if (headerLogo) {
    let activeLogo = null;
    if (meta.activeConcorsoId) {
      const c = db.state.concorsi.find(x => x.id === meta.activeConcorsoId);
      if (c?.logo_url) activeLogo = c.logo_url;
    } else if (meta.role === 'commissario') {
      const com = db.state.commissari.find(x => x.id === meta.currentCommissarioId);
      const c = com ? db.state.concorsi.find(x => x.id === com.concorso_id) : null;
      if (c?.logo_url) activeLogo = c.logo_url;
    }
    if (!activeLogo && ente?.logo_url) activeLogo = ente.logo_url;
    if (!activeLogo && entePublic?.logo_url) activeLogo = entePublic.logo_url;
    headerLogo.src = activeLogo || './logo.png';
  }

  const baseBadge = 'inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.10em] px-3 h-8 mr-2 rounded-full';
  if (meta.role === 'superadmin') {
    sub.textContent = t('app.role.superadmin');
    badge.innerHTML = `${icon('shield', { size: 14 })} <span>${escapeHtml(t('app.role.superadmin'))}</span>`;
    badge.className = `${baseBadge} bg-purple-50 text-purple-700 border border-purple-200`;
    logoutBtn.classList.remove('hidden');
  } else if (meta.role === 'admin') {
    const c = db.state.concorsi.find(x => x.id === meta.activeConcorsoId);
    sub.textContent = c ? `${c.nome} · ${c.anno}` : t('app.no_concorso');
    badge.innerHTML = `${icon('tools', { size: 14 })} <span>${escapeHtml(t('app.role.admin'))}</span>`;
    badge.className = `${baseBadge} bg-brand-50 text-brand-700 border border-brand-100`;
    badge.style.background = '';
    badge.style.borderColor = '';
    logoutBtn.classList.remove('hidden');
  } else if (meta.role === 'commissario') {
    const com = db.state.commissari.find(x => x.id === meta.currentCommissarioId);
    sub.textContent = com ? `${displayName(com)} · ${com.specialita || t('app.role.commissario')}` : t('app.role.commissario');
    if (com?.is_presidente) {
      badge.innerHTML = `${icon('star', { size: 14 })} <span>${escapeHtml(t('app.role.presidente'))}</span>`;
      badge.className = `${baseBadge} bg-sun-50 text-sun-600 border border-sun-400/40`;
      badge.style.background = '';
      badge.style.borderColor = '';
    } else {
      badge.innerHTML = `${icon('music', { size: 14 })} <span>${escapeHtml(t('app.role.commissario'))}</span>`;
      badge.className = `${baseBadge} bg-accent-50 text-accent-600 border border-accent-100`;
      badge.style.background = '';
      badge.style.borderColor = '';
    }
    logoutBtn.classList.remove('hidden');
  } else {
    sub.textContent = t('app.ready');
    badge.textContent = '';
    badge.className = 'hidden';
    badge.style.background = '';
    badge.style.borderColor = '';
    logoutBtn.classList.add('hidden');
  }
}

// Apply translations to all [data-i18n] elements in the document
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  });
}

// Build/refresh the language switcher UI
function setupLanguageSwitcher() {
  const btn = $('#lang-btn');
  const flagEl = $('#lang-flag');
  const codeEl = $('#lang-code');
  const menu = $('#lang-menu');
  if (!btn || !menu) return;

  const refreshTrigger = () => {
    const lang = getLang();
    flagEl.textContent = LANG_FLAGS[lang] || '🌐';
    codeEl.textContent = lang.toUpperCase();
    btn.setAttribute('aria-label', `${t('app.lang.label')}: ${LANG_LABELS[lang]}`);
  };

  const renderMenu = () => {
    const cur = getLang();
    menu.innerHTML = SUPPORTED_LANGS.map(l => `
      <button type="button" role="menuitem" data-lang="${l}"
              class="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-ink-800 hover:bg-brand-50 hover:text-brand-700 transition ${l === cur ? 'bg-brand-50 font-bold text-brand-700' : 'font-medium'}">
        <span aria-hidden="true" class="text-base">${LANG_FLAGS[l]}</span>
        <span class="flex-1 text-left">${LANG_LABELS[l]}</span>
        ${l === cur ? '<span aria-hidden="true">✓</span>' : ''}
      </button>
    `).join('');
    menu.querySelectorAll('[data-lang]').forEach(b => {
      b.addEventListener('click', () => {
        setLang(b.dataset.lang);
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  };

  btn.addEventListener('click', () => {
    const open = !menu.classList.contains('hidden');
    if (open) { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); }
    else { renderMenu(); menu.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); }
  });
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  refreshTrigger();
  // Re-render on language change
  window.addEventListener('langchange', () => {
    refreshTrigger();
    applyStaticI18n();
    updateHeader();
    render(); // re-render the active route to translate dynamic content
  });
}

function showLoading() {
  root.innerHTML = `
    <div class="c-page text-center py-20">
      <div class="inline-flex items-center justify-center w-12 h-12 mb-4 text-brand-500" style="animation:spin 1.4s linear infinite">
        ${icon('refresh', { size: 32, stroke: 1.25 })}
      </div>
      <p class="text-ink-900 font-medium">${escapeHtml(t('app.loading.connect'))}</p>
      <p class="text-xs text-ink-500 font-mono mt-1">${escapeHtml(PB_URL)}</p>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    </div>
  `;
}

function showConnectionError(err) {
  root.innerHTML = `
    <header class="c-page-header" style="border-left: 3px solid #da1e28">
      <p class="c-page-header__eyebrow" style="color:#750e13">${escapeHtml(t('app.error.connect.eyebrow'))}</p>
      <h1 class="c-page-header__title">${escapeHtml(t('app.error.connect.title'))}</h1>
      <p class="c-page-header__sub">${escapeHtml(err.message)}</p>
    </header>
    <div class="c-page">
      <div class="c-tile c-tile--padded">
        <p class="c-tile__eyebrow">${escapeHtml(t('common.details'))}</p>
        <h3 class="c-tile__title">${escapeHtml(t('app.error.connect.resolution'))}</h3>
        <pre class="mt-3 bg-ink-900 text-brand-200 p-3 rounded-2xl overflow-x-auto text-[12px] font-mono">./pocketbase serve --migrationsDir ./pb_migrations</pre>
        <button id="retry-btn" class="c-btn c-btn--primary mt-4">
          <span>${escapeHtml(t('app.error.connect.retry'))}</span><span class="c-btn__icon" aria-hidden="true">${icon('refresh', { size: 16 })}</span>
        </button>
      </div>
    </div>
  `;
  root.querySelector('#retry-btn').addEventListener('click', () => boot());
}

async function boot() {
  showLoading();
  try {
    await db.init();
  } catch (e) {
    console.error('PB init failed:', e);
    showConnectionError(e);
    return;
  }
  // Restore role from authStore if a session exists.
  // Importante: settiamo il ruolo PRIMA del primo render così la prima vista
  // non flickera su quella sbagliata. Per il superadmin forziamo anche la rotta
  // sulla pagina di gestione enti.
  if (pb.authStore.isValid) {
    const acc = pb.authStore.model;
    if (acc?.role === 'superadmin') {
      db.setRole('superadmin');
      // Forza la rotta SOLO se non siamo già su una sotto-rotta valida del superadmin.
      if (!location.hash.startsWith('#/superadmin')) {
        history.replaceState(null, '', '#/superadmin');
      }
    } else if (acc?.role === 'admin') {
      db.setRole('admin');
      if (!db.state.meta.activeConcorsoId && db.state.concorsi.length > 0) {
        db.setActiveConcorso(db.state.concorsi[0].id);
      }
    } else if (acc?.role === 'commissario' && acc.commissario) {
      const com = db.state.commissari.find(c => c.id === acc.commissario);
      if (com) {
        db.setActiveConcorso(com.concorso_id);
        db.setRole('commissario', com.id);
      }
    }
  }
  render();
}

window.addEventListener('hashchange', render);

// ⌘K / Ctrl+K → comando-paletta globale
registerPaletteShortcut();

// PWA: registra il service worker (ignora errori in dev / non-https)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration failed:', err?.message);
    });
  });
}

$('#logout-btn').addEventListener('click', () => {
  db.logout(); // clears authStore + role meta
  location.hash = '#/';
  render(); // will land on login since authStore.isValid=false
});

$('#seed-btn').addEventListener('click', async () => {
  if (!confirm(t('seed.confirm'))) return;
  const btn = $('#seed-btn');
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = t('seed.running');
  try {
    await db.seedDemo();
    toast(t('seed.done'), 'success');
    render();
  } catch (e) {
    console.error(e);
    toast(t('seed.error', { msg: e.message || e }), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
});

subscribe(() => updateHeader());

// First-render i18n: translate static markup + wire language switcher
applyStaticI18n();
setupLanguageSwitcher();

boot();
