import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

const { Pool } = pg;

const appPool = new Pool({ connectionString: env.DATABASE_URL_APP });
const superPool = new Pool({ connectionString: env.DATABASE_URL_SUPER });

export const dbApp = drizzle(appPool, { schema });
export const dbSuper = drizzle(superPool, { schema });

export type DbApp = typeof dbApp;
export type DbSuper = typeof dbSuper;

export async function shutdownPools(): Promise<void> {
  await Promise.all([appPool.end(), superPool.end()]);
}
