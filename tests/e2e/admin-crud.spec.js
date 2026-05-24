// @ts-check
import { test, expect } from '@playwright/test';

/**
 * E2E CRUD admin: crea una sezione via UI nel tab "Sezioni & Categorie" e
 * verifica che compaia; apre la modale di import CSV di sezioni/categorie.
 * Nomi unici per run (il DB di test accumula record tra esecuzioni).
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

async function openSezioniTab(page) {
  await page.locator('tr[data-open-concorso]', { hasText: 'Concorso Solisti 2026' }).click();
  await page.locator('[data-tab="sezioni"]').first().click();
  await expect(page.getByRole('button', { name: /Aggiungi sezione/i })).toBeVisible({ timeout: 5000 });
}

test.describe('Gestimus · admin CRUD E2E', () => {
  test('crea una sezione via UI e la vede in lista', async ({ page }) => {
    await login(page);
    await openSezioniTab(page);

    const nome = `Sezione E2E ${Date.now()}`;
    await page.getByRole('button', { name: /Aggiungi sezione/i }).click();
    await page.locator('#frm input[name="nome"]').fill(nome);
    await page.locator('[data-action="primary"]').click();

    await expect(page.locator(`text=${nome}`).first()).toBeVisible({ timeout: 5000 });
  });

  test('apre la modale di import CSV sezioni/categorie', async ({ page }) => {
    await login(page);
    await openSezioniTab(page);

    await page.locator('[data-action="import-sez"]').click();
    // La modale d'import mostra il pulsante per scaricare il template e il textarea CSV.
    await expect(page.getByRole('button', { name: /template/i })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-import-text]')).toBeVisible();
  });
});
