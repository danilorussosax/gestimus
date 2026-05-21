#!/usr/bin/env node
/**
 * encrypt-existing-smtp.mjs
 *
 * Forza la migrazione delle SMTP password salvate in chiaro nella collection
 * `tenants` del PocketBase platform: le rilegge e le rispedisce con PATCH,
 * lasciando che l'hook pb_hooks/tenants.pb.js le cifri at-rest.
 *
 * Idempotente: i record già cifrati (prefisso `enc:v1:`) vengono saltati.
 *
 * Prerequisiti:
 *   - GESTIMUS_SECRET_KEY impostata nell'env del PB platform (8093).
 *     Se manca, l'hook NON cifra e questo script lascia le password in chiaro.
 *   - Credenziali superadmin in env: PLATFORM_URL, SUPERADMIN_EMAIL, SUPERADMIN_PWD.
 *     Default: legge da deploy/gestimus.env se presente.
 *
 * Uso:
 *   PLATFORM_URL=https://platform.gestimus.it \
 *   SUPERADMIN_EMAIL=superadmin@platform.gestimus.it \
 *   SUPERADMIN_PWD='xxx' \
 *   node scripts/encrypt-existing-smtp.mjs
 */

const PLATFORM_URL = process.env.PLATFORM_URL || 'http://127.0.0.1:8093';
const EMAIL = process.env.SUPERADMIN_EMAIL || '';
const PWD = process.env.SUPERADMIN_PWD || '';

if (!EMAIL || !PWD) {
  console.error('✗ SUPERADMIN_EMAIL e SUPERADMIN_PWD sono obbligatori.');
  process.exit(1);
}

async function authSuper() {
  const r = await fetch(`${PLATFORM_URL}/api/collections/accounts/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: EMAIL, password: PWD }),
  });
  if (!r.ok) throw new Error(`Login fallito: ${r.status} ${await r.text()}`);
  const j = await r.json();
  if (!j.token) throw new Error('Token mancante nella risposta di login');
  if (j.record?.role !== 'superadmin') throw new Error('L\'utente non è superadmin');
  return j.token;
}

async function listTenants(token) {
  const r = await fetch(`${PLATFORM_URL}/api/collections/tenants/records?perPage=500`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`List tenants fallito: ${r.status}`);
  return (await r.json()).items || [];
}

async function patchPassword(token, id, password) {
  const r = await fetch(`${PLATFORM_URL}/api/collections/tenants/records/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ smtp_password: password }),
  });
  if (!r.ok) throw new Error(`PATCH ${id} fallita: ${r.status} ${await r.text()}`);
  return await r.json();
}

(async () => {
  console.log(`→ Login superadmin su ${PLATFORM_URL}...`);
  const token = await authSuper();
  console.log('  ✓ token ottenuto');

  const tenants = await listTenants(token);
  console.log(`→ ${tenants.length} tenant trovat${tenants.length === 1 ? 'o' : 'i'}`);

  let encrypted = 0, alreadyEnc = 0, empty = 0, failed = 0;
  for (const t of tenants) {
    const p = String(t.smtp_password || '');
    if (!p) { empty++; continue; }
    if (p.startsWith('enc:v1:')) { alreadyEnc++; continue; }
    try {
      const updated = await patchPassword(token, t.id, p);
      const after = String(updated.smtp_password || '');
      if (after.startsWith('enc:v1:')) {
        console.log(`  ✓ ${t.slug || t.id}: cifrata`);
        encrypted++;
      } else {
        console.log(`  ⚠ ${t.slug || t.id}: re-salvata ma NON cifrata (GESTIMUS_SECRET_KEY mancante sul server?)`);
        failed++;
      }
    } catch (err) {
      console.error(`  ✗ ${t.slug || t.id}: ${err.message}`);
      failed++;
    }
  }

  console.log('');
  console.log('=========================================');
  console.log(`  Cifrate ora:     ${encrypted}`);
  console.log(`  Già cifrate:     ${alreadyEnc}`);
  console.log(`  Password vuote:  ${empty}`);
  console.log(`  Fallite/in chiaro: ${failed}`);
  console.log('=========================================');
  if (failed > 0) process.exit(2);
})().catch(err => {
  console.error('✗', err.message);
  process.exit(1);
});
