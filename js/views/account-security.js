// Gestione 2FA (TOTP) dell'account corrente: setup → attivazione → recovery
// codes, oppure disattivazione con riconferma password. Testo in italiano
// (azione autenticata di impostazioni); il flusso di login resta i18n completo.

import { db } from '../db.js';
import { refreshAuth } from '../pb.js';
import { modal, toast, escapeHtml } from '../utils.js';

export async function openAccountSecurity() {
  const enabled = !!db.currentAccount()?.totpEnabled;
  return enabled ? openDisable() : openSetup();
}

async function openSetup() {
  let setup;
  try {
    setup = await db.totpSetup();
  } catch {
    toast('Impossibile avviare il setup 2FA.', 'error');
    return;
  }
  modal({
    title: 'Attiva la verifica in due passaggi',
    contentHtml: `
      <div class="space-y-4 text-sm text-ink-700">
        <p>Aggiungi questo account a un'app di autenticazione (Google Authenticator, Authy, 1Password…), poi inserisci il codice a 6 cifre per confermare.</p>
        <div>
          <p class="c-field__label">Chiave (inserimento manuale)</p>
          <code class="block select-all break-all bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px] text-ink-900">${escapeHtml(setup.secret)}</code>
        </div>
        <details>
          <summary class="cursor-pointer text-xs text-slate-500">Mostra URI otpauth (per QR/import)</summary>
          <p class="mt-1 break-all text-[11px] text-slate-500 select-all">${escapeHtml(setup.uri)}</p>
        </details>
        <label class="c-field">
          <span class="c-field__label">Codice a 6 cifre</span>
          <input name="code" inputmode="numeric" autocomplete="one-time-code" class="c-input tracking-widest" placeholder="123456" />
        </label>
        <div id="sec-err" class="hidden text-sm font-semibold text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5"></div>
      </div>`,
    primaryLabel: 'Attiva 2FA',
    onPrimary: async (body) => {
      const code = /** @type {HTMLInputElement} */ (body.querySelector('[name="code"]')).value.trim();
      const err = body.querySelector('#sec-err');
      try {
        const res = await db.totpEnable(code);
        await refreshAuth();
        showRecoveryCodes(res.recoveryCodes || []);
        return true;
      } catch (e) {
        err.textContent = e?.data?.error || 'Codice non valido, riprova.';
        err.classList.remove('hidden');
        return false;
      }
    },
  });
}

function showRecoveryCodes(codes) {
  modal({
    title: 'Codici di recupero',
    contentHtml: `
      <div class="space-y-3 text-sm text-ink-700">
        <p>Conserva questi codici in un luogo sicuro. Ognuno funziona <strong>una sola volta</strong> se perdi l'accesso all'app. Non verranno mostrati di nuovo.</p>
        <pre class="select-all whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px] text-ink-900">${escapeHtml(codes.join('\n'))}</pre>
      </div>`,
    primaryLabel: 'Ho salvato i codici',
    onPrimary: () => {
      toast('Verifica in due passaggi attivata.', 'success');
      return true;
    },
  });
}

function openDisable() {
  modal({
    title: 'Disattiva la verifica in due passaggi',
    contentHtml: `
      <div class="space-y-3 text-sm text-ink-700">
        <p>Conferma la password per disattivare il 2FA su questo account.</p>
        <label class="c-field">
          <span class="c-field__label">Password</span>
          <input name="password" type="password" autocomplete="current-password" class="c-input" placeholder="••••••••" />
        </label>
        <div id="sec-err" class="hidden text-sm font-semibold text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5"></div>
      </div>`,
    primaryLabel: 'Disattiva 2FA',
    onPrimary: async (body) => {
      const pwd = /** @type {HTMLInputElement} */ (body.querySelector('[name="password"]')).value;
      const err = body.querySelector('#sec-err');
      try {
        await db.totpDisable(pwd);
        await refreshAuth();
        toast('Verifica in due passaggi disattivata.', 'success');
        return true;
      } catch (e) {
        err.textContent = e?.data?.error || 'Password non valida.';
        err.classList.remove('hidden');
        return false;
      }
    },
  });
}
