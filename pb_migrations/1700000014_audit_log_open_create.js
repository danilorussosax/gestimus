/// <reference path="../pb_data/types.d.ts" />

// Allenta la createRule del audit_log: qualunque client (anche non autenticato)
// può scrivere log. Le rules di lettura/eliminazione restano admin-only.
// Motivazione: l'audit non deve mai bloccare un'azione di business — se la
// scrittura del log fallisce, l'utente perde la "tracciabilità" ma non l'azione.

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('audit_log');
  c.createRule = '';
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('audit_log');
  c.createRule = '@request.auth.id != ""';
  dao.saveCollection(c);
});
