// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Smoke test — frontend + backend Fastify', () => {
  test('login screen renders with email + password fields', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Bentornato/i })).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /Accedi/i })).toBeVisible();
  });

  test('skip-link punta al main', async ({ page }) => {
    await page.goto('/');
    const skip = page.locator('.skip-link');
    await expect(skip).toHaveAttribute('href', '#app-root');
    await expect(skip).toContainText(/Salta al contenuto/i);
  });

  test('manifest + service worker rispondono', async ({ page }) => {
    const m = await page.request.get('/manifest.webmanifest');
    expect(m.status()).toBe(200);
    const body = await m.json();
    expect(body.name).toContain('Gestionale');
    const sw = await page.request.get('/sw.js');
    expect(sw.status()).toBe(200);
  });

  test('backend healthz', async ({ request }) => {
    const r = await request.get('http://127.0.0.1:4000/healthz');
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
  });

  test('Cmd+K non causa errori prima del login', async ({ page }) => {
    await page.goto('/');
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.keyboard.press('Meta+K');
    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });
});
