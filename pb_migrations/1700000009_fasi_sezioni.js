/// <reference path="../pb_data/types.d.ts" />

// Aggiunge `fasi.sezioni` (relation multi → sezioni).
// Convenzione:
//   • array vuoto / null  → fase unica, valida per tutte le sezioni del concorso
//   • array con 1+ ids    → fase limitata SOLO a quelle sezioni

migrate((db) => {
  const dao = new Dao(db);
  const sezioni = dao.findCollectionByNameOrId('sezioni');
  const fasi = dao.findCollectionByNameOrId('fasi');
  if (!fasi.schema.getFieldByName('sezioni')) {
    fasi.schema.addField(new SchemaField({
      name: 'sezioni',
      type: 'relation',
      options: { collectionId: sezioni.id, cascadeDelete: false, maxSelect: 99, minSelect: 0 },
    }));
    dao.saveCollection(fasi);
  }
}, (db) => {
  const dao = new Dao(db);
  const fasi = dao.findCollectionByNameOrId('fasi');
  const f = fasi.schema.getFieldByName('sezioni');
  if (f) { fasi.schema.removeField(f.id); dao.saveCollection(fasi); }
});
