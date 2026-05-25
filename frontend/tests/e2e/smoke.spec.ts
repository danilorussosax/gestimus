import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke E2E del frontend React contro il backend reale (:4000 via proxy).
 * Verifica che la nuova app si monti, faccia login con sessione cookie,
 * e renderizzi le viste chiave senza eccezioni JS non gestite.
 */

const CREDS = { email: 'admin@ente1.test', password: 'Admin123!' };

function errorSink(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(CREDS.email);
  await page.locator('input[type="password"]').fill(CREDS.password);
  await page.locator('button[type="submit"]').click();
  // Post-login il router lascia /login (PublicOnlyRoute → home).
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

test.describe('Frontend React · smoke', () => {
  test('login screen renders (email + password + submit)', async ({ page }) => {
    const errors = errorSink(page);
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('public /iscrizione renders without login', async ({ page }) => {
    const errors = errorSink(page);
    await page.goto('/iscrizione');
    await expect(page.locator('#root :is(h1, h2)').first()).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });

  test('admin logs in and reaches home + admin workspace', async ({ page }) => {
    const errors = errorSink(page);
    await login(page);
    // Home: un heading dentro #root.
    await expect(page.locator('#root :is(h1, h2)').first()).toBeVisible({ timeout: 10_000 });
    // Admin workspace.
    await page.goto('/admin');
    await expect(page.locator('#root :is(h1, h2)').first()).toBeVisible({ timeout: 10_000 });
    expect(errors, 'errori JS nel flusso admin').toEqual([]);
  });
});
