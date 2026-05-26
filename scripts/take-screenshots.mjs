// scripts/take-screenshots.mjs
//
// Cattura gli screenshot dell'app Gestimus (React + Fastify + Postgres) per il
// manuale admin (docs/manuale-admin.md). Riscritto per lo stack post-migrazione:
// React (BrowserRouter, niente più hash-routing) servito da Vite/nginx, API REST
// Fastify sotto /api e /auth con sessione via cookie (niente più PocketBase).
//
// Prerequisiti:
//   - dev server attivi:  (cd server && npm run dev)  +  (cd frontend && npm run dev)
//   - reverse proxy attivo: ./scripts/dev-proxy.sh up   (sottodomini *.gestimus.local su :80)
//   - seed dati ricco:     (cd server && npx tsx scripts/seed-screenshots.ts)
//   - Playwright installato (npm i -D playwright)
//
// Uso:
//   node scripts/take-screenshots.mjs
//   APP_BASE=http://ente1.gestimus.local node scripts/take-screenshots.mjs
//
// Output: PNG in docs/screenshots/

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'docs', 'screenshots');
const BASE = process.env.APP_BASE || 'http://ente1.gestimus.local';
const ADMIN_EMAIL = 'admin@ente1.test';
const ADMIN_PWD = 'Admin123!';
const COM_EMAIL = 'commissario@ente1.test';
const COM_PWD = 'Demo123!';

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = (name) => path.join(OUT_DIR, name);

const errs = [];
const skip = [];

async function snap(page, name) {
  await page.screenshot({ path: out(name), fullPage: false });
  console.log('  · ' + name);
}

const settle = (page, ms = 700) => page.waitForTimeout(ms);

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#email', { timeout: 10000 });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click('button[type=submit]'),
  ]);
  await settle(page, 1000);
}

// Naviga a un tab del workspace admin via URL (?c=<id>&tab=<tab>).
async function adminTab(page, concorsoId, tab) {
  await page.goto(`${BASE}/admin?c=${concorsoId}&tab=${tab}`, { waitUntil: 'networkidle' });
  await settle(page, 900);
}

