import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import sensible from '@fastify/sensible';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import helmet from '@fastify/helmet';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { env } from './env.js';
import { captureError } from './observability/sentry.js';
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
import { calendarioRoutes } from './routes/calendario.js';
import { calendarioPublicRoutes } from './routes/calendario-public.js';
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
    // Timeout di rete: tempo massimo per RICEVERE la richiesta (non la risposta:
    // sicuro per SSE, che è un GET veloce con risposta a lungo termine).
    requestTimeout: 30_000,
    keepAliveTimeout: 5_000,
    connectionTimeout: 60_000,
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
    // I rate-limit (@fastify/rate-limit con errorResponseBuilder) arrivano qui
    // come oggetto `{ statusCode, error }` (niente `.message`) → leggi `e.error`.
    const e = err as { statusCode?: number; message?: string; error?: string };
    const status = e.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, 'errore interno');
      // Error tracking: i 5xx vanno a Sentry (no-op se SENTRY_DSN assente) con
      // il minimo contesto utile, senza PII di body/cookie. La query string può
      // trasportare PII/segreti (?email=..., ?token=...): teniamo solo il path
      // per debuggabilità e scartiamo tutto ciò che segue il `?`.
      const scrubbedUrl = req.url.split('?')[0]!;
      captureError(err, { method: req.method, url: scrubbedUrl, statusCode: status });
      return reply.code(status).send({ error: 'errore interno del server' });
    }
    return reply.code(status).send({ error: e.error ?? e.message ?? 'errore' });
  });

  await app.register(sensible);
  await app.register(cookie, { secret: env.SESSION_COOKIE_SECRET });
  // Rate-limit globale (opt-in-with-default): protegge OGNI rotta per default.
  // `max` env-aware come per la rotta auth: in prod un default conservativo,
  // in dev/test effettivamente illimitato (la suite d'integrazione martella
  // molte rotte e NON deve mai prendere 429). Le rotte con `config.rateLimit`
  // dedicato (auth/iscrizioni/fasi/calendario-public) OVERRIDANO questo default.
  // Le probe liveness/readiness sono in allowList → mai 429.
  await app.register(rateLimit, {
    global: true,
    max: env.NODE_ENV === 'production' ? 120 : 100_000,
    timeWindow: '1 minute',
    allowList: ['/healthz', '/readyz'],
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
  // Gli allegati delle iscrizioni (documenti d'identità, autorizzazioni minori)
  // sono SENSIBILI → mai serviti come statici. Si scaricano solo via endpoint
  // autenticato admin (GET /api/iscrizioni/allegati/:id/download).
  // In modalità react lo static root è frontend/dist (i path sotto projectRoot
  // non sono serviti). In vanilla il root è projectRoot → senza questa lista
  // /docs, /deploy, /backups, /archive, /.github, /tests sarebbero scaricabili
  // (runbook infra, schema DB, backup cifrati, workflow CI). Difesa in
  // profondità valida in entrambe le modalità (l'hook è globale).
  // NB: /docs/manuale-admin.md è il manuale admin servito di proposito → escluso.
  const BLOCKED_STATIC = [
    /^\/server\//,
    /^\/node_modules\//,
    /^\/\.git\//,
    /^\/package(-lock)?\.json$/i,
    /\.env/i,
    /^\/tsconfig/i,
    /^\/uploads\/[^/]+\/iscrizione\//i,
    /^\/docs\/(?!manuale-admin\.md$)/i,
    /^\/deploy\//i,
    /^\/backups?\//i,
    /^\/archive\//i,
    /^\/\.github\//i,
    /^\/tests\//i,
  ];
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (BLOCKED_STATIC.some((re) => re.test(path))) {
      return reply.code(404).send({ error: 'not found' });
    }
  });
  // Frontend: la SPA React buildata (frontend/dist), servita con fallback SPA
  // per le rotte client (BrowserRouter). Il vecchio frontend vanilla è stato
  // deprecato e rimosso: niente più flag né serving da projectRoot.
  const reactDist = resolve(projectRoot, 'frontend/dist');
  const hasReactDist = existsSync(resolve(reactDist, 'index.html'));

  // Security headers (helmet). CSP: solo asset hashati locali ('self') — niente
  // CDN né 'unsafe-inline'/'unsafe-eval' (servivano solo al vecchio vanilla).
  // Google Fonts (style+font); img data:/blob: per le preview foto; connect a
  // Sentry ingest. Permissions-Policy aggiunta a mano (non in helmet 13).
  const isProd = env.NODE_ENV === 'production';
  await app.register(helmet, {
    contentSecurityPolicy: {
      // useDefaults:false → SOLO le direttive sotto (i default di helmet
      // includono `upgrade-insecure-requests`, che su http romperebbe gli asset).
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'https://*.ingest.sentry.io', 'https://*.sentry.io'],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        formAction: ["'self'"],
        ...(isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // COEP romperebbe i font/risorse cross-origin (Google Fonts): off.
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // HSTS solo in prod (dietro TLS); su http i browser lo ignorano comunque.
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
  });
  // Permissions-Policy: disabilita feature non usate (helmet 13 non la include).
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  });

  if (hasReactDist) {
    const indexHtml = readFileSync(resolve(reactDist, 'index.html'), 'utf8');
    await app.register(fastifyStatic, { root: reactDist, prefix: '/', decorateReply: false });
    // SPA fallback: ogni GET che non è API/asset → index.html (deep-link, reload).
    app.setNotFoundHandler((req, reply) => {
      const p = req.url.split('?')[0]!;
      const isApi = /^\/(api|auth|uploads|realtime|healthz|readyz)(\/|$)/.test(p);
      if (req.method === 'GET' && !isApi) {
        return reply.code(200).type('text/html').send(indexHtml);
      }
      return reply.code(404).send({ error: 'not found' });
    });
    app.log.info('frontend: React SPA da frontend/dist');
  } else {
    // dist mancante: builda con `cd frontend && npm run build`. Le API restano up.
    app.log.warn('frontend/dist assente — SPA non servita. Esegui `npm run build` in frontend/.');
  }
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

  // Calendario / scheduling: admin (CRUD + slot) + pubblico (link read-only)
  await app.register(calendarioPublicRoutes, { prefix: '/api/public' });
  await app.register(calendarioRoutes, { prefix: '/api/calendario' });

  // Fase 6: super-admin platform layer (gestione enti, lifecycle, audit, config)
  await app.register(platformRoutes, { prefix: '/api/platform' });

  return app;
}
