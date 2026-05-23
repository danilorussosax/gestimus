// @ts-check
import { test, expect } from '@playwright/test';

/**
 * E2E calendario/scheduling. Verifica:
 *  - il tab Calendario dell'admin si apre e mostra la gestione sale + board;
 *  - creazione di una sala via UI;
 *  - flusso completo blocco → genera slot → pubblicazione (via API, cookie
 *    condiviso col browser) e rendering della pagina pubblica read-only.
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

test.describe('Gestimus · calendario E2E', () => {
  test('tab Calendario: apre, mostra sale e crea una sala', async ({ page }) => {
    await login(page);
    // Apre l'amministrazione del concorso cliccando la riga della tabella home
    // (setActiveConcorso + role admin + #/admin → i tab vengono renderizzati).
    // NB: il nome nell'header è un <p> non interattivo, non apre i tab.
    await page.locator('tr[data-open-concorso]', { hasText: 'Concorso Solisti 2026' }).click();
    await page.locator('[data-tab="calendario"]').first().click();

    // La board e la sezione sale sono renderizzate.
    await expect(page.getByRole('button', { name: /Aggiungi sala/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /Nuovo blocco/i })).toBeVisible();

    // Crea una sala via modale. Nome unico per run: il DB di test accumula i
    // record tra esecuzioni, un nome fisso darebbe match multipli (strict mode).
    const salaNome = `Sala E2E ${Date.now()}`;
    await page.getByRole('button', { name: /Aggiungi sala/i }).click();
    await page.locator('[data-f="nome"]').fill(salaNome);
    await page.locator('[data-action="primary"]').click();
    await expect(page.locator(`text=${salaNome}`).first()).toBeVisible({ timeout: 5000 });
  });

  test('pagina pubblica: link valido renderizza il calendario read-only', async ({ page, request }) => {
    await login(page);

    // Crea una pubblicazione via API (i cookie del browser sono condivisi col context).
    const concorsi = await page.evaluate(async () => {
      const r = await fetch('/api/concorsi', { credentials: 'include' });
      return r.json();
    });
    const concorso = concorsi.find((c) => /Solisti/.test(c.nome)) || concorsi[0];
    const token = await page.evaluate(async (concorsoId) => {
      const r = await fetch('/api/calendario/pubblicazioni', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ concorsoId, scopo: 'CONCORSO', etichetta: 'E2E', mostraNomi: true }),
      });
      return (await r.json()).token;
    }, concorso.id);
    expect(token).toBeTruthy();

    // La pagina pubblica (anche senza login funzionerebbe; qui riusiamo il context).
    await page.goto(`${BASE}/#/calendario?token=${encodeURIComponent(token)}`);
    await expect(page.locator(`text=${concorso.nome}`).first()).toBeVisible({ timeout: 8000 });

    // Token inesistente → messaggio di non disponibilità. Reload esplicito:
    // cambiare solo la query dell'hash (?token=) non rifà il render della SPA,
    // mentre un link pubblico viene sempre aperto a freddo (full load).
    await page.goto(`${BASE}/#/calendario?token=nonesiste123`);
    await page.reload();
    await expect(page.locator('text=/non disponibile|non valido/i')).toBeVisible({ timeout: 8000 });
  });
});
