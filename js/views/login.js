import { db } from '../db.js';
import { escapeHtml, toast, formFields } from '../utils.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';

export function renderLogin(root, onSuccess) {
  // Branding pubblico (logo + nome ente) — disponibile pre-login.
  const brand = db.getEntePublic();
  const brandLogo = brand?.logo_url || './logo.png';
  const brandName = brand?.nome || '';

  root.innerHTML = `
    <section class="view-fade min-h-[calc(100vh-5.5rem)] grid lg:grid-cols-2 gap-6 lg:gap-10 c-page">
      <!-- Left: royal blue brand panel with musical background -->
      <aside class="login-hero hidden lg:flex flex-col justify-between text-white p-10 overflow-hidden rounded-3xl shadow-pop">
        <div>
          <p class="font-mono text-[12px] uppercase tracking-[0.18em] text-white font-bold drop-shadow">${escapeHtml(brandName || t('login.eyebrow'))}</p>
          <div class="mt-5 flex items-center gap-4">
            <img src="${escapeHtml(brandLogo)}" alt="" class="w-20 h-20 rounded-3xl shadow-2xl ring-4 ring-white/40 object-contain bg-white/10" />
            <h2 style="color:#fff" class="text-[2.4rem] sm:text-5xl font-black tracking-tight leading-[1.0] drop-shadow-md">${escapeHtml(t('login.title.line1'))}<br/>${escapeHtml(t('login.title.line2'))}<br/>${escapeHtml(t('login.title.line3'))}</h2>
          </div>
        </div>
        <div class="space-y-3">
          <div class="flex items-start gap-3 bg-white/15 backdrop-blur-md rounded-2xl px-4 py-3.5 ring-1 ring-white/25 shadow-lg">
            <span class="text-white mt-0.5">${icon('flag', { size: 20 })}</span>
            <p class="text-[15px] text-white font-medium leading-relaxed">${escapeHtml(t('login.feat.1'))}</p>
          </div>
          <div class="flex items-start gap-3 bg-white/15 backdrop-blur-md rounded-2xl px-4 py-3.5 ring-1 ring-white/25 shadow-lg">
            <span class="text-white mt-0.5">${icon('scale', { size: 20 })}</span>
            <p class="text-[15px] text-white font-medium leading-relaxed">${escapeHtml(t('login.feat.2'))}</p>
          </div>
          <div class="flex items-start gap-3 bg-white/15 backdrop-blur-md rounded-2xl px-4 py-3.5 ring-1 ring-white/25 shadow-lg">
            <span class="text-white mt-0.5">${icon('trophy', { size: 20 })}</span>
            <p class="text-[15px] text-white font-medium leading-relaxed">${escapeHtml(t('login.feat.3'))}</p>
          </div>
        </div>
        <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-white/85 font-bold">${escapeHtml(t('login.copyright'))}</p>
      </aside>

      <!-- Right: login form -->
      <div class="flex items-center justify-center p-2 sm:p-6">
        <div class="w-full max-w-md bg-white rounded-3xl shadow-soft p-7 sm:p-10 ring-1 ring-brand-200">
          <div class="flex items-center gap-3 lg:hidden mb-5">
            <img src="${escapeHtml(brandLogo)}" alt="" class="w-14 h-14 rounded-2xl shadow-soft ring-2 ring-brand-100 object-contain" />
            <div>
              <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-brand-700 font-bold">${escapeHtml(brandName || (t('app.title') + ' · ' + t('app.subtitle')))}</p>
              <h3 class="text-lg font-black text-ink-900">${escapeHtml(t('login.title.line1'))}</h3>
            </div>
          </div>
          <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-brand-700 font-bold">${escapeHtml(t('login.form.eyebrow'))}</p>
          <h2 class="mt-1.5 text-3xl sm:text-4xl font-black tracking-tight text-ink-900">${escapeHtml(t('login.form.title'))}</h2>
          <p class="text-[15px] text-ink-700 mt-2 font-medium">${escapeHtml(t('login.form.subtitle'))}</p>

          <form id="login-form" class="mt-7 space-y-5" autocomplete="on" novalidate>
            <label class="c-field">
              <span class="c-field__label">${escapeHtml(t('login.form.email'))}</span>
              <input name="email" type="email" required autocomplete="email" autofocus inputmode="email"
                     class="c-input" placeholder="nome@esempio.it" />
            </label>
            <label class="c-field">
              <span class="c-field__label">${escapeHtml(t('login.form.password'))}</span>
              <input name="password" type="password" required autocomplete="current-password" minlength="6"
                     class="c-input" placeholder="••••••••" />
            </label>
            <div id="login-error" role="alert" aria-live="assertive"
                 class="hidden text-sm font-semibold text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5"></div>
            <button id="login-btn" type="submit" class="c-btn c-btn--primary c-btn--xl w-full justify-center">
              <span>${escapeHtml(t('login.form.submit'))}</span>
              <span class="c-btn__icon" aria-hidden="true">${icon('arrowRight', { size: 16 })}</span>
            </button>
          </form>

          <div class="mt-6 pt-5 border-t border-slate-200 text-center">
            <p class="text-xs text-slate-600 mb-2">Sei un candidato e vuoi iscriverti al concorso?</p>
            <a href="#/iscrizione" class="c-btn c-btn--outline c-btn--sm inline-flex items-center gap-1.5">
              <span>📝</span> <span>Vai al form di iscrizione</span>
            </a>
          </div>

          <!-- Il pannello "Primo avvio" viene mostrato solo se nessun admin esiste
               (probato via /api/setup/has-admin lato server). -->
          <div id="primo-avvio-host" class="hidden"></div>
        </div>
      </div>
    </section>
  `;

  // Probe asincrono "esiste almeno un admin?" via /api/setup/has-admin (server/src/routes/setup.ts).
  // L'endpoint non espone record, solo un booleano → safe da chiamare senza auth.
  // Se hasAdmin=false → mostriamo il pannello "Primo avvio" aperto e ben visibile.
  // Se hasAdmin=true (default conservativo) → pannello nascosto.
  (async () => {
    let hasAdmin = true;
    try {
      const res = await fetch('/api/setup/has-admin');
      if (res.ok) {
        const d = await res.json();
        hasAdmin = d.hasAdmin !== false;
      }
    } catch { /* offline o endpoint mancante → assumiamo hasAdmin per non disturbare */ }

    const host = root.querySelector('#primo-avvio-host');
    if (host && !hasAdmin) {
      host.classList.remove('hidden');
      host.innerHTML = `
        <div class="mt-8 bg-sun-50 border-2 border-sun-400/60 rounded-2xl p-4 space-y-2">
          <p class="font-mono uppercase tracking-[0.12em] text-sun-700 font-bold text-xs inline-flex items-center gap-2">
            ${icon('warning', { size: 14 })} ${escapeHtml(t('login.first.title'))}
          </p>
          <p class="text-xs text-ink-700">${escapeHtml(t('login.first.help'))}</p>
          <pre class="font-mono text-[11px] break-all text-ink-900 bg-white border border-sun-300 rounded-lg p-2 select-all">node scripts/create-admin.js admin@esempio.it password123 Mario Rossi</pre>
        </div>
      `;
    }
  })();

  const form  = root.querySelector('#login-form');
  const errEl = root.querySelector('#login-error');
  const btn   = root.querySelector('#login-btn');
  const btnLabel = btn.firstElementChild;

  // Routing + benvenuto post-login, condiviso tra login diretto e 2FA.
  const proceedAfterLogin = (account) => {
    if (!account.attivo) throw new Error(t('login.error.disabled'));
    const goto = (h) => {
      if (location.hash !== h) history.replaceState(null, '', h);
    };
    if (account.role === 'superadmin') {
      db.setRole('superadmin');
      goto('#/superadmin');
    } else if (account.role === 'admin') {
      db.setRole('admin');
      if (!db.state.meta.activeConcorsoId && db.state.concorsi.length > 0) {
        db.setActiveConcorso(db.state.concorsi[0].id);
      }
      goto('#/');
    } else if (account.role === 'commissario') {
      if (!account.commissario) throw new Error(t('login.error.no_com'));
      const com = db.state.commissari.find(c => c.id === account.commissario);
      if (!com) throw new Error(t('login.error.no_com_record'));
      const firstId = Array.isArray(com.concorsi_ids) ? com.concorsi_ids[0] : null;
      if (firstId) db.setActiveConcorso(firstId);
      db.setRole('commissario', com.id);
      goto('#/');
    } else {
      throw new Error(t('login.error.no_role'));
    }
    toast(t('login.welcome_back', { name: account.nome || account.email }), 'success');
    if (onSuccess) onSuccess(account);
  };

  // Step 2FA: sostituisce il form login con l'inserimento del codice.
  const renderTotpStep = (challenge) => {
    const card = form.closest('.bg-white');
    form.classList.add('hidden');
    const step = document.createElement('form');
    step.id = 'totp-form';
    step.className = 'mt-7 space-y-5';
    step.innerHTML = `
      <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-brand-700 font-bold">${escapeHtml(t('login.2fa.eyebrow'))}</p>
      <h2 class="mt-1.5 text-2xl font-black tracking-tight text-ink-900">${escapeHtml(t('login.2fa.title'))}</h2>
      <p class="text-[15px] text-ink-700 mt-1 font-medium">${escapeHtml(t('login.2fa.help'))}</p>
      <label class="c-field">
        <span class="c-field__label">${escapeHtml(t('login.2fa.code'))}</span>
        <input name="code" inputmode="text" autocomplete="one-time-code" autofocus required
               class="c-input tracking-widest" placeholder="123456" />
      </label>
      <div id="totp-error" role="alert" aria-live="assertive"
           class="hidden text-sm font-semibold text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5"></div>
      <button id="totp-btn" type="submit" class="c-btn c-btn--primary c-btn--xl w-full justify-center">
        <span>${escapeHtml(t('login.2fa.submit'))}</span>
      </button>`;
    card.insertBefore(step, form);
    const codeInput = /** @type {HTMLInputElement} */ (step.querySelector('[name="code"]'));
    const totpErr = step.querySelector('#totp-error');
    const totpBtn = /** @type {HTMLButtonElement} */ (step.querySelector('#totp-btn'));
    codeInput.focus();
    step.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      totpErr.classList.add('hidden');
      totpBtn.disabled = true;
      try {
        const account = await db.completeTotpLogin(challenge, codeInput.value.trim());
        proceedAfterLogin(account);
      } catch (err) {
        let msg = err?.data?.error || err?.data?.message || err?.message || t('login.2fa.error');
        if (err?.status === 401) msg = t('login.2fa.error');
        totpErr.textContent = msg;
        totpErr.classList.remove('hidden');
        totpBtn.disabled = false;
        codeInput.select();
      }
    });
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');
    const data = formFields(form);
    btn.disabled = true;
    btnLabel.textContent = t('login.form.submitting');
    try {
      const account = await db.login(data.email.trim(), data.password);
      // 2FA: il login non ha emesso sessione, mostra lo step del secondo fattore.
      if (account && account.mfaRequired) {
        renderTotpStep(account.challenge);
        return;
      }
      // db.login() ha già chiamato loadAll() internamente (skip per superadmin).
      proceedAfterLogin(account);
    } catch (err) {
      console.error('Login failed:', err);
      let msg = err?.message || t('login.error.generic');
      if (err?.data?.message) msg = err.data.message;
      const invalid = /failed to authenticate|invalid credentials/i.test(msg);
      if (invalid) msg = t('login.error.invalid');
      // Il pannello "Primo avvio" si mostra/nasconde dinamicamente in base
      // a /api/setup/has-admin, qui non serve forzare apertura.
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btnLabel.textContent = t('login.form.submit');
    }
  });
}
