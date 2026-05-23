import pg from 'pg';
import { env } from '../env.js';

type Listener = (payload: unknown) => void;

let client: pg.Client | null = null;
const subscribers = new Map<string, Set<Listener>>();
let reconnectTimer: NodeJS.Timeout | null = null;

async function connect(): Promise<void> {
  client = new pg.Client({ connectionString: env.DATABASE_URL_SUPER });
  client.on('error', (err) => {
    console.error('[realtime] LISTEN client error:', err.message);
    scheduleReconnect();
  });
  client.on('end', () => {
    console.warn('[realtime] LISTEN client closed, will reconnect');
    scheduleReconnect();
  });
  client.on('notification', (msg) => {
    if (!msg.channel) return;
    const subs = subscribers.get(msg.channel);
    if (!subs || subs.size === 0) return;
    let parsed: unknown = msg.payload ?? null;
    try {
      parsed = msg.payload ? JSON.parse(msg.payload) : null;
    } catch {
      // payload non-JSON: lasciamo la stringa raw
    }
    for (const cb of subs) {
      try {
        cb(parsed);
      } catch (err) {
        console.error('[realtime] subscriber error:', err);
      }
    }
  });
  await client.connect();
  // Re-LISTEN ai canali esistenti (in caso di reconnect)
  for (const channel of subscribers.keys()) {
    await client.query(`LISTEN "${channel}"`);
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      client = null;
      await connect();
    } catch (err) {
      console.error('[realtime] reconnect failed:', err);
      scheduleReconnect();
    }
  }, 2000);
}

export async function startRealtimeHub(): Promise<void> {
  if (client) return;
  await connect();
}

export async function stopRealtimeHub(): Promise<void> {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  subscribers.clear();
  if (client) {
    await client.end().catch(() => {});
    client = null;
  }
}

// N3: il nome canale viene interpolato in `LISTEN "..."` (i parametri pg non
// sono ammessi per LISTEN/UNLISTEN). Whitelist rigorosa: solo [a-zA-Z0-9_],
// max 63 char (limite identificatore Postgres). Blocca SQL injection via
// channel arbitrario passato a subscribe().
const VALID_CHANNEL = /^[a-zA-Z0-9_]{1,63}$/;

/**
 * Subscribe a un canale Postgres NOTIFY. Ritorna una funzione di unsubscribe.
 */
export async function subscribe(channel: string, cb: Listener): Promise<() => void> {
  if (!client) throw new Error('realtime hub not started');
  if (!VALID_CHANNEL.test(channel)) {
    throw new Error(`nome canale realtime non valido: ${channel}`);
  }

  let set = subscribers.get(channel);
  if (!set) {
    set = new Set();
    // N81: LISTEN PRIMA di registrare il canale nella map. Se il LISTEN fallisce
    // (errore DB), prima il canale restava nella map con un Set vuoto e le
    // chiamate successive saltavano il LISTEN → notifiche perse per sempre.
    // channel è già validato contro VALID_CHANNEL → interpolazione sicura.
    await client.query(`LISTEN "${channel}"`);
    subscribers.set(channel, set);
  }
  set.add(cb);

  return () => {
    const s = subscribers.get(channel);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) {
      subscribers.delete(channel);
      client?.query(`UNLISTEN "${channel}"`).catch(() => {});
    }
  };
}

/**
 * Canale Postgres per il timer di una fase.
 * UUID con dash sostituiti da underscore (channel name max 63 char).
 */
export function faseChannel(faseId: string): string {
  return `fase_${faseId.replace(/-/g, '_')}`;
}
