import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql, eq } from 'drizzle-orm';
import { dbApp, dbSuper, shutdownPools } from '../../src/db/client.js';
import { tenants, concorsi } from '../../src/db/schema.js';

/**
 * Verifica che RLS isoli correttamente i dati tra tenant.
 * Pre-requisito: `npm run db:seed` deve essere stato lanciato.
 */
describe('RLS isolamento tenant', () => {
  let ente1Id: string;
  let ente2Id: string;

  before(async () => {
    const t1 = await dbSuper.query.tenants.findFirst({ where: eq(tenants.slug, 'ente1') });
    const t2 = await dbSuper.query.tenants.findFirst({ where: eq(tenants.slug, 'ente2') });
    assert.ok(t1, 'tenant ente1 deve esistere (run npm run db:seed)');
    assert.ok(t2, 'tenant ente2 deve esistere (run npm run db:seed)');
    ente1Id = t1!.id;
    ente2Id = t2!.id;
  });

  after(async () => {
    await shutdownPools();
  });

  test('utente del tenant ente1 vede solo concorsi di ente1', async () => {
    const results = await dbApp.transaction(async (tx) => {
      await tx.execute(sql`SELECT app_set_tenant(${ente1Id}::uuid)`);
      return tx.select().from(concorsi);
    });
    assert.ok(results.length > 0, 'ente1 deve avere almeno 1 concorso');
    for (const c of results) {
      assert.equal(c.tenantId, ente1Id, `concorso ${c.id} appartiene a ${c.tenantId}, non a ente1`);
    }
  });

  test('utente del tenant ente2 vede solo concorsi di ente2', async () => {
    const results = await dbApp.transaction(async (tx) => {
      await tx.execute(sql`SELECT app_set_tenant(${ente2Id}::uuid)`);
      return tx.select().from(concorsi);
    });
    assert.ok(results.length > 0, 'ente2 deve avere almeno 1 concorso');
    for (const c of results) {
      assert.equal(c.tenantId, ente2Id);
    }
  });

  test('senza set_tenant la query ritorna zero righe (RLS attiva)', async () => {
    const results = await dbApp.transaction(async (tx) => {
      // Niente app_set_tenant qui
      return tx.select().from(concorsi);
    });
    assert.equal(results.length, 0, 'senza tenant_id la RLS deve filtrare tutto');
  });

  test('tentativo di INSERT con tenant_id sbagliato viene rifiutato', async () => {
    await assert.rejects(
      async () => {
        await dbApp.transaction(async (tx) => {
          await tx.execute(sql`SELECT app_set_tenant(${ente1Id}::uuid)`);
          // Tenta di inserire un concorso per ente2 mentre il contesto è ente1
          await tx.insert(concorsi).values({
            tenantId: ente2Id,
            nome: 'Hack attempt',
            anno: 2026,
          });
        });
      },
      /row violates row-level security|new row violates/i,
      'INSERT cross-tenant deve essere rifiutato dalla policy WITH CHECK',
    );
  });

  test('super-admin (dbSuper, BYPASSRLS) vede tutti i concorsi', async () => {
    const all = await dbSuper.select().from(concorsi);
    const distinctTenants = new Set(all.map((c) => c.tenantId));
    assert.ok(distinctTenants.size >= 2, 'super-admin deve vedere concorsi di più tenant');
  });
});
