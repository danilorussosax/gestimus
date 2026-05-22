import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL_SUPER) {
  throw new Error('DATABASE_URL_SUPER not set (see .env.example)');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_SUPER,
  },
  verbose: true,
  strict: true,
});
