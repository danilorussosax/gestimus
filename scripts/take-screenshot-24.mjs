// Mirato: solo 24-manuale-in-app.png
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'docs', 'screenshots', '24-manuale-in-app.png');
const BASE = 'http://ente1.test:8000';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('gc_lang', 'it'); } catch {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('input[type="email"]', { timeout: 8000 });
  await page.locator('input[type="email"]').first().fill('admin@ente1.test');
  await page.locator('input[type="password"]').first().fill('admin123');
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.locator('button[type="submit"]').first().click(),
  ]);
  await page.waitForTimeout(1500);

  // Vai direttamente al manuale (rotta admin tab=manuale).
  await page.goto(`${BASE}/#/admin?tab=manuale`, { waitUntil: 'networkidle' });
  // Attendi che il markdown sia stato fetched + renderizzato (marked + h2).
  await page.waitForSelector('h2', { timeout: 10000 }).catch(() => {});
  // Dare tempo all'IntersectionObserver di settare la TOC e a marked di renderizzare img.
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT, fullPage: false });
  console.log('✓ salvato:', OUT);

  // chiudo solo dopo che il file è certamente flushato.
  await page.close();
  await ctx.close();
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
