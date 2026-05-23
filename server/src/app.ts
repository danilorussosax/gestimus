import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import sensible from '@fastify/sensible';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { pingDb } from './db/client.js';
import { registerTenantMiddleware } from './middleware/tenant.js';
import { registerAuthMiddleware } from './middleware/auth.js';
import { registerRuntimeMetrics } from './middleware/runtime-metrics.js';
import { authRoutes } from './routes/auth.js';
import { concorsiRoutes } from './routes/concorsi.js';
import { commissariRoutes } from './routes/commissari.js';
import { sezioniRoutes } from './routes/sezioni.js';
import { categorieRoutes } from './routes/categorie.js';
import { commissioniRoutes } from './routes/commissioni.js';
import { candidatiRoutes } from './routes/candidati.js';
import { fasiRoutes } from './routes/fasi.js';
import { criteriRoutes } from './routes/criteri.js';
import { candidatiFaseRoutes } from './routes/candidati-fase.js';
import { valutazioniRoutes } from './routes/valutazioni.js';
import { privacyRoutes } from './routes/privacy.js';
import { realtimeRoutes } from './routes/realtime.js';
import { uploadRoutes } from './routes/upload.js';
import { smtpRoutes } from './routes/smtp.js';
import { accountsRoutes } from './routes/accounts.js';
import { auditRoutes } from './routes/audit.js';
import { membriGruppoRoutes } from './routes/membri-gruppo.js';
import { enteRoutes } from './routes/ente.js';
import { iscrizioniAdminRoutes, iscrizioniPublicRoutes } from './routes/iscrizioni.js';
import { platformRoutes } from './routes/platform.js';
import { startRealtimeHub } from './realtime/hub.js';

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
          : undefined,
    },
    // N129: fidarsi solo del PRIMO hop (il reverse proxy nginx davanti all'app,
    // vedi deploy) invece di TUTTI i proxy. Con `true` un client che raggiunge
    // direttamente il processo potrebbe spoofare x-forwarded-for/proto (falsare
    // rate-limit per-IP e URL di verifica). Se il deploy aggiunge altri hop
    // (es. CDN proxy) aumentare il numero di conseguenza.
    trustProxy: 1,
  });

  // M3: error handler globale. Le route usano sia .parse() (throw) sia
  // .safeParse(); per quelle che throwano una ZodError, restituiamo un 400
  // generico senza leakare i nomi dei campi interni dello schema. Gli errori
  // con statusCode (es. da @fastify/sensible) sono propagati invariati.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      req.log.info({ issues: err.issues }, 'validazione input fallita');
      return reply.code(400).send({ error: 'richiesta non valida' });
    }
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, 'errore interno');
      return reply.code(status).send({ error: 'errore interno del server' });
    }
    return reply.code(status).send({ error: e.message ?? 'errore' });
  });

  await app.register(sensible);
  await app.register(cookie, { secret: env.SESSION_COOKIE_SECRET });
  await app.register(rateLimit, {
    global: false,
    max: 600,
    timeWindow: '1 minute',
  });
  await app.register(multipart, {
    limits: {
      fileSize: env.UPLOADS_MAX_FILE_SIZE_MB * 1024 * 1024,
      files: 1,
    },
  });

  // Servire il frontend statico dalla root del progetto (un livello sopra server/)
  // e gli uploads dal filesystem. Per dev locale comodo: tutto stesso origin.
  const projectRoot = resolve(fileURLToPath(import.meta.url), '../../..');
  // L6: blocca path sensibili che vivono sotto projectRoot e non devono mai
  // essere serviti come asset statici (sorgenti server, env, lockfile, .git).
  // fastifyStatic non serve i dotfile di default, ma `server/`, `package.json`,
  // ecc. sì — quindi li rifiutiamo esplicitamente prima dello static handler.
  const BLOCKED_STATIC = [/^\/server\//, /^\/node_modules\//, /^\/\.git\//, /^\/package(-lock)?\.json$/i, /\.env/i, /^\/tsconfig/i];
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (BLOCKED_STATIC.some((re) => re.test(path))) {
      return reply.code(404).send({ error: 'not found' });
    }
  });
  await app.register(fastifyStatic, {
    root: projectRoot,
    prefix: '/',
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: resolve(env.UPLOADS_DIR),
    prefix: '/uploads/',
    decorateReply: false,
    // M195: i file caricati sono serviti con nosniff → il browser non
    // MIME-sniffa (difesa in profondità oltre a magic-bytes + estensione
    // derivata dal MIME, N131).
    setHeaders: (res) => { res.setHeader('X-Content-Type-Options', 'nosniff'); },
  });

  await registerTenantMiddleware(app);
  await registerAuthMiddleware(app);
  // Runtime metrics: hook onRequest/onResponse per misurare latenza per-tenant.
  // DOPO il tenant middleware così req.tenant è già risolto.
  registerRuntimeMetrics(app);

  // Avvia il realtime hub (Postgres LISTEN client dedicato)
  await startRealtimeHub();

  // /healthz: liveness (il processo risponde). /readyz: readiness — verifica
  // la connettività DB reale così un orchestratore non instrada traffico se il
  // DB è irraggiungibile.
  app.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await pingDb();
      return { ok: true, env: env.NODE_ENV, db: 'up' };
    } catch (err) {
      reply.log.error({ err }, 'readyz: DB non raggiungibile');
      return reply.code(503).send({ ok: false, db: 'down' });
    }
  });

  await app.register(authRoutes, { prefix: '/auth' });

  // CRUD dominio
  await app.register(concorsiRoutes, { prefix: '/api' });
  await app.register(commissariRoutes, { prefix: '/api/commissari' });
  await app.register(sezioniRoutes, { prefix: '/api/sezioni' });
  await app.register(categorieRoutes, { prefix: '/api/categorie' });
  await app.register(commissioniRoutes, { prefix: '/api/commissioni' });
  await app.register(candidatiRoutes, { prefix: '/api/candidati' });
  await app.register(fasiRoutes, { prefix: '/api/fasi' });
  await app.register(criteriRoutes, { prefix: '/api/criteri' });
  await app.register(candidatiFaseRoutes, { prefix: '/api/candidati-fase' });
  await app.register(valutazioniRoutes, { prefix: '/api/valutazioni' });
  await app.register(privacyRoutes, { prefix: '/api/privacy' });

  // Fase 4: realtime + upload + smtp
  await app.register(realtimeRoutes, { prefix: '/api/realtime' });
  await app.register(uploadRoutes, { prefix: '/api/upload' });
  await app.register(smtpRoutes, { prefix: '/api/tenant/smtp' });

  // Fase 5a: accounts, audit, membri gruppo, ente
  await app.register(accountsRoutes, { prefix: '/api/accounts' });
  await app.register(auditRoutes, { prefix: '/api/audit-log' });
  await app.register(membriGruppoRoutes, { prefix: '/api/membri-gruppo' });
  await app.register(enteRoutes, { prefix: '/api/ente' });

  // Fase 5c: iscrizioni pubbliche + admin
  await app.register(iscrizioniPublicRoutes, { prefix: '/api/public' });
  await app.register(iscrizioniAdminRoutes, { prefix: '/api/iscrizioni' });

  // Fase 6: super-admin platform layer (gestione enti, lifecycle, audit, config)
  await app.register(platformRoutes, { prefix: '/api/platform' });

  return app;
}
