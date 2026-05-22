import { createApp } from './app.js';
import { env } from './env.js';
import { shutdownPools } from './db/client.js';
import { stopRealtimeHub } from './realtime/hub.js';

const app = await createApp();

async function start() {
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Gestimus API listening on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  app.log.info(`Received ${signal}, shutting down...`);
  await app.close();
  await stopRealtimeHub();
  await shutdownPools();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await start();
