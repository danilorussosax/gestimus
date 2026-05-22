import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { dbApp, dbSuper, shutdownPools } from '../../src/db/client.js';
import {
  accounts,
  auditLog,
  candidati,
  candidatiFase,
  candidatiMembri,
  categorie,
  commissari,
  commissariArchivio,
  commissioni,
  commissioniCategorie,
  commissioniCommissari,
  commissioniSezioni,
  concorsi,
  criteri,
  fasi,
  fasiSezioni,
  iscrizioni,
  iscrizioniAllegati,
  sessions,
  sezioni,
  tenantConfig,
  tenants,
  valutazioni,
} from '../../src/db/schema.js';

/**
 * Verifica che la Row-Level Security isoli correttamente i dati tra tenant.
 * Copre TUTTE le tabelle di dominio (22) tenant-scoped definite in
 * server/src/db/policies.sql.
 *
 * Per ogni tabella verifico due invarianti:
 *   1. con `app_set_tenant(ente1)`, ogni riga restituita ha tenant_id=ente1
 *   2. senza set_tenant, la SELECT restituisce 0 righe (RLS attiva)
 *
 * Più test mirati su `concorsi` e `valutazioni`:
 *   - tentativo INSERT cross-tenant viene rifiutato dalla policy WITH CHECK
 *   - super-admin (dbSuper, BYPASSRLS) vede tutto
 *   - audit_log append-only (UPDATE/DELETE rifiutati al ruolo applicativo)
 *
 * Pre-requisito: `npm run db:seed`.
 */

const TENANT_TABLES = [
  { name: 'accounts', table: accounts },
  { name: 'sessions', table: sessions },
  { name: 'audit_log', table: auditLog },
  { name: 'tenant_config', table: tenantConfig },
  { name: 'concorsi', table: concorsi },
  { name: 'commissari', table: commissari },
  { name: 'commissari_archivio', table: commissariArchivio },
  { name: 'candidati', table: candidati },
  { name: 'candidati_membri', table: candidatiMembri },
  { name: 'sezioni', table: sezioni },
  { name: 'categorie', table: categorie },
  { name: 'commissioni', table: commissioni },
  { name: 'commissioni_commissari', table: commissioniCommissari },
  { name: 'commissioni_sezioni', table: commissioniSezioni },
  { name: 'commissioni_categorie', table: commissioniCategorie },
  { name: 'fasi', table: fasi },
  { name: 'fasi_sezioni', table: fasiSezioni },
  { name: 'criteri', table: criteri },
  { name: 'candidati_fase', table: candidatiFase },
  { name: 'valutazioni', table: valutazioni },
  { name: 'iscrizioni', table: iscrizioni },
  { name: 'iscrizioni_allegati', table: iscrizioniAllegati },
] as const;

