import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL_APP: z.string().url(),
  DATABASE_URL_SUPER: z.string().url(),
  // DSN DIRETTO a Postgres (bypassa un eventuale PgBouncer). Usato SOLO dai due
  // consumatori che richiedono una SESSIONE stabile: il client LISTEN/NOTIFY del
  // realtime e l'advisory lock di SESSIONE del cleanup — entrambi incompatibili
  // con il transaction pooling. Tutto il resto (APP hot path, query platform,
  // DDL) è transaction-scoped e può passare dal bouncer. Se non impostato,
  // ricade su DATABASE_URL_SUPER (dev / deploy senza PgBouncer).
  DATABASE_URL_DIRECT: z.string().url().optional(),
  // Dimensione dei pool node-postgres. Il default di node-pg è 10: troppo basso
  // sotto picchi (form pubblici + sessioni live SSE concorrenti). Il pool APP
  // serve l'hot path tenant (RLS transaction-local → compatibile con PgBouncer
  // in transaction mode: in quel caso questo è il numero di connessioni
  // Node→PgBouncer, che multiplexa su poche connessioni backend). Il pool SUPER
  // serve solo platform + cleanup (advisory lock di SESSIONE su connessione
  // dedicata) e resta piccolo; NON va dietro un PgBouncer transaction-mode.
  DB_APP_POOL_MAX: z.coerce.number().int().positive().max(1000).default(20),
  DB_SUPER_POOL_MAX: z.coerce.number().int().positive().max(1000).default(5),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SUPERADMIN_SUBDOMAIN: z.string().default('platform'),
  // N27: base URL pubblica per i link nelle email (es. https://{slug}.gestimus.it).
  // Se impostata, gli URL di verifica iscrizione la usano invece degli header
  // host/x-forwarded-proto (spoofabili se un attacker bypassa il reverse proxy).
  // Supporta il placeholder {tenant} che viene sostituito con lo slug del tenant.
  PUBLIC_BASE_URL: z.string().optional(),
  SESSION_COOKIE_NAME: z.string().default('gestimus_session'),
  // L4: usato come secret di @fastify/cookie per firmare i cookie (es. flash,
  // futuri cookie firmati). NON è il segreto del token di sessione: quello è
  // un random per-sessione hashato in SHA-256 e salvato in `sessions.id`.
  SESSION_COOKIE_SECRET: z.string().min(32),
  GESTIMUS_SECRET_KEY: z.string().min(32),
  UPLOADS_DIR: z.string().default('./uploads'),
  UPLOADS_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(5),
  // Cleanup automatico tenant archiviati + backup pre-hard-delete (Fase 6 traccia B)
  ARCHIVE_DIR: z.string().default('./archive'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(90),
  CLEANUP_CRON_SCHEDULE: z.string().default('0 3 * * *'),
  CLEANUP_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),
  PLATFORM_SMTP_HOST: z.string().optional(),
  PLATFORM_SMTP_PORT: z.coerce.number().int().positive().optional(),
  PLATFORM_SMTP_USER: z.string().optional(),
  PLATFORM_SMTP_PASSWORD: z.string().optional(),
  PLATFORM_SMTP_FROM: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof schema>;
