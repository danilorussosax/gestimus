import cron from 'node-cron';
import { createApp } from './app.js';
import { env } from './env.js';
import { shutdownPools } from './db/client.js';
import { stopRealtimeHub } from './realtime/hub.js';
import { runTenantCleanup } from './services/cleanup.js';

const app = await createApp();

let cleanupTask: ReturnType<typeof cron.schedule> | null = null;

async function start() {
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Gestimus API listening on http://${env.HOST}:${env.PORT}`);

    if (env.CLEANUP_ENABLED) {
      if (!cron.validate(env.CLEANUP_CRON_SCHEDULE)) {
        app.log.error(
          { schedule: env.CLEANUP_CRON_SCHEDULE },
          'CLEANUP_CRON_SCHEDULE non valido — job di cleanup non avviato',
        );
      } else {
        cleanupTask = cron.schedule(env.CLEANUP_CRON_SCHEDULE, async () => {
          app.log.info('cron: avvio cleanup tenant archiviati');
          try {
            const r = await runTenantCleanup();
            app.log.info({ result: r }, 'cron: cleanup completato');
          } catch (err) {
            app.log.error({ err }, 'cron: errore durante cleanup');
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

async function shutdown(signal: string) {
  app.log.info(`Received ${signal}, shutting down...`);
  if (cleanupTask) cleanupTask.stop();
  await app.close();
  await stopRealtimeHub();
  await shutdownPools();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await start();
