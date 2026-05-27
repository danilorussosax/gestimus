import pg from 'pg';
import { DATABASE_URL_DIRECT } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { captureError } from '../observability/sentry.js';

type Listener = (payload: unknown) => void;

const INITIAL_RECONNECT_MS = 1000;
// Cap basso: durante una gara live il realtime non deve restare giù a lungo.
// Le notifiche emesse durante il gap sono comunque perse (LISTEN/NOTIFY è
// fire-and-forget), quindi conviene riconnettere in fretta (≤5s).
const MAX_RECONNECT_MS = 5_000;

let client: pg.Client | null = null;
const subscribers = new Map<string, Set<Listener>>();
let reconnectTimer: NodeJS.Timeout | null = null;
// N127: settato prima di smontare timer/subscribers in stopRealtimeHub, così un
// connect() in volo (lanciato da un reconnect schedulato) sa di doversi
// auto-chiudere invece di lasciare un client orfano dopo lo shutdown.
let stopping = false;
// M148: backoff esponenziale tra i tentativi di riconnessione (no thundering
// herd a 2s fissi); resettato a INITIAL su connessione riuscita.
let reconnectDelay = INITIAL_RECONNECT_MS;
// Sentry: un solo alert per "streak" di disconnessione (l'error event può
// rifirare ogni ≤5s durante un'outage). Resettato alla riconnessione riuscita.
let realtimeAlerted = false;

async function connect(): Promise<void> {
  // N126: si costruisce un client LOCALE e si assegna `client` SOLO dopo una
  // connect() riuscita. Prima `client` veniva assegnato subito: se connect()
  // falliva restava un client disconnesso ma truthy → `if (client) return` in
  // start/reconnect bloccava per sempre ogni nuovo tentativo (hub morto).
  // DSN DIRETTO: LISTEN richiede una sessione stabile, incompatibile con
  // PgBouncer transaction mode. Vedi DATABASE_URL_DIRECT in db/client.ts.
  const c = new pg.Client({ connectionString: DATABASE_URL_DIRECT });
  c.on('error', (err) => {
    logger.error({ module: 'realtime', err: err.message }, 'LISTEN client error');
    if (!realtimeAlerted) {
      realtimeAlerted = true;
      captureError(err, { kind: 'realtime.listen' });
    }
    scheduleReconnect();
  });
  c.on('end', () => {
    logger.warn({ module: 'realtime' }, 'LISTEN client chiuso, riconnessione in corso');
    scheduleReconnect();
  });
  c.on('notification', (msg) => {
    if (!msg.channel) return;
    const subs = subscribers.get(msg.channel);
    if (!subs || subs.size === 0) return;
    let parsed: unknown = msg.payload ?? null;
    try {
      parsed = msg.payload ? JSON.parse(msg.payload) : null;
    } catch {
      // payload non-JSON: lasciamo la stringa raw
    }
    // M218: itera uno snapshot — un subscriber che si disiscrive nel callback
    // muterebbe il Set durante il for...of, facendo saltare altri subscriber.
    for (const cb of [...subs]) {
      try {
        cb(parsed);
      } catch (err) {
        logger.error({ module: 'realtime', channel: msg.channel, err }, 'subscriber error');
      }
    }
  });
  await c.connect();
  // N127: se nel frattempo è stato richiesto lo stop, chiudiamo subito il client
  // appena creato invece di pubblicarlo (resterebbe orfano dopo lo shutdown).
  if (stopping) {
    await c.end().catch(() => {});
    return;
  }
  client = c;
  reconnectDelay = INITIAL_RECONNECT_MS;
  realtimeAlerted = false; // riconnesso → riarma l'alert per la prossima outage
  // Re-LISTEN ai canali esistenti (in caso di reconnect)
  for (const channel of subscribers.keys()) {
    await client.query(`LISTEN "${channel}"`);
  }
}

function scheduleReconnect() {
  if (stopping || reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (stopping) return;
    try {
      client = null;
      await connect();
    } catch (err) {
      logger.error({ module: 'realtime', err }, 'reconnect fallito');
      scheduleReconnect();
    }
  }, delay);
  // L227: il timer di reconnect non deve tenere vivo l'event loop allo
  // shutdown (max MAX_RECONNECT_MS di ritardo se non venisse cancellato).
  reconnectTimer.unref?.();
}

export async function startRealtimeHub(): Promise<void> {
  stopping = false;
  reconnectDelay = INITIAL_RECONNECT_MS;
  if (client) return;
  await connect();
}

export async function stopRealtimeHub(): Promise<void> {
  stopping = true;
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
