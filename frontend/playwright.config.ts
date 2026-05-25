import { defineConfig, devices } from '@playwright/test';

/**
 * E2E del frontend React (Vite dev server :5173, proxy → backend Fastify :4000).
 *
 * Pre-requisiti:
 *   - backend Gestimus avviato su :4000 (cd server && npm run dev) + DB seedato
 *   - /etc/hosts: 127.0.0.1 ente1.gestimus.local (tenant via sottodominio)
 *
 * Il proxy Vite preserva l'Host (changeOrigin:false) così il backend risolve
 * il tenant dal sottodominio anche in dev.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://ente1.gestimus.local:5173',
    locale: 'it-IT',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
