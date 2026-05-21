// @ts-check
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'e2e-admin@test.local';
const ADMIN_PWD   = 'e2e-admin-pwd-12345';

async function bootstrap_concorso(request) {
  await ensureAdminAuth(request);
  const auth = await ensureAdminAuth(request);
  const ex = await request.get(
    'http://127.0.0.1:8090/api/collections/concorsi/records?filter=' + encodeURIComponent('nome="E2E test concorso"'),
    { headers: { Authorization: auth } }
  );
  const j = await ex.json();
  if (j.items?.length) return { id: j.items[0].id };
  const c = await request.post('http://127.0.0.1:8090/api/collections/concorsi/records', {
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    data: { nome: 'E2E test concorso', anno: 2026, stato: 'ATTIVO' },
  });
  return { id: (await c.json()).id };
}

async function ensureAdminAuth(request) {
  let res = await request.post('http://127.0.0.1:8090/api/collections/accounts/auth-with-password', {
    data: { identity: ADMIN_EMAIL, password: ADMIN_PWD },
  });
  if (res.status() !== 200) {
    await request.post('http://127.0.0.1:8090/api/collections/accounts/records', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PWD, passwordConfirm: ADMIN_PWD,
              role: 'admin', attivo: true, emailVisibility: true, nome: 'E2E', cognome: 'Admin' },
    });
    res = await request.post('http://127.0.0.1:8090/api/collections/accounts/auth-with-password', {
      data: { identity: ADMIN_EMAIL, password: ADMIN_PWD },
    });
  }
  return (await res.json()).token;
}

async function bootstrap(request) {
  // Ensure admin
  let res = await request.post('http://127.0.0.1:8090/api/collections/accounts/auth-with-password', {
    data: { identity: ADMIN_EMAIL, password: ADMIN_PWD },
  });
  if (res.status() !== 200) {
    res = await request.post('http://127.0.0.1:8090/api/collections/accounts/records', {
      data: {
        email: ADMIN_EMAIL, password: ADMIN_PWD, passwordConfirm: ADMIN_PWD,
        role: 'admin', attivo: true, emailVisibility: true,
        nome: 'E2E', cognome: 'Admin',
      },
    });
    if (![200, 400].includes(res.status())) throw new Error('admin create failed: ' + await res.text());
    res = await request.post('http://127.0.0.1:8090/api/collections/accounts/auth-with-password', {
      data: { identity: ADMIN_EMAIL, password: ADMIN_PWD },
    });
  }
  const adminToken = (await res.json()).token;
  const auth = { Authorization: adminToken };

  // Concorso
  let concorsoId;
  const ex = await request.get(
    'http://127.0.0.1:8090/api/collections/concorsi/records?filter=' + encodeURIComponent('nome="E2E test concorso"'),
    { headers: auth }
  );
  const j = await ex.json();
  if (j.items?.length) concorsoId = j.items[0].id;
  else {
    const c = await request.post('http://127.0.0.1:8090/api/collections/concorsi/records', {
      headers: { ...auth, 'Content-Type': 'application/json' },
      data: { nome: 'E2E test concorso', anno: 2026, stato: 'ATTIVO' },
    });
    concorsoId = (await c.json()).id;
  }

  // Commissario senza account, con email pre-popolata
  const ts = Date.now();
  const comEmail = `e2e-existing-${ts}@test.local`;
  const com = await request.post('http://127.0.0.1:8090/api/collections/commissari/records', {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: {
      concorso: concorsoId, nome: 'Pre', cognome: 'Esistente',
      specialita: 'Pianoforte', stato: 'ATTIVO', email: comEmail,
    },
  });
  expect(com.status()).toBe(200);
  const comJson = await com.json();
  return { concorsoId, comId: comJson.id, comEmail };
}

test('edit commissario esistente + tick "Crea account" + save → account creato', async ({ page, request }) => {
  const { comId, comEmail } = await bootstrap(request);

  // Cattura errori console + network failures
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
  page.on('response', async (resp) => {
    if (resp.url().includes('/api/') && resp.status() >= 400) {
      const body = await resp.text().catch(() => '');
      errors.push(`HTTP ${resp.status()} ${resp.request().method()} ${resp.url()} → ${body}`);
    }
  });

  // 1) Pre-imposta il concorso attivo via localStorage prima del primo render.
  await page.goto('/');
  await page.evaluate((cid) => {
    localStorage.setItem('gestionale_meta_v2', JSON.stringify({
      activeConcorsoId: cid, role: 'admin', currentCommissarioId: null,
    }));
  }, /** @type {string} */ ((await bootstrap_concorso(request)).id));
  // ri-carica per applicare meta
  await page.reload();

  // 2) Login
  await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(ADMIN_PWD);
  await page.getByRole('button', { name: /Accedi/i }).click();
  await page.waitForLoadState('networkidle');

  // 3) Sidebar tab "Commissari"
  await page.locator('button[data-tab="commissari"]').first().click();
  await page.waitForLoadState('networkidle');

  // 3) Click data-edit del commissario specifico (usa il suo id)
  const editBtn = page.locator(`button[data-edit="${comId}"]`);
  await editBtn.scrollIntoViewIfNeeded();
  await expect(editBtn).toBeVisible({ timeout: 5000 });
  await editBtn.click();
  await expect(page.getByRole('heading', { name: /Modifica commissario/i })).toBeVisible({ timeout: 5000 });
  // Scroll dentro al modal fino al toggle account
  await page.locator('#acc-create-toggle').scrollIntoViewIfNeeded();

  // 4) Spunta la checkbox "Crea account di accesso"
  const acctToggle = page.locator('#acc-create-toggle');
  await expect(acctToggle).toBeVisible();
  await acctToggle.check();

  // 5) Fill email (pre-popolata col valore commissario) + password
  await page.locator('#acc-email').fill(comEmail); // unique email = commissario.email
  await page.locator('#acc-password').fill('test-pwd-12345');

  // 6) Click Salva modifiche
  await page.getByRole('button', { name: /Salva modifiche/i }).click();

  // 7) Aspetta toast di successo o di errore
  await page.waitForTimeout(2500);
  const errToast = await page.locator('[role="alert"]').allTextContents().catch(() => []);
  const allText = errToast.join(' | ');

  // Stampa eventuali errori per diagnosi
  if (errors.length || /fallit|errore|impossibile/i.test(allText)) {
    console.log('=== ERRORS CAPTURED ===');
    errors.forEach(e => console.log(e));
    console.log('=== TOAST/ALERTS ===');
    console.log(allText);
  }

  // L'account dovrebbe essere stato creato
  // Verifica via API
  const auth = { Authorization: (await (await page.request.post('http://127.0.0.1:8090/api/collections/accounts/auth-with-password', {
    data: { identity: ADMIN_EMAIL, password: ADMIN_PWD },
  })).json()).token };
  const check = await page.request.get(
    'http://127.0.0.1:8090/api/collections/accounts/records?filter=' + encodeURIComponent(`email="${comEmail}"`),
    { headers: auth }
  );
  const items = (await check.json()).items || [];
  expect(items.length, `account doveva essere creato per ${comEmail}; errori: ${errors.join(' || ')}; toast: ${allText}`).toBe(1);
});
