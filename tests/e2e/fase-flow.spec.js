// @ts-check
import { test, expect } from '@playwright/test';

/**
 * E2E flusso core fase → risultati. Setup via API (cookie admin condiviso),
 * assert sulla UI Risultati. Copre l'INTEGRAZIONE: creazione fase + criterio,
 * avvio (auto-popola candidati_fase), render della classifica, conclusione.
 * (La matematica dello scoring è coperta dagli unit test su scoring.js/tiebreak.js.)
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

/** POST/GET helper eseguiti nel browser (cookie di sessione condivisi). */
async function api(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const r = await fetch(path, {
      method, credentials: 'include',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await r.text();
    let json; try { json = JSON.parse(txt); } catch { json = txt; }
    return { status: r.status, json };
  }, { method, path, body });
}

test.describe('Gestimus · fase → risultati E2E', () => {
  test('setup fase via API, avvio, classifica in Risultati, conclusione', async ({ page }) => {
    await login(page);
    const tag = Date.now();

    // Concorso seedato.
    const { json: concorsi } = await api(page, 'GET', '/api/concorsi');
    const concorso = concorsi.find((/** @type {any} */ c) => /Solisti/.test(c.nome)) || concorsi[0];
    expect(concorso).toBeTruthy();

    // Sezione + categoria + candidato (nomi unici).
    const sez = await api(page, 'POST', '/api/sezioni', { concorsoId: concorso.id, nome: `SezFlow ${tag}` });
    expect(sez.status).toBe(201);
    await api(page, 'POST', '/api/categorie', { sezioneId: sez.json.id, nome: `CatFlow ${tag}` });
    const candNome = `CandFlow ${tag}`;
    const cand = await api(page, 'POST', '/api/candidati', { concorsoId: concorso.id, nome: candNome, strumento: 'Pianoforte' });
    expect(cand.status).toBe(201);

    // Fase + criterio. `ordine` è unique per concorso → calcolo max+1.
    const faseNome = `FaseFlow ${tag}`;
    const { json: fasiEsistenti } = await api(page, 'GET', `/api/fasi?concorsoId=${concorso.id}`);
    const ordine = Math.max(0, ...fasiEsistenti.map((/** @type {any} */ f) => f.ordine || 0)) + 1;
    const fase = await api(page, 'POST', '/api/fasi', { concorsoId: concorso.id, ordine, nome: faseNome, scala: 10 });
    expect(fase.status).toBe(201);
    const crit = await api(page, 'POST', '/api/criteri', { faseId: fase.json.id, nome: 'Tecnica', peso: 100 });
    expect(crit.status).toBe(201);

    // Avvio fase → stato IN_CORSO + auto-popolamento candidati_fase.
    const started = await api(page, 'POST', `/api/fasi/${fase.json.id}/start`, {});
    expect([200, 201]).toContain(started.status);
    const cf = await api(page, 'GET', `/api/candidati-fase?faseId=${fase.json.id}`);
    expect(cf.json.length).toBeGreaterThan(0); // il nostro candidato è stato assegnato

    // Lo stato client (db.loadAll) è stato caricato al login, PRIMA del setup API
    // → reload per rifetchare, poi apri concorso e vai su Risultati.
    const openRisultati = async () => {
      await page.goto(`${BASE}/`); // load a freddo → rifetcha db.loadAll, landing home
      const row = page.locator('tr[data-open-concorso]', { hasText: concorso.nome });
      await row.waitFor({ state: 'visible', timeout: 10_000 });
      await row.click();
      await page.locator('[data-tab="risultati"]').first().click();
    };
    await openRisultati();
    await expect(page.locator(`text=${faseNome}`).first()).toBeVisible({ timeout: 8000 });

    // Concludi la fase via API → reload → Risultati mostra lo stato CONCLUSA.
    const concluded = await api(page, 'POST', `/api/fasi/${fase.json.id}/conclude`, {});
    expect([200, 201]).toContain(concluded.status);
    await openRisultati();
    await expect(page.locator(`text=${faseNome}`).first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=/CONCLUSA/i').first()).toBeVisible({ timeout: 8000 });
  });
});
