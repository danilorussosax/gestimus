import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = resolve(__dirname, '../src/db/policies.sql');

async function main() {
  const url = process.env.DATABASE_URL_SUPER;
  if (!url) throw new Error('DATABASE_URL_SUPER not set');

  const sql = await readFile(SQL_PATH, 'utf8');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    console.log('✓ Policies + roles applicati');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