describe('RLS isolamento tenant (22 tabelle)', () => {
  let ente1Id: string;
  let ente2Id: string;

  before(async () => {
    const t1 = await dbSuper.query.tenants.findFirst({ where: eq(tenants.slug, 'ente1') });
    const t2 = await dbSuper.query.tenants.findFirst({ where: eq(tenants.slug, 'ente2') });
    assert.ok(t1, "tenant ente1 deve esistere (run 'npm run db:seed')");
    assert.ok(t2, "tenant ente2 deve esistere (run 'npm run db:seed')");
    ente1Id = t1!.id;
    ente2Id = t2!.id;
  });

  after(async () => {
    await shutdownPools();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Per ogni tabella: app_set_tenant(ente1) → solo righe ente1
  // ─────────────────────────────────────────────────────────────
  for (const { name, table } of TENANT_TABLES) {
    test(`[${name}] app_set_tenant(ente1) restituisce solo righe ente1`, async () => {
      const rows = await dbApp.transaction(async (tx) => {
        await tx.execute(sql`SELECT app_set_tenant(${ente1Id}::uuid)`);
        return tx.select().from(table);
      });
      for (const r of rows) {
        const rTenantId = (r as { tenantId: string }).tenantId;
        assert.equal(
          rTenantId,
          ente1Id,
          `[${name}] trovata riga con tenantId=${rTenantId}, atteso ${ente1Id}`,
        );
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Per ogni tabella: senza set_tenant → zero righe
  // ─────────────────────────────────────────────────────────────
  for (const { name, table } of TENANT_TABLES) {
    test(`[${name}] senza set_tenant restituisce zero righe (RLS attiva)`, async () => {
      const rows = await dbApp.transaction(async (tx) => {
        return tx.select().from(table);
      });
      assert.equal(
        rows.length,
        0,
        `[${name}] senza tenant_id la RLS deve filtrare tutto (trovate ${rows.length} righe)`,
      );
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Cross-check: nessuna intersezione tra ente1 e ente2
  // ─────────────────────────────────────────────────────────────
  test('cross-check: intersezione concorsi visti da ente1/ente2 è vuota', async () => {
    const e1 = await dbApp.transaction(async (tx) => {
      await tx.execute(sql`SELECT app_set_tenant(${ente1Id}::uuid)`);
      return tx.select().from(concorsi);
    });
    const e2 = await dbApp.transaction(async (tx) => {
      await tx.execute(sql`SELECT app_set_tenant(${ente2Id}::uuid)`);
      return tx.select().from(concorsi);
    });
    const e1Ids = new Set(e1.map((c) => c.id));
    const e2Ids = new Set(e2.map((c) => c.id));
    const inter = [...e1Ids].filter((id) => e2Ids.has(id));
    assert.equal(inter.length, 0, 'nessun concorso deve essere visibile a entrambi i tenant');
  });

  // ─────────────────────────────────────────────────────────────
  // 4. WITH CHECK: INSERT con tenant_id sbagliato viene rifiutato
  // ─────────────────────────────────────────────────────────────
  test('INSERT cross-tenant rifiutato (WITH CHECK su concorsi)', async () => {
    await assert.rejects(
      async () => {
        await dbApp.transaction(async (tx) => {
          await tx.execute(sql`SELECT app_set_tenant(${ente1Id}::uuid)`);
          await tx.insert(concorsi).values({
            tenantId: ente2Id,
            nome: 'Hack attempt RLS',
            anno: 2026,
          });
        });
      },
      /row violates row-level security|new row violates/i,
    );
  });

  test('INSERT cross-tenant rifiutato (WITH CHECK su valutazioni)', async () => {
    const cf = await dbSuper.query.candidatiFase.findFirst({
      where: eq(candidatiFase.tenantId, ente1Id),
    });
    const com = await dbSuper.query.commissari.findFirst({
      where: eq(commissari.tenantId, ente1Id),
    });
    assert.ok(cf && com, 'pre-condizione: ente1 ha candidatiFase e commissari');
    await assert.rejects(
      async () => {
        await dbApp.transaction(async (tx) => {
          await tx.execute(sql`SELECT app_set_tenant(${ente1Id}::uuid)`);
          await tx.insert(valutazioni).values({
            tenantId: ente2Id,
            candidatoFaseId: cf!.id,
            commissarioId: com!.id,
            criterio: 'Tecnica',
            voto: 50,
          });
        });
      },
      /row violates row-level security|new row violates/i,
    );
  });

  // ─────────────────────────────────────────────────────────────
  // 5. Super-admin (dbSuper, BYPASSRLS) vede tutto
  // ─────────────────────────────────────────────────────────────
  test('super-admin (dbSuper, BYPASSRLS) vede concorsi di più tenant', async () => {
    const all = await dbSuper.select().from(concorsi);
    const distinct = new Set(all.map((c) => c.tenantId));
    assert.ok(distinct.size >= 2, 'super-admin deve vedere concorsi di più tenant');
  });

  // ─────────────────────────────────────────────────────────────
  // 6. Audit log append-only: UPDATE e DELETE rifiutati al ruolo app
  // ─────────────────────────────────────────────────────────────
  test('audit_log: UPDATE rifiutato per gestimus_app', async () => {
    await assert.rejects(
      async () => {
        await dbApp.transaction(async (tx) => {
          await tx.execute(sql`SELECT app_set_tenant(${ente1Id}::uuid)`);
          await tx.execute(
            sql`UPDATE audit_log SET action = 'tampered' WHERE tenant_id = ${ente1Id}::uuid`,
          );
        });
      },
      /permission denied/i,
    );
  });

  test('audit_log: DELETE rifiutato per gestimus_app', async () => {
    await assert.rejects(
      async () => {
        await dbApp.transaction(async (tx) => {
          await tx.execute(sql`SELECT app_set_tenant(${ente1Id}::uuid)`);
          await tx.execute(sql`DELETE FROM audit_log WHERE tenant_id = ${ente1Id}::uuid`);
        });
      },
      /permission denied/i,
    );
  });
});
