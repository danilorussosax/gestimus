/// <reference path="../pb_data/types.d.ts" />

// Adds the `tempo_minuti` field to fasi: tempo disponibile per ciascun candidato in minuti.
// 0 = tempo illimitato.

migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('fasi');
  if (!collection.schema.getFieldByName('tempo_minuti')) {
    collection.schema.addField(new SchemaField({
      name: 'tempo_minuti',
      type: 'number',
      options: { min: 0, max: 600, noDecimal: true },
    }));
    dao.saveCollection(collection);
  }
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('fasi');
  const f = collection.schema.getFieldByName('tempo_minuti');
  if (f) { collection.schema.removeField(f.id); dao.saveCollection(collection); }
});
