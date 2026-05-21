/// <reference path="../pb_data/types.d.ts" />

// Aggiunge il flag `anonimo` a concorsi: quando true, i commissari vedono
// solo il numero candidato (e lo strumento) durante la valutazione — niente
// nome/cognome/foto/data nascita/nazionalità.

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('concorsi');
  c.schema.addField(new SchemaField({
    name: 'anonimo',
    type: 'bool',
    options: {},
  }));
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('concorsi');
  c.schema.removeField(c.schema.getFieldByName('anonimo')?.id);
  dao.saveCollection(c);
});
