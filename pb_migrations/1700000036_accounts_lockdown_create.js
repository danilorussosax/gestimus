/// <reference path="../pb_data/types.d.ts" />

// Hardening accounts: blocca la creazione pubblica via REST.
// Prima: createRule = '' (chiunque può POST /api/collections/accounts/records con
// role:"admin" → privilege escalation).
// Ora: createRule = null → la creazione avviene solo via:
//   - /api/setup/create-admin (hook idempotente, rifiuta se admin esiste già)
//   - DAO server-side da altri hook (es. createCommissario)
//   - admin UI di PocketBase
//
// La rule updateRule esistente (v2) consente self-update per cambio password;
// il rischio "promote-self-to-admin" è mitigato dall'hook onRecordBeforeUpdate
// in pb_hooks/accounts.pb.js che blocca la modifica di campi sensibili.

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('accounts');
  c.createRule = null;
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('accounts');
  c.createRule = '';
  dao.saveCollection(c);
});
