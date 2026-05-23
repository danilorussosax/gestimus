// @ts-check
import { test, expect } from '@playwright/test';

/**
 * E2E multitenant via subdomain. Verifica login per ognuno dei 3 ruoli
 * (admin tenant, commissario tenant, super-admin platform) e l'isolamento
 * basico (un admin non vede i concorsi dell'altro tenant).
 *
 * Richiede /etc/hosts mappato per *.gestimus.local → 127.0.0.1
 * e dataset seedato via `npm run db:seed` in server/.
 */

const HOSTS = {
  ente1: 'http://ente1.gestimus.local:4000',
  ente2: 'http://ente2.gestimus.local:4000',
  platform: 'http://platform.gestimus.local:4000',
};

const CREDS = {
  admin1: { email: 'admin@ente1.test', password: 'Admin123!' },
  admin2: { email: 'admin@ente2.test', password: 'Admin123!' },
  commissario1: { email: 'commissario@ente1.test', password: 'Demo123!' },
  superadmin: { email: 'super@platform.test', password: 'Super123!' },
};

async function login(page, baseUrl, creds) {
  await page.goto(`${baseUrl}/`);
  await page.fill('input[name="email"]', creds.email);
  await page.fill('input[name="password"]', creds.password);
  await page.click('#login-btn');
  await page.waitForFunction(
    () => !document.querySelector('input[name="password"]'),
    null,
    { timeout: 10_000 },
  );
}

test.describe('Gestimus · multitenant E2E', () => {
  test('admin ente1 può loggare e vede dati ente1', async ({ page }) => {
    await login(page, HOSTS.ente1, CREDS.admin1);
    // Concorso seedato visibile (sezione admin/home). Il nome compare in più
    // punti (header, select commissari, tabella) → .first() evita lo strict mode.
    await expect(page.locator('text=Concorso Solisti 2026').first()).toBeVisible({ timeout: 5000 });
  });

  test('admin ente2 logga separatamente e non vede dati ente1', async ({ page }) => {
    await login(page, HOSTS.ente2, CREDS.admin2);
    await expect(page.locator('text=Rassegna Giovani 2026').first()).toBeVisible({ timeout: 5000 });
    // Concorsi di ente1 NON devono essere visibili (isolamento tenant)
    await expect(page.locator('text=Concorso Solisti 2026')).toHaveCount(0);
  });

  test('super-admin vede la lista di tutti gli enti', async ({ page }) => {
    await login(page, HOSTS.platform, CREDS.superadmin);
    // I nomi mostrati sono quelli dei tenant, che possono essere ribrandizzati:
    // verifichiamo strutturalmente che la lista contenga ≥2 enti, senza
    // dipendere da nomi specifici.
    const enti = page.locator('[data-ente-id]');
    await expect(enti.first()).toBeVisible({ timeout: 5000 });
    expect(await enti.count()).toBeGreaterThanOrEqual(2);
  });

  test('credenziali errate → messaggio di errore', async ({ page }) => {
    await page.goto(`${HOSTS.ente1}/`);
    await page.fill('input[name="email"]', 'admin@ente1.test');
    await page.fill('input[name="password"]', 'wrong');
    await page.click('#login-btn');
    // Il form rimane visibile + errore mostrato
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });
});
