/// <reference path="../pb_data/types.d.ts" />

// Stato runtime sincronizzato del timer di esecuzione per ogni fase.
// Una sola riga per fase (unique). Il presidente la aggiorna; tutti i client
// la leggono via realtime PocketBase per mostrare il countdown sincronizzato.
//
// Modello tempo:
//   - started_at: ISO. Se NON pausato → il timer parte da started_at.
//   - paused_at:  ISO se pausato, null altrimenti.
//   - duration_seconds: durata totale ammessa per il candidato corrente.
//   - +1 minuto = duration_seconds += 60.
//   - Resume: started_at viene shiftato in avanti di (now - paused_at), paused_at=null.
//
// Calcolo elapsed (lato client):
//   running:   elapsed = now - started_at
//   pausato:   elapsed = paused_at - started_at
//   remaining = duration_seconds*1000 - elapsed

migrate((db) => {
  const dao = new Dao(db);
  const fasi = dao.findCollectionByNameOrId('fasi');
  const cf = dao.findCollectionByNameOrId('candidati_fase');

  const c = new Collection({
    name: 'fase_runtime',
    type: 'base',
    listRule:   '@request.auth.id != ""',
    viewRule:   '@request.auth.id != ""',
    createRule: '@request.auth.role = "admin" || (@request.auth.role = "commissario" && @request.auth.commissario.is_presidente = true)',
    updateRule: '@request.auth.role = "admin" || (@request.auth.role = "commissario" && @request.auth.commissario.is_presidente = true)',
    deleteRule: '@request.auth.role = "admin" || (@request.auth.role = "commissario" && @request.auth.commissario.is_presidente = true)',
    schema: [
      new SchemaField({ name: 'fase', type: 'relation', required: true,
        options: { collectionId: fasi.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: 'candidato_fase', type: 'relation',
        options: { collectionId: cf.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: 'started_at',  type: 'date',   options: {} }),
      new SchemaField({ name: 'paused_at',   type: 'date',   options: {} }),
      new SchemaField({ name: 'duration_seconds', type: 'number', required: true, options: { min: 0, noDecimal: true } }),
    ],
    indexes: [
      'CREATE UNIQUE INDEX `idx_fase_runtime_fase` ON `fase_runtime` (`fase`)',
    ],
  });
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  try {
    const c = dao.findCollectionByNameOrId('fase_runtime');
    dao.deleteCollection(c);
  } catch (e) { /* ignore */ }
});
