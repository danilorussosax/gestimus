/// <reference path="../pb_data/types.d.ts" />

// Rimuove il campo `cv` dalla collection `candidati`.
// Motivazione: per concorsi con molti partecipanti (es. 50k) i CV gonfiano il disco
// in modo sproporzionato rispetto al loro valore di review. I CV per i commissari
// (collection `commissari`) restano invariati: sono pochi e fortemente opzionali.
//
// I file CV già caricati restano fisicamente nel filesystem fino a un purge esplicito
// con `pocketbase admin purge --dry-run=false` o ricreazione del DB; PocketBase ignora
// il campo eliminato lato API.

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('candidati');
  const field = c.schema.getFieldByName('cv');
  if (field) {
    c.schema.removeField(field.id);
    dao.saveCollection(c);
  }
}, (db) => {
  // Down: ricrea il campo identico all'originale (1700000001_init.js).
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('candidati');
  if (!c.schema.getFieldByName('cv')) {
    c.schema.addField(new SchemaField({
      name: 'cv',
      type: 'file',
      options: { maxSelect: 1, maxSize: 5242880 },
    }));
    dao.saveCollection(c);
  }
});
