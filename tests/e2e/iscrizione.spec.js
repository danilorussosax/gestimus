// @ts-check
import { test, expect } from '@playwright/test';

/**
 * E2E iscrizione pubblica (no login). Non invia (evita mutazioni + anti-spam):
 * verifica che il form si renderizzi con le difese anti-bot (honeypot `website`
 * + `startedAt` min-time) e i campi anagrafici, e che sia raggiungibile senza login.
 *
 * Richiede /etc/hosts (*.gestimus.local → 127.0.0.1) e `npm run db:seed`
 * con almeno un concorso a iscrizioni aperte su ente1.
 */

const BASE = 'http://ente1.gestimus.local:4000';

test.describe('Gestimus · iscrizione pubblica E2E', () => {
  test('il form pubblico si apre senza login con honeypot + min-time', async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}/#/iscrizione`);
    await page.reload();

    // Pagina pubblica: nessun redirect al login.
    await expect(page.locator('input[name="password"]')).toHaveCount(0);

    // ente1 ha un concorso a iscrizioni aperte → form renderizzato.
    const form = page.locator('#frm-iscrizione');
    await expect(form).toBeVisible({ timeout: 8000 });

    // Difese anti-bot presenti.
    await expect(form.locator('input[name="website"]')).toHaveCount(1); // honeypot (off-screen)
    await expect(form.locator('input[name="startedAt"]')).toHaveCount(1); // min-time
    // Honeypot fuori schermo (left:-10000px) → un utente reale non lo vede/compila.
    const box = await form.locator('input[name="website"]').boundingBox();
    expect(box && box.x).toBeLessThan(0);
    await expect(form.locator('input[name="website"]')).toHaveValue('');

    // Campi anagrafici chiave presenti.
    await expect(form.locator('input[name="nome"]')).toBeVisible();
    await expect(form.locator('input[name="cognome"]')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('submit a form vuoto non procede (validazione client)', async ({ page }) => {
    await page.goto(`${BASE}/#/iscrizione`);
    await page.reload();
    await expect(page.locator('#frm-iscrizione')).toBeVisible({ timeout: 8000 });

    await page.locator('[data-submit]').click();
    // Restiamo sul form (campi obbligatori non compilati): l'header del concorso resta.
    await expect(page.locator('#frm-iscrizione')).toBeVisible();
  });
});
