/// <reference path="../pb_data/types.d.ts" />

// Follow-up della migration 1700000042_commissari_archivio.js:
// il vecchio field `commissari.concorso` (single relation, required, cascadeDelete)
// è stato sostituito da `commissari.concorsi[]` (multi relation, optional).
// Rimane in schema come legacy, ma deve diventare:
//   - required: false  → permette create di commissari in archivio puro
//   - cascadeDelete: false → non cancellare commissari quando si elimina un concorso
//                            (lo sgancio è gestito esplicitamente in js/db.js)
//
// Idempotente: se il field è già opzionale + no-cascade, no-op.

migrate((db) => {
  const dao = new Dao(db);
  const commissari = dao.findCollectionByNameOrId('commissari');
  const field = commissari.schema.getFieldByName('concorso');
  if (!field) return; // legacy field già rimosso da una future migration

  const opts = field.options || {};
  const isAlreadyOptional = field.required === false && opts.cascadeDelete === false;
  if (isAlreadyOptional) return; // no-op

  // Replace the field con la versione "soft" (mantenendo collectionId/maxSelect).
  commissari.schema.removeField(field.id);
  commissari.schema.addField(new SchemaField({
    name: 'concorso',
    type: 'relation',
    required: false,
    options: {
      collectionId: opts.collectionId,
      cascadeDelete: false,
      maxSelect: 1,
      minSelect: 0,
    },
  }));
  dao.saveCollection(commissari);
}, (db) => {
  // Down: ripristina required=true + cascadeDelete=true.
  // ATTENZIONE: se ci sono record con concorso=NULL (in archivio puro), il
  // ripristino fallirà sul vincolo required. In tal caso il down va eseguito
  // manualmente dopo aver popolato concorso su tutti i record.
  const dao = new Dao(db);
  const commissari = dao.findCollectionByNameOrId('commissari');
  const field = commissari.schema.getFieldByName('concorso');
  if (!field) return;
  const opts = field.options || {};
  commissari.schema.removeField(field.id);
  commissari.schema.addField(new SchemaField({
    name: 'concorso',
    type: 'relation',
    required: true,
    options: {
      collectionId: opts.collectionId,
      cascadeDelete: true,
      maxSelect: 1,
    },
  }));
  dao.saveCollection(commissari);
});