async function getConcorsoId(page) {
  // page.request condivide i cookie del context → chiamata autenticata.
  const res = await page.request.get(`${BASE}/api/concorsi`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body.items ?? body.data ?? []);
  if (!list.length) throw new Error('nessun concorso restituito da /api/concorsi');
  return list[0].id;
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ===== Context ADMIN (lingua IT forzata su ogni pagina) =====
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('gc_lang', 'it'); } catch {} });
  const page = await ctx.newPage();

  // -------- 01: login --------
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#email', { timeout: 10000 });
    await settle(page, 400);
    await snap(page, '01-login.png');
  } catch (e) { errs.push(['01-login', e.message]); }

  await login(page, ADMIN_EMAIL, ADMIN_PWD);

  // -------- 02: home admin (tiles ruolo) --------
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await settle(page, 800);
    await snap(page, '02-home-admin.png');
  } catch (e) { errs.push(['02-home-admin', e.message]); }

  // -------- 03: concorso selector (/admin senza ?c) --------
  try {
    await page.evaluate(() => { try { localStorage.removeItem('gestimus_active_concorso'); } catch {} });
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
    await settle(page, 900);
    await snap(page, '03-concorso-selector.png');
  } catch (e) { errs.push(['03-concorso-selector', e.message]); }

  // -------- concorso id per i tab successivi --------
  let concorsoId = null;
  try { concorsoId = await getConcorsoId(page); }
  catch (e) { errs.push(['get-concorso-id', e.message]); }

  if (!concorsoId) {
    console.error('\n✗ Impossibile ottenere il concorso id: salto i tab admin.');
  } else {
    // -------- 04: sidebar admin (pagina Utenti = sidebar + lista account) --------
    try {
      await page.goto(`${BASE}/admin/utenti`, { waitUntil: 'networkidle' });
      await settle(page, 900);
      await snap(page, '04-sidebar-admin.png');
    } catch (e) { errs.push(['04-sidebar-admin', e.message]); }

    // -------- 05: sezioni --------
    try { await adminTab(page, concorsoId, 'sezioni'); await snap(page, '05-sezioni-tab.png'); }
    catch (e) { errs.push(['05-sezioni-tab', e.message]); }

    // -------- 06: commissari --------
    try { await adminTab(page, concorsoId, 'commissari'); await snap(page, '06-commissari-tab.png'); }
    catch (e) { errs.push(['06-commissari-tab', e.message]); }

    // -------- 07: commissioni --------
    try { await adminTab(page, concorsoId, 'commissioni'); await snap(page, '07-commissioni-tab.png'); }
    catch (e) { errs.push(['07-commissioni-tab', e.message]); }

    // -------- 08: fasi vista raggruppata --------
    try {
      await adminTab(page, concorsoId, 'fasi');
      await page.evaluate(() => window.scrollTo(0, 0));
      await snap(page, '08-fasi-vista-raggruppata.png');
    } catch (e) { errs.push(['08-fasi-vista-raggruppata', e.message]); }

    // -------- 09: fasi guida aperta --------
    try {
      await adminTab(page, concorsoId, 'fasi');
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => d.setAttribute('open', '')));
      await settle(page, 300);
      await page.evaluate(() => window.scrollTo(0, 0));
      await snap(page, '09-fasi-guida-aperta.png');
    } catch (e) { errs.push(['09-fasi-guida-aperta', e.message]); }

    // -------- 10/11/12: wizard fase (sezione Canto = vuota) --------
    // Il wizard è un UNICO dialog scrollabile con i 3 step impilati (template /
    // lista nomi-ammessi / configurazione comune): niente navigazione "Avanti".
    try {
      await adminTab(page, concorsoId, 'fasi');
      const wizardBtn = page.getByRole('button', { name: /Configura fasi/i }).first();
      if (await wizardBtn.count()) {
        await wizardBtn.scrollIntoViewIfNeeded();
        await wizardBtn.click();
        const dialog = page.locator('[role=dialog]');
        await dialog.waitFor({ timeout: 5000 });
        await settle(page, 500);
        await snap(page, '10-fasi-wizard-template.png');

        // scegli il template a 3 fasi (scoped al dialog → evita match con la guida)
        const tpl = dialog.getByRole('button', { name: /Eliminatoria \+ Semifinale \+ Finale/i }).first();
        if (await tpl.count()) { await tpl.click(); await settle(page, 400); }

        // step 2: lista nomi/ammessi (template scelto + lista visibili)
        await dialog.getByText(/Nome e posti per ogni fase/i).first().scrollIntoViewIfNeeded();
        await settle(page, 400);
        await snap(page, '11-fasi-wizard-lista.png');

        // step 3: configurazione comune (forza lo scroll del form interno fino in fondo)
        await dialog.evaluate(() => {
          const form = document.querySelector('[role=dialog] form');
          if (form) form.scrollTop = form.scrollHeight;
        });
        await settle(page, 400);
        await snap(page, '12-fasi-wizard-shared.png');

        await page.keyboard.press('Escape').catch(() => {});
        await settle(page, 300);
      } else {
        skip.push('10/11/12 wizard: pulsante "Configura fasi" non trovato (sezione vuota assente?)');
      }
    } catch (e) { errs.push(['10-fasi-wizard-template', e.message]); }

    // -------- 13: configurazione condivisa (batch-edit) --------
    try {
      await adminTab(page, concorsoId, 'fasi');
      const btn = page.getByRole('button', { name: /Configurazione condivisa/i }).first();
      if (await btn.count()) {
        await btn.scrollIntoViewIfNeeded();
        await btn.click();
        await page.waitForSelector('[role=dialog]', { timeout: 5000 });
        await settle(page, 500);
        await snap(page, '13-fasi-batch-edit.png');
        await page.keyboard.press('Escape').catch(() => {});
        await settle(page, 300);
      } else { skip.push('13-batch-edit: pulsante "Configurazione condivisa" non trovato'); }
    } catch (e) { errs.push(['13-fasi-batch-edit', e.message]); }

    // -------- 14: elimina gruppo (conferma, poi annulla) --------
    try {
      await adminTab(page, concorsoId, 'fasi');
      const btn = page.getByRole('button', { name: /Elimina gruppo/i }).first();
      if (await btn.count()) {
        await btn.scrollIntoViewIfNeeded();
        await btn.click();
        await page.waitForSelector('[role=dialog],[role=alertdialog]', { timeout: 5000 });
        await settle(page, 500);
        await snap(page, '14-fasi-delete-group.png');
        const annulla = page.getByRole('button', { name: /Annulla|Cancel/i }).first();
        if (await annulla.count()) { await annulla.click().catch(() => {}); }
        await page.keyboard.press('Escape').catch(() => {});
        await settle(page, 300);
      } else { skip.push('14-delete-group: pulsante "Elimina gruppo" non trovato'); }
    } catch (e) { errs.push(['14-fasi-delete-group', e.message]); }

    // -------- 15: card override / drift (Pianoforte: Semifinale scala 25) --------
    try {
      await adminTab(page, concorsoId, 'fasi');
      const piano = page.getByText('Pianoforte', { exact: false }).first();
      if (await piano.count()) { await piano.scrollIntoViewIfNeeded(); await settle(page, 300); }
      await snap(page, '15-fasi-card-override.png');
    } catch (e) { errs.push(['15-fasi-card-override', e.message]); }

    // -------- 16: iscrizioni --------
    try { await adminTab(page, concorsoId, 'iscrizioni'); await snap(page, '16-iscrizioni-tab.png'); }
    catch (e) { errs.push(['16-iscrizioni-tab', e.message]); }

    // -------- 18: candidati --------
    try { await adminTab(page, concorsoId, 'candidati'); await snap(page, '18-candidati-tab.png'); }
    catch (e) { errs.push(['18-candidati-tab', e.message]); }

    // -------- 19: risultati riepilogo --------
    try {
      await adminTab(page, concorsoId, 'risultati');
      await page.evaluate(() => window.scrollTo(0, 0));
      await snap(page, '19-risultati-riepilogo.png');
    } catch (e) { errs.push(['19-risultati-riepilogo', e.message]); }

    // -------- 20: generatore verbale --------
    try {
      await adminTab(page, concorsoId, 'risultati');
      // scroll fino al blocco verbale (combobox/select di selezione fase)
      const combo = page.locator('[role=combobox], select').last();
      if (await combo.count()) {
        await combo.scrollIntoViewIfNeeded();
        await settle(page, 400);
        await combo.click().catch(() => {});
        await settle(page, 300);
      } else {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await settle(page, 400);
      }
      await snap(page, '20-risultati-verbale.png');
      await page.keyboard.press('Escape').catch(() => {});
    } catch (e) { errs.push(['20-risultati-verbale', e.message]); }

    // -------- 21: audit --------
    try { await adminTab(page, concorsoId, 'audit'); await snap(page, '21-audit-log.png'); }
    catch (e) { errs.push(['21-audit-log', e.message]); }

    // -------- 24: manuale in-app --------
    try {
      await page.goto(`${BASE}/admin/manuale`, { waitUntil: 'networkidle' });
      await settle(page, 1200);
      await snap(page, '24-manuale-in-app.png');
    } catch (e) { errs.push(['24-manuale-in-app', e.message]); }
  }

  await ctx.close();

  // ===== Context PUBBLICO (no auth): form iscrizione =====
  try {
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx2.addInitScript(() => { try { localStorage.setItem('gc_lang', 'it'); } catch {} });
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/iscrizione`, { waitUntil: 'networkidle' });
    await settle(p2, 1200);
    await snap(p2, '17-iscrizione-form-pubblico.png');
    await ctx2.close();
  } catch (e) { errs.push(['17-iscrizione-form-pubblico', e.message]); }

  // ===== Context COMMISSARIO: presidente panel + eval =====
  try {
    const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx3.addInitScript(() => { try { localStorage.setItem('gc_lang', 'it'); } catch {} });
    const p3 = await ctx3.newPage();
    await login(p3, COM_EMAIL, COM_PWD);
    await p3.goto(`${BASE}/commissario`, { waitUntil: 'networkidle' });
    await settle(p3, 1500);

    // 23: pannello presidente / controllo sessione (in alto)
    await p3.evaluate(() => window.scrollTo(0, 0));
    await settle(p3, 400);
    await snap(p3, '23-presidente-panel.png');

    // 22: scheda di valutazione (ScoringSheet) — sotto il pannello presidente.
    // Anchor stabile: gli slider dei criteri (input[type=range]).
    const slider = p3.locator('input[type=range]').first();
    if (await slider.count()) {
      await slider.scrollIntoViewIfNeeded();
    } else {
      await p3.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    }
    await settle(p3, 500);
    await snap(p3, '22-commissario-eval.png');
    await ctx3.close();
  } catch (e) { errs.push(['22-23-commissario', e.message]); }

  await browser.close();

  console.log('\n--- ERRORI ---');
  if (!errs.length) console.log('(nessuno)');
  errs.forEach(([n, m]) => console.log(`✗ ${n}: ${m}`));
  console.log('\n--- SKIP ---');
  if (!skip.length) console.log('(nessuno)');
  skip.forEach((s) => console.log(`· ${s}`));
  console.log(`\nFatto. Output: ${OUT_DIR}`);
})();
