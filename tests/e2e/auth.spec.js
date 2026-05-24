// @ts-check
import { test, expect } from '@playwright/test';

/**
 * E2E auth: persistenza sessione su reload, logout, e che le pagine pubbliche
 * (privacy) siano raggiungibili senza login. Il login base + credenziali errate
 * sono in multitenant.spec.js.
 *
 * Richiede /etc/hosts (*.gestimus.local → 127.0.0.1) e `npm run db:seed`.
 */

const BASE = 'http://ente1.gestimus.local:4000';
const ADMIN = { email: 'admin@ente1.test', password: 'Admin123!' };

async function login(page) {
  await page.goto(`${BASE}/`);
  await page.fill('input[name="email"]', ADMIN.email);
  await page.fill('input[name="password"]', ADMIN.password);
  await page.click('#login-btn');
  await page.waitForFunction(() => !document.querySelector('input[name="password"]'), null, { timeout: 10_000 });
}

test.describe('Gestimus · auth E2E', () => {
  test('la sessione persiste dopo un reload', async ({ page }) => {
    await login(page);
    await page.reload();
    // Dopo il reload restiamo autenticati: niente form di login, logout visibile.
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
    await expect(page.locator('#logout-btn')).toBeVisible({ timeout: 8000 });
  });

  test('logout riporta alla schermata di login', async ({ page }) => {
    await login(page);
    await page.locator('#logout-btn').click();
    await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('la pagina privacy è pubblica (no login richiesto)', async ({ page }) => {
    await page.goto(`${BASE}/#/privacy`);
    await page.reload();
    // Nessun redirect al login: il form di login NON deve comparire.
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
    await expect(page.locator('#app-root')).toBeVisible();
  });

  test('niente errori JS di pagina al primo caricamento', async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});
