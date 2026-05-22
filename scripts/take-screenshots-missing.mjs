// scripts/take-screenshots-missing.mjs
//
// Cattura gli screenshot mancanti dopo la prima passata di take-screenshots.mjs.
// Mirato a: 17 (form iscrizione pubblico), 21 (audit log), 22 (commissario eval),
// 23 (pannello presidente), 24 (manuale in-app).
//
// Prerequisiti identici allo script completo: PocketBase su ente1.test:8000,
// seed eseguito (admin@ente1.test / admin123 + commissario@demo.local / Demo1234!).

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'docs', 'screenshots');
const BASE = process.env.APP_BASE || 'http://ente1.test:8000';
const ADMIN_EMAIL = 'admin@ente1.test';
const ADMIN_PWD = 'admin123';
const COM_EMAIL = 'commissario@demo.local';
const COM_PWD = 'Demo1234!';

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = (n) => path.join(OUT_DIR, n);
const snap = async (p, n) => { await p.screenshot({ path: out(n), fullPage: false }); console.log('  · ' + n); };

async function setIt(page) {
  await page.evaluate(() => { try { localStorage.setItem('gc_lang', 'it'); } catch {} });
}

async function freshLogin(browser, email, pwd) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  await setIt(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('input[type="email"], input[name="email"], input[name="identity"]', { timeout: 8000 });
  await page.locator('input[type="email"], input[name="email"], input[name="identity"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(pwd);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.locator('button[type="submit"], button:has-text("Accedi"), button:has-text("Entra")').first().click(),
  ]);
  await page.waitForTimeout(1200);
  return { ctx, page };
}

async function enterAdminWithConcorso(page) {
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const tile = page.locator('[data-action="role-admin"]').first();
  if (await tile.count().catch(() => 0)) { await tile.click({ timeout: 2000 }); await page.waitForTimeout(700); }
  const pick = page.locator('[data-pick]').first();
  if (await pick.count().catch(() => 0)) { await pick.click({ timeout: 2000 }); await page.waitForTimeout(900); }
}

const errs = [];

(async () => {
  const browser = await chromium.launch();
  console.log(`[capture missing] base=${BASE}`);

  // ---- 17: form iscrizione pubblico (NO auth) ----
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/iscrizione`, { waitUntil: 'networkidle' });
    await setIt(page);
    await page.reload({ waitUntil: 'networkidle' });
    // Aspetta che il form sia presente.
    await page.waitForSelector('form, input[name="nome"], input[name="email"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    await snap(page, '17-iscrizione-form-pubblico.png');
    await ctx.close();
  } catch (e) { errs.push(['17', e.message]); }

  // ---- 21: tab audit (admin login) ----
  try {
    const { ctx, page } = await freshLogin(browser, ADMIN_EMAIL, ADMIN_PWD);
    await enterAdminWithConcorso(page);
    // Click sulla voce sidebar Audit.
    await page.goto(`${BASE}/#/admin?tab=audit`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    // Se l'hash con ?tab non funziona, fallback su click nav.
    const auditNav = page.locator('a[data-tab="audit"], [data-tab="audit"]').first();
    if (await auditNav.count().catch(() => 0)) {
      try { await auditNav.click({ timeout: 1500 }); } catch {}
      await page.waitForTimeout(700);
    }
    await snap(page, '21-audit-log.png');
    await ctx.close();
  } catch (e) { errs.push(['21', e.message]); }

  // ---- 22+23: commissario (Anna = presidente) ----
  try {
    const { ctx, page } = await freshLogin(browser, COM_EMAIL, COM_PWD);
    await page.goto(`${BASE}/#/commissario`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    // 23: pannello presidente in cima (controllo sessione).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await snap(page, '23-presidente-panel.png');

    // 22: scrolla alla card del candidato (slider voti / quick score).
    await page.evaluate(() => {
      // Cerca un selettore plausibile della scheda valutazione.
      const candidates = [
        '[data-quick-score]',
        '[data-candidate-card]',
        'input[type="range"]',
        'h2',
        'h3',
      ];
      for (const sel of candidates) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const text = (el.textContent || '').toLowerCase();
          if (sel === 'input[type="range"]' || /tecnica|interpretazione|musicalit|#0|candidato/.test(text)) {
            el.scrollIntoView({ block: 'center' });
            return;
          }
        }
      }
      // Fallback: scroll metà pagina.
      window.scrollTo(0, Math.max(500, document.body.scrollHeight / 2));
    });
    await page.waitForTimeout(500);
    await snap(page, '22-commissario-eval.png');
    await ctx.close();
  } catch (e) { errs.push(['22-23', e.message]); }

  // ---- 24: manuale in-app (admin login) ----
  try {
    const { ctx, page } = await freshLogin(browser, ADMIN_EMAIL, ADMIN_PWD);
    await enterAdminWithConcorso(page);
    await page.goto(`${BASE}/#/admin?tab=manuale`, { waitUntil: 'networkidle' });
    // Attendi che il markdown sia stato fetched e renderizzato. La view fa
    // fetch + marked.parse; aspettiamo che almeno un h2 compaia.
    try {
      await page.waitForSelector('.manuale-print h2, [data-manuale] h2, h2', { timeout: 5000 });
    } catch {}
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await snap(page, '24-manuale-in-app.png');
    await ctx.close();
  } catch (e) { errs.push(['24', e.message]); }

  await browser.close();

  console.log('\n--- ERRORI ---');
  errs.forEach(([n, m]) => console.log(`✗ ${n}: ${m}`));
  console.log(errs.length === 0 ? '✓ tutti gli screenshot mancanti catturati' : `⚠ ${errs.length} con errori`);
  process.exit(errs.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
