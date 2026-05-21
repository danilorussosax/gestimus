/// <reference path="../pb_data/types.d.ts" />

// Aggiunge il campo file `logo` al concorso: immagine personalizzata
// che sostituisce il logo applicativo nelle stampe PDF (verbali, protocollo)
// e nell'header dell'app quando il concorso è attivo.

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('concorsi');
  c.schema.addField(new SchemaField({
    name: 'logo',
    type: 'file',
    options: {
      maxSelect: 1,
      maxSize: 5242880,
      mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
    },
  }));
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('concorsi');
  const f = c.schema.getFieldByName('logo');
  if (f) c.schema.removeField(f.id);
  dao.saveCollection(c);
});
