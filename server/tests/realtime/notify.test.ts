import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { dbSuper } from '../../src/db/client.js';
import { faseChannel, startRealtimeHub, subscribe } from '../../src/realtime/hub.js';

describe('Realtime LISTEN/NOTIFY hub', () => {
  before(async () => {
    await startRealtimeHub();
  });

  // realtime hub e pool restano aperti tra i test; --test-force-exit chiude tutto a fine run

  test('subscribe riceve eventi NOTIFY su canale fase_*', async () => {
    const faseId = '019e4eb5-1234-7000-0000-000000000001';
    const channel = faseChannel(faseId);

    const received: unknown[] = [];
    const unsubscribe = await subscribe(channel, (payload) => {
      received.push(payload);
    });

    // Emit NOTIFY via dbSuper
    await dbSuper.execute(
      sql.raw(`SELECT pg_notify('${channel}', '${JSON.stringify({ action: 'start', test: 42 }).replace(/'/g, "''")}')`),
    );

    // Aspetta che il dispatcher in-process consegni l'evento
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(received.length, 1);
    assert.deepEqual(received[0], { action: 'start', test: 42 });

    unsubscribe();
  });

  test('unsubscribe smette di ricevere', async () => {
    const faseId = '019e4eb5-1234-7000-0000-000000000002';
    const channel = faseChannel(faseId);

    const received: unknown[] = [];
    const unsubscribe = await subscribe(channel, (payload) => {
      received.push(payload);
    });
    unsubscribe();

    await dbSuper.execute(sql.raw(`SELECT pg_notify('${channel}', '"after-unsub"')`));
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(received.length, 0);
  });

  test('faseChannel produce identifier valido (no dash)', () => {
    const ch = faseChannel('019e4eb5-4f47-71b6-9283-bc5da3aaa62e');
    assert.equal(ch, 'fase_019e4eb5_4f47_71b6_9283_bc5da3aaa62e');
    assert.ok(ch.length <= 63, 'channel name <= 63 char');
  });
});
