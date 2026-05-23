import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
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
    trustProxy: true,
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
  await app.register(fastifyStatic, {
    root: projectRoot,
    prefix: '/',
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: resolve(env.UPLOADS_DIR),
    prefix: '/uploads/',
    decorateReply: false,
  });

  await registerTenantMiddleware(app);
  await registerAuthMiddleware(app);
  // Runtime metrics: hook onRequest/onResponse per misurare latenza per-tenant.
  // DOPO il tenant middleware così req.tenant è già risolto.
  registerRuntimeMetrics(app);

  // Avvia il realtime hub (Postgres LISTEN client dedicato)
  await startRealtimeHub();

  app.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }));
  app.get('/readyz', async () => ({ ok: true, env: env.NODE_ENV }));

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
