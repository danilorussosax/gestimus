// @ts-check
import { test, expect } from '@playwright/test';

// Setup helper: assicura che esista un admin di test e ritorna l'auth record.
async function ensureAdmin(request) {
  const ADMIN_EMAIL = 'e2e-admin@test.local';
  const ADMIN_PWD   = 'e2e-admin-pwd-12345';

  // Prova ad autenticarti — se fallisce, prova a crearlo.
  let res = await request.post('http://127.0.0.1:8090/api/collections/accounts/auth-with-password', {
    data: { identity: ADMIN_EMAIL, password: ADMIN_PWD },
  });
  if (res.status() === 200) return { email: ADMIN_EMAIL, password: ADMIN_PWD, token: (await res.json()).token };

  // Crea — la collezione accounts ha createRule aperto per il primo bootstrap.
  res = await request.post('http://127.0.0.1:8090/api/collections/accounts/records', {
    data: {
      email: ADMIN_EMAIL,
      password: ADMIN_PWD,
      passwordConfirm: ADMIN_PWD,
      role: 'admin',
      attivo: true,
      emailVisibility: true,
      nome: 'E2E', cognome: 'Admin',
    },
  });
  // 200 created OR 400 duplicate
  if (![200, 400].includes(res.status())) {
    throw new Error('admin create failed: ' + res.status() + ' ' + await res.text());
  }
  const auth = await request.post('http://127.0.0.1:8090/api/collections/accounts/auth-with-password', {
    data: { identity: ADMIN_EMAIL, password: ADMIN_PWD },
  });
  expect(auth.status()).toBe(200);
  return { email: ADMIN_EMAIL, password: ADMIN_PWD, token: (await auth.json()).token };
}

test('createCommissario + createAccount funziona end-to-end (no audit blocks)', async ({ request }) => {
  const admin = await ensureAdmin(request);
  const auth = { Authorization: admin.token };

  // 1) Crea (o ri-usa) un concorso di test
  let concorsoId;
  const existing = await request.get('http://127.0.0.1:8090/api/collections/concorsi/records?filter=' + encodeURIComponent('nome="E2E test concorso"'), { headers: auth });
  const exJson = await existing.json();
  if (exJson.items?.length) {
    concorsoId = exJson.items[0].id;
  } else {
    const create = await request.post('http://127.0.0.1:8090/api/collections/concorsi/records', {
      headers: { ...auth, 'Content-Type': 'application/json' },
      data: { nome: 'E2E test concorso', anno: 2026, stato: 'ATTIVO' },
    });
    expect(create.status()).toBe(200);
    concorsoId = (await create.json()).id;
  }

  // 2) Crea il commissario
  const ts = Date.now();
  const comRes = await request.post('http://127.0.0.1:8090/api/collections/commissari/records', {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: { concorso: concorsoId, nome: 'E2E', cognome: 'Tester', specialita: 'Pianoforte', stato: 'ATTIVO' },
  });
  expect(comRes.status(), 'commissario create').toBe(200);
  const comId = (await comRes.json()).id;

  // 3) Crea l'account collegato — questo è ciò che falliva
  const email = `e2e-com-${ts}@test.local`;
  const accRes = await request.post('http://127.0.0.1:8090/api/collections/accounts/records', {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: {
      email, password: 'pwd-12345', passwordConfirm: 'pwd-12345',
      role: 'commissario', commissario: comId, attivo: true, emailVisibility: true,
      nome: 'E2E', cognome: 'Tester',
    },
  });
  expect(accRes.status(), 'account create response: ' + await accRes.text().catch(() => '')).toBe(200);

  // 4) Pulizia: elimina account + commissario
  const accId = (await accRes.json()).id;
  await request.delete(`http://127.0.0.1:8090/api/collections/accounts/records/${accId}`, { headers: auth });
  await request.delete(`http://127.0.0.1:8090/api/collections/commissari/records/${comId}`, { headers: auth });
});

test('audit_log scrivibile senza autenticazione (best-effort, non blocca)', async ({ request }) => {
  const res = await request.post('http://127.0.0.1:8090/api/collections/audit_log/records', {
    data: { action: 'e2e.test', target_type: 'test', target_id: 'x' },
  });
  expect([200, 201]).toContain(res.status());
});
