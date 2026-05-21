/// <reference path="../pb_data/types.d.ts" />

// Permette di verificare l'esistenza di almeno un admin SENZA autenticazione,
// così la pagina di login può nascondere il pannello "Primo avvio" se un admin
// esiste già. Per gli altri ruoli (commissario, ecc.) resta richiesta l'auth.

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('accounts');
  c.listRule = 'role = "admin" || @request.auth.id != ""';
  c.viewRule = 'role = "admin" || @request.auth.id != ""';
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('accounts');
  c.listRule = '@request.auth.id != ""';
  c.viewRule = '@request.auth.id != ""';
  dao.saveCollection(c);
});
