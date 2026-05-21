// @ts-check
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'e2e-admin@test.local';
const ADMIN_PWD   = 'e2e-admin-pwd-12345';

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

async function ensureConcorso(request, token) {
  const auth = { Authorization: token };
  const ex = await request.get(
    'http://127.0.0.1:8090/api/collections/concorsi/records?filter=' + encodeURIComponent('nome="E2E test concorso"'),
    { headers: auth }
  );
  const j = await ex.json();
  if (j.items?.length) return j.items[0].id;
  const c = await request.post('http://127.0.0.1:8090/api/collections/concorsi/records', {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: { nome: 'E2E test concorso', anno: 2026, stato: 'ATTIVO' },
  });
  return (await c.json()).id;
}

async function bootstrap(request) {
  const token = await ensureAdminAuth(request);
  const auth = { Authorization: token };
  const concorsoId = await ensureConcorso(request, token);

  const ts = Date.now();
  const comEmail = `e2e-pwd-${ts}@test.local`;
  const initialPwd = 'iniziale-pwd-12345';

  // Crea commissario
  const com = await request.post('http://127.0.0.1:8090/api/collections/commissari/records', {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: {
      concorso: concorsoId, nome: 'Reset', cognome: 'PwdTest',
      specialita: 'Pianoforte', stato: 'ATTIVO', email: comEmail,
    },
  });
  expect(com.status()).toBe(200);
  const comId = (await com.json()).id;

  // Crea account collegato col password iniziale
  const accRes = await request.post('http://127.0.0.1:8090/api/collections/accounts/records', {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: {
      email: comEmail, password: initialPwd, passwordConfirm: initialPwd,
      role: 'commissario', commissario: comId, attivo: true, emailVisibility: true,
      nome: 'Reset', cognome: 'PwdTest',
    },
  });
  expect(accRes.status()).toBe(200);
  const accId = (await accRes.json()).id;

  return { concorsoId, comId, comEmail, initialPwd, accId };
}

test('"Genera nuova password" cambia effettivamente la password', async ({ page, request }) => {
  const { concorsoId, comId, comEmail, initialPwd, accId } = await bootstrap(request);

  // Disabilita il SW per evitare cache stale durante i test.
  await page.addInitScript(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister()));
    }
    try { Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true }); } catch {}
  });
  // Pre-imposta concorso attivo
  await page.goto('/');
  await page.evaluate((cid) => {
    localStorage.setItem('gestionale_meta_v2', JSON.stringify({
      activeConcorsoId: cid, role: 'admin', currentCommissarioId: null,
    }));
  }, concorsoId);
  await page.reload();

  // Login
  await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(ADMIN_PWD);
  await page.getByRole('button', { name: /Accedi/i }).click();
  await page.waitForLoadState('networkidle');

  // Tab Commissari
  await page.locator('button[data-tab="commissari"]').first().click();
  await page.waitForLoadState('networkidle');

  // Apri il modal del commissario specifico
  const editBtn = page.locator(`button[data-edit="${comId}"]`);
  await editBtn.scrollIntoViewIfNeeded();
  await editBtn.click();
  await expect(page.getByRole('heading', { name: /Modifica commissario/i })).toBeVisible();

  // Click "🔑 Genera nuova password" — anchor diretto al pulsante
  const resetBtn = page.locator('button[data-acc-action="reset"]');
  await expect(resetBtn).toBeAttached({ timeout: 5000 });
  await resetBtn.scrollIntoViewIfNeeded();
  await resetBtn.click();

  // Aspetta il modal "Nuova password generata" e cattura la password mostrata
  await expect(page.getByRole('heading', { name: /Nuova password generata/i })).toBeVisible({ timeout: 5000 });
  // La password è dentro <span class="select-all"> nel pannello credenziali (la riga con "pwd")
  const pwdLines = await page.locator('.select-all').allTextContents();
  // pwdLines[0] = email, pwdLines[1] = password
  expect(pwdLines.length, 'devono esserci email + password mostrate').toBeGreaterThanOrEqual(2);
  const newPwd = pwdLines[1];
  expect(newPwd.length, 'password generata non vuota').toBeGreaterThanOrEqual(8);
  expect(newPwd, 'la nuova password non deve essere uguale a quella iniziale').not.toBe(initialPwd);

  // Verifica che la VECCHIA password NON funzioni più
  const oldLogin = await request.post('http://127.0.0.1:8090/api/collections/accounts/auth-with-password', {
    data: { identity: comEmail, password: initialPwd },
  });
  expect(oldLogin.status(), 'la password iniziale non deve più autenticare').not.toBe(200);

  // Verifica che la NUOVA password funzioni
  const newLogin = await request.post('http://127.0.0.1:8090/api/collections/accounts/auth-with-password', {
    data: { identity: comEmail, password: newPwd },
  });
  expect(newLogin.status(), `la nuova password deve autenticare; corpo: ${await newLogin.text().catch(()=>'')}`).toBe(200);

  // Pulizia
  const adminToken = await ensureAdminAuth(request);
  await request.delete(`http://127.0.0.1:8090/api/collections/accounts/records/${accId}`, {
    headers: { Authorization: adminToken },
  });
  await request.delete(`http://127.0.0.1:8090/api/collections/commissari/records/${comId}`, {
    headers: { Authorization: adminToken },
  });
});
