import { pino } from 'pino';
import { env } from '../env.js';

/**
 * #12: logger strutturato condiviso per i moduli che girano FUORI dal contesto
 * di una richiesta HTTP (pool DB, realtime hub, servizio email) e quindi non
 * hanno accesso a `req.log` / `app.log`.
 *
 * Prima questi moduli usavano `console.error`/`console.warn`: in produzione
 * (dove Fastify emette JSON strutturato) quelle stringhe finivano su stderr
 * senza livello né campi (reqId/tenantId assenti), non correlabili né filtrabili
 * dall'aggregatore di log. Questo logger replica la configurazione del logger
 * Fastify (livello da LOG_LEVEL, pino-pretty in development) così l'output resta
 * omogeneo: JSON su stdout in produzione, leggibile in dev.
 *
 * `module` distingue la sorgente nei log (es. { module: 'realtime' }).
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
    : {}),
});
