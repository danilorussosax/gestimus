/// <reference path="../pb_data/types.d.ts" />

// Permette la lettura pubblica (no-auth) di un concorso SOLO se è ATTIVO e con
// iscrizioni aperte. Necessario perché il form pubblico /#/iscrizione deve poter
// recuperare nome, anno, scadenza e logo del concorso PRIMA che l'utente faccia
// login (anzi, senza fare login affatto).
//
// La rule non espone informazioni private: dati sensibili come email del referente,
// presidente, audit ecc. sono in altre collection con rule restrittive.

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('concorsi');
  // Mantiene l'accesso completo agli autenticati (rule precedente da lockdown_v2)
  // e aggiunge un ramo pubblico ristretto solo a concorsi aperti alle iscrizioni.
  const publicOpen = '(stato = "ATTIVO" && iscrizioni_aperte = true)';
  c.listRule = `${publicOpen} || @request.auth.id != ""`;
  c.viewRule = `${publicOpen} || @request.auth.id != ""`;
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('concorsi');
  c.listRule = '@request.auth.id != ""';
  c.viewRule = '@request.auth.id != ""';
  dao.saveCollection(c);
});
