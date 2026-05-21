import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

// NOTE: questo file era in tests/multitenant.spec.js — fuori da `testDir` in
// playwright.config.js, quindi non veniva MAI eseguito. Ora è nella dir corretta.
// È marcato describe.skip perché richiede un setup multitenant locale
// (3 istanze PocketBase su porte 8090/8091/8093) che non è automatizzato.
//
// Per riattivarlo:
//   1. Avviare le 3 istanze PB su 8091/8093 (oltre alla principale 8090)
//   2. Eseguire `node scripts/seed-all-tenants.js`
//   3. Rimuovere il `.skip` dal describe sottostante
//
// I waitForTimeout originali sono stati sostituiti con assertion robuste.

const PB_ENTE1 = 'http://127.0.0.1:8091';
const PB_SUPER = 'http://127.0.0.1:8093';
const APP = 'http://localhost:8000';

async function login(page, pbUrl, email, password) {
  await page.goto(`${APP}/?pb=${pbUrl}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('#login-btn');
  await page.waitForSelector('[id="app-root"] section', { timeout: 10000 });
}

test.describe.skip('Gestionale Concorso · multitenant E2E', () => {
  test.beforeAll(() => {
    try {
      execSync('node scripts/seed-all-tenants.js', { timeout: 30000, stdio: 'inherit' });
    } catch (err) {
      // log esplicito invece di silent-swallow
      console.warn('seed-all-tenants failed, tests may fail:', err && err.message);
    }
  });

  test('1. Login admin ente1 e vede dashboard', async ({ page }) => {
    await login(page, PB_ENTE1, 'admin@ente1.test', 'admin123');
    await expect(page.locator('text=Concorso Internazionale di Musica 2026')).toBeVisible({ timeout: 5000 });
  });

  test('2. Navigazione admin · tab Fasi e Candidati', async ({ page }) => {
    await login(page, PB_ENTE1, 'admin@ente1.test', 'admin123');
    await page.click('[data-tab="fasi"]');
    await expect(page.locator('text=Eliminatoria')).toBeVisible();
    await page.click('[data-tab="candidati"]');
    await expect(page.locator('text=Sofia')).toBeVisible();
  });

  test('3. Tab commissari visibile', async ({ page }) => {
    await login(page, PB_ENTE1, 'admin@ente1.test', 'admin123');
    await page.click('[data-tab="commissari"]');
    await expect(page.locator('text=Anna Rossi')).toBeVisible();
    await expect(page.locator('text=Marco Bianchi')).toBeVisible();
  });

  test('4. Selettore concorso', async ({ page }) => {
    await login(page, PB_ENTE1, 'admin@ente1.test', 'admin123');
    await page.click('[data-action="switch-concorso"]');
    await expect(page.locator('text=Scegli un concorso')).toBeVisible();
  });

  test('5. Superadmin dashboard', async ({ page }) => {
    await login(page, PB_SUPER, 'superadmin@platform.test', 'admin123');
    await expect(page.locator('text=Conservatorio di Musica')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Associazione Culturale Musicale')).toBeVisible();
  });
});
