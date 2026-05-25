# Migrazioni SQL & Rollback

Lo schema "vivo" è generato da Drizzle (`schema.ts` → `db:push`). Le modifiche
incrementali di produzione (ALTER/backfill/dati) vivono come **SQL ordinato e
tracciato** in `server/scripts/migrations/`, con supporto **rollback** e una
rete di sicurezza via **backup**.

## File

- `YYYY_MM_DD_<descr>.sql` — la migration (up). Ordine = nome lessicografico.
- `YYYY_MM_DD_<descr>.down.sql` — *opzionale*, il rollback. Se presente, la
  migration è **reversibile**; se assente, è **irreversibile** (si torna
  indietro solo da backup).

Il CI (`validate-migrations`) verifica naming, ordine progressivo e che ogni
`.down.sql` abbia la sua up. **Le nuove migration dovrebbero includere un
`.down.sql`** salvo modifiche intrinsecamente non reversibili (drop di dati,
restringimento di tipi lossy): in quel caso ometti il down — è una scelta
esplicita, non una dimenticanza.

## Runner

Tracciato via tabella ledger `_schema_migrations` (name, checksum, applied_at).
Connessione: `DATABASE_URL_DIRECT` → fallback `DATABASE_URL_SUPER` (serve DDL).

```bash
npm run db:sql:status      # applicate / pendenti / reversibili, drift checksum
npm run db:sql:up          # applica tutte le pendenti (ognuna in una tx)
npm run db:sql:down        # annulla l'ultima (richiede il suo .down.sql)
npm run db:sql:down 3      # annulla le ultime 3
npm run db:sql:baseline    # registra le migration presenti come già applicate
                           # SENZA eseguirle (per DB esistenti allineati a mano)
```

`up` salta i file già nel ledger → idempotente. `down` su una migration senza
`.down.sql` si rifiuta con errore e rimanda al restore da backup.

## Adozione su un DB esistente

Il runner è nuovo: un DB già in produzione ha le migration applicate ma il
ledger vuoto. Allinea **una volta** senza rieseguire nulla:

```bash
npm run db:sql:baseline
```

Da lì in poi `db:sql:up` applica solo le migration aggiunte dopo.

## Backup / Restore (DR)

Esegui un backup **prima** di una migration rischiosa o irreversibile e prima
di ogni deploy:

```bash
npm run db:backup
# → <ARCHIVE_DIR>/db-backups/gestimus_<ISO>.dump  (formato custom pg_dump -Fc)
```

Retention automatica: `BACKUP_RETENTION_DAYS` (default 90). Restore (distruttivo,
conferma prima):

```bash
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL_DIRECT" <file>.dump
```

## Flusso deploy consigliato

1. `npm run db:backup`
2. `npm run db:sql:status` (verifica le pendenti)
3. `npm run db:sql:up`
4. deploy app
5. se serve tornare indietro: `npm run db:sql:down` (se reversibile) **oppure**
   `pg_restore` dal backup del punto 1.
