/// <reference path="../pb_data/types.d.ts" />

// Hardening audit_log:
//   1. createRule: '@request.auth.id != ""' (era '' = anonimo → log poisoning)
//   2. deleteRule: null  (era admin → admin malintenzionato poteva cancellare le
//      tracce delle proprie azioni; ora l'audit è append-only e si rimuove solo
//      tramite retention job esterno o dal DB direttamente).
//   3. updateRule: null (già null, ribadito per chiarezza)
//
// Conseguenze: il frontend NON deve più tentare di scrivere audit da contesti
// non autenticati. Verifica chiamate a audit(...) in js/db.js: tutte fatte dopo
// pb.authStore valido → OK.

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('audit_log');
  c.createRule = '@request.auth.id != ""';
  c.updateRule = null;
  c.deleteRule = null;
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('audit_log');
  c.createRule = '';
  c.updateRule = null;
  c.deleteRule = '@request.auth.role = "admin"';
  dao.saveCollection(c);
});
