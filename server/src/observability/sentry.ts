import * as Sentry from '@sentry/node';
import { env } from '../env.js';

/**
 * Error tracking backend (Sentry). No-op se SENTRY_DSN non è impostato:
 * dev, test e deploy senza Sentry non cambiano comportamento.
 *
 * Wiring (vedi app.ts / index.ts):
 *   - initSentry() una volta all'avvio (prima di createApp)
 *   - captureError() nell'error handler Fastify per i 5xx e nei process handler
 *     (unhandledRejection / uncaughtException)
 */
let enabled = false;

export function initSentry(): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // PII fuori di default: niente body/cookie nei breadcrumb.
    sendDefaultPii: false,
  });
  enabled = true;
  return true;
}

export function isSentryEnabled(): boolean {
  return enabled;
}

/** Invia un errore a Sentry con contesto opzionale. No-op se disabilitato. */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
