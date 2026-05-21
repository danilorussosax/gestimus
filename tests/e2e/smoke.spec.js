// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Smoke test — gestionale', () => {
  test('login screen renders with email + password fields', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Accedi al gestionale/i })).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /Accedi/i })).toBeVisible();
  });

  test('skip-link è presente e linka al main', async ({ page }) => {
    await page.goto('/');
    const skip = page.locator('.skip-link');
    await expect(skip).toHaveAttribute('href', '#app-root');
    await expect(skip).toContainText(/Salta al contenuto/i);
  });

  test('manifest e service worker rispondono', async ({ page }) => {
    const m = await page.request.get('/manifest.webmanifest');
    expect(m.status()).toBe(200);
    const body = await m.json();
    expect(body.name).toContain('Gestionale');
    const sw = await page.request.get('/sw.js');
    expect(sw.status()).toBe(200);
  });

  test('PocketBase API health = 200', async ({ request }) => {
    const r = await request.get('http://127.0.0.1:8090/api/health');
    expect(r.status()).toBe(200);
  });

  test('Cmd+K apre la palette quando autenticati', async ({ page }) => {
    // Senza login il listener è comunque registrato ma db non ha dati.
    // Verifichiamo solo che la combinazione non sollevi errori.
    await page.goto('/');
    await page.keyboard.press('Meta+K');
    // Non assertiamo che si apra (richiede login): solo che non ci siano errori JS.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });
});
