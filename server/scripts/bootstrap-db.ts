import 'dotenv/config';
import { Client } from 'pg';

/**
 * Bootstrap del DB: crea ruoli `gestimus_app` e `gestimus_super` e il database `gestimus`.
 * Va eseguito UNA VOLTA, prima di `db:setup`, usando una connessione con privilegi
 * superuser (default: l'utente di sistema su macOS / postgres su Linux).
 *
 * Connection string usata: DATABASE_URL_BOOTSTRAP
 *   default: postgres://<user>@localhost:5432/postgres (peer auth macOS)
 */
async function main() {
  const bootstrapUrl =
    process.env.DATABASE_URL_BOOTSTRAP ?? `postgres://${process.env.USER}@localhost:5432/postgres`;

  console.log(`→ Bootstrap connection: ${bootstrapUrl.replace(/:[^:@]*@/, ':***@')}`);

  const client = new Client({ connectionString: bootstrapUrl });
  await client.connect();

  try {
    // 1. Ruoli (idempotente)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestimus_app') THEN
          CREATE ROLE gestimus_app LOGIN PASSWORD 'devpassword';
        ELSE
          ALTER ROLE gestimus_app WITH LOGIN PASSWORD 'devpassword';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestimus_super') THEN
          CREATE ROLE gestimus_super LOGIN PASSWORD 'devpassword' BYPASSRLS CREATEDB;
        ELSE
          ALTER ROLE gestimus_super WITH LOGIN PASSWORD 'devpassword' BYPASSRLS CREATEDB;
        END IF;
      END $$;
    `);
    console.log('✓ Ruoli gestimus_app / gestimus_super pronti');

    // 2. Database (CREATE DATABASE non può girare in transazione: già non lo è qui)
    const existing = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'gestimus'`);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE gestimus OWNER gestimus_super`);
      console.log('✓ Database "gestimus" creato (owner: gestimus_super)');
    } else {
      console.log('· Database "gestimus" già esistente');
      await client.query(`ALTER DATABASE gestimus OWNER TO gestimus_super`);
    }
  } finally {
    await client.end();
  }

  console.log('\n✓ Bootstrap completato. Ora puoi eseguire: npm run db:setup');
}

main().catch((err) => {
  console.error('\n✗ Bootstrap fallito:', err.message);
  console.error('\nSe la connessione fallisce: imposta DATABASE_URL_BOOTSTRAP nel .env');
  console.error('Esempio macOS:  postgres://danilorusso@localhost:5432/postgres');
  console.error('Esempio Linux:  postgres://postgres@localhost:5432/postgres\n');
  process.exit(1);
});
