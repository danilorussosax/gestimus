/**
 * Inizializzazione Sentry per il frontend.
 *
 * Da chiamare il prima possibile in main.tsx (prima di ReactDOM.render).
 * Senza VITE_SENTRY_DSN il modulo è no-op: utile per dev locale + per non
 * inviare nulla in build di test.
 *
 * PII scrubbing: rimuove campi sensibili (password, token, secrets, email,
 * nomi/cognomi) sia dalle breadcrumb che dal corpo dell'evento prima
 * dell'invio.
 *
 * Tagging utente: setSentryUser(user) chiamato da AuthContext quando
 * l'utente accede / si rinnova il profilo. user.id viene anonimizzato
 * lato client via SHA-256 (vedi `hashUserId`) prima dell'invio a Sentry —
 * l'id "raw" non lascia mai il browser.
 */

import * as Sentry from '@sentry/react';

const SENSITIVE_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'refreshToken',
  'accessToken',
  'authorization',
  'secret',
  'clientSecret',
  'apiKey',
  'twoFaSecret',
  'recoveryCode',
  'codiceFiscale',
  'matricola',
  'vatNumber',
  'fiscalCode',
]);

const PII_KEYS = new Set(['email', 'firstName', 'lastName', 'phone']);

function scrubObject(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(scrubObject);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = '[REDACTED]';
    } else if (PII_KEYS.has(k)) {
      out[k] = '[PII]';
    } else if (v && typeof v === 'object') {
      out[k] = scrubObject(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

let initialized = false;

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? undefined,
    tracesSampleRate: 0.1,
    // sendDefaultPii=false: scrubbing custom su beforeBreadcrumb/beforeSend
    sendDefaultPii: false,
    attachStacktrace: true,
    // Sentry Logs (v9.41.0+) per logs strutturati lato browser
    enableLogs: true,
    // Distributed tracing browser → backend: il header sentry-trace viene
    // propagato sulle fetch verso questi target, collegando le span FE/BE.
    tracePropagationTargets: [
      'localhost',
      /^\//, // stesso origin (l'app serve frontend e API dal backend)
    ],
    integrations: [Sentry.browserTracingIntegration()],
    // Rumore noto del browser non azionable: non sprechiamo quota.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      'Network request failed',
      'NetworkError when attempting to fetch resource',
      'Load failed',
      // Estensioni browser che intercettano fetch e iniettano errori
      'top.GLOBALS',
      'chrome-extension://',
      'moz-extension://',
    ],
    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-extension:\/\//],
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) {
        breadcrumb.data = scrubObject(breadcrumb.data) as Record<string, unknown>;
      }
      return breadcrumb;
    },
    beforeSend(event) {
      if (event.request) {
        if (event.request.data) event.request.data = scrubObject(event.request.data);
        if (event.request.headers)
          event.request.headers = scrubObject(event.request.headers) as Record<string, string>;
        if (event.request.cookies) event.request.cookies = { redacted: '[REDACTED]' };
      }
      if (event.extra) event.extra = scrubObject(event.extra) as Record<string, unknown>;
      return event;
    },
  });
  initialized = true;
  return true;
}

export function isSentryInitialized() {
  return initialized;
}

/**
 * Hash deterministico (SHA-256) di un id numerico/stringa con salt opzionale.
 * Usato per evitare di inviare l'id reale a Sentry.
 */
async function hashUserId(id: number | string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${String(id)}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function setSentryUser(user: { id: number | string; role: string } | null) {
  if (!initialized) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  const salt = import.meta.env.VITE_SENTRY_USER_ID_SALT ?? '';
  void hashUserId(user.id, salt).then((hash) => {
    Sentry.setUser({ id: hash, role: user.role });
    Sentry.setTag('user_role', user.role);
  });
}

export function setSentryRequestId(id: string) {
  if (!initialized) return;
  Sentry.setTag('request_id', id);
}
