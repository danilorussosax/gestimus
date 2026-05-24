import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

const { Pool } = pg;

const appPool = new Pool({
  connectionString: env.DATABASE_URL_APP,
  max: env.DB_APP_POOL_MAX,
});
// superPool: query del ruolo super (platform, cleanup, DDL). Tutto
// transaction-scoped → compatibile con PgBouncer transaction mode. Gli usi
// session-stateful (LISTEN, advisory lock di sessione) NON passano da qui: usano
// connectDirectClient() / DATABASE_URL_DIRECT.
export const superPool = new Pool({
  connectionString: env.DATABASE_URL_SUPER,
  max: env.DB_SUPER_POOL_MAX,
});

// Affidabilità: un errore su un client idle del pool (es. connessione chiusa
// dal DB) emette 'error' sul Pool. Senza listener node-postgres rilancia e
// CRASHA il processo. Logghiamo; il pool sostituisce il client compromesso.
appPool.on('error', (err) => {
  console.error('[db] errore client idle (app pool):', err.message);
});
superPool.on('error', (err) => {
  console.error('[db] errore client idle (super pool):', err.message);
});

export const dbApp = drizzle(appPool, { schema });
export const dbSuper = drizzle(superPool, { schema });

export type DbApp = typeof dbApp;
export type DbSuper = typeof dbSuper;

// DSN diretto per i consumatori session-stateful (LISTEN/NOTIFY del realtime,
// advisory lock di SESSIONE del cleanup). Sotto PgBouncer transaction mode questi
// NON possono girare su connessioni multiplexate: vanno diretti a Postgres. Se
// `DATABASE_URL_DIRECT` non è impostato (dev / no bouncer), ricade su SUPER.
export const DATABASE_URL_DIRECT = env.DATABASE_URL_DIRECT ?? env.DATABASE_URL_SUPER;

/**
 * Apre un `pg.Client` dedicato e diretto (no pool, no PgBouncer) per usi che
 * richiedono una sessione stabile. Il chiamante è responsabile di `.end()`.
 */
export async function connectDirectClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: DATABASE_URL_DIRECT });
  await client.connect();
  return client;
}

/** Ping di connettività per gli health-check (readyz). Throwa se il DB è giù. */
export async function pingDb(): Promise<void> {
  await appPool.query('SELECT 1');
}

export async function shutdownPools(): Promise<void> {
  // L225: allSettled → se la chiusura di un pool fallisce, l'altro viene chiuso
  // comunque (Promise.all sarebbe fail-fast e lascerebbe un pool aperto).
  await Promise.allSettled([appPool.end(), superPool.end()]);
}
