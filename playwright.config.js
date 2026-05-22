// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — backend Gestimus (Postgres+Fastify) su :4000.
 * Il backend serve anche il frontend statico, quindi un solo webServer.
 *
 * Pre-requisiti per la suite:
 *   - PostgreSQL locale con DB `gestimus` + ruoli (`npm run db:setup` in server/)
 *   - Seed eseguito (`npm run db:seed` in server/)
 *   - /etc/hosts mappa platform/ente1/ente2.gestimus.local → 127.0.0.1
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://ente1.gestimus.local:4000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'cd server && npm run dev',
    url: 'http://127.0.0.1:4000/healthz',
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
