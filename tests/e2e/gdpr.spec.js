// @ts-check
import { test, expect } from '@playwright/test';

/**
 * E2E GDPR export (Art. 20 data portability). Verifica che l'export del tenant:
 *  - richieda autenticazione admin (no auth → 401/403);
 *  - come admin → 200 + JSON strutturato (tenant + exportedAt).
 * Read-only: non muta dati. (L'erase è distruttivo → coperto dai test server.)
 *
 * Richiede /etc/hosts (*.gestimus.local → 127.0.0.1) e `npm run db:seed`.
 */

const BASE = 'http://ente1.gestimus.local:4000';
const ADMIN = { email: 'admin@ente1.test', password: 'Admin123!' };

test.describe('Gestimus · GDPR export E2E', () => {
  test('export senza login → negato', async ({ request }) => {
    const r = await request.post(`${BASE}/api/privacy/export`, {
      headers: { 'content-type': 'application/json' },
      data: {},
      failOnStatusCode: false,
    });
    expect([401, 403]).toContain(r.status());
  });

  test('export come admin → 200 + JSON strutturato', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.fill('input[name="email"]', ADMIN.email);
    await page.fill('input[name="password"]', ADMIN.password);
    await page.click('#login-btn');
    await page.waitForFunction(() => !document.querySelector('input[name="password"]'), null, { timeout: 10_000 });

    const res = await page.evaluate(async () => {
      const r = await fetch('/api/privacy/export', { method: 'POST', credentials: 'include' });
      const text = await r.text();
      let json; try { json = JSON.parse(text); } catch { json = null; }
      return { status: r.status, hasTenant: !!json?.tenant, hasExportedAt: !!json?.exportedAt, slug: json?.tenant?.slug };
    });
    expect(res.status).toBe(200);
    expect(res.hasTenant).toBe(true);
    expect(res.hasExportedAt).toBe(true);
    expect(res.slug).toBe('ente1');
  });
});
