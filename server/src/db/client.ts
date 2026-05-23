import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

const { Pool } = pg;

const appPool = new Pool({ connectionString: env.DATABASE_URL_APP });
const superPool = new Pool({ connectionString: env.DATABASE_URL_SUPER });

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

/** Ping di connettività per gli health-check (readyz). Throwa se il DB è giù. */
export async function pingDb(): Promise<void> {
  await appPool.query('SELECT 1');
}

export async function shutdownPools(): Promise<void> {
  await Promise.all([appPool.end(), superPool.end()]);
}
