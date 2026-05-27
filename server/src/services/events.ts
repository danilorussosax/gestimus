import { eq, sql } from 'drizzle-orm';
import { events } from '../db/schema.js';
import { dbSuper } from '../db/client.js';
import type { TxClient } from '../middleware/tenant.js';
import { logger } from '../lib/logger.js';
import { captureError } from '../observability/sentry.js';

// #4 (architect) — Outbox dei domain events.
//  - publishEvent(): scrive l'evento nella STESSA transazione della write di
//    business (atomicità: o entrambi o nessuno).
//  - processEvents(): claim atomico dei pending (FOR UPDATE SKIP LOCKED → più
//    processi/istanze non prendono le stesse righe), dispatch all'handler, retry
//    fino a MAX_ATTEMPTS, poi 'failed' (dead-letter = righe status='failed').
//    Gira dentro una transazione su dbSuper (BYPASSRLS, cross-tenant): se il
//    processo crasha la tx fa rollback e le righe restano 'pending' (riprese al
//    tick successivo) — nessuno stato "processing" orfano.

const MAX_ATTEMPTS = 5;

export interface PublishEventArgs {
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
}

export async function publishEvent(tx: TxClient, args: PublishEventArgs): Promise<void> {
  await tx.insert(events).values({ tenantId: args.tenantId, type: args.type, payload: args.payload });
}

export interface DomainEventRow {
  id: string;
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}
type Handler = (event: DomainEventRow) => Promise<void>;

const handlers = new Map<string, Handler>();
export function registerEventHandler(type: string, handler: Handler): void {
  handlers.set(type, handler);
}

export async function processEvents(batch = 10): Promise<{ processed: number; failed: number }> {
  return dbSuper.transaction(async (tx) => {
    const claimed = await tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", type, payload, attempts
      FROM events
      WHERE status = 'pending' AND attempts < ${MAX_ATTEMPTS}
      ORDER BY created_at
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    `);
    const rows = (claimed.rows ?? []) as unknown as DomainEventRow[];
    let processed = 0;
    let failed = 0;
    for (const ev of rows) {
      const attempts = ev.attempts + 1;
      const handler = handlers.get(ev.type);
      if (!handler) {
        await tx.update(events)
          .set({ status: 'failed', attempts, lastError: `nessun handler per '${ev.type}'`, processedAt: new Date() })
          .where(eq(events.id, ev.id));
        failed += 1;
        // Dead-letter: evento senza handler → perso silenziosamente. Alert.
        captureError(new Error(`domain event senza handler: '${ev.type}'`), {
          kind: 'event.dead_letter', reason: 'no_handler', eventId: ev.id, type: ev.type, tenantId: ev.tenantId,
        });
        continue;
      }
      try {
        await handler(ev);
        await tx.update(events)
          .set({ status: 'done', attempts, lastError: null, processedAt: new Date() })
          .where(eq(events.id, ev.id));
        processed += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Esaurito il numero di tentativi → dead-letter ('failed'); altrimenti
        // torna 'pending' per il retry al tick successivo.
        const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        await tx.update(events)
          .set({ status, attempts, lastError: msg, processedAt: status === 'failed' ? new Date() : null })
          .where(eq(events.id, ev.id));
        failed += 1;
        logger.warn({ module: 'events', id: ev.id, type: ev.type, attempts, status, err: msg }, 'event handler fallito');
        // Solo alla dead-letter (esauriti i retry): alert. Sui retry intermedi
        // resta 'pending' → niente Sentry per non fare rumore a ogni tentativo.
        if (status === 'failed') {
          captureError(err, {
            kind: 'event.dead_letter', reason: 'max_attempts', eventId: ev.id, type: ev.type, tenantId: ev.tenantId, attempts,
          });
        }
      }
    }
    return { processed, failed };
  });
}
