import cron from 'node-cron';
import { initSentry, captureError } from './observability/sentry.js';
import { createApp } from './app.js';
import { env } from './env.js';
import { shutdownPools } from './db/client.js';
import { stopRealtimeHub } from './realtime/hub.js';
import { runTenantCleanup, cleanupStaleBozze } from './services/cleanup.js';
import { cleanupExpiredSessions } from './services/session.js';
import { startSystemMetricsSampler } from './services/system-metrics.js';
import { processEvents } from './services/events.js';
import { registerDomainEventHandlers } from './services/event-handlers.js';

// Error tracking: init prima di tutto (no-op se SENTRY_DSN assente).
if (initSentry()) {
  // eslint-disable-next-line no-console
  console.log('Sentry: error tracking attivo');
}

const app = await createApp();

let cleanupTask: ReturnType<typeof cron.schedule> | null = null;
let cleanupRunning = false;

// #4: processor dell'outbox eventi. Intervallo breve (consegna email tempestiva)
// con guard di re-entrancy; unref() così non blocca lo shutdown.
const EVENTS_INTERVAL_MS = 15_000;
let eventsTimer: ReturnType<typeof setInterval> | null = null;
let eventsRunning = false;

async function start() {
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Gestimus API listening on http://${env.HOST}:${env.PORT}`);

    // Campionamento risorse processo (RAM/CPU) per le card 24h del super-admin.
    startSystemMetricsSampler();

    // #4: handler dei domain events + processor dell'outbox (retry email, ecc.).
    registerDomainEventHandlers();
    eventsTimer = setInterval(() => {
      if (eventsRunning) return; // tick saltato se il precedente è ancora in corso
      eventsRunning = true;
      void processEvents()
        .then((r) => {
          if (r.processed > 0 || r.failed > 0) {
            app.log.info({ ...r }, 'events: batch processato');
          }
        })
        .catch((err) => app.log.error({ err }, 'events: errore nel processor'))
        .finally(() => { eventsRunning = false; });
    }, EVENTS_INTERVAL_MS);
    eventsTimer.unref();

    if (env.CLEANUP_ENABLED) {
      if (!cron.validate(env.CLEANUP_CRON_SCHEDULE)) {
        app.log.error(
          { schedule: env.CLEANUP_CRON_SCHEDULE },
          'CLEANUP_CRON_SCHEDULE non valido — job di cleanup non avviato',
        );
      } else {
        cleanupTask = cron.schedule(env.CLEANUP_CRON_SCHEDULE, async () => {
          // R15: guard di re-entrancy. node-cron fa partire il tick anche se il
          // precedente è ancora in corso; senza guard la purga sessioni/bozze
          // girerebbe in parallelo a se stessa (DELETE ridondanti, spreco).
          if (cleanupRunning) {
            app.log.warn('cron: tick saltato, cleanup precedente ancora in corso');
            return;
          }
          cleanupRunning = true;
          try {
            app.log.info('cron: avvio cleanup tenant archiviati');
            try {
              const r = await runTenantCleanup();
              app.log.info({ result: r }, 'cron: cleanup completato');
            } catch (err) {
              app.log.error({ err }, 'cron: errore durante cleanup');
            }
            // M217: purga le sessioni scadute (altrimenti la tabella cresce senza
            // limite — sono già invalide al lookup, ma vanno rimosse).
            try {
              const purged = await cleanupExpiredSessions();
              if (purged > 0) app.log.info({ purged }, 'cron: sessioni scadute rimosse');
            } catch (err) {
              app.log.error({ err }, 'cron: errore pulizia sessioni');
            }
            // R15: elimina le iscrizioni BOZZA non completate da >24h.
            try {
              const removed = await cleanupStaleBozze();
              if (removed > 0) app.log.info({ removed }, 'cron: bozze iscrizione scadute rimosse');
            } catch (err) {
              app.log.error({ err }, 'cron: errore pulizia bozze');
            }
          } finally {
            cleanupRunning = false;
          }
        });
        app.log.info(
          { schedule: env.CLEANUP_CRON_SCHEDULE, retention: env.BACKUP_RETENTION_DAYS },
          'cron: cleanup tenant schedulato',
        );
      }
    } else {
      app.log.info('cron: cleanup disabilitato (CLEANUP_ENABLED=false)');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

let shuttingDown = false;
async function shutdown(signal: string) {
  // Idempotente: un secondo segnale durante lo shutdown non riavvia la sequenza.
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`Received ${signal}, shutting down...`);
  // Hard-timeout: se la chiusura ordinata si blocca (connessioni appese, SSE
  // che non drenano), forziamo l'uscita dopo 10s per non restare zombie.
  const forceExit = setTimeout(() => {
    app.log.error('shutdown: timeout 10s superato, uscita forzata');
    process.exit(1);
  }, 10_000);
  forceExit.unref();
  try {
    if (cleanupTask) cleanupTask.stop();
    if (eventsTimer) clearInterval(eventsTimer);
    await app.close();
    await stopRealtimeHub();
    await shutdownPools();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'shutdown: errore durante la chiusura ordinata');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Affidabilità: una promise rejection non gestita o un'eccezione non catturata
// non devono uccidere silenziosamente il processo. Logghiamo con contesto;
// su uncaughtException avviamo uno shutdown ordinato (lo stato è dubbio).
process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'unhandledRejection');
  captureError(reason, { kind: 'unhandledRejection' });
});
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'uncaughtException — shutdown');
  captureError(err, { kind: 'uncaughtException' });
  void shutdown('uncaughtException');
});

await start();
