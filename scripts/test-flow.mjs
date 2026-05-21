import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Clear any existing session
await page.goto('http://127.0.0.1:8000/');
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto('http://127.0.0.1:8000/#/login');
await page.waitForLoadState('networkidle');
await page.evaluate(() => localStorage.setItem('gc_lang','it'));
await page.reload();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(700);

await page.fill('input[name="email"]','admin-shot@local.test');
await page.fill('input[name="password"]','password123');
await page.click('#login-btn');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);

console.log('After login, hash:', await page.evaluate(()=>location.hash));
await page.screenshot({ path: '/tmp/post-login.png', fullPage: false });

// Now navigate to admin and click "Cambia concorso"
await page.click('[data-action="role-admin"]');
await page.waitForTimeout(1200);
await page.click('[data-action="switch-concorso"]');
await page.waitForTimeout(900);
await page.screenshot({ path: '/tmp/cambia-concorso.png', fullPage: true });

await b.close();
if (errors.length) errors.forEach(e=>console.log('JS:',e)); else console.log('OK no errors');
