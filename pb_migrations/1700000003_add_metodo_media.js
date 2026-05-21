/// <reference path="../pb_data/types.d.ts" />

// Adds the `metodo_media` select field to fasi: how to aggregate per-commissario weighted scores
// into the final candidate score. Values:
//   aritmetica       — simple arithmetic mean (default, current behavior)
//   olimpica         — drop highest and lowest, mean of the rest
//   winsorizzata     — cap top/bottom to inner values, then mean
//   mediana          — median of the votes
//   deviazione_std   — drop votes outside mean±2σ, then mean

migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('fasi');
  collection.schema.addField(new SchemaField({
    name: 'metodo_media',
    type: 'select',
    options: { maxSelect: 1, values: ['aritmetica', 'olimpica', 'winsorizzata', 'mediana', 'deviazione_std'] },
  }));
  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('fasi');
  const f = collection.schema.getFieldByName('metodo_media');
  if (f) {
    collection.schema.removeField(f.id);
    dao.saveCollection(collection);
  }
});
