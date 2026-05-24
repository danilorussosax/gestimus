// @ts-check
import { test, expect } from '@playwright/test';

/**
 * E2E del DISPLAY del calendario (#/calendario?token=…&display=1):
 *  - in display mode la chrome dell'app (header/footer) è nascosta → solo tabellone;
 *  - senza display la chrome resta visibile;
 *  - il tabellone (.cal-disp) renderizza.
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

/** Crea una pubblicazione del calendario via API (cookie condivisi col browser) → token. */
async function makeToken(page) {
  const concorsi = await page.evaluate(async () => {
    const r = await fetch('/api/concorsi', { credentials: 'include' });
    return r.json();
  });
  const concorso = concorsi.find((/** @type {any} */ c) => /Solisti/.test(c.nome)) || concorsi[0];
  const token = await page.evaluate(async (concorsoId) => {
    const r = await fetch('/api/calendario/pubblicazioni', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ concorsoId, scopo: 'CONCORSO', etichetta: 'E2E display', mostraNomi: true }),
    });
    return (await r.json()).token;
  }, concorso.id);
  return { token, concorso };
}

test.describe('Gestimus · display calendario (tabellone)', () => {
  test('display=1 nasconde header+footer e mostra il tabellone', async ({ page }) => {
    await login(page);
    const { token, concorso } = await makeToken(page);
    expect(token).toBeTruthy();

    // Apertura "a freddo" come farebbe un monitor (full load, non solo cambio hash).
    await page.goto(`${BASE}/#/calendario?token=${encodeURIComponent(token)}&display=1`);
    await page.reload();

    // Cuore della feature: la chrome admin/app è nascosta.
    await expect(page.locator('#app-header')).toBeHidden({ timeout: 8000 });
    await expect(page.locator('#app-footer')).toBeHidden();

    // Il contenitore del tabellone è renderizzato col titolo del concorso.
    await expect(page.locator('.cal-disp')).toBeVisible({ timeout: 8000 });
    await expect(page.locator(`.cal-disp__title:has-text("${concorso.nome}")`)).toBeVisible();

    // body in display-mode (hook di stile).
    await expect(page.locator('body.display-mode')).toHaveCount(1);
  });

  test('senza display la chrome resta visibile', async ({ page }) => {
    await login(page);
    const { token } = await makeToken(page);
    await page.goto(`${BASE}/#/calendario?token=${encodeURIComponent(token)}`);
    await page.reload();
    await expect(page.locator('#app-header')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('body.display-mode')).toHaveCount(0);
  });
});
