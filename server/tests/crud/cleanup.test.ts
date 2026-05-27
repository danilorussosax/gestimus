import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { readFile, stat, unlink, utimes, writeFile, readdir, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createDecipheriv } from 'node:crypto';
import { resolve, join } from 'node:path';
import { eq, like } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { dbSuper } from '../../src/db/client.js';
import { accounts, concorsi, platformAuditLog, tenants } from '../../src/db/schema.js';
import { backupTenant, listBackups, pruneOldBackups, restoreTenant } from '../../src/services/backup.js';
import { runTenantCleanup } from '../../src/services/cleanup.js';
import { deriveKey } from '../../src/services/keys.js';
import { hashPassword } from '../../src/services/password.js';
import { env } from '../../src/env.js';

// Usa la STESSA dir dei servizi (env.ARCHIVE_DIR, default ./archive).
// Pulizia mirata in `after` per non rimuovere altri backup eventuali.
const ARCHIVE_DIR = resolve(env.ARCHIVE_DIR);
const TEST_SLUG_PREFIX = 'cleanup-';
const STALE_FILE_PREFIX = 'stale-';

describe('Cleanup tenant + backup pre-hard-delete (Fase 6 traccia B)', () => {
  let app: FastifyInstance;
  let superCookie: string;
  const slug = `cleanup-${Date.now()}`;
  let tenantId: string;

  before(async () => {
    await mkdir(ARCHIVE_DIR, { recursive: true });

    app = await createApp();
    await app.ready();

    const superLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'platform.gestimus.local', 'content-type': 'application/json' },
      payload: { email: 'super@platform.test', password: 'Super123!' },
    });
    assert.equal(superLogin.statusCode, 200);
    superCookie = `gestimus_session=${superLogin.cookies.find((c) => c.name === 'gestimus_session')!.value}`;

    // Crea un tenant archiviato con cleanup_scheduled_at nel passato (1 giorno fa)
    const yesterday = new Date(Date.now() - 86400_000);
    const archived = new Date(Date.now() - 30 * 86400_000); // archiviato 30gg fa
    const [t] = await dbSuper
      .insert(tenants)
      .values({
        slug,
        nome: `Test Cleanup ${slug}`,
        piano: 'trial',
        stato: 'archiviato',
        archiviatoAt: archived,
        cleanupAfterDays: 7,
        cleanupScheduledAt: yesterday,
      })
      .returning();
    tenantId = t!.id;

    // Crea un account + un concorso per il tenant (dati da serializzare nel backup)
    await dbSuper.insert(accounts).values({
      tenantId,
      email: `admin@${slug}.test`,
      passwordHash: await hashPassword('Pass1234!'),
      role: 'admin',
      emailVerified: true,
    });
    await dbSuper.insert(concorsi).values({
      tenantId,
      nome: 'Concorso da archiviare',
      anno: 2024,
      stato: 'CONCLUSO',
    });
  });

  after(async () => {
    // Pulizia difensiva: tenant di test residui + audit relativi
    if (tenantId) {
      await dbSuper.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await dbSuper.delete(platformAuditLog).where(eq(platformAuditLog.targetTenantSlug, slug));
    await dbSuper
      .delete(platformAuditLog)
      .where(like(platformAuditLog.targetTenantSlug, `${TEST_SLUG_PREFIX}%`));
    // Rimuovi solo i file di backup creati da questo test (slug cleanup-* o stale-*)
    try {
      const files = await readdir(ARCHIVE_DIR);
      for (const f of files) {
        if (f.startsWith(TEST_SLUG_PREFIX) || f.startsWith(STALE_FILE_PREFIX)) {
          await unlink(join(ARCHIVE_DIR, f));
        }
      }
    } catch {
      // dir può non esistere se nessun test ha scritto
    }
    await app.close();
  });

  test('backupTenant produce un file cifrato AES-256-GCM decifrabile coi dati attesi', async () => {
    const result = await backupTenant(tenantId);
    // C13: il backup è cifrato → estensione .json.gz.enc, format 2.
    assert.ok(result.path.endsWith('.json.gz.enc'), 'estensione cifrata corretta');
    const st = await stat(result.path);
    assert.ok(st.size > 0, 'file non vuoto');
    assert.equal(result.tableCounts.accounts, 1, 'backup contiene il singolo account');
    assert.equal(result.tableCounts.concorsi, 1, 'backup contiene il singolo concorso');

    // Decifra: [1 byte version][12 IV][16 tag][ciphertext = gzip(json)].
    // La chiave AES dei backup è la sottochiave HKDF 'gestimus:backup' (32 byte),
    // non più il master grezzo: riusiamo deriveKey per restare allineati alla
    // derivazione di backup.ts.
    const key = deriveKey('gestimus:backup', 32);
    const buf = await readFile(result.path);
    assert.equal(buf[0], 0x02, 'version byte = 2');
    const iv = buf.subarray(1, 13);
    const tag = buf.subarray(13, 29);
    const ciphertext = buf.subarray(29);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const gz = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const json = JSON.parse(gunzipSync(gz).toString('utf8'));
    assert.equal(json.format, 2);
    assert.equal(json.tenantSlug, slug);
    assert.ok(Array.isArray(json.tables.accounts));
    assert.equal(json.tables.accounts.length, 1);
    assert.equal(json.tables.concorsi.length, 1);
    assert.equal(json.tables.concorsi[0].nome, 'Concorso da archiviare');
    assert.ok(json.tenant, 'la riga del tenant è inclusa');
    assert.equal(json.tenant.slug, slug);
  });

  test('runTenantCleanup elimina il tenant scaduto + scrive audit + backup', async () => {
    // Conta backups prima
    const beforeFiles = await listBackups();
    const result = await runTenantCleanup();

    assert.ok(result.candidatesFound >= 1, 'almeno il nostro tenant deve essere candidato');
    assert.ok(result.deleted >= 1, 'almeno una eliminazione completata');
    assert.equal(result.errors.length, 0, 'nessun errore');

    // Tenant non più presente nel DB
    const check = await dbSuper.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    assert.equal(check, undefined, 'tenant cancellato dopo cleanup');
    tenantId = ''; // evita la pulizia post-test

    // Backup esistente
    const afterFiles = await listBackups();
    assert.ok(
      afterFiles.length > beforeFiles.length,
      'almeno un nuovo file di backup deve essere presente',
    );
    const ourBackup = afterFiles.find((f) => f.tenantSlug === slug);
    assert.ok(ourBackup, 'il backup del tenant cancellato è elencato');

    // Audit platform.tenant.cleanup_auto presente, con payload completo
    const audit = await dbSuper
      .select()
      .from(platformAuditLog)
      .where(eq(platformAuditLog.targetTenantSlug, slug));
    const cleanupAudits = audit.filter((a) => a.action === 'platform.tenant.cleanup_auto');
    assert.equal(cleanupAudits.length, 1, 'una sola riga di audit cleanup');
    const payload = cleanupAudits[0]!.payload as Record<string, unknown>;
    assert.equal(payload.slug, slug);
    assert.ok(payload.backupPath, 'audit cita il path del backup');
    assert.ok(typeof payload.backupSizeBytes === 'number');
  });

  test('pruneOldBackups rimuove file più vecchi del retention', async () => {
    // Scrivi un file "vecchio" simulato
    const oldFile = join(ARCHIVE_DIR, `stale-${Date.now()}.json.gz`);
    await writeFile(oldFile, Buffer.from('dummy'));
    // Imposta mtime a 200 giorni fa
    const oldTime = new Date(Date.now() - 200 * 86400_000);
    await utimes(oldFile, oldTime, oldTime);

    const st = await stat(oldFile);
    const ageDays = (Date.now() - st.mtimeMs) / 86400_000;
    assert.ok(ageDays > 150, `mtime impostata correttamente (age=${ageDays.toFixed(1)}gg)`);

    const beforeCount = (await readdir(ARCHIVE_DIR)).length;
    const r = await pruneOldBackups(90);
    assert.ok(r.deleted >= 1, `almeno un file vecchio rimosso (age=${ageDays.toFixed(1)}gg, deleted=${r.deleted})`);
    const afterCount = (await readdir(ARCHIVE_DIR)).length;
    assert.equal(afterCount, beforeCount - r.deleted);
  });

  test('endpoint POST /api/platform/jobs/cleanup-tenants → trigger manuale', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/platform/jobs/cleanup-tenants',
      headers: { host: 'platform.gestimus.local', cookie: superCookie },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok('candidatesFound' in body);
    assert.ok('deleted' in body);
    assert.ok('backedUp' in body);
    assert.ok(Array.isArray(body.errors));
  });

  test('endpoint GET /api/platform/backups → lista file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/platform/backups',
      headers: { host: 'platform.gestimus.local', cookie: superCookie },
    });
    assert.equal(res.statusCode, 200);
    const list = res.json() as Array<{ filename: string; sizeBytes: number; tenantSlug: string }>;
    assert.ok(Array.isArray(list));
    // Almeno il backup del nostro tenant deve essere lì
    assert.ok(list.some((f) => f.tenantSlug === slug));
  });

  test('cleanup_after_days=0 (mai cancellare) esclude il tenant dal job', async () => {
    // Crea un nuovo tenant archiviato ma con cleanup_after_days=0 → non deve essere toccato
    const neverSlug = `never-${Date.now()}`;
    const [t] = await dbSuper
      .insert(tenants)
      .values({
        slug: neverSlug,
        nome: 'Mai cancellare',
        piano: 'trial',
        stato: 'archiviato',
        archiviatoAt: new Date(Date.now() - 100 * 86400_000),
        cleanupAfterDays: 0,
        cleanupScheduledAt: new Date(Date.now() - 100 * 86400_000),
      })
      .returning();

    const r = await runTenantCleanup();
    // Verifica che il tenant "never" non sia tra i deleted
    const stillThere = await dbSuper.query.tenants.findFirst({ where: eq(tenants.id, t!.id) });
    assert.ok(stillThere, 'tenant con cleanup_after_days=0 non deve essere eliminato');
    assert.equal(stillThere!.stato, 'archiviato');

    // Cleanup
    await dbSuper.delete(tenants).where(eq(tenants.id, t!.id));
    await dbSuper.delete(platformAuditLog).where(eq(platformAuditLog.targetTenantSlug, neverSlug));
    void r;
  });

  // L257: roundtrip backup → hard-delete → restore. Tenant disposable dedicato.
  test('restoreTenant ripristina tenant + dati da un backup cifrato', async () => {
    const rslug = `${TEST_SLUG_PREFIX}restore-${Date.now()}`;
    const [t] = await dbSuper
      .insert(tenants)
      .values({ slug: rslug, nome: `Restore ${rslug}`, piano: 'trial', stato: 'archiviato' })
      .returning();
    const tid = t!.id;
    await dbSuper.insert(concorsi).values({ tenantId: tid, nome: 'Restore Concorso', anno: 2025, stato: 'CONCLUSO' });

    const bk = await backupTenant(tid);
    // Hard-delete del tenant (cascade su tutti i dati).
    await dbSuper.delete(tenants).where(eq(tenants.id, tid));
    assert.equal((await dbSuper.select().from(tenants).where(eq(tenants.id, tid))).length, 0, 'tenant cancellato');

    // Restore dal backup.
    const r = await restoreTenant(bk.path);
    assert.equal(r.tenantId, tid);
    assert.equal(r.tableCounts.concorsi, 1);

    const back = await dbSuper.select().from(tenants).where(eq(tenants.id, tid));
    assert.equal(back.length, 1, 'tenant ripristinato');
    assert.equal(back[0]!.slug, rslug);
    const concs = await dbSuper.select().from(concorsi).where(eq(concorsi.tenantId, tid));
    assert.equal(concs.length, 1, 'concorso ripristinato');
    assert.equal(concs[0]!.nome, 'Restore Concorso');

    // Restore su tenant già esistente → errore (no sovrascrittura).
    await assert.rejects(() => restoreTenant(bk.path), /esiste già/);

    // Cleanup
    await dbSuper.delete(tenants).where(eq(tenants.id, tid));
    await unlink(bk.path).catch(() => {});
  });
});
