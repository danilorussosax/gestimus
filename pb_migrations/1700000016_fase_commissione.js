/// <reference path="../pb_data/types.d.ts" />

// Aggiunge il campo `commissione` (relation singola opzionale) alla collection
// `fasi`. Permette di assegnare una commissione preesistente del concorso ad
// una fase: quando impostato, i commissari della fase sono quelli della
// commissione (sostituisce/ignora `commissari_ids`).

migrate((db) => {
  const dao = new Dao(db);
  const fasi = dao.findCollectionByNameOrId('fasi');
  const commissioni = dao.findCollectionByNameOrId('commissioni');
  if (!fasi.schema.getFieldByName('commissione')) {
    fasi.schema.addField(new SchemaField({
      name: 'commissione',
      type: 'relation',
      required: false,
      options: {
        collectionId: commissioni.id,
        cascadeDelete: false,
        maxSelect: 1,
        minSelect: 0,
      },
    }));
    dao.saveCollection(fasi);
  }
}, (db) => {
  const dao = new Dao(db);
  const fasi = dao.findCollectionByNameOrId('fasi');
  const f = fasi.schema.getFieldByName('commissione');
  if (f) {
    fasi.schema.removeField(f.id);
    dao.saveCollection(fasi);
  }
});
