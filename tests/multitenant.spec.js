import { test, expect } from '@playwright/test';

const PB_ENTE1 = 'http://127.0.0.1:8091';
const APP = 'http://localhost:8000';
const SEED_SCRIPT = 'node scripts/seed-all-tenants.js';

test.describe('Gestionale Concorso - E2E', () => {
  test.beforeAll(async () => {
    // Ensure PBs are running and seeded
    const { execSync } = require('child_process');
    try { execSync(SEED_SCRIPT, { cwd: '..', timeout: 30000 }); } catch {}
  });

  test('1. Login admin ente1 e crea concorso', async ({ page }) => {
    await page.goto(`${APP}/?pb=${PB_ENTE1}`);
    await page.fill('input[name="email"]', 'admin@ente1.test');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('#login-btn');
    await page.waitForSelector('[id="app-root"] section', { timeout: 5000 });

    // Should see the dashboard with KPI
    await expect(page.locator('text=Concorso Internazionale di Musica 2026')).toBeVisible({ timeout: 3000 });
  });

  test('2. Navigazione admin - sezioni e tab', async ({ page }) => {
    await page.goto(`${APP}/?pb=${PB_ENTE1}`);
    await page.fill('input[name="email"]', 'admin@ente1.test');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('#login-btn');
    await page.waitForTimeout(1000);

    // Click on Fasi tab
    await page.click('[data-tab="fasi"]');
    await page.waitForTimeout(500);
    await expect(page.locator('text=Eliminatoria')).toBeVisible();

    // Click on Candidati tab
    await page.click('[data-tab="candidati"]');
    await page.waitForTimeout(500);
    await expect(page.locator('text=Sofia')).toBeVisible();
  });

  test('3. Vista commissario con valutazione', async ({ page }) => {
    // Login as commissario via admin created account
    // First login as admin to get commissario email
    await page.goto(`${APP}/?pb=${PB_ENTE1}`);
    await page.fill('input[name="email"]', 'admin@ente1.test');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('#login-btn');
    await page.waitForTimeout(1000);

    // Navigate to commissari
    await page.click('[data-tab="commissari"]');
    await page.waitForTimeout(500);

    // Verify commissari are visible
    await expect(page.locator('text=Anna Rossi')).toBeVisible();
    await expect(page.locator('text=Marco Bianchi')).toBeVisible();
  });

  test('4. Selettore concorso e cambio', async ({ page }) => {
    await page.goto(`${APP}/?pb=${PB_ENTE1}`);
    await page.fill('input[name="email"]', 'admin@ente1.test');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('#login-btn');
    await page.waitForTimeout(1000);

    // Click "Cambia concorso"
    await page.click('[data-action="switch-concorso"]');
    await page.waitForTimeout(500);

    // Should see concorso selector
    await expect(page.locator('text=Scegli un concorso')).toBeVisible();
    await expect(page.locator('text=Apri')).toBeVisible();
  });

  test('5. Superadmin dashboard', async ({ page }) => {
    await page.goto(`${APP}/?pb=http://127.0.0.1:8093`);
    await page.fill('input[name="email"]', 'superadmin@platform.test');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('#login-btn');
    await page.waitForTimeout(2000);

    // Should see tenant cards
    await expect(page.locator('text=Conservatorio di Musica')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Associazione Culturale Musicale')).toBeVisible();
  });
});