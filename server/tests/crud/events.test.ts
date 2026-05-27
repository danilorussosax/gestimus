import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { dbSuper } from '../../src/db/client.js';
import { events, tenants } from '../../src/db/schema.js';
import { registerEventHandler, processEvents } from '../../src/services/events.js';

// #4 (architect) — meccanica dell'outbox: publish → process → retry → dead-letter.
describe('Outbox domain events (#4)', () => {
  let tenantId: string;
  const handled: string[] = [];

  before(async () => {
    tenantId = (await dbSuper.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'ente1')))[0]!.id;
    registerEventHandler('test.events.ok', async (ev) => { handled.push(ev.id); });
    registerEventHandler('test.events.fail', async () => { throw new Error('boom'); });
  });

  after(async () => {
    await dbSuper.delete(events).where(inArray(events.type, ['test.events.ok', 'test.events.fail']));
  });

  // Esegue processEvents finché l'evento `id` raggiunge uno stato terminale o
  // si esauriscono i giri (robusto a eventuali altri pending nel DB di test).
  async function drainUntilTerminal(id: string, maxRounds = 12): Promise<{ status: string; attempts: number; lastError: string | null }> {
    for (let i = 0; i < maxRounds; i++) {
      const row = (await dbSuper.select().from(events).where(eq(events.id, id)))[0]!;
      if (row.status === 'done' || row.status === 'failed') return row;
      await processEvents();
    }
    return (await dbSuper.select().from(events).where(eq(events.id, id)))[0]!;
  }

  test('evento pending → handler eseguito → status done', async () => {
    const [ev] = await dbSuper.insert(events).values({ tenantId, type: 'test.events.ok', payload: {} }).returning();
    const row = await drainUntilTerminal(ev!.id);
    assert.equal(row.status, 'done');
    assert.equal(row.attempts, 1);
    assert.ok(handled.includes(ev!.id), 'handler eseguito per l\'evento');
  });

  test('handler che fallisce → retry fino a MAX_ATTEMPTS poi failed (dead-letter)', async () => {
    const [ev] = await dbSuper.insert(events).values({ tenantId, type: 'test.events.fail', payload: {} }).returning();
    const row = await drainUntilTerminal(ev!.id);
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 5, 'esauriti i 5 tentativi');
    assert.ok(row.lastError?.includes('boom'), 'ultimo errore registrato');
  });
});
